# SETUP.md — WhatsApp Projekt-Datenbank (Ingest-Bot + semantische Suche)

> **An Claude Code:** Bau dieses Projekt in den unten definierten Phasen. Committe nach
> jeder Phase. Fang nicht mit Phase 2 an, bevor die Akzeptanzkriterien von Phase 1 erfüllt
> sind. Frag nach, wenn Env-Variablen oder Zugänge fehlen — rate nichts.

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

Das rohe `.md` bleibt **1:1 erhalten** (`raw_md`) — es ist das eigentliche Artefakt. Alles
andere (Titel, Summary, Tags, Embedding) ist eine Verständnis-/Such-Schicht darüber.

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

- Eine **Wegwerf-/Zweitnummer** für den Bot (inoffizielle WA-Anbindung → kleines
  Sperrrisiko, nicht die private Nummer nehmen). Bot muss Mitglied der Zielgruppe sein.
- Supabase-Projekt (URL + `service_role`-Key).
- `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY`.

### Env-Variablen (`.env`)

```
ANTHROPIC_API_KEY=
VOYAGE_API_KEY=
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
TARGET_GROUP_JID=          # JID der Gruppe, erst in Phase 1 auslesen und hier eintragen
```

---

## 4. Projektstruktur

```
wa-projekt-bot/
├─ src/
│  ├─ index.js          # Baileys connect, Event-Loop, Routing
│  ├─ ingest.js         # .md erkennen → Meta → Embedding → Supabase
│  ├─ commands.js       # /suche /nehmen /liste
│  ├─ llm.js            # extrahiereMeta() via Anthropic
│  ├─ embed.js          # embed() via Voyage
│  └─ db.js             # Supabase-Client + Helper
├─ auth/                # Baileys useMultiFileAuthState (NICHT committen)
├─ sql/schema.sql
├─ .env
├─ .gitignore           # auth/ und .env rein!
└─ package.json
```

---

## 5. Datenbank-Schema (`sql/schema.sql`)

Im Supabase SQL-Editor ausführen:

```sql
create extension if not exists vector;

create table projekte (
  id            bigint generated always as identity primary key,
  wa_message_id text unique,                 -- Idempotenz: verhindert Doppel-Ingest
  author_jid    text,
  author_name   text,
  created_at    timestamptz default now(),
  titel         text,
  summary       text,
  tags          text[],
  kategorie     text,
  status        text default 'frei',         -- frei | vergeben | erledigt
  claimed_by    text,
  raw_md        text,                         -- das Artefakt für den Coding-Agent
  md_url        text,
  embedding     vector(1024),                 -- voyage-3 = 1024 dims
  fts tsvector generated always as (
    to_tsvector('german',
      coalesce(titel,'') || ' ' || coalesce(summary,'') || ' ' || coalesce(raw_md,''))
  ) stored
);

create index on projekte using hnsw (embedding vector_cosine_ops);
create index on projekte using gin  (fts);

-- Hybrid-Suche: semantisch (Vektor) + Keyword-Bonus, in einem Call
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
    (embedding <=> query_embedding)                              -- kleiner = ähnlicher
    - 0.15 * ts_rank(fts, plainto_tsquery('german', query_text)) -- Keyword-Bonus
  limit treffer;
$$;
```

---

## 6. Phasen

### Phase 1 — Verbindung & Erkennung (kein LLM, keine DB)

Nur connecten und beobachten. Ziel: `.md`-Posts sicher erkennen, bevor irgendwas
Teureres passiert.

- Baileys mit `useMultiFileAuthState('./auth')`, QR beim ersten Start in die Konsole.
- `connection.update` behandeln (QR anzeigen, bei `close` reconnecten, außer Logout).
- `messages.upsert` loggen. Für jede Nachricht ausgeben: Absender (`pushName`),
  `remoteJid`, und ob ein `documentMessage` mit `fileName` auf `.md` endet.
- Die JID der Zielgruppe aus den Logs ablesen und in `.env` als `TARGET_GROUP_JID`
  eintragen. Ab dann nur noch Nachrichten aus dieser JID verarbeiten.

**Skelett `src/index.js`:**
```js
import makeWASocket, { useMultiFileAuthState, downloadMediaMessage } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';

const { state, saveCreds } = await useMultiFileAuthState('./auth');
const sock = makeWASocket({ auth: state });

sock.ev.on('creds.update', saveCreds);
sock.ev.on('connection.update', ({ connection, qr, lastDisconnect }) => {
  if (qr) qrcode.generate(qr, { small: true });
  if (connection === 'close') {
    const loggedOut = lastDisconnect?.error?.output?.statusCode === 401;
    if (!loggedOut) start();   // reconnect; bei 401 neu einloggen
  }
});

sock.ev.on('messages.upsert', async ({ messages }) => {
  for (const m of messages) {
    if (m.key.fromMe) continue;
    const doc = m.message?.documentMessage;
    const isMd = doc?.fileName?.toLowerCase().endsWith('.md');
    console.log({ from: m.pushName, jid: m.key.remoteJid, isMd, file: doc?.fileName });
  }
});
```

**Akzeptanzkriterium:** Wenn jemand eine `.md` in die Gruppe postet, erscheint im Log
`isMd: true` mit korrektem Dateinamen. Kein Fehlalarm bei normalen Textnachrichten.

---

### Phase 2 — Ingest ohne LLM (DB anbinden)

Jetzt `.md`-Inhalt runterladen und roh in Supabase schreiben. Noch keine Meta-Extraktion,
kein Embedding.

- `downloadMediaMessage(m, 'buffer', {})` → `buf.toString('utf-8')`.
- Insert mit `wa_message_id = m.key.id` als `onConflict`-Key (Idempotenz — gleicher Post
  darf nie zwei Zeilen erzeugen, auch bei Reconnect/Replay).
- Bestätigung in die Gruppe senden.

**Skelett `src/db.js`:**
```js
import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

export async function upsertProjekt(row) {
  const { error } = await supabase
    .from('projekte')
    .upsert(row, { onConflict: 'wa_message_id' });
  if (error) throw error;
}
```

**Akzeptanzkriterium:** Nach einem `.md`-Post steht eine Zeile in `projekte` mit
gefülltem `raw_md`, `author_name`, `wa_message_id`. Zweifacher Empfang derselben Nachricht
erzeugt **keine** zweite Zeile.

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
- **`onConflict: 'wa_message_id'`** ist die einzige Doppel-Ingest-Bremse — nicht weglassen.
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
