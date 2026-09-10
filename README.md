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

## GPT Image 2.5 ist da (bestätigt funktionierend)

Nach zwei falschen Rateversuchen hat sich das Kie.ai-Schema geklärt: der
Punkt in "2.5" wird als Bindestrich geschrieben, komplett im selben
durchgehenden Bindestrich-Stil wie GPT Image 2. Ersetzt jetzt GPT Image 2
in der Modell-Auswahl:

- **GPT Image 2.5 Flare** (`gpt-image-2-5-flare-text-to-image` /
  `-image-to-image`) — Standardwahl, schneller als GPT Image 2 bei
  gleichem Preis.
- **GPT Image 2.5 Sunburst** (`gpt-image-2-5-sunburst-text-to-image` /
  `-image-to-image`) — Präzisions-Variante für kontrollierte Bearbeitungen.

Die Bild-zu-Bild-Variante beider Modelle ist direkt im Kie.ai-Dashboard
bestätigt. Die Text-zu-Bild-Variante ist nach demselben, jetzt belegten
Muster abgeleitet, aber noch nicht einzeln gegengetestet — falls die beim
reinen Text-Prompt (ohne Referenzbild) einen Fehler wirft, ist das wie
gehabt eine Ein-Zeilen-Korrektur in `server.js`.

## Neu: Bibliothek, Video-Bereich (Seedance/Kling), Verbindung beider Welten

Das ist der größte Umbau bisher, in drei Etappen — alle in dieser Version enthalten.

### Etappe 1 — Bibliothek (Charaktere, Landschaften/Hintergründe, Gegenstände)

Oben in der Seitenleiste, unter "Projekt". Drei Kategorien, jede mit
dauerhaft gespeicherten Einträgen (Bild + Name + optionaler Beschreibungstext,
`localStorage`, wie Projekte/Verlauf):

- **"+"** lädt ein Bild hoch und fragt nach einem Namen.
- **"✎ Beschreiben"** lässt Claude aus dem Bild eine wiederverwendbare
  Beschreibung schreiben (nur sichtbar, wenn `ANTHROPIC_API_KEY` gesetzt ist).
- **Klick auf den Eintrag** ("→ Verwenden"-Prinzip): Bild wandert in den
  nächsten freien, passenden Referenz-Platz (Charakter → Person,
  Landschaft → Hintergrund, Gegenstand → Gegenstand) und die Beschreibung
  wird in den zuletzt aktiven Prompt eingefügt — ein Klick für beides.

### Etappe 2 — Video-Bereich

Neuer Tab "🎬 Video" neben "🖼 Bild" oben in der Seitenleiste (Projekt und
Bibliothek bleiben in beiden Tabs sichtbar). Zwei Modelle:

| Modell | Anbieter | Stärke |
|---|---|---|
| Seedance 2.0 Fast | ByteDance | Sauberes Start-/Endbild als getrennte Parameter, bis 15s, optional Ton |
| Kling 3.0 | Kuaishou | Benannte Element-Referenzen (`@name` im Prompt), optional Ton |

- **Start-/Endbild:** Entweder direkt hochladen, oder auf jedem fertigen
  Bild im Ergebnisbereich "🎬 Video…" → "als Video-Startbild"/"…-Endbild"
  wählen — damit sind die Bild- und Video-Erzeugung verbunden, genau wie
  gewünscht.
- **Video-Prompt-Generator (Claude):** Wie bei Bildern, aber auf Bewegung
  ausgelegt — nutzt Start-/Endbild (falls gesetzt) und/oder eine eigene
  Idee, berücksichtigt die gewählte Dauer, damit die Bewegung zeitlich
  plausibel bleibt.
- Ergebnisse erscheinen als eigene Karten im selben Ergebnisbereich wie
  Bilder (mit 🎬-Kennzeichnung), mit Video-Player, "★ behalten", Download
  (gleiche Namenskonvention wie Bilder, endet aber auf `.mp4`) und
  "⎘ Prompt". "KI-Check" und "als Referenz verwenden" gibt es hier bewusst
  nicht (nicht sinnvoll übertragbar auf Video).

### Etappe 3 — Bibliothek in der Video-Erzeugung

Bei Kling 3.0 erscheint im Video-Tab ein Block "Elemente aus Bibliothek" —
Charaktere/Gegenstände aus der Bibliothek lassen sich als Kontrollkästchen
aktivieren und werden automatisch als benannte `kling_elements` mitgeschickt;
im Prompt mit `@name` ansprechen (der Name wird dabei automatisch in ein
technisches Kürzel umgewandelt, z. B. "Anna" → `@anna`). Bei Seedance
landet ein aktiviertes Startbild automatisch als `first_frame_url`.

### Bekannte Lücken in dieser ersten Video-Version

- Kein eigener Video-Auflösungsregler (Seedance läuft fest auf 720p, Kling
  auf Standard-Qualität) — bei Bedarf in `server.js` (`VIDEO_MODELS`)
  nachrüstbar.
- Seedances "reine Referenzbilder ohne Start-/Endbild"-Modus ist technisch
  im Server vorbereitet, aber im Interface noch nicht verdrahtet (Start-
  /Endbild deckt den Hauptanwendungsfall ab).
- Kein editierbares Dateiname-Stichwort bei Videos (bei Bildern schon) —
  wird automatisch aus dem Prompt abgeleitet.
- Video-Generierung dauert je nach Modell/Länge deutlich länger als Bilder
  (oft mehrere Minuten) und kostet spürbar mehr Kie.ai-Guthaben pro
  Versuch — vor größeren Testreihen einen Blick ins Kie.ai-Guthaben werfen.

## Neu: Claude formuliert jetzt knapper und stichpunktartiger

Sowohl der Bild- als auch der Video-Prompt-Generator bitten Claude jetzt
ausdrücklich um kurze, komma-getrennte Phrasen statt ausschweifendem
Fließtext (Tag-Stil) — deckt weiterhin Komposition, Personen, Hintergrund,
Licht und Kamera ab, aber knapper formuliert.

## Neu: KI-Check ("zusätzliche Hand" & Co. automatisch erkennen)

Jedes fertige Bild hat einen **"🔍 KI-Check"**-Button (nur sichtbar, wenn
`ANTHROPIC_API_KEY` gesetzt ist). Claude schaut sich das Bild gezielt auf
typische KI-Generierungsfehler an — zusätzliche/fehlende Finger, verformte
Hände, asymmetrische Gesichter, unlesbarer Text im Bild, unmögliche
Anatomie, inkonsistente Schatten/Spiegelungen — und meldet entweder "keine
auffälligen Fehler erkannt" (grün) oder eine kurze Liste konkreter Punkte
mit Ortsangabe (rot). Das Ergebnis wird direkt unter dem Bild angezeigt und
bleibt gespeichert (auch nach Neuladen der Seite sichtbar).

Bewusst **auf Klick**, nicht automatisch nach jeder Generierung — sonst
würde jedes Bild zusätzliche Claude-Kosten verursachen, auch verworfene
Versuche. Wer eine automatische Prüfung nach jeder Generierung möchte,
kann das als Option ergänzen (kleiner Umbau in `app.js`/`server.js`).

## Neu: Einheitliche Dateinamen beim Download

Jedes heruntergeladene Bild heißt jetzt einheitlich:

```
JJMMTT_Projekt_Stichwort_Seitenverhaeltnis_Modell.ext
```

Beispiel: `260908_Mondfahrer_high-angle-village-mist_16zu9_NanoBanana.png`

- **Datum** kommt vom Erstellungszeitpunkt des Bildes.
- **Projekt** ist das zum Zeitpunkt der Generierung aktive Projekt (siehe
  "Projekte" oben), sonst `OhneProjekt`.
- **Stichwort** wird automatisch aus den ersten (englischen) Schlüsselwörtern
  des jeweiligen Prompts abgeleitet — das ist eine einfache, kostenlose
  Heuristik ohne KI-Aufruf, liefert also nicht immer ein so pointiertes
  Wort wie von Hand gewählt. Direkt unter jedem fertigen Bild steht ein
  kleines Textfeld "Datei:", in dem sich das Stichwort jederzeit vor dem
  Herunterladen überschreiben lässt.
- **Seitenverhältnis** und **Modell** stammen aus den bei der Generierung
  gewählten Einstellungen.

Der Download läuft technisch über einen Blob-Fetch, damit der Dateiname
zuverlässig ankommt (reine Cross-Origin-Links respektieren vorgeschlagene
Dateinamen nicht überall zuverlässig) — falls das aus irgendeinem Grund
blockiert wird, öffnet sich das Bild ersatzweise in einem neuen Tab.

## Neu: Bildsprache fließt in den Prompt-Generator ein, "ungesehene Perspektive"

- Im Prompt-Generator (Claude) gibt es jetzt zwei Checkboxen:
  - **"Aktuelle Bildsprache-Auswahl einbeziehen"** — nimmt die vier gerade
    in den Dropdowns gewählten Bausteine (Kamerawinkel, Objektiv,
    cineastischer Kniff, Stil-Referenz) und gibt sie Claude als
    verbindliche Vorgabe mit, statt dass sie nur roh in ein Textfeld
    eingefügt werden. Claude webt sie dann sprachlich sauber in den
    generierten Prompt ein.
  - **"🎲 Besondere, noch nie gesehene Perspektive vorschlagen lassen"** —
    bittet Claude, zusätzlich eine ungewöhnliche, überraschende
    Kamera-Perspektive oder Bildkomposition zu erfinden (konkret
    beschrieben, nicht nur behauptet), statt bei Standard-Einstellungen zu
    bleiben.
  - Beide sind standardmäßig **aus**, damit nichts ungefragt in den Prompt
    einfließt.

## Neu: Bildsprache (Kamerawinkel, Objektiv, cineastische Kniffe, Stil-Referenzen)

Vier Dropdowns mit kuratierten Bausteinen, alle mit deutscher Beschriftung
im Menü und englischem Text, der tatsächlich in den Prompt wandert:

- **Kamerawinkel** — Augenhöhe, Froschperspektive, Vogelperspektive, POV, …
- **Objektiv** — beschrieben nach Wirkung (z. B. "schmeichelnde
  Porträt-Kompression"), nicht nach technischem Namen
- **Cineastischer Kniff** — Rembrandt-Licht, God Rays, Teal-&-Orange, …
- **Stil-Referenz** — an bekannte Filme/Serien angelehnt (z. B. Barry
  Lyndon, Blade Runner 2049). Wichtig: In den Prompt wandert **nur eine
  handgeschriebene Licht-/Farb-/Kompositionsbeschreibung**, nie der
  Filmtitel selbst und nie Figuren/Handlung — Stil ist rechtlich unbedenklich,
  ein zu genau nachgebautes Bild wäre es potenziell nicht. (Keine
  Rechtsberatung, aber die im Prompt-Engineering übliche und sichere Praxis.)

**Eigene Einträge:** "+ Eigener Eintrag" fragt nach einem kurzen Namen fürs
Dropdown und dem englischen Prompt-Text, der eingefügt werden soll — landet
per `localStorage` dauerhaft in der jeweiligen Liste (rein lokal, wie
Verlauf und Projekte).

**Vorschaubild:** Erzeugt bei Bedarf ein einzelnes Beispielbild aus der
Stilbeschreibung heraus (mit einer neutralen Platzhalterszene), über das
aktuell gewählte Modell — bewusst **keine echten Filmstills**, sondern ein
frisch generiertes Bild, das nur den beschriebenen Stil zeigt. Kostet wie
jede normale Generierung reguläres Guthaben, läuft nur auf Klick.

**Einfügen:** Landet im zuletzt angeklickten Prompt-Feld (Start oder Ende),
angehängt an bestehenden Text.

## Neu: Prompt-Generator statt nur Bildbeschreibung, "Prompt kopieren"

- Der Claude-Bereich heißt jetzt **Prompt-Generator** und funktioniert auf
  drei Arten: nur Bild hochladen (wie bisher), nur eine eigene Idee
  eintippen (auch stichwortartig oder auf Deutsch — Claude formuliert
  daraus einen vollständigen Prompt), oder beides kombiniert. Der
  "Prompt erstellen"-Button ist aktiv, sobald mindestens eins von beidem
  ausgefüllt ist.
- Jedes fertige Bild hat jetzt zusätzlich einen **"⎘ Prompt"**-Button, der
  den zugehörigen Start- bzw. End-Prompt-Text in die Zwischenablage kopiert
  (z. B. um ihn extern weiterzuverwenden oder leicht abgewandelt erneut
  einzusetzen).

## Neu: Behalten & Varianten

- **★ Behalten:** Jedes fertige Bild hat einen Stern-Button. Markierte
  Bilder werden nie automatisch aus dem Verlauf gekürzt (der läuft sonst
  nach 40 Einträgen ab), und der Filter-Button "★ Nur Behaltene" oben im
  Ergebnisbereich blendet alles andere aus.
- **↻ Variieren:** Auf jedem fertigen Bild lässt sich ein freier Text
  eintippen (z. B. "Kamera weiter von rechts", "von oben", "mehr Menschen
  im Hintergrund") — daraus entsteht ein neues Einzelbild, das genau
  dieses Bild als einzige Referenz nutzt. Praktisch für schnelle
  Bildvarianten, ohne die Referenz-Kategorien in der Seitenleiste
  anzufassen. Wer mehrere Referenzen kombinieren will (Personen + Stimmung
  + Hintergrund gleichzeitig), nutzt weiterhin das normale Start-/End-Formular.

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
