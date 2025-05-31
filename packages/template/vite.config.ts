import preact from '@preact/preset-vite';
import {defineConfig} from 'vite';
import motionCanvas from '../vite-plugin/src/main';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@twick/ui',
        replacement: '@twick/ui/src/main.tsx',
      },
      {
        find: '@twick/2d/editor',
        replacement: '@twick/2d/src/editor',
      },
      {
        find: /@twick\/2d(\/lib)?/,
        replacement: '@twick/2d/src/lib',
      },
      {find: '@twick/core', replacement: '@twick/core/src'},
    ],
  },
  plugins: [
    preact({
      include: [
        /packages\/ui\/src\/(.*)\.tsx?$/,
        /packages\/2d\/src\/editor\/(.*)\.tsx?$/,
      ],
    }),
    motionCanvas({
      buildForEditor: false,
    }),
  ],
  build: {
    minify: false,
    rollupOptions: {
      output: {
        entryFileNames: '[name].js',
      },
    },
  },
});
