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

if (!KIE_API_KEY) {
  console.warn(
    '[WARNUNG] KIE_API_KEY ist nicht gesetzt. Bitte in .env oder in den ' +
      'Render-Environment-Variablen eintragen, sonst schlagen alle Anfragen an Kie.ai fehl.'
  );
}

const KIE_BASE = 'https://api.kie.ai/api/v1';
const KIE_UPLOAD_BASE = 'https://kieai.redpandaai.co/api';

// ---------------------------------------------------------------------------
// Seitenverhaeltnisse, die im Interface zur Auswahl stehen
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

// Ideogram nutzt statt aspect_ratio ein "image_size"-Enum. Beste bekannte
// Zuordnung – falls Kie.ai das Enum aendert, hier anpassen.
function ideogramSizeFromRatio(ratio) {
  const map = {
    auto: 'square_hd',
    '1:1': 'square_hd',
    '16:9': 'landscape_16_9',
    '9:16': 'portrait_16_9',
    '4:3': 'landscape_4_3',
    '3:4': 'portrait_4_3',
    '21:9': 'landscape_16_9',
  };
  return map[ratio] || 'square_hd';
}

// ---------------------------------------------------------------------------
// Modell-Registry – einzige Quelle der Wahrheit fuer Backend UND Frontend.
// Jedes Modell weiss selbst, wie es sein Kie.ai-Request baut (Text- oder
// Bild-zu-Bild-Variante je nachdem, ob Referenzbilder vorliegen).
// ---------------------------------------------------------------------------
const MODELS = [
  {
    key: 'nano-banana-pro',
    label: 'Nano Banana Pro',
    vendor: 'Google',
    blurb:
      'Der Allrounder: Text-zu-Bild und Bearbeitung mit mehreren Referenzbildern in einem Modell, starke Textwiedergabe im Bild.',
    maxReferenceImages: 6,
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
    blurb: 'Vielseitig einsetzbar – gut fuer Illustrationen, Icons und Bildvarianten.',
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
  {
    key: 'seedream-5-lite',
    label: 'Seedream 5.0 Lite',
    vendor: 'ByteDance',
    blurb: 'Hohe Detailtreue und gute Textdarstellung im Bild, bis zu 6 Referenzbilder.',
    maxReferenceImages: 6,
    supportsResolution: false,
    buildInput(ctx) {
      if (ctx.referenceImageUrls.length > 0) {
        return {
          model: 'seedream/5-lite-image-to-image',
          input: {
            prompt: ctx.prompt,
            image_urls: ctx.referenceImageUrls,
            aspect_ratio: ctx.aspectRatio,
            quality: 'basic',
            nsfw_checker: false,
          },
        };
      }
      return {
        model: 'seedream/5-lite-text-to-image',
        input: { prompt: ctx.prompt, aspect_ratio: ctx.aspectRatio, quality: 'basic', nsfw_checker: false },
      };
    },
  },
  {
    key: 'ideogram-v3',
    label: 'Ideogram V3',
    vendor: 'Ideogram',
    blurb: 'Spezialist fuer Typografie, Logos und Layouts – gut lesbarer Text im Bild.',
    maxReferenceImages: 1,
    supportsResolution: false,
    buildInput(ctx) {
      const image_size = ideogramSizeFromRatio(ctx.aspectRatio);
      if (ctx.referenceImageUrls.length > 0) {
        return {
          model: 'ideogram/v3-remix',
          input: {
            prompt: ctx.prompt,
            image_url: ctx.referenceImageUrls[0],
            rendering_speed: 'BALANCED',
            style: 'AUTO',
            expand_prompt: true,
            image_size,
            num_images: '1',
          },
        };
      }
      return {
        model: 'ideogram/v3-text-to-image',
        input: {
          prompt: ctx.prompt,
          rendering_speed: 'BALANCED',
          style: 'AUTO',
          expand_prompt: true,
          image_size,
        },
      };
    },
  },
  {
    key: 'grok-imagine',
    label: 'Grok Imagine',
    vendor: 'xAI',
    blurb: 'Kraeftige, stilisierte Bilder mit hoher Prompt-Treue.',
    maxReferenceImages: 1,
    supportsResolution: false,
    buildInput(ctx) {
      if (ctx.referenceImageUrls.length > 0) {
        return {
          model: 'grok-imagine/image-to-image',
          input: { prompt: ctx.prompt, image_urls: [ctx.referenceImageUrls[0]], nsfw_checker: false },
        };
      }
      return {
        model: 'grok-imagine/text-to-image',
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
  });
});

// Referenzbild hochladen: Browser schickt Base64, wir reichen es an Kie.ai
// weiter und geben nur die entstandene URL zurueck.
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

// Generierung anstossen
app.post('/api/generate', requireAccess, async (req, res) => {
  try {
    const { modelKey, prompt, aspectRatio, resolution, referenceImageUrls } = req.body || {};
    const model = findModel(modelKey);
    if (!model) return res.status(400).json({ error: 'Unbekanntes Modell.' });
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt fehlt.' });

    const refs = Array.isArray(referenceImageUrls) ? referenceImageUrls.slice(0, model.maxReferenceImages) : [];
    const payload = model.buildInput({
      prompt: prompt.trim(),
      aspectRatio: aspectRatio || 'auto',
      resolution: resolution || '1K',
      referenceImageUrls: refs,
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
      return res.status(upstream.status && upstream.status !== 200 ? upstream.status : 400).json({
        error: data.msg || 'Kie.ai hat den Task abgelehnt.',
      });
    }
    res.json({ taskId: data.data.taskId, modelUsed: payload.model });
  } catch (err) {
    console.error('Generate-Fehler:', err);
    res.status(500).json({ error: 'Generierung fehlgeschlagen (Server-Fehler).' });
  }
});

// Task-Status abfragen
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
