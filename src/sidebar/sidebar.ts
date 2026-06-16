import browser from "webextension-polyfill";
import type { ExtractionResult, RuntimeMessage, Settings } from "../lib/types";
import { getSettings } from "../lib/storage";
import { applyBudget, buildUserMessage } from "../lib/prompt";
import { AnthropicError, streamAnalysis } from "../lib/anthropic";
import { renderMarkdown, splitSections } from "./render";
import { createStore, type State } from "./state";

const headEl = document.getElementById("head")!;
const appEl = document.getElementById("app")!;
const actionsEl = document.getElementById("actions")!;

const store = createStore({ name: "empty", needsKey: false });
let abort: AbortController | null = null;
let settings: Settings | null = null;
let lastExtraction: ExtractionResult | null = null;

const OUTPUT_PRICE: Record<string, number> = {
  "claude-opus-4-8": 25,
  "claude-sonnet-4-6": 15,
  "claude-haiku-4-5": 5,
};

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function applyTheme(theme: Settings["theme"]): void {
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

function badge(t: ExtractionResult["siteType"]): { cls: string; label: string } {
  if (t === "hackernews") return { cls: "hn", label: "Hacker News" };
  if (t === "youtube") return { cls: "youtube", label: "YouTube" };
  return { cls: "web", label: "Webseite" };
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function headerHtml(x: ExtractionResult): string {
  const b = badge(x.siteType);
  const model = settings?.model ?? "";
  return `
    <h1 class="head-title">${esc(x.title || "Ohne Titel")}</h1>
    <div class="head-meta">
      <span class="badge ${b.cls}"><span class="dot"></span>${b.label}</span>
      <span class="host">${esc(hostOf(x.url))}</span>
      ${model ? `<span class="chip">${esc(model.replace("claude-", ""))}</span>` : ""}
    </div>`;
}

const EYE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;

function render(s: State): void {
  headEl.innerHTML = "";
  actionsEl.innerHTML = "";

  switch (s.name) {
    case "empty": {
      appEl.innerHTML = `
        <div class="center">
          <div class="mark">${EYE_SVG}</div>
          <p class="lede">Diskussionen lesen, ohne sie zu lesen.</p>
          <p class="sub">Öffne eine Artikel- oder Kommentarseite und starte die Analyse über das Toolbar-Icon, das Kontextmenü „Diskussion analysieren" oder <kbd>Strg+Shift+Y</kbd>.</p>
          ${
            s.needsKey
              ? `<button id="btn-options" class="btn-primary">Einstellungen öffnen</button>
                 <p class="sub">Es ist noch kein API-Key hinterlegt.</p>`
              : ""
          }
          <p class="privacy">${EYE_SVG_SMALL()} Seiteninhalt wird zur Analyse an Anthropic gesendet.</p>
        </div>`;
      appEl.querySelector("#btn-options")?.addEventListener("click", openOptions);
      break;
    }
    case "extracting": {
      appEl.innerHTML = `
        <div class="center">
          <div class="scan"></div>
          <p class="sub">Inhalt wird gelesen …</p>
        </div>`;
      break;
    }
    case "extracted":
    case "thinking": {
      headEl.innerHTML = headerHtml(s.extraction);
      const st = s.extraction.stats;
      const trunc = s.extraction.truncated
        ? `<p class="notice warn">Inhalt gekürzt — die Analyse beruht auf einer Teilmenge.</p>`
        : "";
      appEl.innerHTML = `
        ${trunc}
        <p class="notice">${st.commentCount > 0 ? `Artikel + ${st.commentCount} Kommentare erkannt` : "Beitrag erkannt"}.</p>
        <div class="thinking-row"><span class="dots"><i></i><i></i><i></i></span> Claude analysiert …</div>`;
      break;
    }
    case "streaming":
    case "done": {
      headEl.innerHTML = headerHtml(s.extraction);
      const sections = splitSections(s.markdown);
      appEl.innerHTML =
        sections
          .map(
            (sec) =>
              `<section class="card${sec.isBias ? " bias" : ""}"><h2>${esc(sec.title)}</h2><div class="body">${renderMarkdown(sec.bodyMd)}</div></section>`,
          )
          .join("") || `<div class="thinking-row"><span class="dots"><i></i><i></i><i></i></span> Claude analysiert …</div>`;

      if (s.name === "done") {
        const cost =
          s.outputTokens != null
            ? ` · ~$${((s.outputTokens / 1e6) * (OUTPUT_PRICE[settings?.model ?? ""] ?? 0)).toFixed(4)}`
            : "";
        const usage = s.outputTokens != null ? `${s.outputTokens} Output-Tokens${cost}` : "";
        actionsEl.innerHTML = `
          <div class="act-row">
            <button id="btn-copy" class="btn-ghost">Kopieren</button>
            <button id="btn-export" class="btn-ghost">Export .md</button>
            <button id="btn-reanalyze" class="btn-signal">Erneut</button>
            <span class="usage">${usage}</span>
          </div>`;
        actionsEl.querySelector("#btn-copy")?.addEventListener("click", () => {
          void navigator.clipboard.writeText(s.markdown);
          flash("#btn-copy", "Kopiert ✓");
        });
        actionsEl.querySelector("#btn-export")?.addEventListener("click", () => exportMd(s.extraction, s.markdown));
        actionsEl.querySelector("#btn-reanalyze")?.addEventListener("click", () => void runAnalysis(s.extraction));
      } else {
        actionsEl.innerHTML = `<div class="act-row"><button id="btn-stop" class="btn-ghost">Stopp</button><span class="usage">streamt …</span></div>`;
        actionsEl.querySelector("#btn-stop")?.addEventListener("click", () => abort?.abort());
      }
      break;
    }
    case "error": {
      if (s.extraction) headEl.innerHTML = headerHtml(s.extraction);
      appEl.innerHTML = `
        <div class="center">
          <div class="errbox">
            <div class="t">Fehler</div>
            <p>${esc(s.error.message)}</p>
            <div class="act-row">
              ${s.error.openOptions ? `<button id="btn-options" class="btn-primary">Einstellungen öffnen</button>` : ""}
              ${s.error.retryable && s.extraction ? `<button id="btn-retry" class="btn-ghost">Erneut versuchen</button>` : ""}
            </div>
          </div>
        </div>`;
      appEl.querySelector("#btn-options")?.addEventListener("click", openOptions);
      const ex = s.extraction;
      if (ex) appEl.querySelector("#btn-retry")?.addEventListener("click", () => void runAnalysis(ex));
      break;
    }
  }
}

function EYE_SVG_SMALL(): string {
  return `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" style="opacity:.7"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
}

function flash(sel: string, text: string): void {
  const btn = actionsEl.querySelector(sel);
  if (!(btn instanceof HTMLButtonElement)) return;
  const prev = btn.textContent;
  btn.textContent = text;
  setTimeout(() => {
    btn.textContent = prev;
  }, 1200);
}

function exportMd(x: ExtractionResult, markdown: string): void {
  const front = `# Diskussionsanalyse\n\n> ${x.title}\n> ${x.url}\n\n---\n\n`;
  const blob = new Blob([front + markdown], { type: "text/markdown" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "diskussionsanalyse.md";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function openOptions(): void {
  void browser.runtime.openOptionsPage();
}

async function runAnalysis(extraction: ExtractionResult): Promise<void> {
  lastExtraction = extraction;
  const cfg = await getSettings();
  settings = cfg;
  if (!cfg.apiKey) {
    store.set({ name: "empty", needsKey: true });
    return;
  }
  abort?.abort();
  abort = new AbortController();
  const signal = abort.signal;

  const budgeted = applyBudget(extraction, cfg.maxInputTokens);
  const userMessage = buildUserMessage(budgeted);

  store.set({ name: "thinking", extraction: budgeted });
  let markdown = "";
  let outputTokens: number | undefined;

  try {
    for await (const ev of streamAnalysis({ settings: cfg, userMessage, signal })) {
      if (ev.type === "text") {
        markdown += ev.text;
        store.set({ name: "streaming", extraction: budgeted, markdown });
      } else if (ev.type === "thinking") {
        // keep the thinking indicator; summarized thinking is not rendered in v1
      } else if (ev.type === "refusal") {
        store.set({
          name: "error",
          error: { code: "refusal", message: "Analyse aus Sicherheitsgründen abgelehnt.", retryable: false },
          extraction: budgeted,
        });
        return;
      } else if (ev.type === "usage") {
        outputTokens = ev.outputTokens;
      } else if (ev.type === "done") {
        store.set({ name: "done", extraction: budgeted, markdown, outputTokens });
      }
    }
  } catch (e) {
    if (signal.aborted) {
      // user stopped — settle on whatever was streamed
      store.set({ name: "done", extraction: budgeted, markdown, outputTokens });
      return;
    }
    const error =
      e instanceof AnthropicError
        ? e.uiError
        : { code: "network", message: "Verbindung verloren. Erneut versuchen.", retryable: true };
    store.set({ name: "error", error, extraction: budgeted });
  }
}

// ── handoff: live runtime messages (primary) + storage.session (cold open) ──
interface SessionState {
  lastExtraction?: ExtractionResult;
  lastExtractionError?: string | null;
  analyzing?: boolean;
}

function extractFailed(): void {
  store.set({
    name: "error",
    error: { code: "extract", message: "Seiteninhalt konnte nicht gelesen werden.", retryable: false },
  });
}

browser.runtime.onMessage.addListener((message: unknown) => {
  const m = message as RuntimeMessage;
  if (m.type === "EXTRACTION_RESULT") void runAnalysis(m.payload);
  else if (m.type === "EXTRACTION_ERROR") extractFailed();
  else if (m.type === "ANALYZING") store.set({ name: "extracting" });
});

// Auto-start once a key is saved while we are waiting with a cached extraction.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  const next = changes.settings.newValue as Partial<Settings> | undefined;
  const cur = store.get();
  if (next?.apiKey && cur.name === "empty" && cur.needsKey && lastExtraction) {
    void runAnalysis(lastExtraction);
  }
});

async function init(): Promise<void> {
  store.subscribe(render);
  settings = await getSettings();
  applyTheme(settings.theme);
  const sess = (await browser.storage.session.get([
    "lastExtraction",
    "lastExtractionError",
    "analyzing",
  ])) as SessionState;

  if (sess.lastExtraction) {
    void runAnalysis(sess.lastExtraction);
  } else if (sess.lastExtractionError) {
    store.set({
      name: "error",
      error: { code: "extract", message: "Seiteninhalt konnte nicht gelesen werden.", retryable: false },
    });
  } else if (sess.analyzing) {
    store.set({ name: "extracting" });
  } else {
    store.set({ name: "empty", needsKey: !settings.apiKey });
  }
}

void init();
