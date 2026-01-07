import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: {
    resolve: true
  },
  sourcemap: true,
  clean: true,
  external: [
    "fluent-ffmpeg",
    "@ffmpeg-installer/ffmpeg",
    "@ffprobe-installer/ffprobe",
    "@twick/core",
    "@twick/telemetry"
  ],
  tsconfig: "./tsconfig.build.json"
});
