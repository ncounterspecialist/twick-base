import {EventName, sendEvent} from '@twick/telemetry';
import type {Plugin} from 'vite';

export function metricsPlugin(): Plugin {
  return {
    name: 'twick:metrics',

    async configResolved() {
      sendEvent(EventName.ServerStarted);
    },
  };
}
