# Beitragen

Danke für dein Interesse an Diskussionsanalyse. Fehlerberichte und kleine, klar abgegrenzte Verbesserungen sind willkommen.

## Vor einem Pull Request

1. Beschreibe bei Bugs die betroffene Seitenart (Hacker News, YouTube oder generisch), Firefox-Version und die Schritte zur Reproduktion. Teile keine API-Keys oder privaten Seiteninhalte.
2. Ergänze für Änderungen an Extraktion, Prompt-Auswahl oder Kostenberechnung einen kleinen, deterministischen Test oder eine anonymisierte Fixture.
3. Führe die lokalen Prüfungen aus:

```bash
npm ci
npx tsc --noEmit
npm test
npm run build
npm run lint:ext
```

Der Extension-Linter meldet bekannte `innerHTML`-Warnungen; **0 Fehler** ist das erforderliche Ergebnis.

## Architektur

- Extraktion läuft nach einer Nutzeraktion im aktiven Tab. Der Background öffnet die Sidebar vor asynchroner Arbeit, damit Firefox die Geste anerkennt.
- Die Sidebar bereitet einen Request vor, zählt dessen Input-Tokens und sendet **denselben** Nachrichteninhalt erst nach Bestätigung an den Analyse-Endpunkt.
- Text aus Webseiten und Modellantworten ist nicht vertrauenswürdig. Modell-Markdown wird vor dem Rendern bereinigt; Quellenlinks werden nur aus verifizierten HTTP(S)-URLs erstellt.
- Neue Berechtigungen und Host-Zugriffe sollten begründet und so eng wie möglich sein.

Die historischen Projektunterlagen unter [docs](docs/) zeigen den ursprünglichen Entwurf, nicht zwingend das aktuelle Verhalten.
