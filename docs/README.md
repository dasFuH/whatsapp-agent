# Planung, Recherche & Datenschutz

Dieser Ordner sammelt die Recherche- und Planungsergebnisse rund um den WhatsApp-Agenten.
Er ergänzt die technische Spezifikation in [`../SETUP.md`](../SETUP.md) und den
Projektüberblick in [`../README.md`](../README.md) — er ersetzt sie **nicht**.

## Was liegt hier?

| Dokument | Inhalt |
|---|---|
| [`recherche-whatsapp-agent.md`](./recherche-whatsapp-agent.md) | Verifizierte Recherche: Wie bindet man einen Agenten an WhatsApp(-Gruppen) an? Optionen, Sperr-Risiko, Vergleichsprojekte, Quellen. |
| [`datenschutz-dsgvo.md`](./datenschutz-dsgvo.md) | DSGVO-Pflichten für einen mitlesenden Community-Bot + fertige Einwilligungs-/Hinweis-Text-Vorlagen. |
| [`roadmap-wissensdatenbank.md`](./roadmap-wissensdatenbank.md) | Erweiterte Vision: täglicher Zusammenfasser, Wissensdatenbank, DM-Abfrage, spätere Einbindung in die VibeCoding-Infrastruktur. |
| [`ag-kommunikation.md`](./ag-kommunikation.md) | Zweckbeschreibung der Arbeitsgruppe + fertiger Kickoff-Beitrag (copy-paste). |

## Scope-Hinweis (wichtig)

Der bereits implementierte Bot (`wa-projekt-bot`, Phase 2/5 in `SETUP.md`) ist **eng
gefasst**: Er erfasst ausschließlich geteilte **`.md`-Projektbeschreibungen** aus **einer**
Gruppe und macht sie durchsuchbar (Projektkatalog gegen Doppelarbeit).

Die Dokumente hier beschreiben zusätzlich eine **breitere Ausbaustufe**: das *Mitlesen*
laufender Diskussionen in *mehreren* Gruppen, eine tägliche Zusammenfassung und eine
durchsuchbare Wissensdatenbank. Das ist ein **komplementärer zweiter Strang**, nicht ein
Ersatz des `.md`-Katalogs.

**Datenschutz-Konsequenz:** Der `.md`-Katalog verarbeitet nur bewusst geteilte Dokumente
(geringeres Risiko). Sobald der Bot *alle* Nachrichten mitliest, steigt die
DSGVO-Anforderung deutlich — siehe [`datenschutz-dsgvo.md`](./datenschutz-dsgvo.md).

## Herkunft

Diese Unterlagen sind das Ergebnis einer Recherche mit mehreren parallel arbeitenden
Recherche-Agenten inklusive adversarialer Gegenprüfung der vier risikoreichsten
Behauptungen (WhatsApp-Anbindung, Sperr-Risiko, DSGVO-Grundlage, Serverless-Eignung).
Die Kernaussagen sind mit Quellen belegt; die rechtlichen Hinweise ersetzen **keine**
Rechtsberatung.
