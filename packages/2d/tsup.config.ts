import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/lib/index.ts", "src/lib/jsx-dev-runtime.ts"],
  format: ["esm", "cjs"],
  dts: {
    resolve: true
  },
  sourcemap: true,
  clean: true,
  external: ["@twick/core"],
  tsconfig: "./src/lib/tsconfig.build.json"
});
