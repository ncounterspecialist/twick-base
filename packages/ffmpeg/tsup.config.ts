import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: false, // Disable DTS generation - types come from @types/fluent-ffmpeg
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
