// kie-image-studio – server.js
//
// Ein schlanker Proxy zwischen Browser und der Kie.ai API.
// Der Grund fuer den Proxy: Kie.ai raet in den eigenen Docs ausdruecklich davon
// ab, den API-Key im Browser zu verwenden. Der Key bleibt also hier auf dem
// Server (als Umgebungsvariable) und wird nie an den Client geschickt.
//
// Quelle der Modell-Parameter: https://docs.kie.ai/market/quickstart (Stand
// September 2026). Kie.ai aktualisiert sein Model-Market gelegentlich – falls
// ein Request mit "Invalid parameter" o.ae. fehlschlaegt, lohnt ein Blick in
// die aktuelle Doku fuer das jeweilige Modell.

require('dotenv').config();
const express = require('express');
const path = require('path');

const app = express();
app.use(express.json({ limit: '25mb' })); // genug Platz fuer Base64-Bilder

const PORT = process.env.PORT || 3000;
const KIE_API_KEY = process.env.KIE_API_KEY;
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD; // optional
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY; // optional, nur fuer "Prompt aus Referenzbild"

if (!KIE_API_KEY) {
  console.warn(
    '[WARNUNG] KIE_API_KEY ist nicht gesetzt. Bitte in .env oder in den ' +
      'Render-Environment-Variablen eintragen, sonst schlagen alle Anfragen an Kie.ai fehl.'
  );
}
if (!ANTHROPIC_API_KEY) {
  console.warn(
    '[HINWEIS] ANTHROPIC_API_KEY ist nicht gesetzt. Die Funktion "Prompt aus Referenzbild" ' +
      'bleibt ohne diesen Key deaktiviert, der Rest der Seite funktioniert trotzdem normal.'
  );
}

const KIE_BASE = 'https://api.kie.ai/api/v1';
const KIE_UPLOAD_BASE = 'https://kieai.redpandaai.co/api';
const ANTHROPIC_BASE = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL = 'claude-sonnet-5';

// ---------------------------------------------------------------------------
// Seitenverhaeltnisse & Aufloesungen, die im Interface zur Auswahl stehen
// ---------------------------------------------------------------------------
const ASPECT_RATIOS = [
  { value: 'auto', label: 'Automatisch' },
  { value: '1:1', label: 'Quadratisch (1:1)' },
  { value: '16:9', label: 'Breitbild (16:9)' },
  { value: '9:16', label: 'Hochformat (9:16)' },
  { value: '4:3', label: 'Foto quer (4:3)' },
  { value: '3:4', label: 'Foto hoch (3:4)' },
  { value: '21:9', label: 'Panorama (21:9)' },
];

const RESOLUTIONS = [
  { value: '1K', label: '1K' },
  { value: '2K', label: '2K' },
  { value: '4K', label: '4K' },
];

// ---------------------------------------------------------------------------
// Referenzbild-Kategorien. "hasName" steuert, ob im Interface ein Namensfeld
// neben dem Bild erscheint (nur bei Personen). maxCount ist die Anzahl an
// Plaetzen, die im Interface angeboten werden – unabhaengig vom technischen
// Limit des jeweiligen Modells (das regelt maxReferenceImages pro Modell,
// siehe unten).
// ---------------------------------------------------------------------------
const REFERENCE_CATEGORIES = [
  { key: 'person', label: 'Person', maxCount: 4, hasName: true },
  { key: 'mood', label: 'Stimmung', maxCount: 3, hasName: false },
  { key: 'background', label: 'Hintergrund/Gebäude', maxCount: 3, hasName: false },
  { key: 'object', label: 'Gegenstand/Fahrzeug', maxCount: 3, hasName: false },
];

function categoryLabel(key) {
  const cat = REFERENCE_CATEGORIES.find((c) => c.key === key);
  return cat ? cat.label : key;
}

// Baut aus den mitgeschickten Referenzbildern eine kurze Beschreibung, die dem
// Prompt vorangestellt wird – die Kie.ai-Modelle bekommen nur eine Liste von
// Bild-URLs ohne Beschriftung, daher erklaeren wir per Text, was Bild 1, 2, 3
// ... zeigt (Standard-Praxis bei multi-image Prompts).
function buildReferenceDescriptor(references) {
  if (!references.length) return '';
  const counters = {};
  const parts = references.map((ref, i) => {
    counters[ref.category] = (counters[ref.category] || 0) + 1;
    let label;
    if (ref.category === 'person' && ref.name && ref.name.trim()) {
      label = `Person: ${ref.name.trim()}`;
    } else {
      label = `${categoryLabel(ref.category)} ${counters[ref.category]}`;
    }
    return `${i + 1}) ${label}`;
  });
  return `Bildreferenzen in dieser Reihenfolge: ${parts.join(', ')}.`;
}

// ---------------------------------------------------------------------------
// Modell-Registry – einzige Quelle der Wahrheit fuer Backend UND Frontend.
// Auf Wunsch reduziert auf drei Modelle. maxReferenceImages ist die
// bestbekannte technische Obergrenze des jeweiligen Kie.ai-Modells (Stand
// September 2026 laut Doku/Community-Quellen) – bei GPT Image 2 ist der
// exakte Wert in der Doku nicht dokumentiert, daher vorsichtig auf 4 gesetzt.
// ---------------------------------------------------------------------------
const MODELS = [
  {
    key: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    vendor: 'Google',
    blurb:
      'Der Allrounder: Text-zu-Bild und Bearbeitung mit bis zu 8 Referenzbildern in einem Modell, starke Textwiedergabe im Bild.',
    maxReferenceImages: 8,
    supportsResolution: true,
    buildInput(ctx) {
      return {
        model: 'nano-banana-pro',
        input: {
          prompt: ctx.prompt,
          image_input: ctx.referenceImageUrls,
          aspect_ratio: ctx.aspectRatio,
          resolution: ctx.resolution,
          output_format: 'png',
        },
      };
    },
  },
  {
    key: 'flux-2-pro',
    label: 'Flux-2 Pro',
    vendor: 'Black Forest Labs',
    blurb: 'Sehr photorealistisch, hohe Bildtreue bei Referenzbildern (bis zu 4).',
    maxReferenceImages: 4,
    supportsResolution: true,
    buildInput(ctx) {
      if (ctx.referenceImageUrls.length > 0) {
        return {
          model: 'flux-2/pro-image-to-image',
          input: {
            input_urls: ctx.referenceImageUrls,
            prompt: ctx.prompt,
            aspect_ratio: ctx.aspectRatio,
            resolution: ctx.resolution,
            nsfw_checker: false,
          },
        };
      }
      return {
        model: 'flux-2/pro-text-to-image',
        input: { prompt: ctx.prompt, aspect_ratio: ctx.aspectRatio, resolution: ctx.resolution },
      };
    },
  },
  {
    key: 'gpt-image-2',
    label: 'GPT Image 2',
    vendor: 'OpenAI',
    blurb: 'Vielseitig einsetzbar – gut fuer Illustrationen, Icons und Bildvarianten (bis zu 4 Referenzbilder, ungefaehr).',
    maxReferenceImages: 4,
    supportsResolution: false,
    buildInput(ctx) {
      if (ctx.referenceImageUrls.length > 0) {
        return {
          model: 'gpt-image-2-image-to-image',
          input: { prompt: ctx.prompt, input_urls: ctx.referenceImageUrls, aspect_ratio: ctx.aspectRatio },
        };
      }
      return {
        model: 'gpt-image-2-text-to-image',
        input: { prompt: ctx.prompt, aspect_ratio: ctx.aspectRatio },
      };
    },
  },
];

function findModel(key) {
  return MODELS.find((m) => m.key === key);
}

// ---------------------------------------------------------------------------
// Einfacher Passwortschutz (optional). Schuetzt nur die API-Routen, nicht die
// statischen Dateien – im HTML/JS steht nichts Geheimes.
// ---------------------------------------------------------------------------
function requireAccess(req, res, next) {
  if (!ACCESS_PASSWORD) return next(); // kein Passwort konfiguriert -> offen
  const provided = req.header('x-access-password');
  if (provided && provided === ACCESS_PASSWORD) return next();
  return res.status(401).json({ error: 'Falsches oder fehlendes Passwort.' });
}

app.post('/api/login', (req, res) => {
  if (!ACCESS_PASSWORD) return res.json({ ok: true, protected: false });
  const { password } = req.body || {};
  if (password === ACCESS_PASSWORD) return res.json({ ok: true, protected: true });
  return res.status(401).json({ ok: false, protected: true });
});

app.get('/api/models', requireAccess, (req, res) => {
  res.json({
    models: MODELS.map((m) => ({
      key: m.key,
      label: m.label,
      vendor: m.vendor,
      blurb: m.blurb,
      maxReferenceImages: m.maxReferenceImages,
      supportsResolution: m.supportsResolution,
    })),
    aspectRatios: ASPECT_RATIOS,
    resolutions: RESOLUTIONS,
    referenceCategories: REFERENCE_CATEGORIES,
    describeEnabled: !!ANTHROPIC_API_KEY,
  });
});

// Referenzbild hochladen: Browser schickt Base64, wir reichen es an Kie.ai
// weiter und geben nur die entstandene URL zurueck. Wird pro Bild-Slot
// aufgerufen (Person 1, Stimmung 2, ...).
app.post('/api/upload', requireAccess, async (req, res) => {
  try {
    const { base64Data, fileName } = req.body || {};
    if (!base64Data) return res.status(400).json({ error: 'base64Data fehlt.' });

    const upstream = await fetch(`${KIE_UPLOAD_BASE}/file-base64-upload`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${KIE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        base64Data,
        uploadPath: 'kie-image-studio',
        fileName: fileName || undefined,
      }),
    });
    const data = await upstream.json();
    if (!upstream.ok || data.success === false) {
      return res.status(upstream.status || 500).json({ error: data.msg || 'Upload fehlgeschlagen.' });
    }
    res.json({ url: data.data.downloadUrl });
  } catch (err) {
    console.error('Upload-Fehler:', err);
    res.status(500).json({ error: 'Upload fehlgeschlagen (Server-Fehler).' });
  }
});

// Start- und (optional) Endbild in einem Aufwasch anstossen. Beide teilen
// sich denselben Referenzbild-Pool, bekommen aber jeweils ihren eigenen
// Prompt-Text.
app.post('/api/generate-pair', requireAccess, async (req, res) => {
  try {
    const { modelKey, promptStart, promptEnd, aspectRatio, resolution, references, stylePrefix } = req.body || {};
    const model = findModel(modelKey);
    if (!model) return res.status(400).json({ error: 'Unbekanntes Modell.' });
    if (!promptStart || !promptStart.trim()) {
      return res.status(400).json({ error: 'Start-Prompt fehlt.' });
    }

    // Defensive Begrenzung – das Frontend begrenzt schon selbst, aber wir
    // verlassen uns nicht blind darauf.
    const refs = Array.isArray(references) ? references.slice(0, model.maxReferenceImages) : [];
    const descriptor = buildReferenceDescriptor(refs);
    const refUrls = refs.map((r) => r.url).filter(Boolean);
    const style = stylePrefix && stylePrefix.trim() ? stylePrefix.trim() : '';

    async function runVariant(promptText) {
      const parts = [descriptor, style, promptText.trim()].filter(Boolean);
      const finalPrompt = parts.join('\n\n');
      const payload = model.buildInput({
        prompt: finalPrompt,
        aspectRatio: aspectRatio || 'auto',
        resolution: resolution || '1K',
        referenceImageUrls: refUrls,
      });
      const upstream = await fetch(`${KIE_BASE}/jobs/createTask`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${KIE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      const data = await upstream.json();
      if (!upstream.ok || data.code !== 200) {
        throw new Error(data.msg || 'Kie.ai hat den Task abgelehnt.');
      }
      return { taskId: data.data.taskId, modelUsed: payload.model };
    }

    const result = {};

    try {
      result.start = await runVariant(promptStart);
    } catch (err) {
      result.start = { error: err.message };
    }

    if (promptEnd && promptEnd.trim()) {
      try {
        result.end = await runVariant(promptEnd);
      } catch (err) {
        result.end = { error: err.message };
      }
    }

    res.json(result);
  } catch (err) {
    console.error('Generate-Pair-Fehler:', err);
    res.status(500).json({ error: 'Generierung fehlgeschlagen (Server-Fehler).' });
  }
});

// Prompt generieren: aus einem hochgeladenen Bild, aus einer frei
// eingetippten Idee, oder aus beidem zusammen.
app.post('/api/generate-prompt', requireAccess, async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY ist auf dem Server nicht gesetzt.' });
    }
    const { base64Data, ideaText, styleHint, buildingBlocks, wantsNovelPerspective } = req.body || {};
    const hasImage = !!base64Data;
    const hasIdea = !!(ideaText && ideaText.trim());
    if (!hasImage && !hasIdea) {
      return res.status(400).json({ error: 'Bitte ein Bild hochladen oder eine Idee eingeben.' });
    }

    const styleLine = styleHint && styleHint.trim()
      ? styleHint.trim()
      : 'düster-mystische Lichtstimmung, cineastisch, extrem realistische Gesichter und Ausdrücke, keine glatte "KI-Optik"';

    const blocks = Array.isArray(buildingBlocks) ? buildingBlocks.filter((b) => b && b.trim()) : [];
    const blockLine = blocks.length
      ? ` Baue außerdem zwingend diese Vorgaben ein, wörtlich oder sinngemäß eingewoben in die Beschreibung: ${blocks.join('; ')}.`
      : '';
    const novelLine = wantsNovelPerspective
      ? ' Erfinde zusätzlich eine besondere, ungewöhnliche Kamera-Perspektive oder Bildkomposition, die man in gewöhnlichen Bildern so kaum sieht — etwas Überraschendes, das trotzdem stimmig zur Szene passt und sie nicht sabotiert. Beschreibe diese Perspektive konkret und technisch im Prompt (Kamerastandort, Blickwinkel, was dadurch ins Bild oder aus dem Bild rückt).'
      : '';

    let task;
    if (hasImage && hasIdea) {
      task = 'Nutze das hochgeladene Bild als visuelle Grundlage UND die zusätzliche Idee/Anweisung des Nutzers, um daraus einen einzigen, stimmigen Prompt zu formen.';
    } else if (hasImage) {
      task = 'Beschreibe das hochgeladene Bild vollständig als Bildgenerierungs-Prompt.';
    } else {
      task = 'Der Nutzer hat noch kein fertiges Bild, sondern nur eine grobe, evtl. stichwortartige oder deutschsprachige Idee. Formuliere daraus einen vollständig ausgearbeiteten, konkreten Bildgenerierungs-Prompt (erfinde plausible Details für Komposition, Licht, Kleidung etc., wo die Idee es offen lässt).';
    }

    const systemPrompt =
      'Du bist ein erfahrener Prompt-Autor fuer KI-Bildgenerierung (u.a. Nano Banana Pro, Flux-2, GPT Image 2). ' +
      task + ' ' +
      'Der fertige Prompt ist englischsprachig, sehr detailliert: Komposition, Personen (Ausdruck, Kleidung, Haltung), ' +
      'Hintergrund/Umgebung, Licht und Kamera/Objektiv-Look. ' +
      `Gewuenschter Stil: ${styleLine}.` +
      blockLine +
      novelLine +
      ' Antworte NUR mit dem fertigen Prompt-Text, ohne Einleitung, ohne Anfuehrungszeichen, ohne Markdown-Formatierung.';

    const content = [];
    if (hasImage) {
      const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(base64Data);
      if (!match) return res.status(400).json({ error: 'Ungültiges Bildformat.' });
      const [, mediaType, base64] = match;
      content.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
    }
    content.push({
      type: 'text',
      text: hasIdea ? `Idee/Anweisung: ${ideaText.trim()}` : 'Beschreibe dieses Bild als Bildgenerierungs-Prompt.',
    });

    const upstream = await fetch(ANTHROPIC_BASE, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 700,
        system: systemPrompt,
        messages: [{ role: 'user', content }],
      }),
    });
    const data = await upstream.json();
    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: data.error?.message || 'Claude-Anfrage fehlgeschlagen.' });
    }
    const text = (data.content || [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();
    res.json({ prompt: text });
  } catch (err) {
    console.error('Generate-Prompt-Fehler:', err);
    res.status(500).json({ error: 'Prompt-Erstellung fehlgeschlagen (Server-Fehler).' });
  }
});

// Task-Status abfragen (wird pro Bild – Start bzw. Ende – einzeln gepollt)
app.get('/api/status/:taskId', requireAccess, async (req, res) => {
  try {
    const { taskId } = req.params;
    const upstream = await fetch(`${KIE_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${KIE_API_KEY}` },
    });
    const data = await upstream.json();
    if (!upstream.ok || !data.data) {
      return res.status(upstream.status || 500).json({ error: data.msg || 'Status konnte nicht geladen werden.' });
    }

    const d = data.data;
    let resultUrls = [];
    if (d.state === 'success' && d.resultJson) {
      try {
        resultUrls = JSON.parse(d.resultJson).resultUrls || [];
      } catch (e) {
        // resultJson unerwartet formatiert - ignorieren, resultUrls bleibt leer
      }
    }

    res.json({
      state: d.state, // waiting | queuing | generating | success | fail
      progress: d.progress ?? null,
      resultUrls,
      failMsg: d.failMsg || null,
      creditsConsumed: d.creditsConsumed ?? null,
    });
  } catch (err) {
    console.error('Status-Fehler:', err);
    res.status(500).json({ error: 'Status konnte nicht geladen werden (Server-Fehler).' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`kie-image-studio laeuft auf Port ${PORT}`);
});
