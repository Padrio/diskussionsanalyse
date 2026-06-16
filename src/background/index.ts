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

    // Hand off via storage.session (survives event-page unload) + a live push.
    await browser.storage.session.set({ lastExtraction: result });
    await browser.storage.session.remove("lastExtractionError");
    const msg: RuntimeMessage = { type: "EXTRACTION_RESULT", payload: result };
    await browser.runtime.sendMessage(msg).catch(() => {
      /* sidebar not ready yet — it pulls from storage.session on load */
    });
  } catch (e) {
    await browser.storage.session.set({ lastExtractionError: String(e) });
    await browser.storage.session.remove("lastExtraction");
    const err: RuntimeMessage = { type: "EXTRACTION_ERROR", payload: String(e) };
    await browser.runtime.sendMessage(err).catch(() => {
      /* ignore */
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
