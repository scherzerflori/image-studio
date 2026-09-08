# Kie Image Studio

Ein schlankes Web-Interface für ausgewählte Bild-KI-Modelle von
[Kie.ai](https://kie.ai) — Referenzbilder kategorisiert befüllen (Personen,
Stimmung, Hintergrund, Gegenstände), Start- und optional Endbild-Prompt
eingeben, entwickeln lassen. Läuft als kleiner Node/Express-Server, der den
API-Key serverseitig hält (Kie.ai rät ausdrücklich davon ab, den Key im
Browser zu verwenden).

## Warum ein eigener Server statt reinem HTML?

Kie.ai ist für Server-zu-Server-Aufrufe gebaut, nicht für direkte
Browser-Requests. Ein reines HTML-Interface müsste den API-Key im
Seiten-Code verstecken (unsicher, jeder im Netzwerktab sieht ihn) und würde
vermutlich zusätzlich an CORS scheitern. Der Server in diesem Projekt ist
daher ein dünner Proxy: Er nimmt Anfragen vom Browser entgegen, hängt den
Key aus einer Umgebungsvariable an und leitet an `api.kie.ai` weiter.

## Neu: Prompt aus Referenzbild (Claude) & Projekte

- **Prompt aus Referenzbild:** Bild hochladen, Claude beschreibt es als
  fertigen, englischsprachigen Bildgenerierungs-Prompt (cineastisch,
  photorealistisch, im gewählten Projekt-Stil). Braucht einen eigenen
  Anthropic-API-Key (siehe unten) — ohne den Key bleibt dieser Abschnitt
  im Interface einfach ausgeblendet, der Rest funktioniert normal weiter.
- **Projekte:** Modell, Seitenverhältnis, Auflösung und ein frei
  formulierter Stil-Text ("Grundstimmung") lassen sich unter einem Namen
  speichern. Der Stil-Text wird automatisch jedem Start-/End-Prompt
  vorangestellt und dient als Vorgabe für die Bildbeschreibung. Projekte
  liegen — wie der Verlauf — nur lokal im Browser (`localStorage`), nicht
  auf dem Server. Anderes Gerät = keine gespeicherten Projekte.

### Anthropic-API-Key einrichten

1. Auf [console.anthropic.com](https://console.anthropic.com) ein Konto
   anlegen (getrennt von einem normalen Claude.ai-Zugang) und einen
   API-Key erzeugen.
2. Bei Render unter **Environment** eine neue Variable `ANTHROPIC_API_KEY`
   mit diesem Key anlegen, dann "Save, rebuild, and deploy".
3. Abrechnung erfolgt nutzungsbasiert (nicht über ein Claude.ai-Abo) —
   eine Bildbeschreibung kostet üblicherweise Bruchteile eines Cents bis
   wenige Cent. Aktuelle Preise: [anthropic.com/pricing](https://anthropic.com/pricing).
   Neue Konten erhalten in der Regel ein kleines Startguthaben.

## Lokal starten

```bash
npm install
cp .env.example .env
# .env öffnen, KIE_API_KEY eintragen (aus https://kie.ai/api-key)
npm start
```

Danach [http://localhost:3000](http://localhost:3000) öffnen.

## Deployment auf Render

1. Projektordner in ein GitHub-Repo hochladen (`package.json` muss direkt im
   Hauptverzeichnis liegen, nicht in einem Unterordner).
2. Auf [render.com](https://render.com) → **New** → **Web Service** → Repo
   auswählen.
3. **Language:** Node · **Build Command:** `npm install` · **Start Command:**
   `npm start`.
4. Unter **Environment**: `KIE_API_KEY` (dein Kie.ai-Key) und optional
   `ACCESS_PASSWORD` (frei wählbares Passwort) eintragen.
5. Deploy anstoßen. Spätere Änderungen an den Dateien im GitHub-Repo lösen
   automatisch einen neuen Build aus (Auto-Deploy) — Render muss danach
   nicht erneut eingerichtet werden.

## Modelle im Interface

| Modell | Anbieter | Stärke | Referenzbilder (Limit) |
|---|---|---|---|
| Nano Banana Pro | Google | Allrounder, starke Textwiedergabe im Bild | bis 8 |
| Flux-2 Pro | Black Forest Labs | Photorealismus, hohe Bildtreue | bis 4 |
| GPT Image 2 | OpenAI | Vielseitig, Illustrationen & Varianten | bis 4 (ungefähr) |

Ohne Referenzbild läuft automatisch die Text-zu-Bild-Variante des jeweiligen
Modells, mit Referenzbild(ern) die Bild-zu-Bild/Edit-Variante — die
Umschaltung passiert automatisch im Server (`server.js`, Funktion
`buildInput` pro Modell).

## Referenzbild-Kategorien

Im Interface gibt es vier feste Kategorien mit jeweils eigener Platzanzahl:

- **Person** (bis zu 4) — mit Namensfeld, z. B. "Anna", "Tom"
- **Stimmung** (bis zu 3) — Referenzbilder für Look & Atmosphäre
- **Hintergrund/Gebäude** (bis zu 3)
- **Gegenstand/Fahrzeug** (bis zu 3)

Theoretisch lassen sich also bis zu 13 Referenzbilder befüllen — die
Kie.ai-Modelle akzeptieren aber jeweils weniger (siehe Tabelle oben). Das
Interface zeigt unter den Referenz-Kategorien immer eine Statuszeile, wie
viele der befüllten Bilder tatsächlich an das gewählte Modell gehen, und
listet explizit auf, welche wegen des Limits nicht berücksichtigt werden.
Priorität: Personen zuerst, dann Stimmung, dann Hintergrund, dann
Gegenstände (in dieser Reihenfolge werden die Plätze aufgefüllt).

Damit das jeweilige Modell weiß, was ein Bild zeigt, baut der Server aus den
Kategorien/Namen automatisch eine kurze Beschreibung, die dem Prompt
vorangestellt wird (z. B. *"Bildreferenzen in dieser Reihenfolge: 1) Person:
Anna, 2) Hintergrund 1, ..."*) — die Bild-APIs selbst kennen keine
Beschriftungen, nur eine Reihenfolge von Bild-URLs.

## Start- und Endbild

Zwei Prompt-Felder: **Start** (Pflicht) und **Ende** (optional). Beide
verwenden denselben Referenzbild-Pool, bekommen aber unterschiedlichen
Text. Bleibt "Ende" leer, entsteht nur ein Bild. Ist es ausgefüllt, laufen
zwei Kie.ai-Anfragen parallel und erscheinen als Paar in einer gemeinsamen
Karte im Ergebnisbereich.

Auf jedem fertigen Bild gibt es einen kleinen "als Referenz…"-Auswähler —
damit lässt sich ein generiertes Ergebnis direkt in einen freien
Referenz-Platz (z. B. Person 2) übernehmen, ohne es erst herunter- und
wieder hochzuladen. Praktisch für Konsistenz über mehrere Generierungen
hinweg (z. B. dieselbe Person in Start- und Folgebildern).

## Bekannte Einschränkungen

- **Ergebnis-URLs laufen ab.** Kie.ai hält generierte Bilder nur befristet
  vor (laut Doku üblicherweise 24 Stunden). Der Download-Pfeil auf jedem
  Bild lädt sofort lokal herunter — bei Bedarf zeitnah nutzen.
- **Hochgeladene Referenzbilder** landen auf Kie.ais temporärem
  Datei-Server und werden nach einigen Tagen automatisch gelöscht.
- **Referenzbild-Limits** sind Näherungswerte aus der Kie.ai-Dokumentation
  bzw. Community-Quellen (Stand September 2026), nicht offiziell für jedes
  Modell exakt dokumentiert — insbesondere bei GPT Image 2 ist der reale
  Wert unsicher. Falls Kie.ai mehr oder weniger akzeptiert, in `server.js`
  im `MODELS`-Array bei `maxReferenceImages` anpassen.
- **Seitenverhältnis/Auflösung:** Nicht jedes Modell akzeptiert jeden Wert.
  Lehnt Kie.ai eine Anfrage ab, erscheint die Fehlermeldung direkt im
  jeweiligen Bild-Slot — meist hilft ein anderes Seitenverhältnis.
- **Verlauf** liegt nur lokal im Browser (`localStorage`), nicht auf dem
  Server. Anderes Gerät oder Browser = leerer Verlauf.
