import path from 'path';
import type {Plugin} from 'vite';
import {
  assetsPlugin,
  editorPlugin,
  exporterPlugin,
  ffmpegBridgePlugin,
  metaPlugin,
  metricsPlugin,
  projectsPlugin,
  rivePlugin,
  settingsPlugin,
  wasmExporterPlugin,
  webglPlugin,
} from './partials';
import type {PluginOptions} from './plugins';
import {PLUGIN_OPTIONS, isPlugin} from './plugins';
import {getProjects} from './utils';

export interface MotionCanvasPluginConfig {
  /**
   * The import path of the project file or an array of paths.
   * Also supports globs.
   *
   * @remarks
   * Each file must contain a default export exposing an instance of the
   * {@link Project} class.
   *
   * @example
   * ```ts
   * motionCanvas({
   *   project: [
   *     './src/firstProject.ts',
   *     './src/secondProject.ts',
   *   ]
   * })
   * ```
   *
   * @defaultValue './src/project.ts'
   */
  project?: string | string[];
  /**
   * A directory path to which the animation will be rendered.
   *
   * @defaultValue './output'
   */
  output?: string;
  /**
   * Defines which assets should be buffered before being sent to the browser.
   *
   * @remarks
   * Streaming larger assets directly from the drive may cause issues with other
   * applications. For instance, if an audio file is being used in the project,
   * Adobe Audition will perceive it as "being used by another application"
   * and refuse to override it.
   *
   * Buffered assets are first loaded to the memory and then streamed from
   * there. This leaves the original files open for modification with hot module
   * replacement still working.
   *
   * @defaultValue /^$/
   */
  bufferedAssets?: RegExp | false;
  /**
   * The import path of the editor package.
   *
   * @remarks
   * This path will be resolved using Node.js module resolution rules.
   * It should lead to a directory containing the following files:
   * - `editor.html` - The HTML template for the editor.
   * - `styles.css` - The editor styles.
   * - `main.js` - A module exporting necessary factory functions.
   *
   * `main.js` should export the following functions:
   * - `editor` - Receives the project factory as its first argument and creates
   *              the user interface.
   * - `index` - Receives a list of all projects as its first argument and
   *             creates the initial page for selecting a project.
   *
   * @defaultValue '\@twick/ui'
   */
  editor?: string;

  /**
   * Build the project to run in the editor.
   */
  buildForEditor?: boolean;
}

export default ({
  project = './src/project.ts',
  output = './output',
  bufferedAssets = /^$/,
  editor = '@twick/ui',
  buildForEditor,
}: MotionCanvasPluginConfig = {}): Plugin[] => {
  const plugins: PluginOptions[] = [];
  const outputPath = path.resolve(output);
  const projects = getProjects(project);

  return [
    {
      name: 'twick',
      async configResolved(resolvedConfig) {
        plugins.push(
          ...resolvedConfig.plugins
            .filter(isPlugin)
            .map(plugin => plugin[PLUGIN_OPTIONS]),
        );
        await Promise.all(
          plugins.map(plugin =>
            plugin.config?.({
              output: outputPath,
              projects: projects.list,
            }),
          ),
        );
      },
    },
    metaPlugin(),
    settingsPlugin(),
    exporterPlugin({outputPath}),
    ffmpegBridgePlugin({output: outputPath}),
    editorPlugin({editor, projects}),
    projectsPlugin({projects, plugins, buildForEditor}),
    assetsPlugin({bufferedAssets}),
    wasmExporterPlugin(),
    rivePlugin(),
    webglPlugin(),
    metricsPlugin(),
  ];
};
