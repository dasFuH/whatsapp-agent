# Roadmap: Wissensdatenbank-Ausbaustufe

> **Verhältnis zu [`../SETUP.md`](../SETUP.md):** SETUP.md beschreibt den bereits laufenden
> `.md`-Projektkatalog (Phasen 1–5). Dieses Dokument beschreibt einen **komplementären
> zweiten Strang** — das Mitlesen laufender Diskussionen, tägliche Zusammenfassung und eine
> allgemeine Wissensdatenbank. Bewusst **offen** gehalten: die AG entscheidet Tempo,
> Technik und Umfang selbst. Nichts hier ist beschlossen.

## 1. Vision

Ein Agent liest in mehreren WhatsApp-Gruppen mit → Rohdaten werden zwischengespeichert →
einmal täglich läuft ein Cron-Job, fasst zusammen und erkennt Themen → daraus wächst eine
durchsuchbare **Wissensdatenbank**. Mitglieder können den Agenten zusätzlich **per DM**
fragen: „Hat jemand zuletzt etwas zu Thema X gepostet?"

Nutzen: Wer ein paar Tage weg war, findet in Sekunden den Überblick — statt 1.000
Nachrichten nachzuscrollen.

## 2. Pipeline

| Stufe | Was passiert | Optionen |
|---|---|---|
| 1. **Ingest** | Bot liest Nachrichten in den Zielgruppen mit | Baileys (wie im Repo) |
| 2. **Rohspeicher** | Nachrichten roh + Metadaten puffern | Supabase/Postgres (schon vorhanden) oder SQLite lokal für PoC |
| 3. **Täglicher Zusammenfasser** | Cron lädt letzte 24 h, fasst pro Gruppe zusammen, extrahiert Themen | Claude (Verstehen) + Voyage (Embedding) — konsistent zur SETUP.md-Wahl |
| 4. **Wissensdatenbank** | Zusammenfassungen + Themen indexiert ablegen | pgvector (`vector(1024)`, wie Schema) |
| 5. **DM-Abfrage** | Mitglied fragt per DM → semantische Suche → Antwort | RPC `suche_projekte`-Muster / RAG |

**Datenschutz-Schritt:** Zwischen Stufe 1 und 3 gehört ein Redaction-/Minimierungs-Schritt
(Pseudonymisierung, Dritte maskieren, sensible Muster filtern) — siehe
[`datenschutz-dsgvo.md`](./datenschutz-dsgvo.md) §4.

## 3. Einer oder zwei Agenten?

Sauber sind **zwei Rollen**:

1. **Mitleser / Ingest** — läuft dauerhaft (systemd), schreibt nur Rohdaten weg, hält keine
   Intelligenz. Muss extrem robust und simpel sein (Reconnect, Session-Persistenz).
2. **Auswerter / Antworter** — der tägliche Zusammenfasser **und** die DM-Antworten (kann
   ein Agent sein). Hier steckt die LLM-Logik; austauschbar, ohne den empfindlichen
   Dauerprozess anzufassen.

Diese Trennung hält Ausfallrisiko und Intelligenz getrennt.

## 4. Betrieb: Vercel+Supabase vs. VPS

- **Mitleser (Stufe 1):** braucht persistenten Prozess → **nicht** Vercel-Serverless.
  Kleiner VPS + systemd (wie SETUP.md §7), Dauer-Container (Fly/Railway/Render) oder
  Managed-Dienst. Für den PoC reicht **jede kleine Dauerkiste** (5-€-VPS, Raspberry Pi,
  Always-on-Rechner) + Supabase — **unabhängig** von der VibeCoding-Server-Entscheidung.
- **Zusammenfasser & Suche (Stufen 3+5):** reine Batch-/Request-Logik → hier *wäre*
  Serverless (Vercel + Supabase) problemlos möglich.

**Empfehlung:** nicht auf den Vereinsserver warten und den Listener nicht auf Vercel
zwingen. PoC auf kleiner Dauerkiste, später umziehen.

## 5. Spätere Einbindung in die VibeCoding-Infrastruktur

Wenn die VibeCoding-Server-Entscheidung steht (~2 Wochen ab Projektstart), passt dieser
Strang sauber in die vorhandene Infrastruktur des Haupt-Repos:

- **Ingest als neue Quelle** im `agents-worker` — analog zum bestehenden Discourse-Ingest
  (`src/rag/discourse.ts`). Statt in eine separate DB → in die zentrale Wissensdatenbank
  einspeisen.
- **Täglicher Job** als neuer Job in `agents-worker/src/jobs/` (dort laufen bereits
  Newsletter- und GitHub-Status-Jobs über eine Worker-Poll-Schleife; ein Host-Cron kann
  `worker:once` täglich anstoßen).
- **DM-Abfrage** gegen die bestehende `knowledge-rag`-API (Fastify + Postgres/pgvector) mit
  `/search` und grounded `/chat` — die „hat-jemand-was-zu-X-gesagt"-Funktion ist dort im
  Kern schon vorhanden.
- **Datenschutz-Filter** nach dem Muster `agents-worker/src/github/ai-filter.ts`.

> **Hinweis / Korrektur einer verbreiteten Annahme:** Einen **Forum-MCP-Server** gibt es im
> VibeCoding-Repo aktuell **nicht** — Forum-Zugriff läuft über normale Discourse-REST-
> Clients. Die Idee „Wissensdatenbank ↔ Forum/Newsletter koppeln" ist damit eine spätere
> Ausbaustufe; die Bausteine (Discourse lesen/schreiben) existieren, ein MCP-Server wäre
> Neubau.

## 6. Grober Sprint-Vorschlag (Startpunkt, nicht bindend)

Baut auf dem auf, was im Repo schon steht — der `.md`-Katalog ist teils schon Sprint-1-Reife.

- **Sprint 0 — Kickoff & Entscheidungen:** Anbindungsweg bestätigen (Baileys ✓), Test-
  Nummer, DSGVO-Rahmen (Einwilligung/Hinweis aus den Vorlagen), KI-Anbieter + Kostendeckel,
  Zielgruppen + Opt-out-Regel.
- **Sprint 1 — Machbarkeits-Beweis:** Live-Abnahme des bestehenden Bots (Schema in echtem
  Supabase, echte Zweitnummer, realer `.md`-Post, Idempotenz-Nachweis). *Das ist der
  „kriegen-wir-das-hin"-Beweis.*
- **Sprint 2 — Mitlesen + täglicher Zusammenfasser:** Ingest über `.md` hinaus, Rohspeicher,
  Cron-Zusammenfassung, Datenschutz-Filter davor.
- **Sprint 3 — DM-Abfrage:** Mitglied fragt per DM → semantische Suche → Antwort.
- **Sprint 4+ — Einbindung in `agents-worker`/`knowledge-rag`** nach der Server-Entscheidung;
  optional Forum-/Newsletter-Kopplung.

## 7. Offene Fragen für die AG (bewusst nicht vorentschieden)

- Welche Gruppen werden mitgelesen — nur ausgewählte? Mit Opt-out pro Person/Nachricht?
- Review vor Eintrag in die Wissensdatenbank, oder vollautomatisch?
- Query-Limit pro Mitglied (Kostenschutz für die KI)?
- Wem „gehört" die Wissensdatenbank, wer darf lesen/exportieren?
- Zusammenfassungen auch ins Forum / in einen Newsletter? (beeinflusst Schema)
- KI-Anbieter/Modell und Region (Datenschutz + Budget)?
