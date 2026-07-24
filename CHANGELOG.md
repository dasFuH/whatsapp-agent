# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

## [0.4.0] - 2026-07-24

### Hinzugefügt

- Phase-4-Befehl `/suche <text>`: Query-Embedding mit `voyage-4`, `input_type: query`
  und denselben 1024 Float-Dimensionen wie der Ingest, RPC `suche_projekte` und
  formatierte Top-5-Antwort direkt in WhatsApp
- Command-Routing in `messages.upsert`: Textnachrichten mit `/`-Präfix gehen an
  `src/commands.js` statt in den Ingest; alle anderen Nachrichten laufen unverändert
  durch den Phase-3-Pfad
- `searchProjekte` im Projekt-Repository; der RPC liefert nur `id`, `status` und
  `titel` statt vollständiger Projektzeilen mit `raw_md` und Embedding
- Netzfreie Phase-4-Tests für Befehls-Parsing, Routing, RPC-Vertrag,
  Ergebnisformatierung, Eingabegrenzen und Fehlerpfade; Gesamtsuite 124/124

### Sicherheit

- Befehle werden nur aus der exakten `TARGET_GROUP_JID` und nie von der Bot-Nummer
  selbst verarbeitet
- Befehlsnamen sind auf `[a-z0-9_-]` und 32 Zeichen begrenzt; unbekannte Befehle
  werden ohne Antwort und ohne Provider-Aufruf verworfen
- Leere und über 500 Zeichen lange Suchanfragen werden vor dem kostenpflichtigen
  Voyage-Aufruf abgewiesen
- Titel und Status aus der Datenbank werden vor dem Senden bereinigt und begrenzt;
  Provider- und Datenbankfehler erzeugen nur eine statische Fehlermeldung ohne
  Details und werden bereinigt protokolliert

## [0.3.0] - 2026-07-24

### Hinzugefügt

- Phase-3-Metadatenextraktion mit dem festen Modell `claude-fable-5`, GA Structured
  Outputs, `effort: low`, 12.000-Zeichen-Grenze und strikter lokaler Validierung
- Dokument-Embeddings mit `voyage-4`, `input_type: document` und exakt 1024
  Float-Dimensionen; Query-Unterstützung für denselben Vektorraum als Grundlage für
  Phase 4
- Kostenfreier Replay-Pfad für vollständige Phase-3-Zeilen sowie stille Anreicherung
  unvollständiger Phase-2-Zeilen aus gespeichertem `raw_md`
- `ANTHROPIC_API_KEY` und `VOYAGE_API_KEY` als zentrale Pflichtkonfiguration ab Phase 3
- Netzfreie Phase-3-Tests für Provider-Verträge, Fehlerpfade, Timeout/Retry,
  Replay/Enrichment, Feld-Allowlist und fehlende Teilpersistenz; Gesamtsuite 80/80

### Sicherheit

- Anthropic-Antworten schlagen bei Refusal, abweichendem Stop-Grund, ungültigem JSON
  oder nicht exakt passendem Metadatenschema geschlossen fehl
- Voyage-Aufrufe auf einen festen HTTPS-Endpunkt, ein festes Modell, Timeout und
  begrenzte Retries nur für HTTP 429/5xx beschränkt; Keys und Provider-Antwortkörper
  werden nicht in Fehlermeldungen übernommen
- Enrichment schreibt nur die explizit erlaubten Phase-3-Felder; Provider-Ergebnisse
  werden vollständig validiert, bevor ein Upsert oder eine WhatsApp-Bestätigung erfolgt
- Hinweise zu externer Datenverarbeitung, Fable-Aufbewahrung, sensiblen Inhalten,
  Rate/Quota-Monitoring und nicht-atomaren gleichzeitigen Replays dokumentiert

## [0.2.0] - 2026-07-24

### Hinzugefügt

- Phase-2-Ingest für `.md`-Dokumente aus der konfigurierten Zielgruppe: Download,
  strikte UTF-8-Dekodierung und Speicherung von `wa_message_id`, Autorendaten und
  unverändertem `raw_md` in Supabase
- Idempotenter Supabase-Upsert über den Unique-Key `wa_message_id` mit Bestätigung in
  WhatsApp erst nach erfolgreicher Persistenz
- Zentrale Phase-2-Konfiguration über `.env.example` sowie getrennte Module für
  Konfiguration, Datenbankzugriff und Ingest
- Automatisierte Tests für Konfiguration, Datenbankvertrag, Schema-Rechte,
  Zielgruppenfilter, Größen-/UTF-8-Grenzen, Idempotenz und Bestätigungsreihenfolge

### Sicherheit

- Supabase-Verbindungen auf gültige HTTPS-URLs beschränkt und der Client ohne persistente
  Benutzer-Session für den serverseitigen `service_role`-Betrieb konfiguriert
- RLS für `projekte` aktiviert; Tabellen-, Sequenz- und RPC-Rechte für `anon` und
  `authenticated` entzogen und explizit auf `service_role` begrenzt
- Verarbeitung vor dem Download auf die exakte `TARGET_GROUP_JID` und `.md`-Endungen
  beschränkt; Anhänge vor und nach dem Download auf 1 MiB begrenzt
- Ungültiges UTF-8 und NUL-Bytes werden abgewiesen; nicht vertrauenswürdige Log- und
  Fehlermeldungsfelder werden bereinigt und begrenzt

## [0.1.0] - 2026-07-12

### Hinzugefügt

- Baileys-Verbindung mit `useMultiFileAuthState`, QR-Login in der Konsole
- Automatischer Reconnect bei Verbindungsabbruch (außer bei Logout)
- Erkennung von `.md`-Dateianhängen in `messages.upsert`, Logging von Absender, JID und
  Dateiname
- SETUP.md mit vollständiger Spezifikation (Phasen 1–5, DB-Schema, Deployment)

[Unreleased]: https://github.com/dasFuH/whatsapp-agent/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/dasFuH/whatsapp-agent/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/dasFuH/whatsapp-agent/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/dasFuH/whatsapp-agent/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/dasFuH/whatsapp-agent/releases/tag/v0.1.0
