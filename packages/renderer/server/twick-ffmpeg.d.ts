/**
 * Declaration file for @twick/ffmpeg - the package has dts: false in tsup config.
 */
declare module '@twick/ffmpeg' {
  export type LogLevel =
    | 'quiet'
    | 'panic'
    | 'fatal'
    | 'error'
    | 'warning'
    | 'info'
    | 'verbose'
    | 'debug'
    | 'trace';

  export type FfmpegSettings = {
    ffmpegPath?: string;
    ffprobePath?: string;
    ffmpegLogLevel?: LogLevel;
  };

  export const ffmpegSettings: {
    getFfmpegPath(): string;
    setFfmpegPath(ffmpegPath: string): void;
    getFfprobePath(): string;
    setFfprobePath(ffprobePath: string): void;
    getLogLevel(): LogLevel;
    setLogLevel(logLevel: LogLevel): void;
  };

  export type AudioCodec = 'aac' | 'libopus';

  export const audioCodecs: Record<string, AudioCodec>;
  export const extensions: Record<string, string>;

  export function concatenateMedia(
    files: string[],
    outputFile: string,
  ): Promise<void>;

  export function createSilentAudioFile(
    filePath: string,
    duration: number,
  ): Promise<void>;

  export function doesFileExist(filePath: string): Promise<boolean>;

  export function getVideoDuration(filePath: string): Promise<number>;

  export function mergeAudioWithVideo(
    audioPath: string,
    videoPath: string,
    outputPath: string,
    audioCodec?: AudioCodec,
  ): Promise<void>;
}
