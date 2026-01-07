import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/editor/index.ts"],
  format: ["esm"],
  dts: {
    resolve: true
  },
  sourcemap: true,
  outDir: "editor",
  clean: false, // Don't clean, let build-lib clean dist
  external: [
    /^@twick\//,
    /^@?preact/,
    "clsx"
  ],
  esbuildOptions(options) {
    options.jsx = 'automatic';
    options.jsxImportSource = 'preact';
    // Inject CSS as modules
    options.loader = {
      ...options.loader,
      '.scss': 'css',
      '.css': 'css',
    };
  },
  tsconfig: "./src/editor/tsup.config.json"
});
