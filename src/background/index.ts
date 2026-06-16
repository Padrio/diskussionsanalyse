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

/** Gesture entry point. sidebarAction.open() MUST be the first call here, with
 *  no `await` before it, or Firefox rejects it ("only from a user input handler"). */
function trigger(tab?: Tab): void {
  browser.sidebarAction
    .open()
    .catch((e) => console.error("Sidebar konnte nicht geöffnet werden:", String(e)));
  void analyze(tab);
}

async function resolveTab(tab?: Tab): Promise<Tab | undefined> {
  if (tab?.id != null) return tab;
  const [active] = await browser.tabs.query({ active: true, currentWindow: true });
  return active;
}

async function analyze(tab?: Tab): Promise<void> {
  try {
    const target = await resolveTab(tab);
    if (target?.id == null) {
      return;
    }

    await browser.storage.session.set({
      analyzing: true,
      lastExtraction: null,
      lastExtractionError: null,
    });
    notify({ type: "ANALYZING" });

    await browser.scripting.executeScript({
      target: { tabId: target.id },
      files: ["src/content/extract.js"],
    });

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
    console.error("Analyse-Fehler:", String(e));
    await browser.storage.session.set({
      lastExtractionError: String(e),
      lastExtraction: null,
      analyzing: false,
    });
    notify({ type: "EXTRACTION_ERROR", payload: String(e) });
  }
}

browser.action.onClicked.addListener((tab) => trigger(tab));
browser.menus.onClicked.addListener((_info, tab) => trigger(tab));
browser.commands.onCommand.addListener((cmd) => {
  if (cmd === "analyze-page") trigger();
});
