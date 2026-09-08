# Kie Image Studio

Ein schlankes Web-Interface für die Bild-KI-Modelle von [Kie.ai](https://kie.ai) —
Prompt eingeben, Modell wählen, optional Referenzbilder hochladen, entwickeln
lassen. Läuft als kleiner Node/Express-Server, der den API-Key serverseitig
hält (Kie.ai rät ausdrücklich davon ab, den Key im Browser zu verwenden).

## Warum ein eigener Server statt reinem HTML?

Kie.ai ist für Server-zu-Server-Aufrufe gebaut, nicht für direkte
Browser-Requests. Ein reines HTML-Interface müsste den API-Key im
Seiten-Code verstecken (unsicher, jeder im Netzwerktab sieht ihn) und würde
vermutlich zusätzlich an CORS scheitern. Der Server in diesem Projekt ist
daher ein dünner Proxy: Er nimmt Anfragen vom Browser entgegen, hängt den
Key aus einer Umgebungsvariable an und leitet an `api.kie.ai` weiter.

## Lokal starten

```bash
npm install
cp .env.example .env
# .env öffnen, KIE_API_KEY eintragen (aus https://kie.ai/api-key)
npm start
```

Danach [http://localhost:3000](http://localhost:3000) öffnen.

## Deployment auf Render (wie bei zeppelin-zero-backend)

1. Projektordner in ein eigenes GitHub-Repo pushen (z. B. `kie-image-studio`).
2. Auf [render.com](https://render.com) → **New** → **Web Service** → das Repo
   auswählen.
3. Einstellungen:
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Node Version:** 18 oder neuer (Render erkennt das meist automatisch)
4. Unter **Environment** die Variablen setzen:
   - `KIE_API_KEY` = dein Kie.ai-Key
   - `ACCESS_PASSWORD` = ein selbst gewähltes Passwort (empfohlen, siehe unten)
5. Deploy anstoßen. Render vergibt automatisch eine `*.onrender.com`-URL
   (später optional eine eigene Subdomain wie `bilder.scherzerflori.de` per
   CNAME bei IONOS eintragen, genau wie bei den anderen Subdomains).

## Passwortschutz

`ACCESS_PASSWORD` ist ein einfacher, gemeinsamer Zugriffsschutz — kein
vollwertiges Login-System, aber genug, um zu verhindern, dass jemand, der
die URL errät oder findet, auf deine Kosten Bilder generiert. Ohne gesetzte
Variable ist das Interface offen erreichbar.

## Modelle im Interface

| Modell | Anbieter | Stärke | Referenzbilder |
|---|---|---|---|
| Nano Banana Pro | Google | Allrounder, starke Textwiedergabe im Bild | bis 6 |
| Flux-2 Pro | Black Forest Labs | Photorealismus, hohe Bildtreue | bis 4 |
| GPT Image 2 | OpenAI | Vielseitig, Illustrationen & Varianten | bis 4 |
| Seedream 5.0 Lite | ByteDance | Detailtreue, Textdarstellung | bis 6 |
| Ideogram V3 | Ideogram | Typografie, Logos, Layouts | 1 |
| Grok Imagine | xAI | Stilisiert, hohe Prompt-Treue | 1 |

Ohne Referenzbild läuft automatisch die Text-zu-Bild-Variante des jeweiligen
Modells, mit Referenzbild(ern) die Bild-zu-Bild/Edit-Variante — die
Umschaltung passiert automatisch im Server (`server.js`, Funktion
`buildInput` pro Modell).

## Bekannte Einschränkungen

- **Ergebnis-URLs laufen ab.** Kie.ai hält generierte Bilder nur befristet
  vor (laut Doku üblicherweise 24 Stunden). Der "Herunterladen"-Button auf
  jeder Karte lädt sofort lokal herunter — das sollte man zeitnah tun, wenn
  ein Ergebnis dauerhaft gebraucht wird.
- **Hochgeladene Referenzbilder** landen auf Kie.ais temporärem
  Datei-Server und werden dort nach einigen Tagen automatisch gelöscht.
- **Seitenverhältnis/Auflösung:** Nicht jedes Modell akzeptiert jeden Wert.
  Falls Kie.ai eine Anfrage mit einer Fehlermeldung ablehnt, erscheint diese
  auf der jeweiligen Karte — meist hilft ein anderes Seitenverhältnis.
- **Ideogram-Seitenverhältnis** wird intern auf Ideograms eigenes Format
  (`square_hd`, `landscape_16_9` usw.) übersetzt. Die Zuordnung ist die
  wahrscheinlichste nach aktueller Dokumentenlage — sollte Kie.ai das Enum
  ändern, in `server.js` → `ideogramSizeFromRatio` anpassen.
- **Verlauf** liegt nur lokal im Browser (`localStorage`), nicht auf dem
  Server. Anderes Gerät oder Browser = leerer Verlauf.
- Die Modell-Parameter stammen aus der Kie.ai-Dokumentation (Stand
  September 2026, [docs.kie.ai/market/quickstart](https://docs.kie.ai/market/quickstart)).
  Kie.ai erweitert sein Modell-Angebot laufend — neue Modelle lassen sich in
  `server.js` im `MODELS`-Array ergänzen, jedes folgt demselben Muster
  (`buildInput(ctx)` gibt `{ model, input }` zurück).
