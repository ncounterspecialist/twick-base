#!/usr/bin/env node

import {EventName, sendEvent} from '@twick/telemetry';
import {Command} from 'commander';
import {launchEditor} from './editor';
import {createServer} from './server/index';

const program = new Command();

const VERSION = '0.10.4';

program
  .name('twick')
  .description('CLI to interact with the twick service')
  .version(VERSION);

program
  .command('serve')
  .description(
    'Exposes a render endpoint to render videos from a project file. Automatically rebuilds the project when the project file changes. Use for local development.',
  )
  .option(
    '--projectFile <path>',
    'Path to the project file',
    './src/project.ts',
  )
  .option('--port <number>', 'Port on which to start the server', '4000')
  .action(async options => {
    sendEvent(EventName.CLICommand);

    const {projectFile, port} = options;
    process.env.PROJECT_FILE = projectFile;
    process.env.TWICK_PORT = port;

    createServer().listen(port, () => {
      console.log(`Server listening on port ${port}`);
      console.log();
    });
  });

program
  .command('editor')
  .description('Start the twick editor')
  .option(
    '--projectFile <path>',
    'Path to the project file',
    './src/project.ts',
  )
  .option('--port <number>', 'Port on which to start the server', '9000')
  .action(async options => {
    const editor = await launchEditor(options.projectFile, options.port);
    console.log(`Editor running on port ${editor.config.server.port}`);
  });

program.parse(process.argv);
