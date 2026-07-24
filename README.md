# wa-projekt-bot

Ein WhatsApp-Bot für die MB/AI-Stammtisch-Community: Er hört in einer Gruppe mit, erfasst
jede geteilte `.md`-Projektbeschreibung strukturiert in einer Datenbank, macht sie
semantisch durchsuchbar und beantwortet Such-/Claim-Befehle direkt in der Gruppe — ohne
App-Wechsel.

Löst zwei Probleme: **Auffindbarkeit** (semantische + Keyword-Suche statt endloser
Chat-Historie) und **Doppelarbeit** (Projekte haben einen Status `frei` / `vergeben` /
`erledigt`).

Die vollständige Spezifikation inkl. aller Phasen, DB-Schema und Deployment steht in
[SETUP.md](./SETUP.md).

## Status

🚧 **Phase 1 von 5** — Baileys-Verbindung steht, `.md`-Anhänge werden erkannt und geloggt.
Noch keine Datenbank-Anbindung, kein Verstehen/Embedding, keine Commands.

Siehe [CHANGELOG.md](./CHANGELOG.md) für den Verlauf und SETUP.md Abschnitt 6 für die
restlichen Phasen.

## Tech-Stack

| Baustein            | Wahl |
|---------------------|------|
| WA-Anbindung        | [Baileys](https://github.com/WhiskeySockets/Baileys) (`@whiskeysockets/baileys`) |
| DB                  | Supabase / Postgres + pgvector |
| Verstehen (MD→Meta) | Anthropic Claude |
| Embedding           | Voyage `voyage-3` |
| Runtime             | Node.js ≥ 20 |

## Quick Start

Voraussetzungen: Node.js ≥ 20, eine Wegwerf-/Zweitnummer für WhatsApp (nicht die private
Nummer).

```bash
npm install
npm start
```

Beim ersten Start erscheint ein QR-Code in der Konsole — mit WhatsApp auf dem Bot-Handy
scannen (Verknüpfte Geräte). Danach bleibt die Session in `auth/` gespeichert und der Bot
verbindet sich automatisch neu.

`auth/` und `.env` sind in `.gitignore` — niemals committen, sie enthalten Zugangsdaten
bzw. eine übernehmbare WhatsApp-Session.

## Projektstruktur

```
wa-projekt-bot/
├─ src/
│  └─ index.js     # Baileys connect, Event-Loop (Phase 1)
├─ auth/           # Baileys Session (nicht committen)
└─ package.json
```

Weitere Module (`ingest.js`, `commands.js`, `llm.js`, `embed.js`, `db.js`) kommen in
späteren Phasen dazu, siehe SETUP.md.

## Konfiguration

Env-Variablen (`.env`, ab Phase 2 relevant):

```
ANTHROPIC_API_KEY=
VOYAGE_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
TARGET_GROUP_JID=
```

## Contributing

Dies ist ein Einzelprojekt für die eigene Community, kein offenes Projekt mit
Contribution-Prozess. Änderungen laufen phasenweise nach SETUP.md: Akzeptanzkriterien
einer Phase erfüllen, committen, dann erst die nächste Phase angehen.
