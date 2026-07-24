# wa-projekt-bot

Ein WhatsApp-Bot für die MB/AI-Stammtisch-Community: Er erfasst in einer fest
konfigurierten Gruppe geteilte `.md`-Projektbeschreibungen in Supabase, extrahiert
strukturierte Metadaten und erzeugt Vektor-Embeddings. Semantische Suche und
Claim-Befehle direkt in WhatsApp folgen in den Phasen 4 und 5.

Die vollständige Spezifikation mit allen Phasen, Datenbankschema und
Deployment-Hinweisen steht in [SETUP.md](./SETUP.md).

## Status

✅ **Phase 3 von 5 ist lokal implementiert und automatisiert verifiziert**
(`npm test`: 80/80 Tests).

Der Bot verarbeitet ausschließlich `.md`-Dokumente aus der exakten
`TARGET_GROUP_JID`. Neue Dokumente dürfen höchstens 1 MiB groß sein und müssen
gültiges UTF-8 ohne NUL-Bytes enthalten. Anthropic extrahiert daraus `titel`,
`summary`, `tags` und `kategorie`; Voyage erzeugt aus Titel und Zusammenfassung
ein 1024-dimensionales Embedding. Erst wenn alle Werte validiert und vollständig
in Supabase gespeichert sind, bestätigt der Bot die Aufnahme mit dem erkannten
Titel.

Replays werden vor Medien-Download und Provider-Aufrufen anhand der
`wa_message_id` geprüft. Vollständige Phase-3-Zeilen verursachen keine weiteren
Downloads, Provider-Aufrufe, Schreibvorgänge oder Bestätigungen. Unvollständige
Phase-2-Zeilen werden still aus ihrem gespeicherten `raw_md` angereichert; dabei
werden ausschließlich die erlaubten Phase-3-Felder geschrieben. Es gibt keine
Teilpersistenz.

Für Phase 3 war keine Datenbankmigration nötig: Das vorhandene Schema enthält
bereits die Metadatenfelder und `embedding vector(1024)`.

Noch ausstehend ist die Live-Abnahme mit echten Anthropic-, Voyage-, WhatsApp-
und Supabase-Zugängen. Das Anwenden von [sql/schema.sql](./sql/schema.sql), reale
Provider-Antworten, Medien-Download, Remote-Persistenz und WhatsApp-Bestätigung
wurden lokal nicht verifiziert.

## Tech-Stack

| Baustein | Wahl |
|---|---|
| WhatsApp-Anbindung | [Baileys](https://github.com/WhiskeySockets/Baileys) (`@whiskeysockets/baileys`) |
| Datenbank | Supabase / Postgres + pgvector, `@supabase/supabase-js` 2.109.0 |
| Metadaten | Anthropic `claude-fable-5`, GA Structured Outputs mit `effort: low` |
| Embeddings | Voyage `voyage-4`, 1024 Float-Dimensionen |
| Runtime | Node.js ≥ 20 |

`voyage-4` ist fest konfiguriert. Der Ingest verwendet `input_type: document`;
Phase 4 muss für Suchanfragen dasselbe Modell und denselben 1024-dimensionalen
Vektorraum mit `input_type: query` verwenden.

## Quick Start

Voraussetzungen:

- Node.js ≥ 20
- eine Wegwerf-/Zweitnummer für WhatsApp, die Mitglied der Zielgruppe ist
- ein Supabase-Projekt mit HTTPS-URL und `service_role`-Key
- die aus Phase 1 bekannte Gruppen-JID der Zielgruppe
- Anthropic- und Voyage-API-Keys

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
ANTHROPIC_API_KEY=<anthropic-api-key>
VOYAGE_API_KEY=<voyage-api-key>
```

Alle fünf Variablen sind ab Phase 3 Pflicht. `SUPABASE_URL` muss eine gültige
HTTPS-URL sein. Der `service_role`-Key und die Provider-Keys gehören nur in den
serverseitigen Bot-Prozess. `.env` und `auth/` sind ignoriert und dürfen nicht
committet werden.

Vor dem Bot-Start [sql/schema.sql](./sql/schema.sql) im Supabase SQL-Editor
anwenden. Das Schema aktiviert RLS, entzieht `anon` und `authenticated` die
Rechte und gewährt die benötigten Tabellen-, Sequenz- und RPC-Rechte nur
`service_role`.

```bash
npm test
npm start
```

Beim ersten Start erscheint ein QR-Code in der Konsole. Nach dem Scan über
„Verknüpfte Geräte“ bleibt die WhatsApp-Session in `auth/` gespeichert; bei
einem normalen Verbindungsabbruch verbindet sich der Bot erneut.

## Datenverarbeitung und Betrieb

- Pro neuem oder unvollständigem Projekt werden bis zu 12.000 Zeichen des rohen
  Markdown an Anthropic übertragen. Für `claude-fable-5` gilt laut
  [Anthropic-Dokumentation](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
  eine 30-tägige Aufbewahrung.
- An Voyage gehen nur der extrahierte Titel und die Zusammenfassung, nicht das
  vollständige Markdown.
- Keine Secrets, Zugangsdaten oder sensiblen/personenbezogenen Inhalte in
  Projektdateien ablegen. Vor Livebetrieb müssen die Community über die externe
  Verarbeitung informiert und die eigenen Datenschutzanforderungen geklärt
  werden.
- Rate Limits, Provider-Quoten und Kosten überwachen. Jedes Gruppenmitglied kann
  mit einer neuen `.md` kostenpflichtige Provider-Aufrufe auslösen.
- Parallele Zustellungen derselben neuen Nachrichten-ID können wegen der
  nicht-atomaren Prüfung doppelte Providerkosten und Bestätigungen erzeugen.
  Der Unique-Key verhindert eine zweite Datenbankzeile, ersetzt aber kein
  Claiming oder Locking.

## Projektstruktur

```text
wa-projekt-bot/
├─ src/
│  ├─ index.js          # Konfiguration, Clients, Baileys-Verbindung und Routing
│  ├─ config.js         # Pflichtvariablen und HTTPS-Prüfung
│  ├─ db.js             # Supabase-Lookup und idempotenter Upsert
│  ├─ ingest.js         # Filter, Download, Replay, Anreicherung und Bestätigung
│  ├─ llm.js            # strukturierte Metadatenextraktion mit Anthropic
│  └─ embed.js          # Voyage-Embeddings für Dokumente und spätere Queries
├─ test/
│  ├─ config.test.js
│  ├─ db.test.js
│  ├─ ingest.test.js
│  ├─ llm.test.js
│  └─ embed.test.js
├─ sql/
│  └─ schema.sql        # Tabelle, Indizes, RLS und Rechte
├─ .env.example
├─ auth/                # lokale Baileys-Session, nicht committen
└─ package.json
```

## Konfiguration

Phase 3 benötigt genau diese fünf Variablen:

| Variable | Zweck |
|---|---|
| `SUPABASE_URL` | HTTPS-URL des Supabase-Projekts |
| `SUPABASE_SERVICE_KEY` | geheimer `service_role`-Key für den Bot-Prozess |
| `TARGET_GROUP_JID` | exakte WhatsApp-JID der einzigen verarbeiteten Gruppe |
| `ANTHROPIC_API_KEY` | API-Key für die Metadatenextraktion |
| `VOYAGE_API_KEY` | API-Key für Dokument-Embeddings |

Modelle und Vektordimension sind absichtlich nicht per Env überschreibbar, damit
Ingest und spätere Suche denselben Embedding-Raum verwenden.

## Contributing

Dies ist ein Einzelprojekt für die eigene Community, kein offenes Projekt mit
Contribution-Prozess. Änderungen laufen phasenweise nach SETUP.md und müssen vor
einem Release gegen die jeweiligen Akzeptanzkriterien validiert werden.
