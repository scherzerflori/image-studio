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
// Referenzbild-Kategorien. Bewusst einfach gehalten: zwei Eimer statt vier -
// "was soll im Bild auftauchen" und "welchen Look/Stimmung soll es haben".
// maxCount ist die Anzahl an Plaetzen im Interface, unabhaengig vom
// technischen Limit des jeweiligen Modells (siehe maxReferenceImages je
// Modell weiter unten).
// ---------------------------------------------------------------------------
const REFERENCE_CATEGORIES = [
  { key: 'subject', label: 'Personen & Dinge', maxCount: 8, hasName: false },
  { key: 'style', label: 'Stil & Look', maxCount: 4, hasName: false },
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
    const label = `${categoryLabel(ref.category)} ${counters[ref.category]}`;
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
    // Bestaetigt von Florian direkt im Kie.ai-Dashboard (09/2026): Kie.ai
    // schreibt den Punkt in "2.5" als Bindestrich, komplett im selben
    // durchgehenden Bindestrich-Schema wie GPT Image 2. Image-to-Image ist
    // damit belegt; Text-to-Image ist nach demselben Muster abgeleitet
    // (noch nicht einzeln bestaetigt).
    key: 'gpt-image-2.5-flare',
    label: 'GPT Image 2.5 Flare',
    vendor: 'OpenAI',
    blurb: 'Nachfolger von GPT Image 2 – spuerbar schneller bei gleichem Preis, Standardwahl fuer die meisten Bilder.',
    maxReferenceImages: 4,
    supportsResolution: false,
    buildInput(ctx) {
      if (ctx.referenceImageUrls.length > 0) {
        return {
          model: 'gpt-image-2-5-flare-image-to-image',
          input: { prompt: ctx.prompt, input_urls: ctx.referenceImageUrls, aspect_ratio: ctx.aspectRatio, quality: 'high' },
        };
      }
      return {
        model: 'gpt-image-2-5-flare-text-to-image',
        input: { prompt: ctx.prompt, aspect_ratio: ctx.aspectRatio, quality: 'high' },
      };
    },
  },
  {
    key: 'gpt-image-2.5-sunburst',
    label: 'GPT Image 2.5 Sunburst',
    vendor: 'OpenAI',
    blurb: 'Praezisions-Variante fuer kontrollierte Bearbeitungen (z.B. "nur die Jacke aendern, Rest exakt beibehalten"), etwas langsamer als Flare.',
    maxReferenceImages: 4,
    supportsResolution: false,
    buildInput(ctx) {
      if (ctx.referenceImageUrls.length > 0) {
        return {
          model: 'gpt-image-2-5-sunburst-image-to-image',
          input: { prompt: ctx.prompt, input_urls: ctx.referenceImageUrls, aspect_ratio: ctx.aspectRatio, quality: 'high' },
        };
      }
      return {
        model: 'gpt-image-2-5-sunburst-text-to-image',
        input: { prompt: ctx.prompt, aspect_ratio: ctx.aspectRatio, quality: 'high' },
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
  {
    key: 'imagen4',
    label: 'Google Imagen4',
    vendor: 'Google',
    blurb: 'Sehr sauberes, natuerliches Fotolook-Ergebnis. Reines Text-zu-Bild, keine Referenzbilder.',
    maxReferenceImages: 0,
    supportsResolution: false,
    buildInput(ctx) {
      return {
        model: 'google/imagen4',
        input: { prompt: ctx.prompt, negative_prompt: '', aspect_ratio: ctx.aspectRatio === 'auto' ? '1:1' : ctx.aspectRatio, seed: '' },
      };
    },
  },
  {
    key: 'imagen4-ultra',
    label: 'Google Imagen4 Ultra',
    vendor: 'Google',
    blurb: 'Wie Imagen4, aber hoechste Qualitaetsstufe – langsamer und teurer. Reines Text-zu-Bild, keine Referenzbilder.',
    maxReferenceImages: 0,
    supportsResolution: false,
    buildInput(ctx) {
      return {
        model: 'google/imagen4-ultra',
        input: { prompt: ctx.prompt, negative_prompt: '', aspect_ratio: ctx.aspectRatio === 'auto' ? '1:1' : ctx.aspectRatio, seed: '' },
      };
    },
  },
  {
    key: 'qwen3',
    label: 'Qwen3',
    vendor: 'Alibaba',
    blurb: 'Vielseitig, gut fuer asiatische Schriftzeichen/Text im Bild, bis zu 3 Referenzbilder.',
    maxReferenceImages: 3,
    supportsResolution: true,
    buildInput(ctx) {
      const resolution1K2K = ctx.resolution === '2K' ? '2K' : '1K';
      if (ctx.referenceImageUrls.length > 0) {
        return {
          model: 'qwen3/image-to-image',
          input: {
            prompt: ctx.prompt,
            image_urls: ctx.referenceImageUrls,
            image_size: ctx.aspectRatio === 'auto' ? '1:1' : ctx.aspectRatio,
            resolution: resolution1K2K,
            output_format: 'png',
          },
        };
      }
      return {
        model: 'qwen3/text-to-image',
        input: {
          prompt: ctx.prompt,
          image_size: ctx.aspectRatio === 'auto' ? '1:1' : ctx.aspectRatio,
          resolution: resolution1K2K,
          output_format: 'png',
        },
      };
    },
  },
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

function findModel(key) {
  return MODELS.find((m) => m.key === key);
}

// ---------------------------------------------------------------------------
// Video-Modell-Registry. Getrennt von der Bild-Registry, da Video-Modelle
// andere Parameter brauchen (Dauer, Ton, Start-/Endbild statt Referenzbilder).
// Quelle: docs.kie.ai (Bytedance Seedance 2.0 Fast, Kling 3.0), Stand
// September 2026.
// ---------------------------------------------------------------------------
const VIDEO_ASPECT_RATIOS = [
  { value: '16:9', label: 'Breitbild (16:9)' },
  { value: '9:16', label: 'Hochformat (9:16)' },
  { value: '1:1', label: 'Quadratisch (1:1)' },
];

const VIDEO_MODELS = [
  {
    key: 'seedance-2-fast',
    label: 'Seedance 2.0 Fast',
    vendor: 'ByteDance',
    blurb: 'Sauberes Start- und Endbild als getrennte Parameter, bis 15s, optional Ton.',
    supportsStartEnd: true,
    supportsElements: false,
    supportsAudio: true,
    maxReferenceImages: 9,
    durations: [5, 10, 15],
    buildInput(ctx) {
      const input = {
        prompt: ctx.prompt,
        aspect_ratio: ctx.aspectRatio,
        resolution: '720p',
        duration: ctx.duration,
        generate_audio: !!ctx.generateAudio,
      };
      if (ctx.startImageUrl && ctx.endImageUrl) {
        input.first_frame_url = ctx.startImageUrl;
        input.last_frame_url = ctx.endImageUrl;
      } else if (ctx.startImageUrl) {
        input.first_frame_url = ctx.startImageUrl;
      } else if (ctx.referenceImageUrls.length) {
        input.reference_image_urls = ctx.referenceImageUrls;
      }
      return { model: 'bytedance/seedance-2-fast', input };
    },
  },
  {
    key: 'kling-3',
    label: 'Kling 3.0',
    vendor: 'Kuaishou',
    blurb: 'Benannte Element-Referenzen für Charaktere/Objekte (im Prompt mit @name ansprechen), optional Ton.',
    supportsStartEnd: false,
    supportsElements: true,
    supportsAudio: true,
    maxReferenceImages: 1,
    durations: [5, 10],
    buildInput(ctx) {
      const input = {
        prompt: ctx.prompt,
        aspect_ratio: ctx.aspectRatio,
        duration: String(ctx.duration),
        mode: 'std',
        sound: !!ctx.generateAudio,
      };
      if (ctx.startImageUrl) input.image_urls = [ctx.startImageUrl];
      if (ctx.elements.length) {
        input.kling_elements = ctx.elements.map((el) => ({
          name: el.name,
          description: el.description || '',
          element_input_urls: [el.url],
        }));
      }
      return { model: 'kling-3.0/video', input };
    },
  },
];

function findVideoModel(key) {
  return VIDEO_MODELS.find((m) => m.key === key);
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
    videoModels: VIDEO_MODELS.map((m) => ({
      key: m.key,
      label: m.label,
      vendor: m.vendor,
      blurb: m.blurb,
      supportsStartEnd: m.supportsStartEnd,
      supportsElements: m.supportsElements,
      supportsAudio: m.supportsAudio,
      maxReferenceImages: m.maxReferenceImages,
      durations: m.durations,
    })),
    videoAspectRatios: VIDEO_ASPECT_RATIOS,
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

// Video generieren: Text-zu-Video, Start-/Endbild-zu-Video (Seedance), oder
// mit benannten Element-Referenzen (Kling).
app.post('/api/generate-video', requireAccess, async (req, res) => {
  try {
    const {
      modelKey,
      prompt,
      aspectRatio,
      duration,
      generateAudio,
      startImageUrl,
      endImageUrl,
      referenceImageUrls,
      elements,
    } = req.body || {};
    const model = findVideoModel(modelKey);
    if (!model) return res.status(400).json({ error: 'Unbekanntes Video-Modell.' });
    if (!prompt || !prompt.trim()) return res.status(400).json({ error: 'Prompt fehlt.' });

    const payload = model.buildInput({
      prompt: prompt.trim(),
      aspectRatio: aspectRatio || '16:9',
      duration: duration || model.durations[0],
      generateAudio,
      startImageUrl: startImageUrl || null,
      endImageUrl: endImageUrl || null,
      referenceImageUrls: Array.isArray(referenceImageUrls) ? referenceImageUrls.slice(0, model.maxReferenceImages) : [],
      elements: Array.isArray(elements) ? elements.slice(0, 4) : [],
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
        error: data.msg || 'Kie.ai hat den Video-Task abgelehnt.',
      });
    }
    res.json({ taskId: data.data.taskId, modelUsed: payload.model });
  } catch (err) {
    console.error('Generate-Video-Fehler:', err);
    res.status(500).json({ error: 'Video-Generierung fehlgeschlagen (Server-Fehler).' });
  }
});

// Video-Prompt generieren: Start-/Endbild (optional) plus eigene Idee, Claude
// beschreibt daraus eine Bewegung statt nur ein Standbild.
app.post('/api/generate-video-prompt', requireAccess, async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY ist auf dem Server nicht gesetzt.' });
    }
    const { startImage, endImage, ideaText, styleHint, duration } = req.body || {};

    async function toBase64DataUrl(image) {
      if (!image) return null;
      if (image.startsWith('data:')) return image;
      const resp = await fetch(image);
      if (!resp.ok) return null;
      const buf = await resp.arrayBuffer();
      const contentType = (resp.headers.get('content-type') || 'image/png').split(';')[0];
      const SUPPORTED = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
      const mediaType = SUPPORTED.includes(contentType) ? contentType : 'image/png';
      return `data:${mediaType};base64,${Buffer.from(buf).toString('base64')}`;
    }

    const startImageBase64 = await toBase64DataUrl(startImage);
    const endImageBase64 = await toBase64DataUrl(endImage);
    const hasStart = !!startImageBase64;
    const hasEnd = !!endImageBase64;
    const hasIdea = !!(ideaText && ideaText.trim());
    if (!hasStart && !hasEnd && !hasIdea) {
      return res.status(400).json({ error: 'Bitte mindestens ein Bild oder eine Idee angeben.' });
    }

    const styleLine = styleHint && styleHint.trim()
      ? styleHint.trim()
      : 'düster-mystische Lichtstimmung, cineastisch, extrem realistische Bewegungen';
    const durationLine = duration
      ? ` Der Clip ist etwa ${duration} Sekunden lang – die beschriebene Bewegung muss in dieser Zeit plausibel ablaufen, nicht zu viel hineinpacken.`
      : '';

    let task;
    if (hasStart && hasEnd) {
      task = 'Das erste Bild zeigt den Anfang des Videos, das zweite Bild das Ende. Beschreibe die Kamerabewegung und Handlung, die glaubhaft von Anfang zu Ende führt.';
    } else if (hasStart) {
      task = 'Das Bild zeigt den Startpunkt des Videos. Beschreibe, welche Bewegung/Handlung von hier ausgehend passiert.';
    } else {
      task = 'Es gibt noch kein Bild, nur eine Idee. Formuliere daraus eine konkrete Bewegungsbeschreibung für ein KI-Video.';
    }

    const systemPrompt =
      'Du bist ein erfahrener Prompt-Autor fuer KI-Videogenerierung (u.a. Seedance, Kling). ' +
      task + ' ' +
      'Der fertige Prompt ist englischsprachig, knapp und stichpunktartig (kurze Phrasen statt Fliesstext), ' +
      'beschreibt konkrete BEWEGUNG ueber Zeit (Kamera, Figuren, Umgebung), nicht nur ein Standbild.' +
      durationLine +
      ` Gewuenschter Stil: ${styleLine}. ` +
      'Antworte NUR mit dem fertigen Prompt-Text, ohne Einleitung, ohne Anfuehrungszeichen, ohne Markdown-Formatierung.';

    const content = [];
    if (hasStart) {
      const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(startImageBase64);
      if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
    }
    if (hasEnd) {
      const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(endImageBase64);
      if (m) content.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
    }
    content.push({
      type: 'text',
      text: hasIdea ? `Idee/Anweisung: ${ideaText.trim()}` : 'Beschreibe die Bewegung für dieses Video.',
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
        max_tokens: 500,
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
    console.error('Generate-Video-Prompt-Fehler:', err);
    res.status(500).json({ error: 'Video-Prompt-Erstellung fehlgeschlagen (Server-Fehler).' });
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
      'Der fertige Prompt ist englischsprachig, aber bewusst KNAPP und STICHPUNKTARTIG formuliert: kurze, ' +
      'praegnante Phrasen statt ausschweifender Fliesstext-Saetze, durch Kommas getrennt (Tag-Stil, keine ' +
      'vollstaendigen Saetze mit "the/a/is"). Deckt trotzdem alles Wesentliche ab: Komposition, Personen ' +
      '(Ausdruck, Kleidung, Haltung), Hintergrund/Umgebung, Licht, Kamera/Objektiv-Look. Lieber ein knappes, ' +
      'praezises Schlagwort als ein ausschweifender Nebensatz. ' +
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

// Fertiges Bild von Claude gezielt auf typische KI-Generierungsfehler prüfen
// lassen (zusätzliche/fehlende Finger, verformte Hände, unlesbarer Text, ...).
app.post('/api/check-image', requireAccess, async (req, res) => {
  try {
    if (!ANTHROPIC_API_KEY) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY ist auf dem Server nicht gesetzt.' });
    }
    const { imageUrl } = req.body || {};
    if (!imageUrl) return res.status(400).json({ error: 'imageUrl fehlt.' });

    const imgResp = await fetch(imageUrl);
    if (!imgResp.ok) return res.status(502).json({ error: 'Bild konnte nicht geladen werden (Link evtl. abgelaufen).' });
    const arrayBuffer = await imgResp.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const rawType = (imgResp.headers.get('content-type') || '').split(';')[0].trim();
    const mediaType = SUPPORTED_TYPES.includes(rawType) ? rawType : 'image/png';

    const systemPrompt =
      'Du pruefst KI-generierte Bilder auf typische KI-Generierungsfehler: zusaetzliche oder fehlende Finger, ' +
      'verformte oder verschmolzene Haende, asymmetrische oder verzerrte Gesichter, unlesbaren oder unsinnigen ' +
      'Text im Bild, doppelte oder verschmolzene Koerperteile, unmoegliche Anatomie, inkonsistente Schatten oder ' +
      'Spiegelungen, unmoegliche Objektplatzierungen. Antworte auf Deutsch, sehr knapp. Wenn dir nichts Konkretes ' +
      'auffaellt, antworte NUR mit dem einen Satz "Keine auffälligen Fehler erkannt.". Wenn dir etwas auffaellt, ' +
      'liste jeden Punkt in einer eigenen Zeile, beginnend mit "⚠ " und einer kurzen Ortsangabe, z.B. ' +
      '"⚠ rechte Hand hat sechs Finger". Keine Vermutungen ueber Unklares, keine allgemeinen Stil- oder ' +
      'Geschmackskommentare, nur klar erkennbare technische Fehler.';

    const upstream = await fetch(ANTHROPIC_BASE, {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 400,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
              { type: 'text', text: 'Prüfe dieses Bild auf KI-Generierungsfehler.' },
            ],
          },
        ],
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
    res.json({ report: text });
  } catch (err) {
    console.error('Check-Image-Fehler:', err);
    res.status(500).json({ error: 'Prüfung fehlgeschlagen (Server-Fehler).' });
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
