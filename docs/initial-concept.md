# Konzept: Firefox-Addon „Diskussionsanalyse"

> Historischer Entwurf vom Juni 2026. Modelle, Ablauf und Funktionsumfang haben sich seitdem geändert. Für den aktuellen Stand gelten [README](../README.md) und Quellcode.

> **Working Title:** Diskussionsanalyse (Meinungsspiegel)
> **Stand:** 2026-06-16
> **Status:** Design abgenommen, bereit für Implementierungs-Plan + Umsetzung in frischer Session.

Ein Firefox-Addon, das den Inhalt der aktuellen Seite (Artikel + Kommentare) extrahiert, in den vorhandenen Meta-Prompt (`meta-prompt-diskussionsanalyse.md`) verpackt und von der Claude-API analysieren lässt. Ergebnis ist eine strukturierte, neutrale deutsche Analyse mit Bias-Befund, live gestreamt in eine Sidebar.

---

## 1. Zweck & Scope

**Job:** Seite scrapen → in Meta-Prompt verpacken → von Claude analysieren lassen → strukturiertes Ergebnis rendern.

Der Meta-Prompt (`meta-prompt-diskussionsanalyse.md`) ist die fixe Fachlogik: Er macht Claude zum Diskussions-/Meinungsanalyse-Agenten, der ein Meinungsspektrum, Konsens, Streitpunkte, Bemerkenswertes und vor allem **Bias & Tendenz** des Materials herausarbeitet — neutral in der eigenen Stimme, den Bias als Befund. Output ist Deutsch, 5 Abschnitte (Kurzüberblick · Hauptthemen · Meinungsbild · Bemerkenswertes · Bias & Tendenz).

**v1-Scope:**
- Sidebar-UI, persönlicher Gebrauch (temporär geladen / self-signed; kein AMO).
- Direkter Browser→Anthropic-Call mit eigenem API-Key (kein Backend).
- Extraktion: generisch (Readability + Kommentar-Heuristik) **plus** getunte Extraktoren für **Hacker News** und **YouTube**.
- Default-Modell **`claude-opus-4-8`** (in den Optionen umstellbar).

**Explizit NICHT in v1 (YAGNI):** Proxy-Backend · AMO-Publishing · Reddit-/X-Spezialextraktor (laufen über den generischen Pfad) · strukturierte Bias-Gauge-Visualisierung (Prompt liefert Prosa) · Chrome-Portierung · History/Persistenz alter Analysen · i18n der UI (UI deutsch).

---

## 2. Architektur

Drei Laufzeit-Kontexte + Options-Seite. Die **Sidebar besitzt den API-Call** (Streaming bleibt lokal, kein Port-Protokoll für Deltas nötig). Extraktion läuft **on-demand injiziert** (keine dauerhaften Content-Scripts).

```
┌──────────────────────────────────────────────────────────────┐
│ BACKGROUND (event page, minimal)                              │
│ • action.onClicked / menus / commands  → User-Geste           │
│ • gewährt activeTab, ruft sidebarAction.open()                │
│ • scripting.executeScript(Readability + extract) im akt. Tab  │
│ • schickt ExtractionResult an die Sidebar                     │
└───────────┬───────────────────────────────────┬──────────────┘
            │ scripting.executeScript            │ runtime msg
            ▼ (on-demand, activeTab)             ▼
┌────────────────────────────┐      ┌────────────────────────────┐
│ CONTENT-EXTRAKTION          │      │ SIDEBAR (moz-extension://)  │
│ (in active tab injiziert)   │      │ • State-Machine + UI        │
│ Readability + Site-Extractor│      │ • fetch → api.anthropic.com │
│ → ExtractionResult (JSON)   │      │   (SSE-Streaming)           │
└────────────────────────────┘      │ • marked + DOMPurify render │
                                     └─────────────┬──────────────┘
                                                   │ HTTPS (SSE)
                                                   ▼
                                     ┌────────────────────────────┐
                                     │ Anthropic Messages API      │
                                     │ POST /v1/messages stream    │
                                     └────────────────────────────┘
┌──────────────────────────────────────────────────────────────┐
│ OPTIONS-PAGE: API-Key · Modell · Token-Caps · System-Prompt-  │
│ Editor (Default = gebündelter Meta-Prompt) · Sprache · Theme  │
└──────────────────────────────────────────────────────────────┘
```

### Interaktionsmodell (wichtig — Permission-Korrektheit)

Ein Klick **innerhalb** der Sidebar gewährt **kein** `activeTab`. `activeTab` (temporärer Host-Zugriff auf den aktiven Tab inkl. `scripting`-Injektion) wird nur durch bestimmte Gesten gewährt: Klick auf das Toolbar-Icon (`action.onClicked`), Kontextmenü-Eintrag, Tastenkürzel.

Daher:
- **Erstanalyse** wird durch Toolbar-Icon / Kontextmenü „Diskussion analysieren" / Shortcut ausgelöst. Der Handler (Background) gewährt `activeTab`, öffnet die Sidebar (`sidebarAction.open()` muss aus einem Gesten-Handler kommen), injiziert den Extraktor, schickt das `ExtractionResult` an die Sidebar. Sidebar startet sofort den Stream.
- **„Erneut analysieren"** in der Sidebar arbeitet auf dem **gecachten** `ExtractionResult` (kein erneutes Injizieren nötig) — funktioniert ohne neue Geste.
- **Neue Seite analysieren** = erneut Toolbar/Kontextmenü.

So bleibt es bei minimalen Permissions (`activeTab` statt `<all_urls>`). Trade-off: ein vollwertiger „Analysieren"-Button *in* der Sidebar für beliebige Seiten bräuchte optionale Host-Permissions (`permissions.request`) — bewusst auf später verschoben.

---

## 3. Manifest & Permissions (Manifest V3, Firefox)

```jsonc
{
  "manifest_version": 3,
  "name": "Diskussionsanalyse",
  "version": "0.1.0",
  "browser_specific_settings": { "gecko": { "id": "diskussionsanalyse@local" } },
  "background": { "scripts": ["background.js"] },   // Firefox MV3 event page (kein service_worker)
  "sidebar_action": {
    "default_title": "Diskussionsanalyse",
    "default_panel": "sidebar/sidebar.html",
    "default_icon": "assets/icon.svg"
  },
  "action": { "default_title": "Diskussion analysieren", "default_icon": "assets/icon.svg" },
  "options_ui": { "page": "options/options.html", "open_in_tab": true },
  "permissions": ["activeTab", "scripting", "storage", "menus"],
  "host_permissions": ["https://api.anthropic.com/*"],
  "commands": {
    "analyze-page": {
      "suggested_key": { "default": "Ctrl+Shift+Y" },
      "description": "Aktuelle Seite analysieren"
    }
  },
  "content_security_policy": {
    "extension_pages": "default-src 'self'; connect-src https://api.anthropic.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'"
  }
}
```

- **Kein `<all_urls>`** — Extraktion nur via `activeTab` bei Nutzer-Geste.
- `connect-src` auf `api.anthropic.com` beschränkt — Output kann nirgendwo sonst hin.
- Firefox MV3: `background.scripts` (nicht-persistente event page), `sidebar_action` (Firefox-spezifisch, MV3-fähig).

---

## 4. Datenfluss

1. Nutzer-Geste (Toolbar / Kontextmenü / `Ctrl+Shift+Y`).
2. Background: `sidebarAction.open()` + `scripting.executeScript({target:{tabId}, files:["vendor/Readability.js","content/extract.js"]})`.
3. `extract.js` wählt per `location.hostname` den Extraktor (HN / YouTube / generisch), liefert `ExtractionResult`.
4. Background sendet `ExtractionResult` an Sidebar (runtime message); Sidebar cached es.
5. Sidebar: `prompt.ts` baut die User-Message (Markdown), wendet Token-Budget/Truncation an.
6. Sidebar: `anthropic.ts` streamt `POST /v1/messages` (`system` = Meta-Prompt, `stream:true`, adaptive thinking).
7. Sidebar rendert Deltas live in die 5 Abschnitte (sanitisiert).
8. Done: Kopieren (Markdown) · Export `.md` · Erneut analysieren · Token-/Kosten-Zeile aus `usage`.

---

## 5. Content-Extraktion

### ExtractionResult (gemeinsames Schema)

```ts
interface Comment {
  author?: string;
  text: string;          // bereits zu Markdown/Plaintext normalisiert
  score?: number;        // z.B. HN-Punkte, YT-Likes
  depth: number;         // Verschachtelungstiefe (0 = top-level)
}
interface ExtractionResult {
  url: string;
  title: string;
  siteType: "hackernews" | "youtube" | "generic";
  lang?: string;
  article: { text: string; byline?: string } | null;  // Readability-Hauptinhalt als Markdown
  comments: Comment[];   // flach mit depth-Feld (Baum via depth rekonstruierbar)
  stats: { commentCount: number; charCount: number };
  truncated: boolean;    // gesetzt durch Token-Budget-Stufe (s. §6)
}
```

### Generischer Pfad (alle Seiten, inkl. Reddit/X)
- Artikel: `@mozilla/readability` auf einer DOM-Kopie → HTML → **Turndown** → Markdown.
- Kommentare: Heuristik über gängige Container (`[id*="comment"]`, `.comment`, `article` in Kommentar-Bereichen, `[role="comment"]`). Best-effort; Tiefe aus DOM-Verschachtelung. Wenn nichts Sinnvolles gefunden wird → `comments: []`, Analyse läuft auf dem Artikel allein.

### Hacker News (`news.ycombinator.com`)
- Sauberes, statisches DOM — zuverlässig. Post: `.fatitem` (Titel, Text). Kommentare: `.comtr`/`.comment`, Autor `.hnuser`, Tiefe aus `.ind img[width]` (Einrückung in Pixel / 40). Score wo vorhanden.

### YouTube (`youtube.com/watch`)
- Best-effort. Titel + Beschreibung als „Artikel". Kommentare laden dynamisch nach — primär aus `ytInitialData`/Continuation-Daten lesen, Fallback: sichtbare `#comments ytd-comment-thread-renderer`. Hinweis in der UI, dass YT-Kommentare unvollständig sein können (nur geladene). Kein erzwungenes Scrollen in v1.

> Reddit & X laufen bewusst über den generischen Pfad (dynamisches/login-gated UI = hoher, fragiler Aufwand → spätere Iteration).

**Injektionsmechanik:** `Readability.js` als Datei injizieren (setzt globalen `Readability`), dann `extract.js` als Datei injizieren; dessen letzter Ausdruck ist das `ExtractionResult`, das `scripting.executeScript` als `result` zurückgibt. (Exakte Mechanik in der Implementierung verifizieren/abtesten — `func`- vs. `files`-Rückgabewert.)

---

## 6. Prompt-Assembly & Token-Budget

**System-Prompt** = Inhalt von `meta-prompt-diskussionsanalyse.md`, als Asset gebündelt; in den Optionen editierbar mit „Auf Default zurücksetzen".

**User-Message** (Markdown):

```
QUELLE: <url>
TITEL: <title>
TYP: <siteType>
[HINWEIS: Inhalt wurde aus Längengründen gekürzt — Analyse beruht auf einer Teilmenge.]   ← nur wenn truncated

=== BEITRAG / ARTIKEL ===
<article.text als Markdown>

=== KOMMENTARE (<commentCount>) ===
> [<author> · <score>▲ · Ebene <depth>]
<comment.text>
...
```

**Token-Budget / Truncation:**
- Grobe Schätzung (`chars/4`) gegen ein konfigurierbares Input-Cap (Default z.B. 150k Tokens; Opus 4.8 hat 1M Kontext, aber Kosten/Latenz begrenzen sinnvoll).
- Priorisierung: Artikel komplett → Top-Level-/höchstbewertete Kommentare → tiefe/niedrige zuletzt. Überschuss wird abgeschnitten, `truncated=true`, und der Prompt teilt dem Modell die Kürzung mit (passt zur Meta-Prompt-Regel „dünne Datenlage offen benennen").
- **Optional:** Vor dem Senden `POST /v1/messages/count_tokens` für präzise Token-/Kostenanzeige (gleicher CORS-Header).

---

## 7. Anthropic-API-Integration

> Modell-/API-Fakten Stand des Konzepts. Die umsetzende Session **muss** die `claude-api`-Skill konsultieren, da sich IDs/Parameter ändern können.

- **Endpoint:** `POST https://api.anthropic.com/v1/messages`
- **Headers:** `x-api-key: <key>`, `anthropic-version: 2023-06-01`, `content-type: application/json`, **`anthropic-dangerous-direct-browser-access: true`** (erlaubt Browser-Origin / liefert CORS-Header).
- **Body:**
  ```jsonc
  {
    "model": "claude-opus-4-8",          // Default; Optionen: claude-sonnet-4-6, claude-haiku-4-5
    "max_tokens": 8000,                   // Output-Cap (Analyse ist kompakt); konfigurierbar
    "system": "<Meta-Prompt>",
    "messages": [{ "role": "user", "content": "<User-Message>" }],
    "thinking": { "type": "adaptive" },   // verbessert Analysequalität; KEIN budget_tokens (würde 400 werfen)
    "stream": true
  }
  ```
- **Adaptive Thinking:** `display` standardmäßig `"omitted"` → vor dem ersten Text-Delta erscheint eine Pause; UI zeigt solange „Claude analysiert …". (Optional `display:"summarized"`, wenn Denk-Zusammenfassung angezeigt werden soll.)
- **Kein Prefill** (würde auf Opus 4.8 mit 400 fehlschlagen). **Kein** Fable-5-Fallback-Mechanismus nötig (nur bei `claude-fable-5` relevant).
- **Prompt Caching:** für v1 nicht genutzt — der Meta-Prompt allein liegt unter Opus' minimaler Cache-Prefix-Größe (4096 Tokens), und jede Seite ist eine neue User-Message.

### SSE-Parsing (manuell, im Browser)
Stream als `text/event-stream` lesen (`response.body.getReader()` + Zeilen-Puffer). Events:
- `message_start` → Start.
- `content_block_delta` mit `delta.type === "text_delta"` → `delta.text` anhängen (Analyse-Text). `thinking_delta` → optional Denk-Anzeige.
- `message_delta` → `usage` (Output-Tokens) für Kostenzeile.
- `message_stop` → Ende. `error`-Event → Fehlerpfad.

### Fehlerbehandlung → UI-Meldungen
| Code / Fall | Meldung / Aktion |
|---|---|
| 401 `authentication_error` | „API-Key ungültig — in Einstellungen prüfen." → Link zu Optionen |
| 403 `permission_error` | „Key hat keinen Zugriff auf das gewählte Modell." |
| 413 `request_too_large` | „Inhalt zu groß — Input-Cap senken." (Truncation greift normalerweise vorher) |
| 429 `rate_limit_error` | „Rate-Limit — in N Sekunden erneut." (`retry-after`-Header) |
| 529 / 500 | „Anthropic überlastet/Serverfehler — erneut versuchen." (Retry-Button) |
| `stop_reason: "refusal"` | „Analyse aus Sicherheitsgründen abgelehnt." (kommt bei toxischen Inhalten vor) |
| Netzwerk/Abbruch | „Verbindung verloren." + Retry; Stop-Button bricht via `AbortController` ab |

`stop_reason` **vor** dem Lesen des Contents prüfen.

---

## 8. UI-Design (Sidebar)

**Designsprache:** Lesefokus-Typografie (großzügige Zeilenhöhe, ruhige Maße), Light/Dark via `prefers-color-scheme`, keine generische „AI-Slop"-Optik (keine Inter/Roboto-Default, keine Lila-Verläufe) — eigenständige, cohäsive Palette. Die 5 Analyse-Abschnitte klar typografisch getrennt; **„Bias & Tendenz" als hervorgehobenes Panel** (Kernanforderung des Meta-Prompts).

**Header:** erkannte Seite (Titel, Host) + Typ-Badge („Hacker News" / „YouTube" / „Webseite") + Modell-Chip.

**Zustände (State-Machine):**
| State | Inhalt |
|---|---|
| `empty` | Kurz-Erklärer + Hinweis „Toolbar-Icon / Kontextmenü nutzen, um die aktuelle Seite zu analysieren". Falls kein API-Key gesetzt: Hinweis + Button „Einstellungen öffnen". |
| `extracting` | Spinner „Inhalt wird gelesen …" |
| `extracted` | kurz: „Artikel + 142 Kommentare erkannt" + ggf. Truncation-Hinweis, dann Übergang zu Stream |
| `thinking` | „Claude analysiert …" (vor dem ersten Text-Delta) |
| `streaming` | Live-gerenderter Markdown-Text, **Stop**-Button |
| `done` | Vollständige Analyse + Aktionsleiste: Kopieren · Export `.md` · Erneut analysieren · Token/Kosten-Zeile |
| `error` | Klartext-Meldung gemäß §7 + passende Aktion |

**Rendering:** `marked` → HTML → **DOMPurify** → `innerHTML`. Inkrementell beim Streaming (Re-render gepuffert, nicht pro Token).

**Accessibility:** ausreichender Kontrast (Light+Dark), Fokus-Reihenfolge, ARIA-Live-Region für den Stream, Tastatur-bedienbare Aktionen.

> Visuelle Detailausarbeitung erfolgt in der Umsetzung mit der `frontend-design`-Skill.

---

## 9. Einstellungen (Options-Page)

- **API-Key** (Passwortfeld, in `browser.storage.local`).
- **Modell** (Dropdown: Opus 4.8 [Default] · Sonnet 4.6 · Haiku 4.5).
- **Max. Input-Tokens** (Truncation-Cap) und **Max. Output-Tokens**.
- **System-Prompt-Editor** (Textarea; Default = gebündelter Meta-Prompt; „Auf Default zurücksetzen").
- **Ausgabesprache** (Default Deutsch — wird dem Modell nur als Hinweis mitgegeben; Meta-Prompt ist deutsch).
- **Theme** (System / Hell / Dunkel).

---

## 10. Sicherheit & Datenschutz

- API-Key in `browser.storage.local` — **extension-isoliert, aber nicht OS-verschlüsselt** (ehrliche Einordnung; keine Scheinsicherheit durch Obfuskation). Nie geloggt. Verlässt das Gerät ausschließlich Richtung `api.anthropic.com`.
- Modell-Output **immer** mit DOMPurify sanitisiert vor `innerHTML` (Defense-in-Depth).
- Strikte CSP (`connect-src` nur Anthropic).
- Minimale Permissions (`activeTab`, kein `<all_urls>`).
- Datenschutz-Hinweis in der UI: „Seiteninhalt wird zur Analyse an Anthropic gesendet."

---

## 11. Stack & Projektstruktur

**Stack:** TypeScript · Vite (`vite-plugin-web-extension`) · `web-ext` (run/lint/build/self-sign).
**Libraries:** `@mozilla/readability`, `turndown`, `marked`, `dompurify`. (Anthropic-Call via `fetch` direkt — kein SDK im Browser nötig; SDK optional, aber `fetch`+SSE ist schlank und vermeidet Bundle-Gewicht.)

```
diskussionsanalyse/
  manifest.json
  src/
    background/index.ts        # action/menus/commands, activeTab, sidebar öffnen, Extraktion anstoßen
    sidebar/
      sidebar.html  sidebar.ts  sidebar.css
      state.ts                 # State-Machine
      render.ts                # marked + DOMPurify
    options/
      options.html  options.ts  options.css
    content/
      extract.ts               # Dispatch per hostname
      extractors/{generic,hackernews,youtube}.ts
    lib/
      anthropic.ts             # fetch + SSE-Streaming, Fehler-Mapping
      prompt.ts                # System+User-Message, Truncation
      tokens.ts                # grobe Schätzung / count_tokens
      storage.ts               # Settings get/set
      types.ts                 # ExtractionResult, Settings, …
    assets/
      meta-prompt.md           # gebündelter Default-System-Prompt
      icon.svg
    vendor/Readability.js
  test/
    fixtures/                  # gespeicherte HTML: hn.html, youtube.html, generic-*.html
    extract.test.ts  prompt.test.ts  sse.test.ts  tokens.test.ts
  package.json  tsconfig.json  vite.config.ts  web-ext-config.cjs
```

---

## 12. Testing (TDD)

Test-zuerst (Vitest). Schwerpunkte:
- **Extraktion** gegen gespeicherte HTML-Fixtures (HN, YouTube, generischer Artikel mit/ohne Kommentare) → erwartetes `ExtractionResult`.
- **Prompt-Bau:** korrekte User-Message-Struktur, Truncation-Verhalten + `truncated`-Flag.
- **SSE-Parser:** korrektes Zusammensetzen aus Delta-Events, Umgang mit Split-Chunks, `error`-Event, `stop_reason: refusal`.
- **Token-Schätzung:** Budget-Grenzfälle.
- **Fehler-Mapping:** HTTP-Codes → UI-Meldung.

Manueller End-to-End-Check via `web-ext run` auf je einer echten HN-, YouTube- und News-Seite.

---

## 13. Build / Run / Dev

- `npm run dev` → Vite-Watch-Build.
- `web-ext run` → startet Firefox mit temporär geladenem Addon (Auto-Reload).
- `web-ext lint` → Manifest-/Code-Checks.
- `web-ext build` + optional `web-ext sign` (self-distributed, persönlich) für dauerhafte Installation.
- `npm test` → Vitest.

---

## 14. Modell- & Kostenhinweis

- **`claude-opus-4-8`** (Default): 1M Kontext, $5 / $25 pro 1M Token (Input/Output). Beste Analysetiefe.
- **`claude-sonnet-4-6`**: 1M Kontext, $3 / $15 — günstiger bei langen Kommentar-Threads (input-lastig).
- **`claude-haiku-4-5`**: $1 / $5, nur 200K Kontext — für kurze Threads/Speed.

Da Diskussions-Threads input-dominant sind, sind Input-Tokens der Hauptkostentreiber → Token-Cap + Modellwahl sind die zentralen Stellschrauben. Die `usage`-Zeile nach jeder Analyse macht Kosten transparent.

---

## 15. Spätere Iterationen (Backlog)

Reddit-/X-Spezialextraktoren · in-Panel-„Analysieren"-Button (optionale Host-Permissions) · strukturierte Bias-Visualisierung (Zusatz-JSON-Schema im Prompt) · History/gespeicherte Analysen · AMO-Veröffentlichung · Chrome/Edge-Portierung (`side_panel` statt `sidebar_action`) · Prompt-Caching bei größeren System-Prompts.

---

## Anhang: Beispiel-User-Message (gekürzt)

```
QUELLE: https://news.ycombinator.com/item?id=12345
TITEL: Ask HN: Is remote work here to stay?
TYP: hackernews

=== BEITRAG / ARTIKEL ===
Ask HN: Is remote work here to stay? …

=== KOMMENTARE (87) ===
> [alice · 142▲ · Ebene 0]
Remote hat unsere Produktivität messbar erhöht …

> [bob · 38▲ · Ebene 1]
Kommt stark auf die Rolle an — für Junioren fehlt das Mentoring …
```
