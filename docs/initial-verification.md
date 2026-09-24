# Verifizierung — Diskussionsanalyse v1

> Historische Prüfnachweise vom Juni 2026. Aktuelle Prüfungen stehen in der [CI](../.github/workflows/ci.yml) und im [README](../README.md).

Stand: 2026-06-16. Belege statt Behauptungen (verification-before-completion).

## Automatisch verifiziert

| Prüfung | Befehl | Ergebnis |
|---|---|---|
| Unit-Tests (TDD) | `npm test` | **27 Tests / 11 Dateien grün** — storage, tokens, prompt+truncation, errors, sse, anthropic, generic/HN/YouTube-Extraktion, extract-core, render |
| Typecheck | `npx tsc --noEmit` | **0 Fehler** (strict) |
| Build | `npm run build` | **OK** — background, sidebar, options, `src/content/extract.js` (klassisches IIFE, setzt `globalThis.__diskussionsanalyseExtract`, kein top-level ESM) |
| Manifest/Code-Lint | `npx web-ext lint -s dist` | **0 errors**, 11 warnings (alle: `innerHTML` — in unserem Code via DOMPurify + `esc()` sanitisiert; statischer Linter sieht das nicht), 1 notice |
| Packaging | `npx web-ext build -s dist` | **OK** — `web-ext-artifacts/diskussionsanalyse-0.1.0.zip` |
| Laden in echtem Firefox | `web-ext run -s dist` | **OK** — Log: „Installed … dist as a temporary add-on" (kein Manifest-/Ladefehler) |

### Korrektheits-Details (gegen `claude-api`-Skill verifiziert)
- Request: `thinking:{type:"adaptive"}`, **kein** `budget_tokens`/`temperature`/`top_p`/`top_k`, **kein** Assistant-Prefill (alle → 400 auf Opus 4.8). Header `anthropic-dangerous-direct-browser-access: true`. Per Test `anthropic.test.ts` abgesichert.
- `stop_reason:"refusal"` wird vor dem Content geprüft und sauber als UI-Fehler angezeigt.
- Fehler-Mapping 401/403/413/429(retry-after)/500/529 → deutsche Meldungen (`errors.test.ts`).
- SSE-Parser robust gegen Chunk-Splits + `[DONE]` (`sse.test.ts`).
- Injektion: `files`-Inject des Bundles + `func`-Inject zum zuverlässigen Rückgabewert; Pfad `src/content/extract.js` gegen `dist/` abgeglichen.
- Sicherheit: minimale Permissions (`activeTab`/`scripting`/`storage`/`menus`, Host nur `api.anthropic.com`, kein `<all_urls>`), strikte CSP (`connect-src` nur Anthropic), Key nie geloggt, `storage.local`-Caveat in den Optionen offen dokumentiert.

## Manueller End-to-End-Check (benötigt eigenen API-Key)

Firefox läuft via `web-ext run`. Schritte:

1. **Key setzen:** Toolbar → Addon-Menü → „Verwalten" → Einstellungen (oder über das Zahnrad). Anthropic-API-Key einfügen, Modell = Opus 4.8, Speichern.
2. **Hacker News:** ein HN-Item mit Kommentaren öffnen (z. B. von `news.ycombinator.com/best`) → **Toolbar-Icon** klicken → Sidebar öffnet, „Artikel + N Kommentare erkannt" → „Claude analysiert …" → 5 Abschnitte streamen, **Bias & Tendenz** als hervorgehobenes Panel. Kopieren / Export .md / Erneut / Token-Zeile prüfen.
3. **YouTube:** ein `youtube.com/watch`-Video öffnen → Toolbar-Icon → Analyse streamt (YT-Kommentare best-effort).
4. **News:** einen Artikel öffnen → Rechtsklick → „Diskussion analysieren".
5. **Fehlerpfade:** falschen Key setzen → 401-Meldung „API-Key ungültig" + „Einstellungen öffnen". Während Stream **Stopp** klicken → bricht sauber ab.

> Dieser Schritt wird vom Nutzer mit eigenem Key ausgeführt (Key wird vom Assistenten nicht angefasst). Ergebnisse hier eintragen:
>
> - [ ] HN: …
> - [ ] YouTube: …
> - [ ] News: …
> - [ ] Fehler/Stop: …
