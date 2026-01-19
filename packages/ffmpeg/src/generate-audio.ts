import type {AssetInfo, FfmpegExporterOptions} from '@twick/core';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Import fluent-ffmpeg - handle both ESM and CJS
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const ffmpeg = require('fluent-ffmpeg');
import {extensions} from './ffmpeg-exporter-server';
import {ffmpegSettings} from './settings';
import type {AudioCodec} from './utils';
import {
  checkForAudioStream,
  getSampleRate,
  makeSureFolderExists,
  mergeAudioWithVideo,
  resolvePath,
} from './utils';

export const audioCodecs: Record<FfmpegExporterOptions['format'], AudioCodec> =
  {
    mp4: 'aac',
    webm: 'libopus',
    proRes: 'aac',
  };

interface MediaAsset {
  key: string;
  src: string;
  type: 'video' | 'audio';
  startInVideo: number;
  endInVideo: number;
  duration: number;
  playbackRate: number;
  volume: number;
  trimLeftInSeconds: number;
  durationInSeconds: number;
}

const SAMPLE_RATE = 48000;

function getAssetPlacement(frames: AssetInfo[][]): MediaAsset[] {
  const assets: MediaAsset[] = [];

  // A map to keep track of the first and last currentTime for each asset.
  const assetTimeMap = new Map<string, {start: number; end: number}>();

  for (let frame = 0; frame < frames.length; frame++) {
    for (const asset of frames[frame]) {
      if (!assetTimeMap.has(asset.key)) {
        // If the asset is not in the map, add it with its current time as both start and end.
        assetTimeMap.set(asset.key, {
          start: asset.currentTime,
          end: asset.currentTime,
        });
        assets.push({
          key: asset.key,
          src: asset.src,
          type: asset.type,
          startInVideo: frame,
          endInVideo: frame,
          duration: 0, // Placeholder, will be recalculated later based on frames
          durationInSeconds: 0, // Placeholder, will be calculated based on currentTime
          playbackRate: asset.playbackRate,
          volume: asset.volume,
          trimLeftInSeconds: asset.currentTime,
        });
      } else {
        // If the asset is already in the map, update the end time.
        const timeInfo = assetTimeMap.get(asset.key);
        if (timeInfo) {
          timeInfo.end = asset.currentTime;
          assetTimeMap.set(asset.key, timeInfo);
        }

        const existingAsset = assets.find(a => a.key === asset.key);
        if (existingAsset) {
          existingAsset.endInVideo = frame;
        }
      }
    }
  }

  // Calculate the duration based on frame count and durationInSeconds based on currentTime.
  assets.forEach(asset => {
    const timeInfo = assetTimeMap.get(asset.key);
    if (timeInfo) {
      // Calculate durationInSeconds based on the start and end currentTime values.
      asset.durationInSeconds =
        (timeInfo.end - timeInfo.start) / asset.playbackRate;
      
      console.log(`[getAssetPlacement] Asset ${asset.key}:`);
      console.log(`  - currentTime range: ${timeInfo.start} to ${timeInfo.end}`);
      console.log(`  - durationInSeconds (from currentTime): ${asset.durationInSeconds}`);
    }
    // Recalculate the original duration based on frame count.
    asset.duration = asset.endInVideo - asset.startInVideo + 1;
    console.log(`  - frame range: ${asset.startInVideo} to ${asset.endInVideo}`);
    console.log(`  - duration (frames): ${asset.duration}`);
  });

  return assets;
}

function calculateAtempoFilters(playbackRate: number) {
  const atempoFilters = [];

  // Calculate how many times we need to 100x the speed
  let rate = playbackRate;
  while (rate > 100.0) {
    atempoFilters.push('atempo=100.0');
    rate /= 100.0;
  }
  // Add the last atempo filter with the remaining rate
  if (rate > 1.0) {
    atempoFilters.push(`atempo=${rate}`);
  }

  // Calculate how many times we need to halve the speed
  rate = playbackRate;
  while (rate < 0.5) {
    atempoFilters.push('atempo=0.5');
    rate *= 2.0;
  }
  // Add the last atempo filter with the remaining rate
  if (rate < 1.0) {
    atempoFilters.push(`atempo=${rate}`);
  }

  return atempoFilters;
}
async function prepareAudio(
  outputDir: string,
  tempDir: string,
  asset: MediaAsset,
  startFrame: number,
  endFrame: number,
  fps: number,
): Promise<string> {
  console.log(`[prepareAudio] Processing asset: ${asset.key}`);
  console.log(`[prepareAudio] Asset src: ${asset.src}`);
  console.log(`[prepareAudio] Asset type: ${asset.type}`);
  console.log(`[prepareAudio] Playback rate: ${asset.playbackRate}`);
  console.log(`[prepareAudio] Volume: ${asset.volume}`);
  
  // Construct the output path
  const sanitizedKey = asset.key.replace(/[/[\]]/g, '-');
  const outputPath = path.join(tempDir, `${sanitizedKey}.wav`);
  console.log(`[prepareAudio] Output path: ${outputPath}`);

  const trimLeft = asset.trimLeftInSeconds / asset.playbackRate;
  
  // Calculate duration from frames if durationInSeconds is 0 or suspiciously small
  let effectiveDurationInSeconds = asset.durationInSeconds;
  if (effectiveDurationInSeconds < 0.1) {
    // Fallback: use frame-based duration
    effectiveDurationInSeconds = asset.duration / fps;
    console.log(`[prepareAudio] WARNING: durationInSeconds was ${asset.durationInSeconds}, using frame-based duration: ${effectiveDurationInSeconds}s`);
  }
  
  const trimRight =
    1 / fps +
    Math.min(
      trimLeft + effectiveDurationInSeconds,
      trimLeft + (endFrame - startFrame) / fps,
    );
  const padStart = (asset.startInVideo / fps) * 1000;
  
  console.log(`[prepareAudio] Trim calculation:`);
  console.log(`  - trimLeft: ${trimLeft}s`);
  console.log(`  - effectiveDurationInSeconds: ${effectiveDurationInSeconds}s`);
  console.log(`  - trimRight: ${trimRight}s`);
  console.log(`  - padStart: ${padStart}ms`);
  
  const resolvedPath = resolvePath(outputDir, asset.src);
  console.log(`[prepareAudio] Resolved path: ${resolvedPath}`);
  
  const assetSampleRate = await getSampleRate(resolvedPath);
  console.log(`[prepareAudio] Sample rate: ${assetSampleRate}`);

  const padEnd = Math.max(
    0,
    (assetSampleRate * (endFrame - startFrame + 1)) / fps -
      (assetSampleRate * asset.duration) / fps -
      (assetSampleRate * padStart) / 1000,
  );

  const atempoFilters = calculateAtempoFilters(asset.playbackRate); // atempo filter value must be >=0.5 and <=100. If the value is higher or lower, this function sets multiple atempo filters
  console.log(`[prepareAudio] Atempo filters: ${atempoFilters.join(', ')}`);

  await new Promise<void>((resolve, reject) => {
    const audioFilters = [
      ...atempoFilters,
      `atrim=start=${trimLeft}:end=${trimRight}`,
      `apad=pad_len=${padEnd}`,
      `adelay=${padStart}|${padStart}|${padStart}`,
      `volume=${asset.volume}`,
    ].join(',');

    console.log(`[prepareAudio] Audio filters: ${audioFilters}`);
    console.log(`[prepareAudio] Starting ffmpeg processing...`);

    ffmpeg.setFfmpegPath(ffmpegSettings.getFfmpegPath());
    ffmpeg(resolvedPath)
      .audioChannels(2)
      .audioCodec('pcm_s16le')
      .audioFrequency(SAMPLE_RATE)
      .outputOptions([`-af`, audioFilters])
      .on('end', () => {
        console.log(`[prepareAudio] Successfully processed audio for ${asset.key}`);
        resolve();
      })
      .on('error', (err: Error) => {
        console.error(`[prepareAudio] Error processing audio for asset key: ${asset.key}`, err);
        reject(err);
      })
      .save(outputPath);
  });

  console.log(`[prepareAudio] Audio file saved: ${outputPath}`);
  return outputPath;
}

async function mergeAudioTracks(
  tempDir: string,
  audioFilenames: string[],
): Promise<void> {
  console.log(`[mergeAudioTracks] Starting merge of ${audioFilenames.length} tracks`);
  audioFilenames.forEach((filename, idx) => {
    console.log(`[mergeAudioTracks] Track ${idx + 1}: ${filename}`);
  });
  
  const outputPath = path.join(tempDir, `audio.wav`);
  console.log(`[mergeAudioTracks] Output path: ${outputPath}`);
  
  return new Promise((resolve, reject) => {
    ffmpeg.setFfmpegPath(ffmpegSettings.getFfmpegPath());
    const command = ffmpeg();

    audioFilenames.forEach(filename => {
      command.input(filename);
    });

    const complexFilter = `amix=inputs=${audioFilenames.length}:duration=longest,volume=${audioFilenames.length}`;
    console.log(`[mergeAudioTracks] Complex filter: ${complexFilter}`);

    command
      .complexFilter([complexFilter])
      .outputOptions(['-c:a', 'pcm_s16le'])
      .on('end', () => {
        console.log(`[mergeAudioTracks] Successfully merged audio tracks to: ${outputPath}`);
        resolve();
      })
      .on('error', (err: Error) => {
        console.error(`[mergeAudioTracks] Error merging audio tracks:`, err);
        reject(err);
      })
      .save(outputPath);
  });
}

export async function generateAudio({
  outputDir,
  tempDir,
  assets,
  startFrame,
  endFrame,
  fps,
}: {
  outputDir: string;
  tempDir: string;
  assets: AssetInfo[][];
  startFrame: number;
  endFrame: number;
  fps: number;
}) {
  console.log(`[generateAudio] Starting audio generation`);
  console.log(`[generateAudio] Output dir: ${outputDir}`);
  console.log(`[generateAudio] Temp dir: ${tempDir}`);
  console.log(`[generateAudio] Start frame: ${startFrame}, End frame: ${endFrame}`);
  console.log(`[generateAudio] FPS: ${fps}`);
  console.log(`[generateAudio] Total frames: ${assets.length}`);
  
  const fullTempDir = path.join(os.tmpdir(), tempDir);
  console.log(`[generateAudio] Full temp dir: ${fullTempDir}`);
  
  await makeSureFolderExists(outputDir);
  await makeSureFolderExists(fullTempDir);

  const assetPositions = getAssetPlacement(assets);
  console.log(`[generateAudio] Found ${assetPositions.length} unique assets`);
  
  assetPositions.forEach((asset, idx) => {
    console.log(`[generateAudio] Asset ${idx + 1}: key=${asset.key}, src=${asset.src}, type=${asset.type}, playbackRate=${asset.playbackRate}, volume=${asset.volume}`);
  });
  
  const audioFilenames: string[] = [];

  for (const asset of assetPositions) {
    console.log(`[generateAudio] Processing asset: ${asset.key}`);
    
    let hasAudioStream = true;
    if (asset.type !== 'audio') {
      const resolvedPath = resolvePath(outputDir, asset.src);
      console.log(`[generateAudio] Checking for audio stream in: ${resolvedPath}`);
      hasAudioStream = await checkForAudioStream(resolvedPath);
      console.log(`[generateAudio] Has audio stream: ${hasAudioStream}`);
    }

    if (asset.playbackRate !== 0 && asset.volume !== 0 && hasAudioStream) {
      console.log(`[generateAudio] Asset ${asset.key} will be processed (playbackRate=${asset.playbackRate}, volume=${asset.volume}, hasAudio=${hasAudioStream})`);
      const filename = await prepareAudio(
        outputDir,
        fullTempDir,
        asset,
        startFrame,
        endFrame,
        fps,
      );
      audioFilenames.push(filename);
      console.log(`[generateAudio] Added audio file to list: ${filename}`);
    } else {
      console.log(`[generateAudio] Skipping asset ${asset.key} (playbackRate=${asset.playbackRate}, volume=${asset.volume}, hasAudio=${hasAudioStream})`);
    }
  }

  console.log(`[generateAudio] Total audio files to merge: ${audioFilenames.length}`);

  if (audioFilenames.length > 0) {
    console.log(`[generateAudio] Merging ${audioFilenames.length} audio tracks...`);
    await mergeAudioTracks(fullTempDir, audioFilenames);
    console.log(`[generateAudio] Audio tracks merged successfully`);
  } else {
    console.warn(`[generateAudio] No audio files to merge!`);
  }

  return audioFilenames;
}

export async function mergeMedia(
  outputFilename: string,
  outputDir: string,
  tempDir: string,
  format: FfmpegExporterOptions['format'],
) {
  console.log(`[mergeMedia] Starting media merge`);
  console.log(`[mergeMedia] Output filename: ${outputFilename}`);
  console.log(`[mergeMedia] Output dir: ${outputDir}`);
  console.log(`[mergeMedia] Temp dir: ${tempDir}`);
  console.log(`[mergeMedia] Format: ${format}`);
  
  const fullTempDir = path.join(os.tmpdir(), tempDir);
  console.log(`[mergeMedia] Full temp dir: ${fullTempDir}`);
  
  await makeSureFolderExists(outputDir);
  await makeSureFolderExists(fullTempDir);

  const audioWavPath = path.join(fullTempDir, `audio.wav`);
  const audioWavExists = fs.existsSync(audioWavPath);
  console.log(`[mergeMedia] Audio WAV exists: ${audioWavExists} (${audioWavPath})`);
  
  const visualsPath = path.join(fullTempDir, `visuals.${extensions[format]}`);
  const visualsExists = fs.existsSync(visualsPath);
  console.log(`[mergeMedia] Visuals exist: ${visualsExists} (${visualsPath})`);
  
  const outputPath = path.join(outputDir, `${outputFilename}.${extensions[format]}`);
  
  if (audioWavExists) {
    console.log(`[mergeMedia] Merging audio and video...`);
    await mergeAudioWithVideo(
      audioWavPath,
      visualsPath,
      outputPath,
      audioCodecs[format],
    );
    console.log(`[mergeMedia] Successfully merged audio and video to: ${outputPath}`);
  } else {
    console.log(`[mergeMedia] No audio found, copying video only...`);
    await fs.promises.copyFile(visualsPath, outputPath);
    console.log(`[mergeMedia] Successfully copied video to: ${outputPath}`);
  }
  
  if (fullTempDir.endsWith('-undefined')) {
    console.log(`[mergeMedia] Cleaning up temp directory: ${fullTempDir}`);
    await fs.promises
      .rm(fullTempDir, {recursive: true, force: true})
      .catch((err) => {
        console.warn(`[mergeMedia] Failed to clean up temp directory:`, err);
      });
  }
  
  console.log(`[mergeMedia] Media merge completed`);
}
