import { extractDiscussion } from "./extract-core";

declare global {
  // eslint-disable-next-line no-var
  var __diskussionsanalyseExtract: ((url: string) => Promise<unknown>) | undefined;
}

// Returns a Promise (YouTube uses an async Innertube fetch); executeScript({func})
// awaits the returned promise, so results[0].result is the resolved value.
globalThis.__diskussionsanalyseExtract = async (url: string) => {
  try {
    return await extractDiscussion(document, url);
  } catch (e) {
    return { __error: String(e) };
  }
};
