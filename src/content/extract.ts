import { extractDiscussion } from "./extract-core";

declare global {
  // eslint-disable-next-line no-var
  var __diskussionsanalyseExtract: ((url: string) => unknown) | undefined;
}

globalThis.__diskussionsanalyseExtract = (url: string) => {
  try {
    return extractDiscussion(document, url);
  } catch (e) {
    return { __error: String(e) };
  }
};
