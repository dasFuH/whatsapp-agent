# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

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

[Unreleased]: https://github.com/dasFuH/whatsapp-agent/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dasFuH/whatsapp-agent/releases/tag/v0.1.0
