/// <reference types="vite/client" />

import 'vite/types/customEvent';

declare module 'vite/types/customEvent' {
  interface CustomEventMap {
    'twick:meta': {source: string; data: any};
    'twick:meta-ack': {source: string};
    'twick:export': {
      data: string;
      subDirectories: string[];
      mimeType: string;
      frame: number;
      sceneFrame?: number;
      groupByScene?: boolean;
    };
    'twick:export-ack': {frame: number};
    'twick:assets': {urls: string[]};
  }
}
