import fs from 'fs';
import os from 'os';
import path from 'path';
import {PostHog} from 'posthog-node';

const Client = new PostHog('phc_XaPky8YDbZjqm4GkCWBsVmICZTOTgjascrsftSOoJUJ', {
  host: 'https://eu.posthog.com',
});

process.on('beforeExit', async () => {
  await Client.shutdown();
});

export enum EventName {
  RenderStarted = 'twick-render-started',
  ServerStarted = 'twick-server-started',
  CLICommand = 'twick-cli-command',
  CreateCommand = 'twick-create-command',
  Error = 'twick-error',
}

async function getCurrentVersion() {
  try {
    const packageData = JSON.parse(
      // Relative to this file: ../package.json
      await fs.promises.readFile(
        path.resolve(__dirname, '../package.json'),
        'utf-8',
      ),
    );

    return packageData.version;
  } catch (e) {
    return 'ERROR';
  }
}

async function getDistinctId() {
  try {
    return await fs.promises.readFile(
      path.resolve(os.homedir(), '.twick/id.txt'),
      'utf-8',
    );
  } catch (e) {
    return 'anonymous-user';
  }
}

export async function sendEvent(
  eventName: EventName,
  eventProperties: object = {},
) {
  if (process.env.DISABLE_TELEMETRY === 'true') {
    return;
  }

  try {
    const [version, distinctId] = await Promise.all([
      getCurrentVersion(),
      getDistinctId(),
    ]);

    Client.capture({
      distinctId,
      event: eventName,
      properties: {
        version,
        ...eventProperties,
      },
    });
  } catch (e) {
    // No-op
  }
}
