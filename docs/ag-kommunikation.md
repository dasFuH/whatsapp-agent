# AG-Kommunikation

Fertige Texte zum Kopieren für die neue Arbeitsgruppe. WhatsApp-Formatierung (`*fett*`)
funktioniert direkt; für Forum/Discourse ggf. in Markdown anpassen.

---

## 1. Zweckbeschreibung der Arbeitsgruppe (kurz, z. B. als Gruppenbeschreibung)

```
AG WhatsApp-Agent — Wir bauen einen Community-Agenten, der in unseren WhatsApp-Gruppen
mitliest, das Wichtigste einmal täglich zusammenfasst und daraus nach und nach eine
durchsuchbare Wissensdatenbank aufbaut. Ziel: Auch wer ein paar Tage raus war, findet in
Sekunden „was lief zu Thema X?" — statt 1.000 Nachrichten nachzuscrollen. Wir starten mit
einem kleinen Machbarkeits-Test und entscheiden Technik, Datenschutz und Umfang gemeinsam.
```

---

## 2. Erster Beitrag / Kickoff (copy-paste)

```
👋 Willkommen in der AG WhatsApp-Agent!

Wir sind inzwischen ~200 Leute in der Community — genial, aber ehrlich auch unübersichtlich.
Wer mal zwei Tage raus ist, findet kaum noch zurück in die wichtigen Diskussionen.

Die Idee dieser AG:
Ein Agent liest (mit eurem Einverständnis) in unseren Gruppen mit und legt das Geschriebene
erstmal nur als Rohdaten ab. Einmal am Tag läuft ein Job drüber, fasst zusammen, erkennt
Themen — und füllt Stück für Stück eine Wissensdatenbank. Später soll man den Agenten auch
einfach per DM fragen können: „Hat jemand zuletzt was zu <Thema> gepostet?"

Wie wir anfangen — bewusst klein:
Der allererste Schritt ist ein reiner Machbarkeits-Beweis, losgelöst von allem anderen:
Kriegen wir einen Agenten sauber an WhatsApp angebunden, in eine Test-Gruppe eingeladen,
eine Nachricht ausgelesen und in eine Datenbank geschrieben? Wenn das steht, bauen wir
Schritt für Schritt weiter. (Ein erster Stand existiert sogar schon im Repo.)

Zwei Dinge klären wir gemeinsam gleich zu Beginn — offen, ihr entscheidet mit:
• Anbindung: Wie verbinden wir den Agenten technisch sauber mit WhatsApp? (Es gibt mehrere
  Wege mit unterschiedlichen Trade-offs — u.a. ein Sperr-Risiko für die genutzte Nummer.
  Deshalb testen wir mit einer eigenen Test-Nummer, nie mit privaten.)
• Datenschutz: Wir verarbeiten eure Nachrichten — also machen wir das von Anfang an
  DSGVO-konform (Einwilligung, Transparenz, Datensparsamkeit). Das ist Teil des Projekts,
  nicht die Bremse.

Wen wir gut gebrauchen können:
🛠️ Node/TypeScript & Lust auf WhatsApp-/Bot-APIs (Baileys & Co.)
🤖 KI/RAG, Prompting, Zusammenfassungs-Qualität
🔐 Datenschutz-/Vereins-affine Köpfe
🧩 und alle, die einfach mitdenken und ausprobieren wollen

Es gibt keinen fixen Fahrplan von oben — es gibt einen groben Vorschlag als Startpunkt
(liegt im Repo unter docs/), aber Tempo, Technik und Umfang gestalten wir zusammen.

Sagt kurz Hallo 👋 und schreibt dazu, wobei ihr mit anpacken würdet.
```

---

## 3. Verweise für Interessierte

- Recherche zur WhatsApp-Anbindung: [`recherche-whatsapp-agent.md`](./recherche-whatsapp-agent.md)
- Datenschutz + Einwilligungs-Vorlagen: [`datenschutz-dsgvo.md`](./datenschutz-dsgvo.md)
- Roadmap Wissensdatenbank: [`roadmap-wissensdatenbank.md`](./roadmap-wissensdatenbank.md)
- Technische Spezifikation (bestehender Bot): [`../SETUP.md`](../SETUP.md)
