import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  assetsInclude: ["**/*.wasm"],
  build: {
    target: "chrome142",
  },
  worker: {
    format: "es",
  },
});
