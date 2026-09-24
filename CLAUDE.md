# CLAUDE.md — Diskussionsanalyse (Projekt-Vorgaben)

Firefox-Addon (MV3): Seite extrahieren → Meta-Prompt → Claude-API → gestreamte deutsche Diskussions-/Bias-Analyse in der Sidebar, plus Rückfragen-Thread. Direkter Browser→Anthropic-Call, kein Backend. Persönlicher Gebrauch, temporär geladen.

**Vor inhaltlicher Arbeit lesen:** `KONZEPT.md` (abgenommenes Design), `meta-prompt-diskussionsanalyse.md` (fixe Fachlogik), `README.md`.

## Befehle

```bash
npm install
npm run dev        # Vite-Dev + Firefox via web-ext (HMR)
npm test           # Vitest (immer grün halten)
npx tsc --noEmit   # strikter Typecheck (Gate vor Commit)
npm run build      # → dist/
npm run lint:ext   # web-ext lint -s dist  (0 errors halten)
npm run start:ff   # web-ext run -s dist
```

## Stack

TypeScript (strict, `esModuleInterop`) · Vite + `vite-plugin-web-extension` (`browser: "firefox"`) · `web-ext` · `webextension-polyfill` · `@mozilla/readability` · `turndown` · `marked` · `dompurify` · Vitest (jsdom). Anthropic via `fetch` + manuelles SSE (kein SDK). Default-Modell `claude-opus-5-5`.

## Architektur-Invarianten (nicht brechen)

- **Sidebar besitzt den API-Call.** Es gibt **einen** Pfad zum Request-Bau (`lib/anthropic.ts`): `system = settings.systemPrompt`, `model = settings.model`, `max_tokens = settings.maxOutputTokens`, `stream:true`. Adaptive Thinking gilt für alle auswählbaren Modelle außer Haiku 4.5; dort wird `thinking` weggelassen. `countTokens` teilt denselben Body-Bau. Rückfragen nutzen denselben `streamAnalysis` mit `messages`-Array. Keinen zweiten Request-Pfad einführen (Cross-Pfad-Konsistenz).
- **Erstanalyse nur über echte Geste** (Toolbar-Aktion / Kontextmenü / `Strg+Shift+Y`) — die gewährt `activeTab`. Ein Klick *in* der Sidebar gewährt es nicht. „Erneut"/Rückfragen laufen auf gecachtem Ergebnis.
- **`sidebarAction.open()` muss die ERSTE Anweisung im Gesten-Handler sein**, ohne vorheriges `await` — sonst wirft Firefox „only from a user input handler". Siehe `background/index.ts` → `trigger()` (open synchron, dann `void analyze()`).
- **Zwei Toolbar-Buttons:** `sidebar_action` erzeugt einen Sidebar-Umschalter, `action` den Analyse-Trigger. Nur `action.onClicked` / `menus` / `commands` lösen die Analyse aus.
- **Handoff Background→Sidebar = Runtime-Messages (primär) + `storage.session` (Cold-Open-Read).** `storage.onChanged` für die **`session`**-Area feuert im Sidebar-Kontext **nicht zuverlässig** — nicht als Live-Kanal verwenden. `storage.onChanged` für **`local`** ist zuverlässig (für Auto-Start beim Key-Speichern genutzt).
- **Injektion:** Extraktor wird als **klassisches IIFE** gebündelt (`src/content/extract.ts` in `additionalInputs`), per `executeScript({files})` injiziert (setzt `globalThis.__diskussionsanalyseExtract`), dann per `executeScript({func})` aufgerufen — `func`-Rückgabe ist der zuverlässige Kanal. Build emittiert nach `dist/src/content/extract.js`; Background injiziert exakt `"src/content/extract.js"`.

## Anthropic-API-Regeln

- Für Fable 5.1, Opus 5.5, Sonnet 5 und die älteren Opus-/Sonnet-Modelle: `thinking:{type:"adaptive"}`. Haiku 4.5 unterstützt das nicht; `thinking` für Haiku weglassen. **Kein** `budget_tokens`, **kein** `temperature`/`top_p`/`top_k`, **kein** Assistant-Prefill bei den neueren Modellen.
- Header inkl. `anthropic-dangerous-direct-browser-access: true` (Browser-CORS), `anthropic-version: 2023-06-01`.
- `stop_reason === "refusal"` **vor** dem Content prüfen.
- Bei Modell-/Param-Fragen die `claude-api`-Skill konsultieren, nicht aus dem Gedächtnis antworten. Modell-IDs exakt aus dem Katalog.

## UI / Sicherheit

- **CSP verbietet Inline-Handler** (`onclick="…"`). Listener immer nach dem Render per `addEventListener` anhängen (Element-IDs).
- **Modell-Output immer durch `renderMarkdown` (marked → DOMPurify)** bevor er ins DOM geht. Untrusted Seiten-Strings (Titel, Host, Section-Titel) mit `esc()` escapen bzw. `textContent`.
- **Streaming rendert in-place** (reconciling, `renderSectionsInto`/`renderQA`), gedrosselt (~90 ms). Entrance-Animation nur auf `.enter` (neue Knoten). **Nie** `appEl.innerHTML` pro Token ersetzen (Flacker-/Scroll-Bug).
- UI ist deutsch.
- Key nie loggen. `storage.local`-Caveat (nicht OS-verschlüsselt) ehrlich in den Optionen benennen.
- Minimale Permissions beibehalten: `activeTab`, `scripting`, `storage`, `menus`; Host nur `api.anthropic.com`. Kein `<all_urls>`.
- Manifest-referenzierte statische Assets (Icon) gehören nach `public/` (werden nach `dist/` kopiert) — `?raw`-Importe landen nur im JS-Bundle.

## Tests (TDD)

- Reine Logik test-zuerst: Extraktoren, `prompt`, `tokens`, `sse`, `errors`, `storage`, `render`. UI/Background per `web-ext` manuell.
- jsdom-Umgebung; `webextension-polyfill` ist in `vitest.config.ts` auf `test/mocks/webextension-polyfill.ts` (In-Memory) gealiast.
- Fixtures minimal & deterministisch (nicht Mega-HTML). Readability braucht > ~500 Zeichen Artikel, sonst liefert `parse()` null.
- Vor Commit: `npx tsc --noEmit` **und** `npm test` grün.

## Commits

- **Niemals** `Co-Authored-By: Claude …` (auch global vorgegeben). Identität `Pascal Krason <3200139+Padrio@users.noreply.github.com>`. Lokal committen; Push nur auf Aufforderung. Conventional-Commit-Präfixe (`feat:`/`fix:`/`chore:`/`test:`/`docs:`).

## Bekannte Stolperfallen (gelernt)

- `storage.onChanged`/session unzuverlässig → Runtime-Messages (s. o.).
- `sidebarAction.open()` nach `await` → wirft (s. o.).
- Build legt Entries unter `dist/src/…` ab und schreibt Manifest-Pfade um → injizierter Pfad muss zu dist passen.
- `web-ext lint` meldet `innerHTML` als **Warnings** (sanitisiert → akzeptabel für temporär geladenes Addon), aber **0 errors** halten.
- `[DA bg]` / `[DA sb]` Debug-Logs sind aktuell im Code — vor „Release"/Aufräumen entfernen oder hinter ein Flag legen.

## Backlog

Reddit/X-Extraktoren · Bias-Visualisierung · AMO-Signierung · Chrome-Port (`side_panel`).
