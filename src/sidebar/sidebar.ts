import browser from "webextension-polyfill";
import type {
  Convo,
  ExtractionResult,
  HistorySummary,
  ModelId,
  RuntimeMessage,
  Settings,
} from "../lib/types";
import { getSettings } from "../lib/storage";
import { applyBudget, buildUserMessage } from "../lib/prompt";
import { estimateTokens } from "../lib/tokens";
import { outputForecast, previewCosts, type PreparedRequest } from "../lib/preview";
import { price } from "../lib/models";
import { updateRequestUsage } from "../lib/usage";
import { acceptsJobMessage, resumeTarget, type SessionJob } from "../lib/jobs";
import { AnthropicError, countTokens, streamAnalysis } from "../lib/anthropic";
import { convoFromRecord, dropOldestFollowup, followupMessages, recordFromConvo } from "../lib/conversation";
import { clearAll, deleteChat, getChat, isHistoryAvailable, putChat, queryChats, recentOutputs } from "../lib/history";
import { formatRelative } from "../lib/dates";
import { formatUsage, renderSourcedMarkdown, splitSections } from "./render";
import { createStore, type State } from "./state";

const headEl = document.getElementById("head")!;
const appEl = document.getElementById("app")!;
const actionsEl = document.getElementById("actions")!;

const store = createStore({ name: "empty", needsKey: false });
let abort: AbortController | null = null;
let settings: Settings | null = null;
let lastExtraction: ExtractionResult | null = null;
let activeExtraction: ExtractionResult | null = null;

let convo: Convo | null = null;
type Phase = "analyzing" | "answering" | "preparing" | "idle";
let phase: Phase = "idle";
let outputTokens = 0;
let inputTokens = 0;
let prepared: PreparedRequest | null = null;
let windowId: number | null = null;
let activeJobId: string | null = null;
let preparedJobId: string | null = null;
let usageCost = 0;
let previewErrorMessage: string | null = null;

// ── history persistence state ──
let activeRecordId: string | null = null; // record id of the current convo
let activeModel: ModelId | null = null; // model the active analysis ran with (display only)
let recordCreatedAt = 0; // createdAt of the active record (kept across updates)
let convoRestored = false; // convo came from history → no full extraction ("Erneut" off)
let checkpointTimer: ReturnType<typeof setTimeout> | null = null;
let checkpointWrite = Promise.resolve();
let historyQuery = "";
let histSearchTimer: ReturnType<typeof setTimeout> | null = null;

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
const CLOCK_SVG = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`;

function headerHtml(x: ExtractionResult, model = settings?.model ?? ""): string {
  const b = badge(x.siteType);
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
    if (phase === "analyzing") {
      if (!container.querySelector(".thinking-inline")) {
        container.innerHTML = `<div class="thinking-row thinking-inline">${DOTS} Claude analysiert …</div>`;
      }
    } else if (!container.querySelector(".notice")) {
      container.innerHTML = '<p class="notice">Keine Analyseausgabe gespeichert.</p>';
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
    const html = renderSourcedMarkdown(sec.bodyMd, convo?.sources);
    if (body.innerHTML !== html) body.innerHTML = html;
  });
  while (container.children.length > sections.length) container.lastElementChild!.remove();
}

function renderQA(): void {
  const qaEl = document.getElementById("qa");
  if (!qaEl || !convo) return;
  const c = convo;
  c.qa.forEach((turn, i) => {
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
    const html = turn.a
      ? renderSourcedMarkdown(turn.a, c.sources)
      : phase === "answering" ? DOTS : renderSourcedMarkdown("_Keine Antwort gespeichert._");
    if (body.innerHTML !== html) body.innerHTML = html;
  });
  while (qaEl.children.length > convo.qa.length) qaEl.lastElementChild!.remove();
}

// ── result view (analysis + Q&A + question box) ──

function ensureResultDom(): void {
  if (document.getElementById("analysis")) return;
  appEl.innerHTML = `
    <div id="run-status"></div>
    <div id="coverage"></div>
    <div id="analysis"></div>
    <div id="qa"></div>
    <div id="sources"></div>
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
  headEl.innerHTML = headerHtml(
    convo.extraction,
    convoRestored && activeModel ? activeModel : settings?.model ?? "",
  );
  ensureResultDom();
  const statusEl = document.getElementById("run-status");
  if (statusEl) statusEl.innerHTML =
    (convo.status === "partial" ? '<p class="notice warn">Diese Analyse wurde unterbrochen. Der sichtbare Teil ist gespeichert.</p>' : "") +
    (previewErrorMessage ? `<p class="notice warn">${esc(previewErrorMessage)}</p>` : "");
  const coverage = convo.extraction.coverage;
  const coverageEl = document.getElementById("coverage");
  if (coverageEl) {
    coverageEl.innerHTML = coverage
      ? `<p class="notice ${convo.extraction.truncated ? "warn" : ""}">Auswertung: ${coverage.selected.toLocaleString("de-DE")} von ${coverage.captured.toLocaleString("de-DE")} erfassten Kommentaren${convo.extraction.stats.platformTotal != null ? ` · Plattform gesamt: ${convo.extraction.stats.platformTotal.toLocaleString("de-DE")}` : ""}.</p>`
      : "";
  }
  renderSectionsInto(document.getElementById("analysis")!, convo.analysis);
  renderQA();
  const sourceEl = document.getElementById("sources");
  if (sourceEl && convo.sources?.length) {
    sourceEl.innerHTML = `<details class="source-list"><summary>Quellen (${convo.sources.length})</summary>
      ${convo.sources.map((s) => {
        let href = "";
        try {
          const u = new URL(s.url ?? "");
          if (u.protocol === "http:" || u.protocol === "https:") href = u.href;
        } catch { /* no link */ }
        return `<div class="source-item"><strong>${esc(s.id ?? "")}</strong> · ${esc(s.author ?? "anonym")}
          <p>${esc(s.text.slice(0, 240))}${s.text.length > 240 ? "…" : ""}</p>
          ${href ? `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">Kommentar öffnen ↗</a>` : ""}
        </div>`;
      }).join("")}</details>`;
  }

  const form = document.getElementById("ask") as HTMLFormElement | null;
  const input = document.getElementById("ask-input") as HTMLTextAreaElement | null;
  const send = document.getElementById("ask-send") as HTMLButtonElement | null;
  const busy = phase !== "idle";
  if (form) form.hidden = phase === "analyzing" || !convo.analysis.trim();
  if (input) input.disabled = busy;
  if (send) send.disabled = busy;

  if (phase === "idle") {
    const usage =
      convoRestored && !inputTokens && !outputTokens
        ? "aus Verlauf"
        : formatUsage(inputTokens, outputTokens, settings?.model ?? "", usageCost || undefined);
    const reanalyze = convoRestored ? "" : `<button id="btn-reanalyze" class="btn-signal">Erneut</button>`;
    actionsEl.innerHTML = `<div class="act-row">
      <button id="btn-copy" class="btn-ghost">Kopieren</button>
      <button id="btn-export" class="btn-ghost">Export .md</button>
      ${reanalyze}
      <span class="usage">${usage}</span></div>`;
    actionsEl.querySelector("#btn-copy")?.addEventListener("click", () => {
      void navigator.clipboard.writeText(combinedMarkdown());
      flash("#btn-copy", "Kopiert ✓");
    });
    actionsEl.querySelector("#btn-export")?.addEventListener("click", () =>
      exportMd(convo!.extraction, combinedMarkdown()),
    );
    actionsEl.querySelector("#btn-reanalyze")?.addEventListener("click", () =>
      void runAnalysis(activeExtraction ?? convo!.extraction),
    );
  } else {
    actionsEl.innerHTML = `<div class="act-row"><button id="btn-stop" class="btn-ghost">Stopp</button><span class="usage">${phase === "answering" ? "antwortet …" : phase === "preparing" ? "Vorschau wird berechnet …" : "analysiert …"}</span></div>`;
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
          <p class="privacy">${EYE_SVG_SMALL} Für die Tokenzählung und Analyse wird Seiteninhalt an Anthropic gesendet.</p>
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
    case "confirm": {
      const p = s.preview;
      const x = p.extraction;
      const costs = previewCosts(p);
      const count = (n: number) => n.toLocaleString("de-DE");
      const dollars = (n: number) => `~$${n.toFixed(4)}`;
      headEl.innerHTML = headerHtml(x, p.settings.model);
      appEl.innerHTML = `
        <section class="preview">
          <p class="preview-kicker">Vor der Analyse</p>
          <h2>${p.kind === "analysis" ? "Analyse prüfen" : "Rückfrage prüfen"}</h2>
          <p class="preview-intro">${p.tokenSource === "api" ? "Für die API-Tokenzählung wurde dieser Inhalt bereits an Anthropic gesendet." : "Die API-Tokenzählung ist fehlgeschlagen. Dabei können bereits Inhalte an Anthropic übertragen worden sein; die Tokenzahl ist lokal geschätzt."} Die kostenpflichtige Analyse startet erst nach deiner Bestätigung.</p>
          <div class="preview-block">
            <h3>Umfang</h3>
            <dl>
              <div><dt>Erfasst auf dieser Seite</dt><dd>${count(x.coverage?.captured ?? x.stats.commentCount)}</dd></div>
              <div><dt>Für die Analyse ausgewählt</dt><dd>${count(x.coverage?.selected ?? x.comments.length)}</dd></div>
              <div><dt>Extraktionsweg</dt><dd>${x.siteType === "hackernews" ? "Hacker News" : x.siteType === "youtube" ? "YouTube" : "Generische Webseite"}</dd></div>
              <div><dt>Plattform insgesamt</dt><dd>${x.stats.platformTotal != null ? count(x.stats.platformTotal) : "Unbekannt"}</dd></div>
              <div><dt>Auswahl ausgelassen</dt><dd>${count(Math.max(0, (x.coverage?.captured ?? x.stats.commentCount) - (x.coverage?.selected ?? x.comments.length)))}</dd></div>
            </dl>
            ${x.coverage?.articleTruncated ? '<p class="preview-note">Artikeltext wurde gekürzt, damit mehr Kommentare Platz haben.</p>' : ""}
            ${x.coverage?.shortenedComments ? `<p class="preview-note">${count(x.coverage.shortenedComments)} lange Kommentare wurden gekürzt.</p>` : ""}
            ${x.stats.platformTotal != null && x.stats.platformTotal > (x.coverage?.captured ?? x.stats.commentCount) ? '<p class="preview-note">Die Plattform zeigt mehr Kommentare an, als aktuell erfasst werden konnten.</p>' : ""}
            ${x.truncated ? '<p class="preview-note">Die Auswertung beruht auf einer Teilmenge der erfassten Inhalte.</p>' : ""}
            ${p.droppedTurns ? `<p class="preview-note">${count(p.droppedTurns)} ältere Rückfragen entfallen aus dem Request; der gespeicherte Verlauf bleibt erhalten.</p>` : ""}
          </div>
          <div class="preview-block">
            <h3>Tokens &amp; Kosten</h3>
            <dl>
              <div><dt>Modell</dt><dd>${esc(p.settings.model)}</dd></div>
              <div><dt>Input ${p.tokenSource === "api" ? "(API-Schätzung)" : "(lokale Schätzung)"}</dt><dd>${count(p.inputTokens)} · ${dollars(costs.input)}</dd></div>
              <div><dt>Output ${p.outputBasis === "history" ? "(bisherige Analysen)" : "(Szenarien ohne Verlauf)"}</dt><dd>${count(p.outputLow)}–${count(p.outputHigh)}</dd></div>
              <div><dt>Gesamtkosten, Bereich</dt><dd>${dollars(costs.low)}–${dollars(costs.high)}</dd></div>
              <div><dt>Output-Limit</dt><dd>${count(p.settings.maxOutputTokens)} Tokens</dd></div>
              <div><dt>Kosten bei Output-Limit</dt><dd>${dollars(costs.max)}</dd></div>
            </dl>
            <p class="preview-note">Output enthält gegebenenfalls Thinking-Tokens. Tatsächliche API-Nutzung kann von der Schätzung abweichen.</p>
          </div>
          ${p.warning ? `<p class="notice warn">${esc(p.warning)}</p>` : ""}
          <div class="preview-actions">
            <button id="btn-confirm" class="btn-primary">${p.warning ? "Trotzdem starten" : p.kind === "analysis" ? "Analysieren" : "Rückfrage senden"}</button>
            <button id="btn-cancel" class="btn-ghost">Abbrechen</button>
          </div>
        </section>`;
      appEl.querySelector("#btn-confirm")?.addEventListener("click", () => confirmStream());
      appEl.querySelector("#btn-cancel")?.addEventListener("click", () => cancelStream());
      break;
    }
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

// ── history persistence (write-through; degrades to no-op without IndexedDB) ──

function saveCheckpointNow(): void {
  if (checkpointTimer) {
    clearTimeout(checkpointTimer);
    checkpointTimer = null;
  }
  if (!convo || !activeRecordId || activeModel == null || !isHistoryAvailable()) return;
  const snapshot = recordFromConvo(convo, {
      id: activeRecordId,
      model: activeModel,
      createdAt: recordCreatedAt,
      updatedAt: Date.now(),
    });
  checkpointWrite = checkpointWrite.then(() => putChat(snapshot)).catch((e) => {
    console.error("Verlauf konnte nicht gespeichert werden:", e);
  });
}

/** Throttled mid-stream checkpoint — bounds IndexedDB writes during a stream. */
function scheduleCheckpoint(): void {
  if (!isHistoryAvailable() || checkpointTimer) return;
  checkpointTimer = setTimeout(() => {
    checkpointTimer = null;
    saveCheckpointNow();
  }, 1500);
}

// ── history panel (full-overlay drawer) ──

function renderTopbar(): void {
  const bar = document.getElementById("topbar");
  if (!bar) return;
  bar.innerHTML = `
    <span class="brand">${EYE_SVG_SMALL}<span>Diskussionsanalyse</span></span>
    ${isHistoryAvailable() ? `<button id="btn-history" class="btn-ghost icon" title="Verlauf" aria-label="Verlauf öffnen">${CLOCK_SVG}</button>` : ""}`;
  bar.querySelector("#btn-history")?.addEventListener("click", () => void openHistory());
}

function ensureHistoryDom(): void {
  const panel = document.getElementById("history-panel");
  if (!panel || panel.dataset.ready) return;
  panel.dataset.ready = "1";
  panel.innerHTML = `
    <div class="hist-head">
      <strong>Verlauf</strong>
      <span class="hist-spacer"></span>
      <button id="hist-clear" class="btn-ghost small">Alles löschen</button>
      <button id="hist-close" class="btn-ghost small">Schließen</button>
    </div>
    <input id="hist-search" type="search" autocomplete="off" spellcheck="false" placeholder="Verlauf durchsuchen …" />
    <div id="hist-list"></div>`;
  panel.querySelector("#hist-close")?.addEventListener("click", closeHistory);
  const clearBtn = panel.querySelector("#hist-clear") as HTMLButtonElement | null;
  clearBtn?.addEventListener("click", () => confirmClearAll(clearBtn));
  const search = panel.querySelector("#hist-search") as HTMLInputElement | null;
  search?.addEventListener("input", () => {
    historyQuery = search.value;
    if (histSearchTimer) clearTimeout(histSearchTimer);
    histSearchTimer = setTimeout(() => {
      histSearchTimer = null;
      void refreshHistory();
    }, 200);
  });
}

async function openHistory(): Promise<void> {
  ensureHistoryDom();
  const search = document.getElementById("hist-search") as HTMLInputElement | null;
  if (search) search.value = historyQuery;
  await refreshHistory();
  const panel = document.getElementById("history-panel");
  if (panel) panel.hidden = false;
}

function closeHistory(): void {
  const panel = document.getElementById("history-panel");
  if (panel) panel.hidden = true;
}

async function refreshHistory(): Promise<void> {
  renderHistoryList(await queryChats(historyQuery));
}

/** Two-step inline confirm for the destructive "delete all". */
function confirmClearAll(btn: HTMLButtonElement): void {
  if (btn.dataset.armed) {
    btn.dataset.armed = "";
    btn.textContent = "Alles löschen";
    void clearAll().then(refreshHistory);
    return;
  }
  btn.dataset.armed = "1";
  btn.textContent = "Sicher? Alles löschen";
  setTimeout(() => {
    if (btn.dataset.armed) {
      btn.dataset.armed = "";
      btn.textContent = "Alles löschen";
    }
  }, 3000);
}

function renderHistoryList(items: HistorySummary[]): void {
  const list = document.getElementById("hist-list");
  if (!list) return;
  if (items.length === 0) {
    list.innerHTML = `<p class="notice">${historyQuery ? "Keine Treffer." : "Noch keine Analysen gespeichert."}</p>`;
    return;
  }
  const now = Date.now();
  list.innerHTML = items
    .map((s) => {
      const b = badge(s.siteType);
      return `<div class="hist-item">
        <button class="hist-open" data-id="${esc(s.id)}">
          <span class="hist-title">${esc(s.title || "Ohne Titel")}</span>
          <span class="hist-sub">
            <span class="badge ${b.cls}"><span class="dot"></span>${b.label}</span>
            <span class="host">${esc(hostOf(s.url))}</span>
            <span class="hist-date">${esc(formatRelative(s.updatedAt, now))}</span>
          </span>
        </button>
        <button class="hist-del" data-id="${esc(s.id)}" title="Löschen" aria-label="Eintrag löschen">✕</button>
      </div>`;
    })
    .join("");
  list.querySelectorAll<HTMLElement>(".hist-open").forEach((el) =>
    el.addEventListener("click", () => void openRecord(el.dataset.id!)),
  );
  list.querySelectorAll<HTMLElement>(".hist-del").forEach((el) =>
    el.addEventListener("click", () => void deleteChat(el.dataset.id!).then(refreshHistory)),
  );
}

/** Restore a stored chat into the live convo so follow-ups continue against it. */
async function openRecord(id: string): Promise<void> {
  const rec = await getChat(id);
  if (!rec) return;
  previewErrorMessage = null;
  saveCheckpointNow(); // flush the current live convo under its own id first
  abort?.abort();
  phase = "idle";
  prepared = null;
  convo = convoFromRecord(rec);
  if (convo.status === "running") convo.status = "partial";
  activeRecordId = rec.id;
  activeModel = rec.model;
  recordCreatedAt = rec.createdAt;
  convoRestored = true;
  activeExtraction = null;
  outputTokens = rec.usage?.outputTokens ?? 0;
  inputTokens = rec.usage?.inputTokens ?? 0;
  usageCost = rec.usage?.costUsd ?? 0;
  settings = await getSettings();
  closeHistory();
  store.set({ name: "result", extraction: convo.extraction });
}

// ── drivers ──

function inputEstimate(cfg: Settings, messages: { content: string }[]): number {
  return estimateTokens(cfg.systemPrompt) + messages.reduce((n, m) => n + estimateTokens(m.content) + 8, 0);
}

async function measuredInput(cfg: Settings, messages: PreparedRequest["messages"], signal: AbortSignal) {
  try {
    const tokens = await countTokens(cfg, messages, signal);
    if (!Number.isFinite(tokens) || tokens <= 0) throw new Error("Leere Tokenantwort");
    return { tokens, source: "api" as const, warning: undefined };
  } catch (e) {
    if (signal.aborted) throw e;
    if (e instanceof AnthropicError && !e.uiError.retryable) throw e;
    return {
      tokens: Math.ceil(inputEstimate(cfg, messages) * 1.3),
      source: "local" as const,
      warning: "Die API-Tokenzählung ist derzeit nicht erreichbar. Die lokale Schätzung enthält einen Sicherheitsaufschlag.",
    };
  }
}

function previewError(e: unknown, extraction: ExtractionResult, question?: string): void {
  const error = e instanceof AnthropicError
    ? e.uiError
    : { code: "preview", message: e instanceof Error ? e.message : "Vorschau fehlgeschlagen.", retryable: true };
  if (question && convo) {
    previewErrorMessage = error.message;
    store.set({ name: "result", extraction: convo.extraction });
    const input = document.getElementById("ask-input") as HTMLTextAreaElement | null;
    if (input) input.value = question;
    return;
  }
  store.set({ name: "error", error, extraction });
}

async function runAnalysis(extraction: ExtractionResult): Promise<void> {
  previewErrorMessage = null;
  closeHistory();
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
  prepared = null;
  store.set({ name: "extracting" });
  try {
    let contentCap = Math.max(100, cfg.maxInputTokens - estimateTokens(cfg.systemPrompt) - 700);
    let selected = applyBudget(extraction, contentCap);
    let messages: PreparedRequest["messages"] = [{ role: "user", content: buildUserMessage(selected) }];
    let measured = await measuredInput(cfg, messages, signal);
    for (let attempt = 0; measured.tokens > cfg.maxInputTokens && attempt < 5; attempt++) {
      const nextCap = Math.max(100, contentCap - (measured.tokens - cfg.maxInputTokens) - 300);
      if (nextCap >= contentCap) break;
      contentCap = nextCap;
      selected = applyBudget(extraction, contentCap);
      messages = [{ role: "user", content: buildUserMessage(selected) }];
      measured = await measuredInput(cfg, messages, signal);
    }
    if (signal.aborted) return;
    if (measured.tokens > cfg.maxInputTokens) {
      throw new AnthropicError({ code: "input_limit", message: "Der Request überschreitet das Input-Limit. Bitte Limit erhöhen.", retryable: false, openOptions: true });
    }
    const forecast = outputForecast(cfg.maxOutputTokens, await recentOutputs(cfg.model));
    if (signal.aborted) return;
    prepared = { kind: "analysis", settings: { ...cfg }, messages, extraction: selected,
      droppedTurns: 0, inputTokens: measured.tokens, tokenSource: measured.source,
      warning: measured.warning, ...forecast };
    store.set({ name: "confirm", preview: prepared });
  } catch (e) {
    if (!signal.aborted) previewError(e, extraction);
  }
}

async function askFollowUp(question: string): Promise<void> {
  if (!convo || phase !== "idle") return;
  previewErrorMessage = null;
  const jobAtStart = activeJobId;
  abort?.abort();
  abort = new AbortController();
  const signal = abort.signal;
  phase = "preparing";
  renderResult();
  const cfg = await getSettings();
  if (signal.aborted) {
    if (activeJobId === jobAtStart) { phase = "idle"; renderResult(); }
    return;
  }
  settings = cfg;
  if (!cfg.apiKey) {
    phase = "idle";
    previewErrorMessage = "API-Key fehlt — bitte in den Einstellungen hinterlegen.";
    renderResult();
    const input = document.getElementById("ask-input") as HTMLTextAreaElement | null;
    if (input) input.value = question;
    return;
  }
  prepared = null;
  const extraction = convo.extraction;
  try {
    let messages: PreparedRequest["messages"] = followupMessages(convo, question);
    let droppedTurns = 0;
    let measured = await measuredInput(cfg, messages, signal);
    while (measured.tokens > cfg.maxInputTokens && messages.length > 3) {
      messages = dropOldestFollowup(messages);
      droppedTurns++;
      measured = await measuredInput(cfg, messages, signal);
    }
    if (signal.aborted) {
      if (activeJobId === jobAtStart) { phase = "idle"; renderResult(); }
      return;
    }
    if (measured.tokens > cfg.maxInputTokens) {
      throw new AnthropicError({ code: "input_limit", message: "Die ursprüngliche Analyse und Frage überschreiten das Input-Limit.", retryable: false, openOptions: true });
    }
    const forecast = outputForecast(cfg.maxOutputTokens, await recentOutputs(cfg.model));
    if (signal.aborted || activeJobId !== jobAtStart) {
      if (activeJobId === jobAtStart) { phase = "idle"; renderResult(); }
      return;
    }
    phase = "idle";
    prepared = { kind: "followup", settings: { ...cfg }, messages, extraction,
      question, droppedTurns, inputTokens: measured.tokens, tokenSource: measured.source,
      warning: measured.warning, ...forecast };
    store.set({ name: "confirm", preview: prepared });
  } catch (e) {
    if (activeJobId !== jobAtStart) return;
    phase = "idle";
    if (!signal.aborted) previewError(e, extraction, question);
    else renderResult();
  }
}

async function confirmStream(): Promise<void> {
  const p = prepared;
  if (!p) return;
  const current = await getSettings();
  if (JSON.stringify(current) !== JSON.stringify(p.settings)) {
    if (p.kind === "analysis") void runAnalysis(lastExtraction ?? p.extraction);
    else if (p.question) void askFollowUp(p.question);
    return;
  }
  prepared = null;
  abort?.abort();
  abort = new AbortController();
  if (p.kind === "analysis") void startStream(p, abort.signal);
  else void startFollowUp(p, abort.signal);
}

function cancelStream(): void {
  const wasFollowup = prepared?.kind === "followup";
  const question = prepared?.question;
  prepared = null;
  abort?.abort();
  phase = "idle";
  if (convo && (wasFollowup || convo.analysis)) {
    store.set({ name: "result", extraction: convo.extraction });
    if (question) {
      const input = document.getElementById("ask-input") as HTMLTextAreaElement | null;
      if (input) input.value = question;
    }
  }
  else store.set({ name: "empty", needsKey: false });
}

async function startStream(p: PreparedRequest, signal: AbortSignal): Promise<void> {
  const jobAtStart = activeJobId;
  activeExtraction = lastExtraction ?? p.extraction;
  const c: Convo = {
    extraction: p.extraction, userMessage: p.messages[0].content, analysis: "", qa: [],
    sources: p.extraction.comments.map((s) => ({ ...s })), status: "running",
  };
  convo = c;
  phase = "analyzing";
  inputTokens = 0; outputTokens = 0; usageCost = 0;
  activeRecordId = crypto.randomUUID();
  activeModel = p.settings.model;
  recordCreatedAt = Date.now();
  convoRestored = false;
  if (windowId != null && activeJobId) {
    void browser.storage.session.set({ [`analysisRecord_${windowId}`]: { jobId: activeJobId, recordId: activeRecordId } });
  }
  saveCheckpointNow();
  store.set({ name: "thinking", extraction: c.extraction });
  let requestUsage = { inputTokens: 0, outputTokens: 0 };
  try {
    for await (const ev of streamAnalysis({ settings: p.settings, messages: p.messages, signal })) {
      if (ev.type === "text") {
        c.analysis += ev.text;
        scheduleCheckpoint();
        if (store.get().name !== "result") store.set({ name: "result", extraction: c.extraction });
        else scheduleFlush();
      } else if (ev.type === "usage") {
        requestUsage = updateRequestUsage(requestUsage, ev);
        c.usage = { ...requestUsage,
          analysisOutputTokens: requestUsage.outputTokens,
          costUsd: price(p.settings.model, requestUsage.inputTokens, requestUsage.outputTokens) };
      } else if (ev.type === "refusal") {
        throw new AnthropicError({ code: "refusal", message: "Analyse aus Sicherheitsgründen abgelehnt.", retryable: false });
      }
    }
    c.status = "complete";
  } catch (e) {
    c.status = "partial";
    if (!signal.aborted) {
      const error = e instanceof AnthropicError ? e.uiError
        : { code: "network", message: "Verbindung verloren. Erneut versuchen.", retryable: true };
      if (!c.analysis) store.set({ name: "error", error, extraction: c.extraction });
      else c.analysis += `\n\n_(Analyse unterbrochen: ${error.message})_`;
    }
  }
  if (activeJobId !== jobAtStart || convo !== c) return;
  inputTokens = requestUsage.inputTokens;
  outputTokens = requestUsage.outputTokens;
  usageCost = price(p.settings.model, inputTokens, outputTokens);
  c.usage = { inputTokens, outputTokens, analysisOutputTokens: outputTokens, costUsd: usageCost };
  phase = "idle";
  saveCheckpointNow();
  if (c.status === "complete" || c.analysis) store.set({ name: "result", extraction: c.extraction });
}

async function startFollowUp(p: PreparedRequest, signal: AbortSignal): Promise<void> {
  const c = convo;
  if (!c || !p.question) return;
  const jobAtStart = activeJobId;
  const previousInput = inputTokens;
  const previousOutput = outputTokens;
  const previousCost = usageCost;
  c.qa.push({ q: p.question, a: "", status: "partial" });
  c.status = "running";
  const idx = c.qa.length - 1;
  phase = "answering";
  store.set({ name: "result", extraction: c.extraction });
  let requestUsage = { inputTokens: 0, outputTokens: 0 };
  let interrupted = false;
  try {
    for await (const ev of streamAnalysis({ settings: p.settings, messages: p.messages, signal })) {
      if (ev.type === "text") {
        c.qa[idx].a += ev.text;
        scheduleCheckpoint();
        scheduleFlush();
      } else if (ev.type === "usage") {
        requestUsage = updateRequestUsage(requestUsage, ev);
        c.usage = { inputTokens: previousInput + requestUsage.inputTokens, outputTokens: previousOutput + requestUsage.outputTokens,
          analysisOutputTokens: c.usage?.analysisOutputTokens,
          costUsd: previousCost + price(p.settings.model, requestUsage.inputTokens, requestUsage.outputTokens) };
      } else if (ev.type === "refusal") {
        c.qa[idx].a = "_Antwort aus Sicherheitsgründen abgelehnt._";
        break;
      }
    }
  } catch (e) {
    interrupted = true;
    if (!signal.aborted) {
      const msg = e instanceof AnthropicError ? e.uiError.message : "Verbindung verloren.";
      c.qa[idx].a += `\n\n_(Fehler: ${msg})_`;
    }
  }
  if (activeJobId !== jobAtStart || convo !== c) return;
  inputTokens = previousInput + requestUsage.inputTokens;
  outputTokens = previousOutput + requestUsage.outputTokens;
  usageCost = previousCost + price(p.settings.model, requestUsage.inputTokens, requestUsage.outputTokens);
  c.usage = { inputTokens, outputTokens, analysisOutputTokens: c.usage?.analysisOutputTokens, costUsd: usageCost };
  c.status = interrupted || signal.aborted ? "partial" : "complete";
  c.qa[idx].status = c.status;
  if (!c.qa[idx].a) c.qa[idx].a = "_Keine Antwort gespeichert._";
  phase = "idle";
  saveCheckpointNow();
  renderResult();
}

// ── handoff: live runtime messages (primary) + storage.session (cold open) ──

function extractFailed(): void {
  store.set({
    name: "error",
    error: { code: "extract", message: "Seiteninhalt konnte nicht gelesen werden.", retryable: false },
  });
}

browser.runtime.onMessage.addListener((message: unknown) => {
  const m = message as RuntimeMessage;
  if (!acceptsJobMessage(m, windowId, activeJobId)) return;
  if (m.type === "ANALYZING") {
    previewErrorMessage = null;
    abort?.abort();
    if (convo && phase !== "idle") convo.status = "partial";
    saveCheckpointNow();
    phase = "idle";
    activeJobId = m.jobId;
    preparedJobId = null;
    prepared = null;
    store.set({ name: "extracting" });
  } else if (m.jobId === activeJobId && m.type === "EXTRACTION_RESULT") {
    if (preparedJobId === m.jobId) return;
    preparedJobId = m.jobId;
    void runAnalysis(m.payload);
  } else if (m.jobId === activeJobId && m.type === "EXTRACTION_ERROR") extractFailed();
});

// Auto-start once a key is saved while we are waiting with a cached extraction.
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.settings) return;
  const next = changes.settings.newValue as Partial<Settings> | undefined;
  const cur = store.get();
  if (cur.name === "confirm" && prepared) {
    const pending = prepared;
    prepared = null;
    if (pending.kind === "analysis") void runAnalysis(lastExtraction ?? pending.extraction);
    else if (pending.question) void askFollowUp(pending.question);
  } else if (next?.apiKey && cur.name === "empty" && cur.needsKey && lastExtraction) {
    void runAnalysis(lastExtraction);
  }
});

async function init(): Promise<void> {
  store.subscribe(render);
  settings = await getSettings();
  applyTheme(settings.theme);
  renderTopbar();
  windowId = (await browser.windows.getCurrent()).id ?? null;
  const jobKey = `analysisJob_${windowId}`;
  const recordKey = `analysisRecord_${windowId}`;
  const sess = await browser.storage.session.get([jobKey, recordKey]);
  const job = sess[jobKey] as SessionJob | undefined;
  const record = sess[recordKey] as { jobId: string; recordId: string } | undefined;
  if (job) activeJobId = job.jobId;
  const saved = record && record.jobId === job?.jobId ? await getChat(record.recordId) : undefined;
  const target = resumeTarget(job, record, !!saved);
  if (target === "record" && record) {
    await openRecord(record.recordId);
  } else if (target === "preview" && job?.extraction) {
    preparedJobId = job.jobId;
    void runAnalysis(job.extraction as ExtractionResult);
  } else if (target === "error") {
    extractFailed();
  } else if (target === "extracting") {
    store.set({ name: "extracting" });
  } else {
    store.set({ name: "empty", needsKey: !settings.apiKey });
  }
}

window.addEventListener("pagehide", () => {
  if (convo && phase !== "idle") convo.status = "partial";
  saveCheckpointNow();
});
void init();
