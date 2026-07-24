# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden hier dokumentiert.

Format nach [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
Versionierung nach [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

- Phase 2: Ingest ohne LLM (rohe `.md` in Supabase schreiben, Idempotenz über
  `wa_message_id`)

## [0.1.0] - 2026-07-12

### Hinzugefügt

- Baileys-Verbindung mit `useMultiFileAuthState`, QR-Login in der Konsole
- Automatischer Reconnect bei Verbindungsabbruch (außer bei Logout)
- Erkennung von `.md`-Dateianhängen in `messages.upsert`, Logging von Absender, JID und
  Dateiname
- SETUP.md mit vollständiger Spezifikation (Phasen 1–5, DB-Schema, Deployment)

[Unreleased]: https://github.com/dasFuH/whatsapp-agent/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dasFuH/whatsapp-agent/releases/tag/v0.1.0
