import fs from 'fs';
import os from 'os';
import path from 'path';
import {PostHog} from 'posthog-node';

let client: PostHog | null = null;

function isTelemetryEnabled(): boolean {
  if (process.env.DISABLE_TELEMETRY === 'true') {
    return false;
  }
  return process.env.TWICK_TELEMETRY_ENABLED === 'true';
}

function getTelemetryClient(): PostHog | null {
  if (!isTelemetryEnabled()) return null;
  if (client) return client;

  const apiKey = process.env.TWICK_TELEMETRY_API_KEY;
  if (!apiKey) return null;

  client = new PostHog(apiKey, {
    host: process.env.TWICK_TELEMETRY_HOST || 'https://eu.posthog.com',
  });
  return client;
}

process.on('beforeExit', async () => {
  await client?.shutdown();
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
  const telemetryClient = getTelemetryClient();
  if (!telemetryClient) return;

  try {
    const [version, distinctId] = await Promise.all([
      getCurrentVersion(),
      getDistinctId(),
    ]);

    telemetryClient.capture({
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
