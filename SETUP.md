# SETUP.md — WhatsApp Projekt-Datenbank (Ingest-Bot + semantische Suche)

> **Projektstatus:** Phase 1 und die lokale Implementierung von Phase 2 sind abgeschlossen.
> Die automatisierte Suite für Phase 2 besteht mit 23/23 Tests. Die Live-Abnahme mit
> WhatsApp und Supabase sowie das Anwenden des Schemas auf ein Remote-Projekt stehen ohne
> Zugangsdaten noch aus. Phase 3 ist nicht implementiert.

---

## 1. Kontext & Ziel

Eine WhatsApp-Community (MB/AI Stammtisch) teilt Projekte als Nachricht mit angehängter
`.md`-Datei. Diese `.md` ist eine Nachbau-Anleitung (Format, das ein Coding-Agent direkt
verwerten kann). Ziel: Ein Bot hört in der Gruppe mit, erfasst jede geteilte `.md`
strukturiert in einer Datenbank, macht sie semantisch durchsuchbar und beantwortet
Such-/Claim-Befehle **direkt in der Gruppe** — niemand muss die App wechseln.

Zwei Probleme werden gelöst:
- **Auffindbarkeit:** semantische + Keyword-Suche statt einer endlosen Chat-Liste.
- **Doppelarbeit vermeiden:** Projekte haben einen Status (`frei` / `vergeben` / `erledigt`).

Das rohe `.md` bleibt als gültiger UTF-8-Text unverändert in `raw_md` erhalten — es ist
das eigentliche Artefakt. Ungültiges UTF-8, NUL-Bytes und Anhänge über 1 MiB werden
abgewiesen. Alles andere (Titel, Summary, Tags, Embedding) ist eine Verständnis-/
Such-Schicht darüber.

---

## 2. Tech-Stack

| Baustein            | Wahl                          | Grund |
|---------------------|-------------------------------|-------|
| WA-Anbindung        | **Baileys** (`@whiskeysockets/baileys`) | reine WebSocket-Impl, kein Chromium/Puppeteer → schlanker VPS-Prozess |
| DB                  | **Supabase / Postgres** + `pgvector` | Vektorsuche eingebaut, schon vorhanden |
| Verstehen (MD→Meta) | **Anthropic Fable/Claude**    | JSON-Extraktion aus MD |
| Embedding           | **Voyage `voyage-3`** (1024 dims) | starkes Deutsch, managed. Alternativ `bge-m3` self-hosted, wenn nichts rausgehen soll |
| Runtime             | Node.js ≥ 20, systemd auf dem VPS | `Restart=always`, Outbound-only (kein offener Port, kein Caddy nötig) |

> **Wichtige Trennung:** Fable/Claude ist fürs **Verstehen** (Titel, Summary, Tags).
> Das Embedding-Modell ist fürs **Suchen**. Anthropic liefert keine Embeddings — nicht
> verwechseln.

---

## 3. Voraussetzungen (der Mensch stellt bereit)

- Node.js ≥ 20.
- Eine **Wegwerf-/Zweitnummer** für den Bot (inoffizielle WA-Anbindung → kleines
  Sperrrisiko, nicht die private Nummer nehmen). Der Bot muss Mitglied der Zielgruppe
  sein.
- Die aus Phase 1 bekannte JID genau dieser Zielgruppe.
- Ein Supabase-Projekt mit HTTPS-URL und `service_role`-Key.
- Für Phase 3 zusätzlich `ANTHROPIC_API_KEY` und `VOYAGE_API_KEY`; Phase 2 verwendet
  diese beiden Schlüssel noch nicht.

### Env-Variablen (`.env`)

```dotenv
SUPABASE_URL=https://projekt.supabase.co
SUPABASE_SERVICE_KEY=<service_role-key>
TARGET_GROUP_JID=<gruppen-jid>@g.us
```

Die Vorlage liegt in `.env.example`. `SUPABASE_URL` wird beim Start als HTTPS-URL
validiert. Der `service_role`-Key ist ein Servergeheimnis und darf nicht in Logs,
Client-Code oder Git landen. Vor dem Bot-Start `sql/schema.sql` im Supabase SQL-Editor
anwenden; dieser Remote-Schritt ist in der lokalen Phase-2-Validierung noch nicht erfolgt.

---

## 4. Projektstruktur

```text
wa-projekt-bot/
├─ src/
│  ├─ index.js          # Konfiguration, Baileys-Verbindung und Event-Routing
│  ├─ config.js         # Pflichtvariablen und HTTPS-Prüfung
│  ├─ ingest.js         # Zielgruppenfilter, Download, Validierung und Bestätigung
│  └─ db.js             # serverseitiger Supabase-Client und idempotenter Upsert
├─ test/
│  ├─ config.test.js
│  ├─ db.test.js
│  └─ ingest.test.js
├─ auth/                # Baileys useMultiFileAuthState (NICHT committen)
├─ sql/schema.sql
├─ .env.example
├─ .gitignore           # auth/ und .env sind ausgeschlossen
└─ package.json
```

`commands.js`, `llm.js` und `embed.js` folgen erst in den Phasen 3–5.

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

Dieser Block entspricht `sql/schema.sql`. RLS ist aktiv; `anon` und `authenticated`
erhalten weder Tabellenrechte noch RPC-Ausführung. Der serverseitige Bot arbeitet mit
`service_role`, dem die benötigten Rechte auf Schema, Tabelle, Identity-Sequenz und
Suchfunktion explizit erteilt werden.

---

## 6. Phasen

### Phase 1 — Verbindung & Erkennung (implementiert)

Baileys verwendet `useMultiFileAuthState('./auth')`, zeigt den QR-Code beim ersten Login
und verbindet sich nach einem Abbruch erneut, sofern WhatsApp keinen Logout meldet. Die in
Phase 1 ermittelte Gruppen-JID wird für Phase 2 als `TARGET_GROUP_JID` vorausgesetzt.

Der aktuelle Phase-2-Handler protokolliert keine JIDs mehr. Er filtert zuerst auf die
exakte Zielgruppe und untersucht erst dann Nachricht und Dateiname.

---

### Phase 2 — Ingest ohne LLM (lokal implementiert)

Phase 2 lädt `.md`-Anhänge aus genau einer konfigurierten Gruppe herunter und speichert
ihren Rohtext in Supabase. Meta-Extraktion und Embeddings sind noch nicht enthalten.

- `src/config.js` verlangt `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` und
  `TARGET_GROUP_JID`; die Supabase-URL muss HTTPS verwenden.
- Nachrichten vom Bot selbst, Nachrichten aus anderen Chats und Dateien ohne
  case-insensitive `.md`-Endung werden vor dem Download ignoriert.
- Eine vertrauenswürdige deklarierte Dateigröße wird vor dem Download geprüft. Der
  tatsächlich geladene Buffer wird danach erneut geprüft; das Limit beträgt jeweils
  1 MiB (`1_048_576` Bytes).
- Der Buffer wird strikt als UTF-8 dekodiert. Ungültiges UTF-8 und NUL-Bytes werden
  abgewiesen.
- Eine stabile `m.key.id` ist Pflicht. Gespeichert werden `wa_message_id`,
  `author_name`, `author_jid` und der unveränderte UTF-8-Text als `raw_md`.
- `src/db.js` nutzt `@supabase/supabase-js` 2.109.0 als serverseitigen Client und führt
  `.upsert(row, { onConflict: 'wa_message_id' })` aus. Der Unique-Constraint im Schema
  verhindert eine zweite Zeile bei Reconnect oder Replay.
- Die WhatsApp-Bestätigung wird erst nach erfolgreichem Upsert gesendet. Bei einem
  Persistenzfehler wird nicht bestätigt.

**Lokale Verifikation:** `npm test` besteht mit 23/23 Tests für Konfiguration,
HTTPS-Zwang, Datenbankvertrag und Rechte, Zielgruppenfilter, Idempotenz, Download- und
UTF-8-Grenzen sowie die Reihenfolge „persistieren, dann bestätigen“.

**Noch offene Live-Abnahme:** `sql/schema.sql` muss in einem echten Supabase-Projekt
angewendet und der Bot mit einer echten Zweitnummer, Zielgruppen-JID, Supabase-URL und
`service_role`-Key gestartet werden. Danach sind ein realer `.md`-Post, die gespeicherte
Zeile, die Bestätigung und ein Replay ohne Duplikat manuell zu prüfen. Diese Schritte
wurden mangels Zugangsdaten und Remote-Schema noch nicht verifiziert.

---

### Phase 3 — Verstehen & Suchbar machen (Fable + Embedding)

Zwischen Download und Insert die zwei Schichten einziehen.

**`src/llm.js` — Meta-Extraktion (Anthropic):**
```js
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();

const SYSTEM = `Du extrahierst Metadaten aus einer Markdown-Projektbeschreibung.
Antworte AUSSCHLIESSLICH mit JSON, ohne Markdown-Fences, ohne Fließtext:
{"titel": string, "summary": string (max 1 Satz), "tags": string[], "kategorie": string}`;

export async function extrahiereMeta(md) {
  const res = await client.messages.create({
    model: 'claude-fable-5',        // ggf. auf verfügbares Modell anpassen
    max_tokens: 512,
    system: SYSTEM,
    messages: [{ role: 'user', content: md.slice(0, 12000) }],
  });
  const text = res.content.find(b => b.type === 'text')?.text ?? '{}';
  return JSON.parse(text.trim());   // bei Parse-Fehler: siehe Fallstricke
}
```

**`src/embed.js` — Embedding (Voyage):**
```js
export async function embed(text) {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: 'voyage-3', input: text }),
  });
  const data = await res.json();
  return data.data[0].embedding;   // Array mit 1024 Floats
}
```

**Ingest-Kern (`src/ingest.js`), Reihenfolge:**
```js
const meta = await extrahiereMeta(md);                 // 1. Verstehen
const emb  = await embed(`${meta.titel}\n${meta.summary}`); // 2. Suchbar machen
await upsertProjekt({
  wa_message_id: m.key.id,
  author_name:   m.pushName,
  author_jid:    m.key.participant ?? m.key.remoteJid,
  raw_md: md,
  ...meta,
  embedding: emb,
});
await sock.sendMessage(m.key.remoteJid, { text: `✅ „${meta.titel}" erfasst.` });
```

**Akzeptanzkriterium:** Nach einem Post sind `titel`, `summary`, `tags`, `kategorie` und
`embedding` gefüllt; die Gruppe bekommt die Bestätigung mit dem erkannten Titel.

---

### Phase 4 — `/suche` (erster Command)

Command-Routing in `messages.upsert`: Textnachrichten, die mit `/` beginnen, gehen an
`commands.js` statt in den Ingest.

- `/suche <text>` → `embed(text)` → RPC `suche_projekte` → Top 5 formatiert zurück.

```js
export async function handleSuche(sock, jid, query) {
  const emb = await embed(query);
  const { data, error } = await supabase.rpc('suche_projekte', {
    query_embedding: emb,      // ⚠️ evtl. JSON.stringify(emb) — siehe Fallstricke
    query_text: query,
    treffer: 5,
  });
  if (error) throw error;
  const lines = data.map(p => `#${p.id} [${p.status}] ${p.titel}`).join('\n')
    || 'Nichts gefunden.';
  await sock.sendMessage(jid, { text: lines });
}
```

**Akzeptanzkriterium:** `/suche puzzle game` liefert thematisch passende Projekte, auch
wenn das Wort „puzzle" im Post nicht wörtlich vorkommt (semantischer Treffer).

---

### Phase 5 — `/nehmen` & `/liste` (Kür)

- `/nehmen <id>` → `update projekte set status='vergeben', claimed_by=<pushName> where id=<id>`
  → bestätigen. Löst „nicht doppelt am gleichen Projekt arbeiten".
- `/liste frei` → `select id, titel from projekte where status='frei'`.

**Akzeptanzkriterium:** Nach `/nehmen 42` taucht #42 nicht mehr in `/liste frei` auf und
ist in der Suche als `[vergeben]` markiert.

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

Erstes QR-Login **interaktiv** machen (`node src/index.js` von Hand), erst danach als
Service aktivieren — sonst siehst du den QR nicht. `auth/` bleibt persistent, danach
reconnected der Bot selbst.

---

## 8. Fallstricke (unbedingt beachten)

- **`auth/` und `.env` niemals committen** — `auth/` enthält die Session, mit der man den
  Account übernehmen kann. In `.gitignore` zuerst eintragen.
- **pgvector via supabase-js RPC:** Postgres erwartet das Embedding als `'[0.1,0.2,…]'`.
  Falls der RPC-Call mit dem Array fehlschlägt, `JSON.stringify(emb)` übergeben.
- **JSON-Parsing der LLM-Antwort:** Modelle packen manchmal doch ```-Fences drumrum.
  Vor `JSON.parse` Fences strippen und einen Retry mit strengerem Prompt einbauen, statt
  hart zu crashen.
- **Idempotenz:** `onConflict: 'wa_message_id'` im Bot und der Unique-Constraint auf
  `wa_message_id` im Schema gehören zusammen — beides nicht weglassen.
- **Supabase-Zugang:** Nur eine HTTPS-URL akzeptieren. Den `service_role`-Key ausschließlich
  im serverseitigen Bot verwenden; RLS und Rechte aus `sql/schema.sql` nicht lockern.
- **Dateigrenzen:** Nur `.md` aus der exakten Zielgruppe verarbeiten. Das 1-MiB-Limit vor
  und nach dem Download prüfen und nur gültiges UTF-8 ohne NUL-Bytes speichern.
- **Rate/Kosten:** Fable-Call nur bei tatsächlicher `.md` auslösen, nie bei jeder Nachricht.
- **Gruppen-Scope:** ausschließlich `TARGET_GROUP_JID` verarbeiten, sonst reagiert der Bot
  in jedem Chat, in dem die Nummer steckt.
- **Voyage-Dimension:** `voyage-3` = 1024. Wenn du das Embedding-Modell wechselst, muss
  `vector(N)` im Schema mitgezogen werden, sonst passt nichts mehr zusammen.

---

## 9. Definition of Done

Ein Community-Mitglied postet eine `.md` → Bot bestätigt mit Titel → ein anderes Mitglied
findet das Projekt über `/suche` (auch bei anderer Wortwahl) → `/nehmen` markiert es als
vergeben → es verschwindet aus `/liste frei`. Alles innerhalb WhatsApp, ohne App-Wechsel.
