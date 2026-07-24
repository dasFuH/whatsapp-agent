# Recherche: Agenten an WhatsApp anbinden

> Stand der Recherche: Juli 2026. Die vier kritischsten Aussagen wurden adversarial
> gegengeprüft (Ergebnisse unten in [§5](#5-gegenpr%C3%BCfung-verifikation)).
> Diese Recherche **bestätigt** die im Projekt bereits getroffene Tech-Wahl
> (Baileys + Supabase/pgvector + Wegwerf-Nummer + VPS/systemd).

## 1. Kernfrage & Kurzfazit

**Kann ein Agent in WhatsApp-Gruppen mitlesen und per DM antworten?** Ja — technisch
erprobt, es gibt fertige Vergleichsprojekte. Der Knackpunkt ist **nicht** das „ob",
sondern **auf welchem Weg** (Sperr-Risiko der Nummer) und **rechtskonform** (DSGVO, siehe
[`datenschutz-dsgvo.md`](./datenschutz-dsgvo.md)).

## 2. Anbindungswege im Vergleich

| Weg | Offiziell? | Liest Gruppen mit? | Sperr-Risiko der Nummer | Aufwand / Betrieb |
|---|---|---|---|---|
| **Baileys** (`@whiskeysockets/baileys`, Node/TS) | nein | ja, zuverlässig (`messages.upsert`) | **hoch** (AGB-Verstoß, ML-Erkennung) | klein, kostenlos, reiner WebSocket-Prozess |
| **whatsapp-web.js** (Puppeteer/Chromium) | nein | ja, aber seit Mitte 2026 Sende-Verzögerungen gemeldet | hoch (wie Baileys) | schwerer (Headless-Browser) |
| **WPPConnect / Venom** (Node) | nein | ja | hoch | mittel, REST-Wrapper dabei |
| **Managed-Dienste** (Whapi.cloud, 2Chat, Green API) | nein (gehostet) | ja, per Webhook | niedriger (Anbieter trägt/rotiert Nummern) | klein, aber kostenpflichtig |
| **Meta Cloud API** (offiziell) | ja | Gruppen-Support neu & **limitiert** (s. u.) | **null** | Business-Verifizierung nötig |

**Warum Baileys für dieses Projekt richtig ist:** reine WebSocket-Implementierung, kein
Chromium → schlanker VPS-Prozess, exzellent für Node/TS, empfängt Gruppennachrichten
zuverlässig. Genau die Wahl, die im Repo bereits getroffen wurde.

### Zur offiziellen Meta Cloud API

Die pauschale Aussage „die offizielle API kann Gruppen gar nicht lesen" ist **überholt**:
Meta hat Ende 2025 offizielles Gruppen-Messaging in der Cloud API eingeführt. Aber:

- die Bot-Nummer muss **Teilnehmer** der Gruppe sein (kein „Fremd-Mitlesen"),
- **Business-Verifizierung** (Official Business Account) ist Voraussetzung,
- es gelten **Beschränkungen** (Teilnehmer-/Gruppen-Limits, nicht alle Nachrichtentypen),
- Gruppen werden tendenziell **über die API verwaltet**.

→ Für eine **bestehende, große Community-Gruppe** ist die offizielle API heute **kein
Plug-and-Play**. Sie ist das langfristige Ziel für den produktiven Betrieb, sobald die
Gruppen-Funktion reift — nicht der schnelle Weg zum Machbarkeits-Beweis.

## 3. Sperr-Risiko ehrlich eingeordnet

WhatsApp erkennt inoffizielle Clients **heuristisch** (u. a. Antwortquote, robotische
Timing-Muster, Kontakte zu Fremden). Wichtige, gegengeprüfte Erkenntnisse:

- Das Risiko ist **real und nicht eliminierbar**, nur begrenzbar. Auch „braves", rein
  mitlesendes Verhalten kann erkannt werden — es ist **nicht** nur volumenabhängig.
- Eine **dedizierte Wegwerf-/Zweitnummer** schützt vor allem die *private* Nummer; sie
  senkt die Sperr-*Wahrscheinlichkeit* der Bot-Nummer nur begrenzt.
- Sinnvolle Dämpfer: geringes, reaktives Volumen; menschliches Timing-Jitter; keine
  Kontaktaufnahme zu Fremden; kein Broadcast-Spam.
- **Lieferketten-Warnung:** Es kursieren bösartige npm-Forks von Baileys (Token-/
  Nachrichten-Diebstahl). Nur das offizielle `@whiskeysockets/baileys` verwenden und
  Versionen pinnen.

**Betriebsempfehlung:** Bot-Nummer als „verlierbar" behandeln, Session (`auth/`) sichern,
Re-Pairing-Prozess dokumentieren. Für echten Produktivbetrieb mittelfristig Richtung
offizielle API oder Managed-Dienst evaluieren.

## 4. Persistenz: kein klassisches Serverless

Ein Baileys-Bot braucht einen **dauerhaft laufenden Prozess** mit offenem WebSocket und
persistenter Session. **Vercel-/Lambda-Serverless ist für den Mitleser ungeeignet**
(Timeouts, kein persistentes Dateisystem, keine Hintergrundprozesse) — gegengeprüft und
bestätigt.

Geeignet sind: kleiner **VPS + systemd** (`Restart=always`, Outbound-only — genau die Wahl
in [`../SETUP.md`](../SETUP.md) §7), oder Dauer-Container (Fly.io, Railway, Render), oder
ein Managed-Dienst mit REST + Webhooks (verlagert die Persistenz zum Anbieter).

> Serverless (z. B. Vercel + Supabase) ist trotzdem brauchbar — aber für die **Batch-/
> Query-Teile** (täglicher Zusammenfasser, Suchendpunkt), **nicht** für den Live-Listener.
> Siehe [`roadmap-wissensdatenbank.md`](./roadmap-wissensdatenbank.md).

## 5. Gegenprüfung (Verifikation)

Vier Behauptungen wurden gezielt zu widerlegen versucht:

| Behauptung | Urteil | Kern-Korrektur |
|---|---|---|
| „Offizielle Cloud API kann Gruppen **gar nicht** lesen" | **widerlegt** | Meta hat Ende 2025 offizielles (aber limitiertes) Gruppen-Messaging eingeführt; für große Bestandsgruppen dennoch kein Plug-and-Play. |
| „Sperr-Risiko lässt sich durch Zweitnummer + wenig Volumen senken, nicht eliminieren" | **teilweise bestätigt** | Nicht eliminierbar — korrekt. Aber die Minderung wird **überschätzt**: Erkennung ist heuristisch, greift auch bei sauberem Verhalten. |
| „Speichern + KI-Zusammenfassen braucht DSGVO-Rechtsgrundlage; stilles Mitloggen ist riskant" | **teilweise bestätigt** | Kern korrekt. Einwilligung ist der sichere Weg, **berechtigtes Interesse** (Art. 6 f) mit dokumentierter Abwägung ist ebenfalls möglich; KI-Auswertung löst **verschärfte** Transparenzpflichten aus (Art. 13 Abs. 2 f). |
| „Baileys braucht persistenten Prozess; Serverless ungeeignet" | **bestätigt** | Korrekt. Alternativen: Dauer-Container oder Managed-REST-Dienste. |

## 6. Vergleichsprojekte (Referenzen)

- **[firstlinkai/Daily-WhatsApp-Group-Summary](https://github.com/firstlinkai/Daily-WhatsApp-Group-Summary)** — End-to-End „tägliche Zusammenfassung", gutes Muster für den Cron-Teil.
- **[drukpa1455/crewai-whatsapp](https://github.com/drukpa1455/crewai-whatsapp)** — Multi-Agent-Ansatz (Message Handler + Summarizer).
- **[lucasboscatti/Whatsapp-Langgraph-Agent-Integration](https://github.com/lucasboscatti/Whatsapp-Langgraph-Agent-Integration)** — LangGraph + FastAPI + Postgres-Memory, relevant für den DM-Query-Agenten.
- **[naveen_gaur: Baileys VPS + PM2 Deployment Guide](https://dev.to/naveen_gaur/the-complete-developers-guide-to-the-baileys-whatsapp-bot-setup-scaling-and-vps-deployment-1cp3)** — Produktions-Referenz (Session-Persistenz, Reconnect).
- **[worldbank/WhatsApp-RAG-Example](https://github.com/worldbank/WhatsApp-RAG-Example)** — RAG-Anbindung an WhatsApp.

## 7. Quellen

**WhatsApp-Anbindung & Sperr-Risiko**
- Meta Developers — WhatsApp Cloud API, Groups Messaging: <https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/groups-messaging/>
- Baileys (Repo): <https://github.com/whiskeysockets/Baileys>
- Baileys-Doku: <https://whiskeysockets-baileys-94.mintlify.app/introduction>
- whatsapp-web.js-Doku: <https://docs.wwebjs.dev/>
- Anti-Ban-Strategie (2025): <https://wasenderapi.com/blog/stop-getting-banned-the-ultimate-whatsapp-anti-ban-strategy-for-unofficial-apis-in-2025>
- Ban-Risiko-Analyse: <https://blog.kraya-ai.com/whatsapp-automation-ban-risk>
- Whapi.cloud (Gruppen-API): <https://whapi.cloud/whatsapp-groups-api>
- 2Chat (Gruppen-Nachrichten): <https://developers.2chat.co/docs/API/WhatsApp/messages/get-group-messages>
- Green API: <https://green-api.com/en/docs/api/>
- Twilio WhatsApp (Best Practices): <https://www.twilio.com/docs/whatsapp/best-practices-and-faqs>

**Datenschutz** — siehe Quellenliste in [`datenschutz-dsgvo.md`](./datenschutz-dsgvo.md).
