import browser from "webextension-polyfill";
import type { ExtractionResult, RuntimeMessage } from "../lib/types";

type Tab = Awaited<ReturnType<typeof browser.tabs.query>>[number];

const MENU_ID = "diskussionsanalyse-analyze";
const latestJob = new Map<number, string>();
const jobWrites = new Map<number, Promise<void>>();

async function saveJob(windowId: number, jobId: string, state: object): Promise<boolean> {
  const previous = jobWrites.get(windowId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(async () => {
    if (latestJob.get(windowId) === jobId) {
      await browser.storage.session.set({ [`analysisJob_${windowId}`]: { jobId, ...state } });
    }
  });
  jobWrites.set(windowId, next);
  await next;
  return latestJob.get(windowId) === jobId;
}

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
  let windowId: number | undefined;
  let jobId: string | undefined;
  try {
    const target = await resolveTab(tab);
    if (target?.id == null || target.windowId == null) {
      return;
    }
    windowId = target.windowId;
    jobId = crypto.randomUUID();
    latestJob.set(windowId, jobId);
    if (!await saveJob(windowId, jobId, { status: "extracting" })) return;
    notify({ type: "ANALYZING", windowId, jobId });

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

    if (latestJob.get(windowId) !== jobId) return;
    if (!await saveJob(windowId, jobId, { status: "ready", extraction: result })) return;
    notify({ type: "EXTRACTION_RESULT", payload: result, windowId, jobId });
  } catch (e) {
    console.error("Analyse-Fehler:", String(e));
    if (windowId == null || !jobId || latestJob.get(windowId) !== jobId) return;
    if (!await saveJob(windowId, jobId, { status: "error", error: String(e) })) return;
    notify({ type: "EXTRACTION_ERROR", payload: String(e), windowId, jobId });
  }
}

browser.action.onClicked.addListener((tab) => trigger(tab));
browser.menus.onClicked.addListener((_info, tab) => trigger(tab));
browser.commands.onCommand.addListener((cmd) => {
  if (cmd === "analyze-page") trigger();
});
