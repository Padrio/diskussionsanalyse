import browser from "webextension-polyfill";
import type { ExtractionResult } from "../lib/types";

type Tab = Awaited<ReturnType<typeof browser.tabs.query>>[number];

const MENU_ID = "diskussionsanalyse-analyze";

browser.runtime.onInstalled.addListener(() => {
  browser.menus.create({
    id: MENU_ID,
    title: "Diskussion analysieren",
    contexts: ["page", "selection", "link"],
  });
});

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

  // Hand off via storage.session (survives event-page unload); the sidebar
  // reacts through storage.onChanged. Mark "analyzing" so a cold-opened sidebar
  // shows the reading state while extraction runs.
  await browser.storage.session.set({
    analyzing: true,
    lastExtraction: null,
    lastExtractionError: null,
  });

  try {
    // 1. Inject the bundled extractor (sets the globalThis factory).
    //    NOTE: the emitted path is confirmed against dist in Phase 8.
    await browser.scripting.executeScript({
      target: { tabId: target.id },
      files: ["content/extract.js"],
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
  } catch (e) {
    await browser.storage.session.set({
      lastExtractionError: String(e),
      lastExtraction: null,
      analyzing: false,
    });
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
