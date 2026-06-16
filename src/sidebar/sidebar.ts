import browser from "webextension-polyfill";
import type { ExtractionResult, RuntimeMessage, Settings } from "../lib/types";
import { getSettings } from "../lib/storage";
import { applyBudget, buildUserMessage } from "../lib/prompt";
import { AnthropicError, streamAnalysis, type ChatMessage } from "../lib/anthropic";
import { renderMarkdown, splitSections } from "./render";
import { createStore, type State } from "./state";

const headEl = document.getElementById("head")!;
const appEl = document.getElementById("app")!;
const actionsEl = document.getElementById("actions")!;

const store = createStore({ name: "empty", needsKey: false });
let abort: AbortController | null = null;
let settings: Settings | null = null;
let lastExtraction: ExtractionResult | null = null;

interface Convo {
  extraction: ExtractionResult;
  userMessage: string; // the built content message sent for the analysis
  analysis: string; // streamed analysis markdown
  qa: { q: string; a: string }[];
}
let convo: Convo | null = null;
type Phase = "analyzing" | "answering" | "idle";
let phase: Phase = "idle";
let outputTokens = 0;

const OUTPUT_PRICE: Record<string, number> = {
  "claude-opus-4-8": 25,
  "claude-sonnet-4-6": 15,
  "claude-haiku-4-5": 5,
};

const log = (...a: unknown[]): void => console.log("[DA sb]", ...a);
const DOTS = `<span class="dots"><i></i><i></i><i></i></span>`;

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

const EYE_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;
const EYE_SVG_SMALL = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" style="opacity:.7"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>`;

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

// ── reconciling renderers (stable DOM, entrance animation only on new nodes) ──

function renderSectionsInto(container: HTMLElement, markdown: string): void {
  const sections = splitSections(markdown);
  if (sections.length === 0) {
    if (!container.querySelector(".thinking-inline")) {
      container.innerHTML = `<div class="thinking-row thinking-inline">${DOTS} Claude analysiert …</div>`;
    }
    return;
  }
  // drop a non-card first child (e.g. the inline thinking row) before the first card lands
  if (container.firstElementChild && !container.firstElementChild.classList.contains("card")) {
    container.innerHTML = "";
  }
  sections.forEach((sec, i) => {
    let card = container.children[i] as HTMLElement | undefined;
    if (!card || !card.classList.contains("card")) {
      card = document.createElement("section");
      card.className = "card enter";
      card.innerHTML = `<h2></h2><div class="body"></div>`;
      container.appendChild(card);
    }
    card.classList.toggle("bias", sec.isBias);
    const h2 = card.querySelector("h2")!;
    if (h2.textContent !== sec.title) h2.textContent = sec.title;
    const body = card.querySelector(".body")!;
    const html = renderMarkdown(sec.bodyMd);
    if (body.innerHTML !== html) body.innerHTML = html;
  });
  while (container.children.length > sections.length) container.lastElementChild!.remove();
}

function renderQA(): void {
  const qaEl = document.getElementById("qa");
  if (!qaEl || !convo) return;
  convo.qa.forEach((turn, i) => {
    let block = qaEl.children[i] as HTMLElement | undefined;
    if (!block) {
      block = document.createElement("div");
      block.className = "qa enter";
      block.innerHTML = `<div class="q"></div><section class="card answer"><h2>Antwort</h2><div class="body"></div></section>`;
      qaEl.appendChild(block);
    }
    const q = block.querySelector(".q")!;
    if (q.textContent !== turn.q) q.textContent = turn.q;
    const body = block.querySelector(".answer .body")!;
    const html = turn.a ? renderMarkdown(turn.a) : DOTS;
    if (body.innerHTML !== html) body.innerHTML = html;
  });
  while (qaEl.children.length > convo.qa.length) qaEl.lastElementChild!.remove();
}

// ── result view (analysis + Q&A + question box) ──

function ensureResultDom(): void {
  if (document.getElementById("analysis")) return;
  appEl.innerHTML = `
    <div id="analysis"></div>
    <div id="qa"></div>
    <form id="ask" hidden>
      <textarea id="ask-input" rows="2" spellcheck="false"
        placeholder="Rückfrage zur Diskussion stellen … (Enter sendet, Shift+Enter = Zeile)"></textarea>
      <button id="ask-send" class="btn-signal" type="submit">Fragen</button>
    </form>`;
  const form = document.getElementById("ask") as HTMLFormElement;
  const input = document.getElementById("ask-input") as HTMLTextAreaElement;
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    submitQuestion();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submitQuestion();
    }
  });
}

function submitQuestion(): void {
  const input = document.getElementById("ask-input") as HTMLTextAreaElement | null;
  const q = input?.value.trim();
  if (!q) return;
  if (input) input.value = "";
  void askFollowUp(q);
}

function renderResult(): void {
  if (!convo) return;
  headEl.innerHTML = headerHtml(convo.extraction);
  ensureResultDom();
  renderSectionsInto(document.getElementById("analysis")!, convo.analysis);
  renderQA();

  const form = document.getElementById("ask") as HTMLFormElement | null;
  const input = document.getElementById("ask-input") as HTMLTextAreaElement | null;
  const send = document.getElementById("ask-send") as HTMLButtonElement | null;
  const busy = phase !== "idle";
  if (form) form.hidden = phase === "analyzing";
  if (input) input.disabled = busy;
  if (send) send.disabled = busy;

  if (phase === "idle") {
    const cost = outputTokens
      ? ` · ~$${((outputTokens / 1e6) * (OUTPUT_PRICE[settings?.model ?? ""] ?? 0)).toFixed(4)}`
      : "";
    const usage = outputTokens ? `${outputTokens} Output-Tokens${cost}` : "";
    actionsEl.innerHTML = `<div class="act-row">
      <button id="btn-copy" class="btn-ghost">Kopieren</button>
      <button id="btn-export" class="btn-ghost">Export .md</button>
      <button id="btn-reanalyze" class="btn-signal">Erneut</button>
      <span class="usage">${usage}</span></div>`;
    actionsEl.querySelector("#btn-copy")?.addEventListener("click", () => {
      void navigator.clipboard.writeText(combinedMarkdown());
      flash("#btn-copy", "Kopiert ✓");
    });
    actionsEl.querySelector("#btn-export")?.addEventListener("click", () =>
      exportMd(convo!.extraction, combinedMarkdown()),
    );
    actionsEl.querySelector("#btn-reanalyze")?.addEventListener("click", () =>
      void runAnalysis(convo!.extraction),
    );
  } else {
    actionsEl.innerHTML = `<div class="act-row"><button id="btn-stop" class="btn-ghost">Stopp</button><span class="usage">${phase === "answering" ? "antwortet …" : "analysiert …"}</span></div>`;
    actionsEl.querySelector("#btn-stop")?.addEventListener("click", () => abort?.abort());
  }
}

// ── render() for store-driven states (everything except live result updates) ──

function render(s: State): void {
  if (s.name === "result") {
    renderResult();
    return;
  }
  headEl.innerHTML = "";
  actionsEl.innerHTML = "";
  switch (s.name) {
    case "empty":
      appEl.innerHTML = `
        <div class="center">
          <div class="mark">${EYE_SVG}</div>
          <p class="lede">Diskussionen lesen, ohne sie zu lesen.</p>
          <p class="sub">Starte die Analyse per <strong>Rechtsklick auf die Seite → „Diskussion analysieren"</strong>, über das Aktions-Icon in der Symbolleiste oder mit <kbd>Strg+Shift+Y</kbd>. Der Sidebar-Umschalter allein startet keine Analyse.</p>
          ${
            s.needsKey
              ? `<button id="btn-options" class="btn-primary">Einstellungen öffnen</button>
                 <p class="sub">Es ist noch kein API-Key hinterlegt.</p>`
              : ""
          }
          <p class="privacy">${EYE_SVG_SMALL} Seiteninhalt wird zur Analyse an Anthropic gesendet.</p>
        </div>`;
      appEl.querySelector("#btn-options")?.addEventListener("click", openOptions);
      break;
    case "extracting":
      appEl.innerHTML = `<div class="center"><div class="scan"></div><p class="sub">Inhalt wird gelesen …</p></div>`;
      break;
    case "thinking":
      headEl.innerHTML = headerHtml(s.extraction);
      appEl.innerHTML = `
        ${s.extraction.truncated ? `<p class="notice warn">Inhalt gekürzt — die Analyse beruht auf einer Teilmenge.</p>` : ""}
        <p class="notice">${s.extraction.stats.commentCount > 0 ? `Artikel + ${s.extraction.stats.commentCount} Kommentare erkannt` : "Beitrag erkannt"}.</p>
        <div class="thinking-row">${DOTS} Claude analysiert …</div>`;
      break;
    case "error":
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
      {
        const ex = s.extraction;
        if (ex) appEl.querySelector("#btn-retry")?.addEventListener("click", () => void runAnalysis(ex));
      }
      break;
  }
}

// ── streaming throttle ──

let flushScheduled = false;
function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  setTimeout(() => {
    flushScheduled = false;
    if (!convo) return;
    if (phase === "analyzing") {
      const el = document.getElementById("analysis");
      if (el) renderSectionsInto(el, convo.analysis);
    } else if (phase === "answering") {
      renderQA();
    }
  }, 90);
}

// ── helpers ──

function flash(sel: string, text: string): void {
  const btn = actionsEl.querySelector(sel);
  if (!(btn instanceof HTMLButtonElement)) return;
  const prev = btn.textContent;
  btn.textContent = text;
  setTimeout(() => {
    btn.textContent = prev;
  }, 1200);
}

function combinedMarkdown(): string {
  if (!convo) return "";
  let md = convo.analysis;
  if (convo.qa.length) {
    md += "\n\n---\n\n## Rückfragen\n";
    for (const t of convo.qa) md += `\n**F:** ${t.q}\n\n${t.a}\n`;
  }
  return md;
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

// ── drivers ──

async function runAnalysis(extraction: ExtractionResult): Promise<void> {
  lastExtraction = extraction;
  const cfg = await getSettings();
  settings = cfg;
  log("runAnalysis", extraction.siteType, "hasKey:", Boolean(cfg.apiKey));
  if (!cfg.apiKey) {
    store.set({ name: "empty", needsKey: true });
    return;
  }
  abort?.abort();
  abort = new AbortController();
  const signal = abort.signal;

  const budgeted = applyBudget(extraction, cfg.maxInputTokens);
  const userMessage = buildUserMessage(budgeted);
  const c: Convo = { extraction: budgeted, userMessage, analysis: "", qa: [] };
  convo = c;
  outputTokens = 0;
  phase = "analyzing";
  store.set({ name: "thinking", extraction: budgeted });

  try {
    for await (const ev of streamAnalysis({
      settings: cfg,
      messages: [{ role: "user", content: userMessage }],
      signal,
    })) {
      if (ev.type === "text") {
        c.analysis += ev.text;
        if (store.get().name !== "result") store.set({ name: "result", extraction: budgeted });
        else scheduleFlush();
      } else if (ev.type === "refusal") {
        phase = "idle";
        store.set({
          name: "error",
          error: { code: "refusal", message: "Analyse aus Sicherheitsgründen abgelehnt.", retryable: false },
          extraction: budgeted,
        });
        return;
      } else if (ev.type === "usage") {
        outputTokens += ev.outputTokens;
      }
    }
    phase = "idle";
    if (store.get().name === "result") renderResult();
  } catch (e) {
    phase = "idle";
    if (signal.aborted) {
      if (store.get().name === "result") renderResult();
      return;
    }
    const error =
      e instanceof AnthropicError
        ? e.uiError
        : { code: "network", message: "Verbindung verloren. Erneut versuchen.", retryable: true };
    store.set({ name: "error", error, extraction: budgeted });
  }
}

function conversationMessages(c: Convo): ChatMessage[] {
  const msgs: ChatMessage[] = [
    { role: "user", content: c.userMessage },
    { role: "assistant", content: c.analysis },
  ];
  for (const t of c.qa) {
    msgs.push({ role: "user", content: t.q });
    if (t.a) msgs.push({ role: "assistant", content: t.a });
  }
  return msgs;
}

async function askFollowUp(question: string): Promise<void> {
  if (!convo || phase !== "idle") return;
  const cfg = await getSettings();
  settings = cfg;
  if (!cfg.apiKey) {
    store.set({ name: "empty", needsKey: true });
    return;
  }
  const c = convo;
  c.qa.push({ q: question, a: "" });
  const idx = c.qa.length - 1;
  phase = "answering";
  abort?.abort();
  abort = new AbortController();
  const signal = abort.signal;
  renderResult();

  try {
    for await (const ev of streamAnalysis({
      settings: cfg,
      messages: conversationMessages(c),
      signal,
    })) {
      if (ev.type === "text") {
        c.qa[idx].a += ev.text;
        scheduleFlush();
      } else if (ev.type === "refusal") {
        c.qa[idx].a = "_Antwort aus Sicherheitsgründen abgelehnt._";
        break;
      } else if (ev.type === "usage") {
        outputTokens += ev.outputTokens;
      }
    }
  } catch (e) {
    if (!signal.aborted) {
      const msg = e instanceof AnthropicError ? e.uiError.message : "Verbindung verloren.";
      c.qa[idx].a += `\n\n_(Fehler: ${msg})_`;
    }
  }
  phase = "idle";
  renderResult();
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
  log("onMessage", m.type);
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
  log("init", "hasKey:", Boolean(settings.apiKey), "session:", JSON.stringify(Object.keys(sess)));

  if (sess.lastExtraction) {
    void runAnalysis(sess.lastExtraction);
  } else if (sess.lastExtractionError) {
    extractFailed();
  } else if (sess.analyzing) {
    store.set({ name: "extracting" });
  } else {
    store.set({ name: "empty", needsKey: !settings.apiKey });
  }
}

void init();
