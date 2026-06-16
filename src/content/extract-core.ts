import type { ExtractionResult } from "../lib/types";
import { extractGeneric } from "./extractors/generic";
import { extractHackerNews } from "./extractors/hackernews";
import { extractYouTube } from "./extractors/youtube";

export function extractDiscussion(doc: Document, url: string): ExtractionResult {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    /* keep generic */
  }
  if (host.endsWith("news.ycombinator.com")) return extractHackerNews(doc, url);
  if (host.endsWith("youtube.com")) return extractYouTube(doc, url);
  return extractGeneric(doc, url);
}
