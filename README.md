# Diskussionsanalyse

Ein Firefox-Addon (Manifest V3), das den Inhalt der aktuellen Seite — Artikel **und** Kommentare — extrahiert, in einen festen deutschen Meta-Prompt verpackt und von der Claude-API analysieren lässt. Das Ergebnis ist eine neutrale, strukturierte Analyse mit **Bias-Befund**, die live in eine Sidebar gestreamt wird. Anschließend lassen sich **Rückfragen** zur Diskussion stellen.

> Diskussionen lesen, ohne sie zu lesen — inklusive der Frage, *wie einseitig* das Material überhaupt ist.

---

## Was es macht

1. Du löst die Analyse auf einer beliebigen Seite aus (Toolbar-Aktion, Kontextmenü oder `Strg+Shift+Y`).
2. Der Seiteninhalt wird on-demand extrahiert (Readability + Kommentar-Heuristik; getunte Extraktoren für Hacker News & YouTube).
3. Die Sidebar streamt eine deutsche Analyse in fünf Abschnitten:
   **Kurzüberblick · Hauptthemen · Meinungsbild · Bemerkenswertes · Bias & Tendenz**
   (das „Bias & Tendenz"-Panel ist die Kernfunktion und visuell hervorgehoben).
4. Danach kannst du **Rückfragen** stellen — die Frage geht zusammen mit dem Original-Inhalt und der bisherigen Analyse an Claude (Multi-Turn).

Die fachliche Logik steckt im Meta-Prompt (`meta-prompt-diskussionsanalyse.md`): Claude bleibt in der eigenen Stimme neutral, gibt jede Position fair wieder und macht die Schlagseite des Materials als **Befund** sichtbar — ohne selbst Partei zu ergreifen.

## Features

- **Live-Streaming** der Analyse (SSE, manuell geparst) mit ruhigem In-place-Rendering.
- **Rückfragen-Thread** mit vollem Kontext (Artikel + Kommentare + Analyse).
- **Getunte Extraktoren** für Hacker News & YouTube, generischer Pfad (Readability) für alles andere (inkl. Reddit/X in v1).
- **Token-Budget/Truncation**: Artikel zuerst, dann höchstbewertete Kommentare; Kürzung wird dem Modell offengelegt.
- **Optionen**: API-Key, Modell, Token-Caps, editierbarer System-Prompt (mit „Auf Default zurücksetzen"), Sprache, Theme.
- **Lesefokus-Design**: eigenständige Typografie (Buch-Serife für die Analyse, humanistische Sans für die UI), Light/Dark via `prefers-color-scheme` + manuelles Theme.
- **Fehlerbehandlung** mit klaren deutschen Meldungen (401/403/413/429/5xx/Refusal/Abbruch).

## Wie es funktioniert (Architektur)

```
Nutzer-Geste (Toolbar-Aktion / Kontextmenü / Shortcut)
        │  (gewährt activeTab)
        ▼
BACKGROUND (Event-Page)
  • sidebarAction.open()  ← synchron im Gesten-Handler
  • scripting.executeScript: Extraktor-Bundle injizieren + via func aufrufen
  • Ergebnis → storage.session + runtime.sendMessage
        │
        ▼
SIDEBAR (moz-extension://)
  • State-Machine + Rendering
  • fetch → api.anthropic.com  (SSE-Streaming, adaptive thinking)
  • marked + DOMPurify  → Karten + Bias-Panel + Q&A-Thread
```

Die **Sidebar besitzt den API-Call** (kein Backend, kein Proxy). Die Extraktion läuft **on-demand injiziert** (keine dauerhaften Content-Scripts). Ein Klick *innerhalb* der Sidebar gewährt kein `activeTab` — deshalb startet die Erstanalyse immer über eine echte Geste (Aktion/Menü/Shortcut); „Erneut" und Rückfragen arbeiten auf dem gecachten Ergebnis.

## Installation & Entwicklung

Voraussetzungen: Node ≥ 20, Firefox.

```bash
npm install

npm run dev        # Vite-Dev-Build + startet Firefox mit dem Addon (HMR)
npm test           # Vitest (Unit-Tests)
npm run build      # Produktions-Build nach dist/
npm run lint:ext   # web-ext lint gegen dist/
npm run start:ff   # web-ext run -s dist  (gebaute Version in Firefox laden)
```

Manuelles Laden ohne web-ext: `about:debugging` → „Dieses Firefox" → „Temporäres Add-on laden" → `dist/manifest.json`.

## Konfiguration

Optionen-Seite (Add-on verwalten → Einstellungen):

| Einstellung | Default | Zweck |
|---|---|---|
| **API-Key** | – | Anthropic-Key, in `storage.local` |
| **Modell** | `claude-opus-4-8` | Alternativen: `claude-sonnet-4-6`, `claude-haiku-4-5` |
| **Max. Input-Tokens** | 150 000 | Kürzungs-Cap für den Seiteninhalt |
| **Max. Output-Tokens** | 8 000 | Länge der Analyse (`max_tokens`) |
| **System-Prompt** | gebündelter Meta-Prompt | editierbar, rücksetzbar |
| **Ausgabesprache** | Deutsch | Hinweis ans Modell |
| **Theme** | System | System / Hell / Dunkel |

## Unterstützte Seiten

- **Hacker News** — getunt (Post + verschachtelte Kommentare mit Tiefe).
- **YouTube** (`/watch`) — best-effort (Titel + Beschreibung; Kommentare aus `ytInitialData`, sonst sichtbares DOM; kann unvollständig sein).
- **Alles andere** — generischer Pfad: Readability für den Artikel, Heuristik für Kommentare (greift auch für Reddit/X).

## Datenschutz & Sicherheit

- Der API-Key liegt in `browser.storage.local` — **vom Addon isoliert, aber nicht betriebssystemverschlüsselt**. Er wird nie geloggt und verlässt das Gerät ausschließlich Richtung `api.anthropic.com`.
- Strikte CSP: `connect-src` ist auf `api.anthropic.com` beschränkt — Output kann nirgendwo sonst hin.
- Minimale Permissions: `activeTab`, `scripting`, `storage`, `menus` — **kein** `<all_urls>`; Host nur `https://api.anthropic.com/*`.
- Modell-Output wird **immer** mit DOMPurify sanitisiert, bevor er ins DOM geht.
- Der Seiteninhalt wird zur Analyse an Anthropic gesendet (Hinweis in der UI).

## Projektstruktur

```
src/
  background/index.ts          Gesten-Handler, activeTab, Sidebar öffnen, Inject+Invoke, Handoff
  content/
    extract.ts                 injizierter Wrapper (setzt globalThis-Factory)
    extract-core.ts            Dispatch per hostname  [pure, getestet]
    extractors/{generic,hackernews,youtube}.ts  [pure, getestet]
  sidebar/
    sidebar.{html,ts,css}      State-Machine, Streaming, Q&A, Rendering
    state.ts  render.ts        Store + marked/DOMPurify  [render getestet]
  options/options.{html,ts,css}
  lib/
    anthropic.ts               fetch + SSE-Streaming, Fehler-Mapping
    sse.ts  errors.ts          [pure, getestet]
    prompt.ts  tokens.ts       Prompt-Bau + Truncation  [pure, getestet]
    storage.ts  types.ts       Settings  [getestet]
  assets/meta-prompt.md        gebündelter Default-System-Prompt
public/icon.svg                Toolbar-Icon (nach dist/ kopiert)
test/                          Vitest + Fixtures (HN/YouTube/generisch)
```

## Tests

Test-getrieben (Vitest, jsdom). Abgedeckt: Extraktion (HN/YouTube/generisch gegen Fixtures), Prompt-Bau + Truncation, SSE-Parser (inkl. Chunk-Splits), Fehler-Mapping, Token-Schätzung, Storage, Render/Section-Split. `npm test` → aktuell 27 Tests grün.

## Status & Roadmap

**v1 fertig**: Extraktion, Streaming-Analyse, Bias-Panel, Optionen, Fehlerpfade, Rückfragen-Thread.

**Backlog**: Reddit-/X-Spezialextraktoren · robustere YouTube-Kommentar-Extraktion (Continuation/Scroll) · optionale `count_tokens`-Vorab-Anzeige · Input-Kosten in der Usage-Zeile · strukturierte Bias-Visualisierung · History · AMO-Signierung · Chrome-Port (`side_panel`).

## Lizenz / Nutzung

Persönlicher Gebrauch, unsigniert/temporär geladen (kein AMO). Benötigt einen eigenen Anthropic-API-Key.
