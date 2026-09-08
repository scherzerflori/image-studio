// kie-image-studio – app.js
// Reines Vanilla JS, kein Build-Schritt. Spricht ausschliesslich mit dem
// eigenen Server (/api/...), niemals direkt mit api.kie.ai.

const HISTORY_KEY = 'kis_history';
const PASSWORD_KEY = 'kis_password';
const MAX_HISTORY = 60;

let MODELS = [];
let ASPECT_RATIOS = [];
let RESOLUTIONS = [];
let currentModel = null;
let refImages = []; // { id, previewUrl, url, status: 'uploading'|'done'|'error' }
let busyCount = 0; // Anzahl laufender Generierungen (fuer Statuszeile)

const $ = (sel) => document.querySelector(sel);

function authHeaders(extra = {}) {
  const pw = sessionStorage.getItem(PASSWORD_KEY) || '';
  return { 'x-access-password': pw, ...extra };
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  wireLogin();
  wireControls();
  wireDropzone();
  wireGenerate();
  boot();
});

async function boot() {
  const ok = await loadModels();
  if (ok) {
    $('#login-overlay').classList.add('hidden');
    $('#app').classList.remove('hidden');
    hydrateHistory();
  } else {
    $('#login-overlay').classList.remove('hidden');
  }
}

async function loadModels() {
  try {
    const res = await fetch('/api/models', { headers: authHeaders() });
    if (res.status === 401) return false;
    const data = await res.json();
    MODELS = data.models;
    ASPECT_RATIOS = data.aspectRatios;
    RESOLUTIONS = data.resolutions;
    populateModelSelect();
    populateAspectRatios();
    populateResolutions();
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

function wireLogin() {
  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const password = $('#login-password').value;
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        sessionStorage.setItem(PASSWORD_KEY, password);
        $('#login-error').classList.add('hidden');
        boot();
      } else {
        $('#login-error').classList.remove('hidden');
      }
    } catch (err) {
      $('#login-error').textContent = 'Verbindung fehlgeschlagen.';
      $('#login-error').classList.remove('hidden');
    }
  });
}

// ---------------------------------------------------------------------------
// Steuerelemente befüllen
// ---------------------------------------------------------------------------

function populateModelSelect() {
  const sel = $('#model-select');
  sel.innerHTML = '';
  MODELS.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.key;
    opt.textContent = `${m.label} — ${m.vendor}`;
    sel.appendChild(opt);
  });
  sel.value = MODELS[0].key;
  applyModel(MODELS[0]);
}

function populateAspectRatios() {
  const sel = $('#aspect-ratio');
  sel.innerHTML = '';
  ASPECT_RATIOS.forEach((r) => {
    const opt = document.createElement('option');
    opt.value = r.value;
    opt.textContent = r.label;
    sel.appendChild(opt);
  });
  sel.value = 'auto';
}

function populateResolutions() {
  const sel = $('#resolution');
  sel.innerHTML = '';
  RESOLUTIONS.forEach((r) => {
    const opt = document.createElement('option');
    opt.value = r.value;
    opt.textContent = r.label;
    sel.appendChild(opt);
  });
  sel.value = '1K';
}

function applyModel(model) {
  currentModel = model;
  $('#model-blurb').textContent = model.blurb;
  $('#resolution-wrap').classList.toggle('hidden', !model.supportsResolution);
  $('#ref-limit').textContent = model.maxReferenceImages > 0 ? `(max. ${model.maxReferenceImages})` : '(nicht unterstützt)';
  $('#dropzone').classList.toggle('hidden', model.maxReferenceImages === 0);
  if (refImages.length > model.maxReferenceImages) {
    refImages = refImages.slice(0, model.maxReferenceImages);
    renderRefThumbs();
  }
}

function wireControls() {
  $('#model-select').addEventListener('change', (e) => {
    const model = MODELS.find((m) => m.key === e.target.value);
    applyModel(model);
  });
}

// ---------------------------------------------------------------------------
// Referenzbilder: Auswahl, Upload, Vorschau
// ---------------------------------------------------------------------------

function wireDropzone() {
  const zone = $('#dropzone');
  const input = $('#file-input');

  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    handleFiles(input.files);
    input.value = '';
  });

  ['dragover', 'dragenter'].forEach((evt) =>
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.add('dragover');
    })
  );
  ['dragleave', 'drop'].forEach((evt) =>
    zone.addEventListener(evt, (e) => {
      e.preventDefault();
      zone.classList.remove('dragover');
    })
  );
  zone.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  });
}

function handleFiles(fileList) {
  if (!currentModel || currentModel.maxReferenceImages === 0) return;
  const remaining = currentModel.maxReferenceImages - refImages.length;
  const files = Array.from(fileList).slice(0, Math.max(remaining, 0));
  files.forEach(uploadReferenceImage);
}

function uploadReferenceImage(file) {
  const id = `ref-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const entry = { id, previewUrl: null, url: null, status: 'uploading' };
  refImages.push(entry);
  renderRefThumbs();

  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result;
    entry.previewUrl = dataUrl;
    renderRefThumbs();
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ base64Data: dataUrl, fileName: file.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload fehlgeschlagen');
      entry.url = data.url;
      entry.status = 'done';
    } catch (err) {
      console.error(err);
      entry.status = 'error';
    }
    renderRefThumbs();
  };
  reader.readAsDataURL(file);
}

function addReferenceFromUrl(url) {
  if (!currentModel || currentModel.maxReferenceImages === 0) return;
  if (refImages.length >= currentModel.maxReferenceImages) {
    refImages.shift();
  }
  refImages.push({
    id: `ref-${Date.now()}`,
    previewUrl: url,
    url,
    status: 'done',
  });
  renderRefThumbs();
}

function renderRefThumbs() {
  const wrap = $('#ref-thumbs');
  wrap.innerHTML = '';
  refImages.forEach((entry) => {
    const div = document.createElement('div');
    div.className = 'ref-thumb' + (entry.status === 'uploading' ? ' uploading' : '');
    if (entry.previewUrl) {
      const img = document.createElement('img');
      img.src = entry.previewUrl;
      div.appendChild(img);
    }
    if (entry.status === 'uploading') {
      const spinner = document.createElement('div');
      spinner.className = 'ref-thumb-spinner';
      spinner.textContent = '…';
      div.appendChild(spinner);
    }
    if (entry.status === 'error') {
      const spinner = document.createElement('div');
      spinner.className = 'ref-thumb-spinner';
      spinner.textContent = '✕';
      div.appendChild(spinner);
    }
    const remove = document.createElement('button');
    remove.className = 'ref-thumb-remove';
    remove.textContent = '×';
    remove.title = 'Entfernen';
    remove.addEventListener('click', () => {
      refImages = refImages.filter((r) => r.id !== entry.id);
      renderRefThumbs();
    });
    div.appendChild(remove);
    wrap.appendChild(div);
  });
}

// ---------------------------------------------------------------------------
// Generierung
// ---------------------------------------------------------------------------

function wireGenerate() {
  $('#generate-btn').addEventListener('click', startGeneration);
}

function setStatus(text) {
  $('#topbar-status').textContent = text;
}

async function startGeneration() {
  const prompt = $('#prompt').value.trim();
  const errorEl = $('#generate-error');
  errorEl.classList.add('hidden');

  if (!prompt) {
    errorEl.textContent = 'Bitte einen Prompt eingeben.';
    errorEl.classList.remove('hidden');
    return;
  }

  const aspectRatio = $('#aspect-ratio').value;
  const resolution = $('#resolution').value;
  const referenceImageUrls = refImages.filter((r) => r.status === 'done').map((r) => r.url);

  const btn = $('#generate-btn');
  btn.disabled = true;
  busyCount++;
  setStatus(`entwickelt … (${busyCount})`);

  const card = createPendingCard({ modelLabel: currentModel.label, prompt });
  $('#results-grid').prepend(card.el);

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        modelKey: currentModel.key,
        prompt,
        aspectRatio,
        resolution,
        referenceImageUrls,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generierung fehlgeschlagen.');

    btn.disabled = false; // sofort wieder freigeben, es darf parallel weitergehen
    pollTask(data.taskId, card, { modelLabel: currentModel.label, prompt });
  } catch (err) {
    console.error(err);
    finishCardAsError(card, err.message || 'Unbekannter Fehler.');
    busyCount = Math.max(0, busyCount - 1);
    setStatus(busyCount > 0 ? `entwickelt … (${busyCount})` : 'bereit');
    btn.disabled = false;
    errorEl.textContent = err.message || 'Generierung fehlgeschlagen.';
    errorEl.classList.remove('hidden');
  }
}

function pollTask(taskId, card, meta) {
  let delay = 2000;
  let elapsed = 0;
  const maxElapsed = 6 * 60 * 1000;
  let failures = 0;

  async function tick() {
    try {
      const res = await fetch(`/api/status/${taskId}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Status unbekannt.');
      failures = 0;

      if (data.state === 'success') {
        const url = data.resultUrls?.[0];
        if (url) {
          finishCardAsDone(card, { ...meta, url, taskId });
          saveToHistory({ ...meta, url, taskId, createdAt: Date.now() });
        } else {
          finishCardAsError(card, 'Fertig gemeldet, aber keine Bild-URL erhalten.');
        }
        settle();
        return;
      }
      if (data.state === 'fail') {
        finishCardAsError(card, data.failMsg || 'Task fehlgeschlagen.');
        settle();
        return;
      }

      // waiting / queuing / generating -> weiter pollen
      const fillPct = typeof data.progress === 'number' ? Math.min(Math.max(data.progress, 5), 95) : Math.min(elapsed / 1500, 90);
      const fillEl = card.el.querySelector('.developing-fill');
      if (fillEl) fillEl.style.height = `${fillPct}%`;
      const labelEl = card.el.querySelector('.card-media-label');
      if (labelEl) labelEl.textContent = typeof data.progress === 'number' ? `wird entwickelt … ${data.progress}%` : 'wird entwickelt …';

      elapsed += delay;
      if (elapsed > maxElapsed) {
        finishCardAsError(card, `Zeitüberschreitung. Task-ID für später: ${taskId}`);
        settle();
        return;
      }
      delay = Math.min(delay * 1.15, 6000);
      setTimeout(tick, delay);
    } catch (err) {
      failures++;
      if (failures > 5) {
        finishCardAsError(card, 'Verbindung zum Server verloren.');
        settle();
        return;
      }
      setTimeout(tick, 4000);
    }
  }

  function settle() {
    busyCount = Math.max(0, busyCount - 1);
    setStatus(busyCount > 0 ? `entwickelt … (${busyCount})` : 'bereit');
  }

  setTimeout(tick, delay);
}

// ---------------------------------------------------------------------------
// Karten (Kontaktbogen)
// ---------------------------------------------------------------------------

function createPendingCard({ modelLabel, prompt }) {
  const node = $('#tpl-card-pending').content.cloneNode(true);
  const el = node.querySelector('.card');
  el.querySelector('.card-model').textContent = modelLabel;
  el.querySelector('.card-state').textContent = 'wartet …';
  el.querySelector('.card-prompt').textContent = prompt;
  return { el };
}

function finishCardAsDone(card, { modelLabel, prompt, url }) {
  const node = $('#tpl-card-done').content.cloneNode(true);
  const newCard = node.querySelector('.card');
  newCard.querySelector('.card-img').src = url;
  newCard.querySelector('.card-model').textContent = modelLabel;
  newCard.querySelector('.card-prompt').textContent = prompt;
  const dl = newCard.querySelector('.card-download');
  dl.href = url;
  dl.setAttribute('download', '');
  newCard.querySelector('.card-use-ref').addEventListener('click', () => addReferenceFromUrl(url));
  card.el.replaceWith(newCard);
  card.el = newCard;
}

function finishCardAsError(card, message) {
  const node = $('#tpl-card-error').content.cloneNode(true);
  const newCard = node.querySelector('.card');
  newCard.querySelector('.card-model').textContent = currentModel ? currentModel.label : '';
  newCard.querySelector('.card-prompt').textContent = card.el.querySelector('.card-prompt')?.textContent || '';
  newCard.querySelector('.card-error-msg').textContent = message;
  card.el.replaceWith(newCard);
  card.el = newCard;
}

// ---------------------------------------------------------------------------
// Verlauf (localStorage, rein lokal auf diesem Gerät)
// ---------------------------------------------------------------------------

function saveToHistory(entry) {
  const list = readHistory();
  list.unshift(entry);
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, MAX_HISTORY)));
}

function readHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function hydrateHistory() {
  const list = readHistory();
  list.forEach((entry) => {
    const card = createPendingCard({ modelLabel: entry.modelLabel, prompt: entry.prompt });
    $('#results-grid').appendChild(card.el);
    finishCardAsDone(card, entry);
  });
}
