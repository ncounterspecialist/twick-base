import {renderVideo} from '@twick/renderer';

async function render() {
  console.log('Rendering video...');

  const file = await renderVideo({
    projectFile: './src/project.ts',
    variables: {fill: 'orange'},
    settings: {
      logProgress: true,
      projectSettings: {
        exporter: {
          name: '@twick/core/wasm',
        },
      },
    },
  });

  console.log(`Rendered video to ${file}`);
}

render();
