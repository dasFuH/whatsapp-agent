# Datenschutz (DSGVO) für den WhatsApp-Agenten

> **Kein Ersatz für Rechtsberatung.** Diese Zusammenfassung ordnet die Pflichten ein und
> liefert Textbausteine als Ausgangspunkt. Die finale Abnahme gehört zum Vorstand bzw.
> einer datenschutzkundigen Person.

## 0. Warum das hier ernst zu nehmen ist

Sobald der Bot Nachrichten von Community-Mitgliedern speichert und eine KI drüberlaufen
lässt, ist das eine **Verarbeitung personenbezogener Daten**. Verantwortlich ist der
Verein/Vorstand (Art. 4 Nr. 7 DSGVO), nicht „der Bot" und nicht der einzelne Entwickler.

**Zwei Risikostufen — bewusst unterscheiden:**

| Umfang | Beispiel | Risiko |
|---|---|---|
| **Eng** (Ist-Zustand `wa-projekt-bot`) | Nur bewusst geteilte `.md`-Projektdateien werden erfasst | **niedriger** — wer die Datei teilt, tut das absichtlich zum Katalogisieren |
| **Breit** (Vision „alles mitlesen") | Der Bot protokolliert laufende Gruppen-Chats und fasst sie zusammen | **deutlich höher** — betrifft beiläufige, private Äußerungen aller |

Der breite Umfang braucht die volle Behandlung unten. Für den engen Umfang gelten dieselben
Prinzipien, aber verhältnismäßig leichter.

## 1. Rechtsgrundlage (Art. 6 DSGVO)

Zwei gangbare Wege:

- **Einwilligung (Art. 6 Abs. 1 a)** — der sichere Weg. Vorher, informiert, freiwillig,
  jederzeit widerrufbar, dokumentiert. Am besten **beim Beitritt** einholen (nicht nur als
  Reaktion in der Gruppe, wo Freiwilligkeit fraglich ist).
- **Berechtigtes Interesse (Art. 6 Abs. 1 f)** — möglich (Wissensmanagement/Dokumentation
  des Vereins), erfordert aber eine **dokumentierte Interessenabwägung** gegen die Rechte
  der Mitglieder und **Transparenz**. Höherer Nachweisaufwand im Prüfungsfall.

> **Freiwilligkeits-Falle:** Läuft die Community *hauptsächlich* über die Gruppe, kann eine
> Einwilligung als erzwungen gelten. Gegenmittel: Alternativkanäle offenhalten und Opt-out
> ohne Ausschluss aus der Community ermöglichen.

## 2. Pflichten-Checkliste

- [ ] **Transparenz/Information (Art. 13/14):** Datenschutzhinweis mit Verantwortlichem,
      Zweck, Rechtsgrundlage, Speicherdauer, Empfängern (KI-Anbieter), Betroffenenrechten.
- [ ] **Verschärfte KI-Transparenz (Art. 13 Abs. 2 f):** verständlich erklären, dass eine
      KI zusammenfasst/auswertet — Logik, Tragweite, angestrebte Wirkung.
- [ ] **AV-Vertrag / DPA mit dem KI-Anbieter (Art. 28):** verpflichtend. Ausdrücklich:
      **kein Training** mit euren Daten, möglichst **Zero Data Retention**.
- [ ] **Drittlandtransfer (Art. 44 ff.):** bei US-Anbietern → DPA + EU-US Data Privacy
      Framework + Datenminimierung. EU-Region wählen, wo möglich.
- [ ] **Datenminimierung (Art. 5 Abs. 1 c):** siehe [§4](#4-datenminimierung-konkret).
- [ ] **Speicherfristen (Art. 5 Abs. 1 e):** Löschkonzept, z. B. Rohtext 6 Monate →
      Zusammenfassung länger → reine Statistik anonym.
- [ ] **Betroffenenrechte (Art. 15–22):** Prozess für Auskunft, Berichtigung, Löschung,
      Widerspruch. Widerruf muss so leicht sein wie die Einwilligung.
- [ ] **Verzeichnis von Verarbeitungstätigkeiten (VVT, Art. 30):** tabellarisch reicht.
- [ ] **DSFA (Art. 35) prüfen:** bei umfangreichem Mitlesen + KI-Auswertung wahrscheinlich
      erforderlich — Risiken und Gegenmaßnahmen dokumentieren.
- [ ] **Vorstandsbeschluss:** Projekt inkl. Risikoabwägung formal beschließen.

## 3. Verein-spezifisch

- **Datenschutzbeauftragter:** für einen kleinen Verein i. d. R. **nicht** zwingend, außer
  ≥ 20 Personen ständig mit automatisierter Verarbeitung befasst **oder** umfangreiche
  systematische Überwachung. Bei ~200 Mitgliedern ohne hauptamtliche Stelle meist kein DSB
  nötig — die **Rechenschaftspflicht** (Art. 5 Abs. 2) bleibt aber.
- **Vorstandshaftung:** Verstöße können Bußgelder und Schadensersatz (Art. 82) auslösen.
- **Fürsorge/Vertrauen:** KI-Auswertung privater Chats wird als invasiv empfunden →
  proaktiv kommunizieren, Opt-out anbieten, ggf. Mitgliederversammlung informieren.

## 4. Datenminimierung konkret

Diese Punkte lassen sich direkt in den Bot bauen (der bestehende Code hat mit
`sql/schema.sql`/RLS und den Größen-/UTF-8-Grenzen bereits eine gute Grundlage):

- **Themen statt Klartext dauerhaft:** Volltext nur kurz halten; langfristig nur
  Zusammenfassungen/Themen speichern.
- **Absender pseudonymisieren:** nicht „Max Mustermann", sondern z. B. `Mitglied #42`;
  Mapping-Tabelle getrennt und zugriffsbeschränkt.
- **Dritte/Nicht-Mitglieder redigieren:** in Nachrichten erwähnte Namen automatisch
  maskieren (`[externer Name]`) — sie haben nicht eingewilligt.
- **Sensible Muster filtern:** Telefonnummern, E-Mails, Adressen, Gesundheitsangaben per
  Regex erkennen und redigieren **bevor** etwas an die KI geht.
- **Opt-out pro Nachricht:** z. B. Reaktions-Emoji „nicht speichern" → Bot löscht/ignoriert.
- **Besondere Kategorien (Art. 9):** Gesundheit, Religion, u. Ä. möglichst gar nicht
  verarbeiten; falls doch, ist eine DSFA zwingend.

> **Umsetzungs-Anker im Code:** Ein solcher Redaction-/Whitelist-Schritt kann sich am
> Muster `github/ai-filter.ts` (Secret-Redaction + Whitelist) aus dem VibeCoding-
> `agents-worker`-Repo orientieren — dort wird bereits gefiltert, was an ein LLM gehen darf.

## 5. Textbaustein-Vorlagen (Entwürfe — juristisch prüfen lassen)

### 5a. Gepinnter Hinweis in der Gruppe

```
ℹ️ Hinweis zum Community-Bot

In dieser Gruppe ist ein Bot aktiv, der geteilte Inhalte erfasst, einmal täglich
zusammenfasst und in eine durchsuchbare Wissensdatenbank der Community überführt.
Zur Auswertung wird ein KI-Dienst eingesetzt. Personenbezug wird dabei so weit wie
möglich reduziert (Namen pseudonymisiert, Dritte/Kontaktdaten entfernt).

• Rechtsgrundlage & Details: <Link zur Datenschutzerklärung>
• Du möchtest nicht, dass deine Nachrichten verarbeitet werden? Schreib <Kontakt/Befehl>
  — dein Opt-out gilt sofort und ohne Nachteile.
```

### 5b. Einwilligung (z. B. im Aufnahme-/Beitrittsformular)

```
☐ Ich willige ein, dass meine in den Community-WhatsApp-Gruppen geteilten Nachrichten
  vom Community-Bot gespeichert und mithilfe eines KI-Dienstes zu einer durchsuchbaren
  Wissensdatenbank zusammengefasst werden.

Zweck: gemeinsames Auffinden von Wissen und Projekten, Vermeidung von Doppelarbeit.
Verantwortlich: <Verein / Anschrift / Kontakt>.
Empfänger der Auswertung: <KI-Anbieter, Region>. Speicherdauer: <z. B. Rohtext 6 Monate,
Zusammenfassungen 24 Monate>. Deine Rechte: Auskunft, Berichtigung, Löschung, Widerspruch;
diese Einwilligung ist jederzeit mit Wirkung für die Zukunft widerrufbar unter <Kontakt>.
Ohne Einwilligung bleibt die Teilnahme an der Community möglich; deine Nachrichten werden
dann nicht verarbeitet. Details: <Link zur Datenschutzerklärung>.
```

## 6. Quellen

- eRecht24 — WhatsApp & Datenschutz: <https://www.e-recht24.de/dsg/12753-whatsapp.html>
- VIBSS — WhatsApp-Rechtslage im Verein: <https://www.vibss.de/vereinsmanagement/marketing/social-media/whatsapp/whatsapp-rechtslage-mit-einfuehrung-der-eu-dsgvo>
- dsn group — WhatsApp Communities & Datenschutz: <https://www.dsn-group.de/datenschutz-notizen/whatsapp-communities-0152881>
- LfDI Baden-Württemberg — Orientierungshilfe Datenschutz im Verein: <https://www.baden-wuerttemberg.datenschutz.de/orientierungshilfe-datenschutz-verein/>
- DSK — Orientierungshilfe KI und Datenschutz (2024): <https://www.datenschutzkonferenz-online.de/media/oh/20240506_DSK_Orientierungshilfe_KI_und_Datenschutz.pdf>
- activeMind — ChatGPT datenschutzkonform: <https://www.activemind.de/magazin/chatgpt/>
- DataGuard — Pseudonymisierung/Anonymisierung: <https://www.dataguard.de/blog/pseudonymisierung-und-anonymisierung-in-dsgvo-und-datenschutz>
- Dr. DSGVO — Datenschutzbeauftragter im Verein: <https://www.datenschutz.org/datenschutzbeauftragter-verein/>
