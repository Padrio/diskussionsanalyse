import browser from "webextension-polyfill";
import type { ExtractionResult, RuntimeMessage } from "../lib/types";

type Tab = Awaited<ReturnType<typeof browser.tabs.query>>[number];

const MENU_ID = "diskussionsanalyse-analyze";

browser.runtime.onInstalled.addListener(() => {
  browser.menus.create({
    id: MENU_ID,
    title: "Diskussion analysieren",
    contexts: ["page", "selection", "link"],
  });
});

/** Live push to the sidebar (primary channel when it is open). */
function notify(msg: RuntimeMessage): void {
  browser.runtime.sendMessage(msg).catch(() => {
    /* no receiver (sidebar closed) — storage.session covers cold open */
  });
}

async function resolveTab(tab?: Tab): Promise<Tab | undefined> {
  if (tab?.id != null) return tab;
  const [active] = await browser.tabs.query({ active: true, currentWindow: true });
  return active;
}

async function analyze(tab?: Tab): Promise<void> {
  const target = await resolveTab(tab);
  if (target?.id == null) return;

  // sidebarAction.open() must be called from within the user-gesture handler.
  await browser.sidebarAction.open();

  // Handoff: a live runtime message for the open sidebar, plus storage.session
  // (survives event-page unload) so a freshly opened sidebar can pull on load.
  await browser.storage.session.set({
    analyzing: true,
    lastExtraction: null,
    lastExtractionError: null,
  });
  notify({ type: "ANALYZING" });

  try {
    // 1. Inject the bundled extractor (sets the globalThis factory).
    await browser.scripting.executeScript({
      target: { tabId: target.id },
      files: ["src/content/extract.js"],
    });
    // 2. Invoke it via `func` — the reliable executeScript return channel.
    const results = await browser.scripting.executeScript({
      target: { tabId: target.id },
      func: (url: string) =>
        (
          globalThis as unknown as {
            __diskussionsanalyseExtract?: (u: string) => unknown;
          }
        ).__diskussionsanalyseExtract?.(url),
      args: [target.url ?? ""],
    });

    const result = results[0]?.result as ExtractionResult | { __error: string } | undefined;
    if (!result || "__error" in result) {
      throw new Error(
        (result as { __error?: string } | undefined)?.__error ??
          "Extraktion lieferte kein Ergebnis.",
      );
    }

    await browser.storage.session.set({
      lastExtraction: result,
      lastExtractionError: null,
      analyzing: false,
    });
    notify({ type: "EXTRACTION_RESULT", payload: result });
  } catch (e) {
    await browser.storage.session.set({
      lastExtractionError: String(e),
      lastExtraction: null,
      analyzing: false,
    });
    notify({ type: "EXTRACTION_ERROR", payload: String(e) });
  }
}

browser.action.onClicked.addListener((tab) => {
  void analyze(tab);
});
browser.commands.onCommand.addListener((cmd) => {
  if (cmd === "analyze-page") void analyze();
});
browser.menus.onClicked.addListener((_info, tab) => {
  void analyze(tab);
});
