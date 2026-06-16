import { defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";

export default defineConfig({
  plugins: [
    webExtension({
      browser: "firefox",
      manifest: "manifest.json",
      // extract.ts is injected programmatically (NOT a content_scripts entry),
      // so it must be declared here to be built into the bundle.
      additionalInputs: ["src/content/extract.ts"],
      webExtConfig: {
        // start on a thread-heavy page for fast manual testing
        startUrl: ["https://news.ycombinator.com/best"],
      },
    }),
  ],
});
