# SETUP.md — WhatsApp Projekt-Datenbank (Ingest-Bot + semantische Suche)

> **Projektstatus:** Phase 1 bis 4 sind lokal implementiert. Die aktuelle
> automatisierte Suite besteht mit 124/124 Tests. Die Live-Abnahme mit Anthropic,
> Voyage, WhatsApp und Supabase sowie das Anwenden des Schemas auf ein
> Remote-Projekt stehen ohne Zugangsdaten noch aus.

---

## 1. Kontext & Ziel

Eine WhatsApp-Community (MB/AI Stammtisch) teilt Projekte als Nachricht mit
angehängter `.md`-Datei. Diese `.md` ist eine Nachbau-Anleitung, die ein
Coding-Agent direkt verwerten kann. Der Bot erfasst sie strukturiert in einer
Datenbank. Spätere Phasen machen die Projekte direkt in WhatsApp semantisch
durchsuchbar und ergänzen Claim-Befehle.

Zwei Probleme werden gelöst:

- **Auffindbarkeit:** semantische + Keyword-Suche statt einer endlosen Chat-Liste.
- **Doppelarbeit vermeiden:** Projekte haben einen Status (`frei` / `vergeben` /
  `erledigt`).

Das rohe `.md` bleibt als gültiger UTF-8-Text unverändert in `raw_md` erhalten;
es ist das eigentliche Artefakt. Ungültiges UTF-8, NUL-Bytes und Anhänge über
1 MiB werden abgewiesen. Titel, Summary, Tags und Embedding bilden die
Verständnis- und Suchschicht darüber.

---

## 2. Tech-Stack

| Baustein | Wahl | Grund |
|---|---|---|
| WA-Anbindung | **Baileys** (`@whiskeysockets/baileys`) | reine WebSocket-Implementierung, kein Chromium/Puppeteer |
| DB | **Supabase / Postgres** + `pgvector` | Vektorsuche und serverseitiger Zugriff |
| Verstehen (MD→Meta) | **Anthropic `claude-fable-5`** | GA Structured Outputs mit `effort: low` |
| Embedding | **Voyage `voyage-4`**, 1024 Float-Dimensionen | fester Vektorraum für Dokumente und spätere Queries |
| Runtime | Node.js ≥ 20, systemd auf dem VPS | schlanker Outbound-only-Prozess |

Fable/Claude extrahiert `titel`, `summary`, `tags` und `kategorie`.
Voyage erzeugt den Suchvektor; Anthropic liefert keine Embeddings. Modelle und
Dimension sind im Code festgelegt, damit Ingest und spätere Suche denselben
Embedding-Raum verwenden.

---

## 3. Voraussetzungen

- Node.js ≥ 20.
- Eine **Wegwerf-/Zweitnummer** für den Bot. Baileys ist eine inoffizielle
  WhatsApp-Anbindung und bringt ein Sperrrisiko mit; nicht die private Nummer
  verwenden. Der Bot muss Mitglied der Zielgruppe sein.
- Die aus Phase 1 bekannte JID genau dieser Zielgruppe.
- Ein Supabase-Projekt mit HTTPS-URL und `service_role`-Key.
- Ein Anthropic-API-Key und ein Voyage-API-Key.

### Env-Variablen (`.env`)

```dotenv
SUPABASE_URL=https://projekt.supabase.co
SUPABASE_SERVICE_KEY=<service_role-key>
TARGET_GROUP_JID=<gruppen-jid>@g.us
ANTHROPIC_API_KEY=<anthropic-api-key>
VOYAGE_API_KEY=<voyage-api-key>
```

Alle fünf Variablen sind ab Phase 3 Pflicht. Die Vorlage liegt in
`.env.example`. `SUPABASE_URL` wird beim Start als HTTPS-URL validiert. Der
`service_role`-Key und beide Provider-Keys sind Servergeheimnisse und dürfen
nicht in Logs, Client-Code oder Git landen. `.env` und `auth/` sind ignoriert
und dürfen nicht committet werden.

Vor dem Bot-Start `sql/schema.sql` im Supabase SQL-Editor anwenden. Dieser
Remote-Schritt ist in der lokalen Phase-3-Validierung noch nicht erfolgt.

### Externe Datenverarbeitung

- Für ein neues oder unvollständiges Projekt gehen bis zu 12.000 Zeichen des
  rohen Markdown an Anthropic. Für `claude-fable-5` gilt laut
  [Anthropic-Dokumentation](https://platform.claude.com/docs/en/manage-claude/api-and-data-retention)
  eine 30-tägige Aufbewahrung.
- An Voyage gehen beim Ingest Titel und Zusammenfassung, nicht das vollständige
  Markdown. Bei `/suche` geht der eingegebene Suchtext an Voyage; er ist auf 500
  Zeichen begrenzt.
- Projektdateien dürfen keine Secrets, Zugangsdaten oder unnötigen sensiblen
  beziehungsweise personenbezogenen Daten enthalten. Vor Livebetrieb die
  Community über die externe Verarbeitung informieren und die eigenen
  Datenschutzanforderungen klären.

---

## 4. Projektstruktur

```text
wa-projekt-bot/
├─ src/
│  ├─ index.js          # Konfiguration, Clients, Baileys-Verbindung und Routing
│  ├─ config.js         # Pflichtvariablen und HTTPS-Prüfung
│  ├─ ingest.js         # Filter, Download, Replay, Anreicherung und Bestätigung
│  ├─ commands.js       # Command-Parsing, /suche und Ergebnisformatierung
│  ├─ db.js             # Supabase-Lookup, idempotenter Upsert und Such-RPC
│  ├─ llm.js            # Anthropic Structured Outputs und Metadatenvalidierung
│  └─ embed.js          # Voyage-Embeddings für document/query
├─ test/
│  ├─ config.test.js
│  ├─ db.test.js
│  ├─ ingest.test.js
│  ├─ commands.test.js
│  ├─ llm.test.js
│  └─ embed.test.js
├─ auth/                # Baileys useMultiFileAuthState, nicht committen
├─ sql/schema.sql
├─ .env.example
├─ .gitignore           # auth/ und .env sind ausgeschlossen
└─ package.json
```

`commands.js` enthält seit Phase 4 die WhatsApp-Befehle; Phase 5 ergänzt dort
`/nehmen` und `/liste`.

---

## 5. Datenbank-Schema (`sql/schema.sql`)

Im Supabase SQL-Editor ausführen:

```sql
create extension if not exists vector;

create table projekte (
  id            bigint generated always as identity primary key,
  wa_message_id text unique,
  author_jid    text,
  author_name   text,
  created_at    timestamptz default now(),
  titel         text,
  summary       text,
  tags          text[],
  kategorie     text,
  status        text default 'frei',
  claimed_by    text,
  raw_md        text,
  md_url        text,
  embedding     vector(1024),
  fts tsvector generated always as (
    to_tsvector('german',
      coalesce(titel,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(raw_md,''))
  ) stored
);

create index on projekte using hnsw (embedding vector_cosine_ops);
create index on projekte using gin  (fts);

alter table public.projekte enable row level security;

revoke all on table public.projekte from anon, authenticated;
revoke all on sequence public.projekte_id_seq from public, anon, authenticated;

grant usage on schema public to service_role;
grant select, insert, update, delete on table public.projekte to service_role;
grant usage, select on sequence public.projekte_id_seq to service_role;

create or replace function suche_projekte(
  query_embedding vector(1024),
  query_text      text,
  treffer         int default 5
)
returns setof projekte language sql stable as $$
  select *
  from projekte
  where status <> 'erledigt'
  order by
    (embedding <=> query_embedding)
    - 0.15 * ts_rank(fts, plainto_tsquery('german', query_text))
  limit treffer;
$$;

revoke execute on function public.suche_projekte(vector, text, integer)
  from public, anon, authenticated;
grant execute on function public.suche_projekte(vector, text, integer)
  to service_role;
```

Dieser Block entspricht `sql/schema.sql`. RLS ist aktiv; `anon` und
`authenticated` erhalten weder Tabellenrechte noch RPC-Ausführung. Der
serverseitige Bot arbeitet mit `service_role`, dem die benötigten Rechte auf
Schema, Tabelle, Identity-Sequenz und Suchfunktion explizit erteilt werden.

Die Phase-3-Spalten und `vector(1024)` waren bereits vorhanden. Für Phase 3 ist
daher keine DDL-Änderung erforderlich.

---

## 6. Phasen

### Phase 1 — Verbindung & Erkennung (implementiert)

Baileys verwendet `useMultiFileAuthState('./auth')`, zeigt den QR-Code beim
ersten Login und verbindet sich nach einem Abbruch erneut, sofern WhatsApp
keinen Logout meldet. Die in Phase 1 ermittelte Gruppen-JID wird als
`TARGET_GROUP_JID` vorausgesetzt.

Der aktuelle Handler protokolliert keine JIDs. Er filtert zuerst auf die exakte
Zielgruppe und untersucht erst dann Nachricht und Dateiname.

---

### Phase 2 — Ingest ohne LLM (lokal implementiert)

Phase 2 führte den sicheren Rohdaten-Ingest ein:

- Nachrichten vom Bot selbst, andere Chats und Dateien ohne case-insensitive
  `.md`-Endung werden vor dem Download ignoriert.
- Die deklarierte Dateigröße wird, wenn vertrauenswürdig, vor dem Download
  geprüft. Der geladene Buffer wird danach erneut geprüft. Das Limit beträgt
  1 MiB (`1_048_576` Bytes).
- Der Buffer wird strikt als UTF-8 dekodiert. Ungültiges UTF-8 und NUL-Bytes
  werden abgewiesen.
- Eine stabile `m.key.id` ist Pflicht. Gespeichert werden `wa_message_id`,
  `author_name`, `author_jid` und der unveränderte UTF-8-Text als `raw_md`.
- Der Supabase-Upsert nutzt `wa_message_id` als Konfliktschlüssel. Der
  Unique-Constraint verhindert eine zweite Zeile bei Replay.
- Eine WhatsApp-Bestätigung folgt erst auf die erfolgreiche Persistenz.

Die damalige Phase-2-Suite bestand mit 23/23 Tests. Die aktuelle Suite enthält
diese Regressionen unverändert.

---

### Phase 3 — Verstehen & Suchbar machen (lokal implementiert)

Phase 3 ergänzt zwei fest konfigurierte Provider-Schichten.

**`src/llm.js` — Metadaten**

- Festes Modell: `claude-fable-5`.
- GA Structured Outputs mit `output_config.effort: low` und einem JSON-Schema
  ohne zusätzliche Felder.
- Höchstens 12.000 Zeichen Markdown pro Anfrage.
- Akzeptiert nur `stop_reason: end_turn`; Refusals und andere Stop-Gründe
  schlagen geschlossen fehl.
- Validiert lokal genau `titel`, `summary`, `tags` und `kategorie`, einschließlich
  Typen, Leerwerten und Längen. Unbekannte Felder werden abgewiesen.

**`src/embed.js` — Embeddings**

- Fester HTTPS-Endpunkt und festes Modell `voyage-4`.
- `input_type: document` beim Ingest, `truncation: false`,
  `output_dimension: 1024` und `output_dtype: float`.
- Eingabe beim Ingest ist `${titel}\n${summary}`.
- Akzeptiert nur genau einen Datensatz mit Index 0 und exakt 1024 endlichen
  Zahlen für das erwartete Modell.
- Timeout sowie höchstens drei Versuche; Retries nur für HTTP 429 und 5xx.

Phase 4 bettet Suchanfragen mit demselben `voyage-4`, derselben Dimension und
`input_type: query` ein. Unterschiedliche Modelle oder Dimensionen dürfen nicht
im selben Vektorraum gemischt werden.

**Ablauf für neue Dokumente**

1. Zielgruppe, Dateiendung, Nachrichten-ID, Größe und UTF-8 prüfen.
2. Metadaten extrahieren und vollständig validieren.
3. Titel und Zusammenfassung als Voyage-Dokument einbetten und validieren.
4. Rohdaten, Identität, Metadaten und Embedding gemeinsam per Upsert speichern.
5. Erst danach mit dem bereinigten Titel in WhatsApp bestätigen.

Bei einem Anthropic-, Voyage- oder Supabase-Fehler wird keine unvollständige
Phase-3-Zeile geschrieben und keine Bestätigung gesendet.

**Replay und Phase-2-Anreicherung**

- Der Lookup über `wa_message_id` erfolgt vor Medien-Download und
  Provider-Aufrufen.
- Eine vollständige Phase-3-Zeile wird ohne Download, Provider-Aufruf, Write
  oder erneute Bestätigung übersprungen.
- Eine unvollständige Phase-2-Zeile wird still aus ihrem gespeicherten `raw_md`
  angereichert; das Medium wird nicht erneut heruntergeladen.
- Beim Enrichment werden ausschließlich `wa_message_id`, `titel`, `summary`,
  `tags`, `kategorie` und `embedding` geschrieben. Rohtext, Autor, Status,
  Claim und Zeitstempel werden nicht überschrieben.
- Fehlt wiederverwendbares `raw_md`, endet der Vorgang vor kostenpflichtigen
  Aufrufen.

**Lokale Verifikation**

Phase 3 brachte die Suite auf 80/80 netzfreie Tests; sie sind in den aktuellen
124/124 enthalten. Abgedeckt sind der genaue Anthropic-/Voyage-Vertrag, Schema-
und Dimensionsvalidierung, Timeout/Retry, Refusal- und Fehlerpfade, vollständige
neue Ingestion, kostenfreie Replays, stille Phase-2-Anreicherung, DB-Allowlist
und fehlende Teilpersistenz.

**Noch offene Live-Abnahme**

1. `sql/schema.sql` in einem echten Supabase-Projekt anwenden.
2. Alle fünf Env-Variablen mit realen, serverseitigen Zugangsdaten setzen.
3. Den Bot mit einer Zweitnummer starten und eine gültige `.md` bis 1 MiB in
   der Zielgruppe posten.
4. In Supabase prüfen, dass Rohtext, vier Metadatenfelder und exakt 1024
   Embedding-Werte gespeichert sind.
5. Prüfen, dass die WhatsApp-Bestätigung erst nach der Persistenz den erkannten
   Titel nennt.
6. Dieselbe Nachricht erneut zustellen und verifizieren, dass weder
   Provider-Aufrufe noch Write oder Bestätigung wiederholt werden.
7. Eine vorhandene Phase-2-Zeile erneut zustellen und die stille Anreicherung
   aus `raw_md` prüfen.

Anthropic, Voyage, WhatsApp und Supabase wurden in der lokalen Validierung nicht
live aufgerufen. Diese Abnahme ist vor einem produktiven Einsatz zwingend.

---

### Phase 4 — `/suche` (lokal implementiert)

**Routing**

`messages.upsert` filtert weiterhin zuerst auf eigene Nachrichten und die exakte
Zielgruppe. Danach entscheidet `commands.js`: Textnachrichten, deren getrimmter
Inhalt mit `/` beginnt, werden als Befehl behandelt und erreichen den Ingest
nicht. Alles andere läuft unverändert durch den Phase-3-Pfad. Der Befehlsname
wird kleingeschrieben und muss `[a-z0-9_-]` mit höchstens 32 Zeichen entsprechen;
sonst gilt die Nachricht nicht als Befehl. Ein `/suche` in der Bildunterschrift
eines Dokuments ist kein Befehl, sondern bleibt ein Ingest-Kandidat.

**`src/commands.js` — `/suche <text>`**

- Der Suchtext wird mit `embed(text, { inputType: 'query' })` eingebettet, also
  mit `voyage-4` und denselben 1024 Float-Dimensionen wie der Ingest.
- Danach folgt der RPC `suche_projekte` mit `query_embedding`, `query_text` und
  `treffer: 5`.
- Der RPC liefert `setof projekte`. Die Abfrage projiziert serverseitig auf
  `id,status,titel`, damit weder `raw_md` noch fünf Embeddings übertragen werden.
- Die Antwort enthält höchstens fünf Zeilen im Format
  `#<id> [<status>] <titel>`, ohne Treffer „Nichts gefunden.“.
- Zeilen ohne positive Ganzzahl-`id` oder ohne Titel werden verworfen; `titel`
  und `status` werden vor dem Senden bereinigt und auf 160 beziehungsweise 32
  Zeichen begrenzt.

**Grenzen und Fehlerverhalten**

- Ein leerer Suchbegriff beantwortet der Bot mit `Nutzung: /suche <suchbegriff>`,
  mehr als 500 Zeichen mit einer Längenmeldung. Beides geschieht vor dem
  kostenpflichtigen Voyage-Aufruf.
- Unbekannte Befehle werden verworfen: keine Antwort, kein Provider-Aufruf, kein
  Ingest.
- Schlägt Voyage oder der RPC fehl, sendet der Bot nur „Die Suche ist gerade
  nicht möglich.“ und der Fehler wird bereinigt und begrenzt protokolliert.
  Provider- oder Datenbankdetails erreichen die Gruppe nicht.

**Lokale Verifikation**

`npm test` besteht mit 124/124 netzfreien Tests. Phase 4 deckt Parsing,
Routing gegen den Ingest, den RPC-Vertrag, Ergebnisformatierung und
-bereinigung, Eingabegrenzen sowie Provider- und Datenbankfehler ab.

**Noch offene Live-Abnahme**

1. `/suche puzzle game` in der Zielgruppe absetzen und prüfen, dass der Bot
   thematisch passende Projekte nennt, auch wenn das Wort „puzzle“ im Post nicht
   wörtlich vorkommt.
2. Dabei verifizieren, dass supabase-js das Zahlenarray als `vector(1024)`
   akzeptiert (siehe Fallstricke) und die Projektion `id,status,titel` greift.
3. `/suche` ohne Begriff, mit über 500 Zeichen und einen unbekannten Befehl wie
   `/liste` absetzen und das jeweils beschriebene Verhalten prüfen.

**Akzeptanzkriterium:** `/suche puzzle game` liefert thematisch passende
Projekte, auch wenn das Wort „puzzle“ im Post nicht wörtlich vorkommt.

---

### Phase 5 — `/nehmen` & `/liste` (geplant)

- `/nehmen <id>` setzt `status='vergeben'` und `claimed_by=<pushName>` und
  bestätigt die Änderung.
- `/liste frei` liefert freie Projekte.

**Akzeptanzkriterium:** Nach `/nehmen 42` taucht #42 nicht mehr in
`/liste frei` auf und ist in der Suche als `[vergeben]` markiert.

---

## 7. Deployment (VPS, systemd)

`/etc/systemd/system/wa-projekt-bot.service`:

```ini
[Unit]
Description=WA Projekt Bot
After=network-online.target

[Service]
WorkingDirectory=/opt/wa-projekt-bot
ExecStart=/usr/bin/node src/index.js
EnvironmentFile=/opt/wa-projekt-bot/.env
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Das erste QR-Login interaktiv mit `node src/index.js` durchführen. Erst danach
den Service aktivieren; sonst ist der QR-Code nicht sichtbar. `auth/` muss
zwischen Neustarts persistent bleiben.

---

## 8. Fallstricke

- **`auth/` und `.env` niemals committen.** `auth/` enthält die WhatsApp-Session,
  `.env` enthält Supabase- und Provider-Secrets.
- **Externe Verarbeitung:** Roh-Markdown geht bis zur 12.000-Zeichen-Grenze an
  Anthropic; Titel und Summary gehen an Voyage. Für Fable gilt eine
  30-tägige Aufbewahrung. Keine Secrets oder ungeklärten sensiblen Inhalte
  einspeisen.
- **Structured Outputs:** Provider-Antworten werden nicht repariert oder mit
  einem manuellen Fallback übernommen. Refusal, falscher Stop-Grund, ungültiges
  JSON oder ein abweichendes Schema brechen die Verarbeitung ab.
- **Idempotenz:** `onConflict: 'wa_message_id'` und der Unique-Constraint gehören
  zusammen. Sie verhindern doppelte Zeilen, aber keine doppelten Kosten bei
  zeitgleichen Zustellungen.
- **Nebenläufigkeit:** Der Lookup und Upsert sind kein atomarer Claim. Parallele
  Zustellungen derselben neuen Nachrichten-ID können doppelte Provider-Aufrufe
  und Bestätigungen verursachen. Für höhere Last ist DB-Claiming oder ein
  keyed Lock erforderlich.
- **Rate und Kosten:** Jedes Mitglied der Zielgruppe kann mit einer neuen `.md`
  und mit jedem `/suche` kostenpflichtige Aufrufe auslösen. Rate Limits, Quoten
  und Kosten überwachen; für breiteren Betrieb eine Sender-Allowlist oder
  Rate-Limits ergänzen. Der Bot begrenzt Befehle bisher nicht pro Absender.
- **Supabase-Zugang:** Nur HTTPS akzeptieren. Den `service_role`-Key nur im
  serverseitigen Bot verwenden; RLS und Rechte aus `sql/schema.sql` nicht
  lockern.
- **Dateigrenzen:** Nur `.md` aus der exakten Zielgruppe verarbeiten. Das
  1-MiB-Limit vor und nach dem Download prüfen und nur gültiges UTF-8 ohne
  NUL-Bytes speichern.
- **Voyage-Raum:** Dokumente und Queries müssen beide `voyage-4` mit 1024
  Float-Dimensionen verwenden; nur `input_type` wechselt zwischen `document`
  und `query`.
- **pgvector via supabase-js RPC:** `/suche` übergibt `query_embedding` als
  Zahlenarray. Falls die reale Instanz das nicht akzeptiert, die erwartete
  Vektordarstellung dort prüfen. Diese Live-Integration ist noch nicht validiert.
- **Befehle sind keine Ingest-Nachrichten:** Ein `/`-Präfix schaltet den Ingest
  für diese Nachricht ab. Neue Befehle in `commands.js` müssen deshalb selbst
  entscheiden, ob sie antworten, und dürfen keine Provider-Aufrufe auslösen,
  bevor Eingabe und Länge geprüft sind.

---

## 9. Definition of Done

Der Gesamtumfang ist nach Phase 5 erreicht: Ein Community-Mitglied postet eine
`.md`, der Bot bestätigt nach vollständiger Speicherung mit dem Titel, ein
anderes Mitglied findet das Projekt über `/suche`, `/nehmen` markiert es als
vergeben und es verschwindet aus `/liste frei`. Alles bleibt innerhalb
WhatsApp.

Aktuell ist Phase 4 lokal abgeschlossen. Die produktive Freigabe bleibt bis zur
oben beschriebenen Live-Abnahme offen.
