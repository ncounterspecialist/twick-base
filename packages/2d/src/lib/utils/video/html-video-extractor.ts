/**
 * Alternative video frame extractor using HTML Video Element
 * This works with any video format the browser supports (no Mp4Box limitations)
 * 
 * Usage: Instead of Mp4Parser, this uses the browser's native video element
 * to seek to specific times and capture frames
 */

export class HTMLVideoFrameExtractor {
  private video: HTMLVideoElement;
  private lastTime: number = -1;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  
  constructor(private src: string) {
    this.video = document.createElement('video');
    this.video.crossOrigin = 'anonymous';
    this.video.preload = 'auto';
    this.video.src = src;
    this.video.muted = true;
    
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }
  
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timeout loading video metadata'));
      }, 30000);
      
      this.video.addEventListener('loadedmetadata', () => {
        clearTimeout(timeout);
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
        resolve();
      }, { once: true });
      
      this.video.addEventListener('error', () => {
        clearTimeout(timeout);
        reject(new Error('Failed to load video'));
      }, { once: true });
    });
  }
  
  async getFrameAt(time: number): Promise<ImageBitmap> {
    // Only seek if time changed
    if (Math.abs(this.video.currentTime - time) > 0.016) { // ~1 frame tolerance
      await this.seekTo(time);
    }
    
    // Draw current frame to canvas
    this.ctx.drawImage(this.video, 0, 0);
    
    // Create ImageBitmap from canvas
    return createImageBitmap(this.canvas);
  }
  
  private async seekTo(time: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Seek timeout at ${time}s`));
      }, 5000);
      
      const onSeeked = () => {
        clearTimeout(timeout);
        this.video.removeEventListener('seeked', onSeeked);
        resolve();
      };
      
      this.video.addEventListener('seeked', onSeeked, { once: true });
      this.video.currentTime = time;
    });
  }
  
  getDuration(): number {
    return this.video.duration || 0;
  }
  
  getTime(): number {
    return this.video.currentTime;
  }
  
  getLastTime(): number {
    return this.lastTime;
  }
  
  close(): void {
    this.video.src = '';
    this.video.load();
  }
}

// Cache of extractors
const htmlVideoExtractors = new Map<string, HTMLVideoFrameExtractor>();

export async function getFrameHTML(
  id: string,
  filePath: string,
  time: number,
  fps: number,
): Promise<ImageBitmap> {
  const extractorId = filePath + '-' + id;
  let extractor = htmlVideoExtractors.get(extractorId);

  if (!extractor) {
    extractor = new HTMLVideoFrameExtractor(filePath);
    await extractor.start();
    htmlVideoExtractors.set(extractorId, extractor);
  }
  
  // Get the frame at the specified time
  return extractor.getFrameAt(time);
}

export function dropHTMLExtractor(id: string, filePath: string) {
  const extractorId = filePath + '-' + id;
  const extractor = htmlVideoExtractors.get(extractorId);
  if (extractor) {
    extractor.close();
    htmlVideoExtractors.delete(extractorId);
  }
}
