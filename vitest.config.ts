import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
    alias: {
      "webextension-polyfill": fileURLToPath(
        new URL("./test/mocks/webextension-polyfill.ts", import.meta.url),
      ),
    },
  },
});
