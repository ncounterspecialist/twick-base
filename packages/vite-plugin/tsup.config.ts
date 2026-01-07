import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: {
    resolve: true,
    compilerOptions: {
      skipLibCheck: true
    }
  },
  sourcemap: true,
  clean: true,
  external: [
    /^@twick\//,
    "vite",
    "lightningcss",
    "postcss",
    "fast-glob",
    "follow-redirects",
    "formidable",
    "mime-types",
    "source-map"
  ],
  tsconfig: "./tsconfig.build.json"
});
