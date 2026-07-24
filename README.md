# wa-projekt-bot

Ein WhatsApp-Bot für die MB/AI-Stammtisch-Community: Er erfasst in einer fest
konfigurierten Gruppe geteilte `.md`-Projektbeschreibungen in Supabase. Spätere Phasen
ergänzen Metadaten, semantische Suche und Claim-Befehle direkt in WhatsApp.

Die vollständige Spezifikation mit allen Phasen, Datenbankschema und Deployment-Hinweisen
steht in [SETUP.md](./SETUP.md).

## Status

✅ **Phase 2 von 5 ist lokal implementiert und automatisiert verifiziert**
(`npm test`: 23/23 Tests).

Der aktuelle Bot verarbeitet ausschließlich `.md`-Dokumente aus der exakten
`TARGET_GROUP_JID`, akzeptiert höchstens 1 MiB gültiges UTF-8, schreibt den Rohtext per
Supabase-Upsert mit `wa_message_id` als Idempotenzschlüssel und bestätigt erst nach
erfolgreicher Speicherung. Meta-Extraktion, Embeddings und Commands beginnen ab Phase 3.

Noch ausstehend ist die Live-Abnahme mit einer echten WhatsApp-Gruppe und einem echten
Supabase-Projekt. Das Anwenden von [sql/schema.sql](./sql/schema.sql), der reale
Medien-Download, die Bestätigung in WhatsApp und der Idempotenznachweis gegen die
Remote-Datenbank wurden ohne Zugangsdaten nicht verifiziert.

## Tech-Stack

| Baustein | Wahl |
|---|---|
| WhatsApp-Anbindung | [Baileys](https://github.com/WhiskeySockets/Baileys) (`@whiskeysockets/baileys`) |
| Datenbank | Supabase / Postgres + pgvector, `@supabase/supabase-js` 2.109.0 |
| Runtime | Node.js ≥ 20 |
| Ab Phase 3 geplant | Anthropic Claude für Metadaten, Voyage `voyage-3` für Embeddings |

## Quick Start

Voraussetzungen:

- Node.js ≥ 20
- eine Wegwerf-/Zweitnummer für WhatsApp, die Mitglied der Zielgruppe ist
- ein Supabase-Projekt mit HTTPS-URL und `service_role`-Key
- die aus Phase 1 bekannte Gruppen-JID der Zielgruppe

Abhängigkeiten installieren und die lokale Konfiguration anlegen:

```bash
npm install
cp .env.example .env
```

Unter PowerShell lautet der zweite Befehl `Copy-Item .env.example .env`.

Anschließend `.env` ohne Platzhalter befüllen:

```dotenv
SUPABASE_URL=https://projekt.supabase.co
SUPABASE_SERVICE_KEY=<service_role-key>
TARGET_GROUP_JID=<gruppen-jid>@g.us
```

`SUPABASE_URL` muss eine gültige HTTPS-URL sein. Der `service_role`-Key gehört nur in den
serverseitigen Bot-Prozess und darf weder veröffentlicht noch an Clients ausgeliefert
werden. `.env` und `auth/` sind ignoriert und dürfen nicht committet werden.

Vor dem Bot-Start [sql/schema.sql](./sql/schema.sql) im Supabase SQL-Editor anwenden.
Das Schema aktiviert RLS, entzieht `anon` und `authenticated` die Rechte und gewährt die
benötigten Tabellen-, Sequenz- und RPC-Rechte nur `service_role`.

```bash
npm test
npm start
```

Beim ersten Start erscheint ein QR-Code in der Konsole. Nach dem Scan über „Verknüpfte
Geräte“ bleibt die WhatsApp-Session in `auth/` gespeichert; bei einem normalen
Verbindungsabbruch verbindet sich der Bot erneut.

## Projektstruktur

```text
wa-projekt-bot/
├─ src/
│  ├─ index.js          # Konfiguration, Baileys-Verbindung und Event-Routing
│  ├─ config.js         # Pflichtvariablen und HTTPS-Prüfung
│  ├─ db.js             # serverseitiger Supabase-Client und idempotenter Upsert
│  └─ ingest.js         # Zielgruppenfilter, Download, Validierung und Bestätigung
├─ test/
│  ├─ config.test.js
│  ├─ db.test.js
│  └─ ingest.test.js
├─ sql/
│  └─ schema.sql        # Tabelle, Indizes, RLS und Rechte
├─ .env.example
├─ auth/                # lokale Baileys-Session, nicht committen
└─ package.json
```

## Konfiguration

Phase 2 benötigt genau diese drei Variablen:

| Variable | Zweck |
|---|---|
| `SUPABASE_URL` | HTTPS-URL des Supabase-Projekts |
| `SUPABASE_SERVICE_KEY` | geheimer `service_role`-Key für den Bot-Prozess |
| `TARGET_GROUP_JID` | exakte WhatsApp-JID der einzigen verarbeiteten Gruppe |

`ANTHROPIC_API_KEY` und `VOYAGE_API_KEY` werden erst mit Phase 3 benötigt.

## Contributing

Dies ist ein Einzelprojekt für die eigene Community, kein offenes Projekt mit
Contribution-Prozess. Änderungen laufen phasenweise nach SETUP.md und müssen vor einem
Release gegen die jeweiligen Akzeptanzkriterien validiert werden.
