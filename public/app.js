// kie-image-studio – app.js
// Reines Vanilla JS, kein Build-Schritt. Spricht ausschliesslich mit dem
// eigenen Server (/api/...), niemals direkt mit api.kie.ai.

const HISTORY_KEY = 'kis_history';
const PASSWORD_KEY = 'kis_password';
const MAX_HISTORY = 40;

let MODELS = [];
let ASPECT_RATIOS = [];
let RESOLUTIONS = [];
let REFERENCE_CATEGORIES = [];
let currentModel = null;
let refState = {}; // { [categoryKey]: [ {name, url, previewUrl, status} ] }
let busyCount = 0;
let pendingUpload = null; // { category, index }

const $ = (sel) => document.querySelector(sel);

function authHeaders(extra = {}) {
  const pw = sessionStorage.getItem(PASSWORD_KEY) || '';
  return { 'x-access-password': pw, ...extra };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : str;
  return div.innerHTML;
}

function emptySlot() {
  return { name: '', url: null, previewUrl: null, status: 'empty' };
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const sharedFileInput = document.createElement('input');
sharedFileInput.type = 'file';
sharedFileInput.accept = 'image/png,image/jpeg,image/webp';
sharedFileInput.hidden = true;
document.body.appendChild(sharedFileInput);

document.addEventListener('DOMContentLoaded', () => {
  wireLogin();
  wireGenerate();
  wireRefClearAll();
  sharedFileInput.addEventListener('change', handleSharedFileChange);
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
    REFERENCE_CATEGORIES = data.referenceCategories;
    initRefState();
    populateModelSelect();
    populateAspectRatios();
    populateResolutions();
    renderReferenceSections();
    updateRefStatus();
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

function initRefState() {
  refState = {};
  REFERENCE_CATEGORIES.forEach((cat) => {
    refState[cat.key] = Array.from({ length: cat.maxCount }, emptySlot);
  });
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
// Modell / Seitenverhältnis / Auflösung
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
  sel.addEventListener('change', (e) => {
    applyModel(MODELS.find((m) => m.key === e.target.value));
  });
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
  renderReferenceSections();
  updateRefStatus();
}

// ---------------------------------------------------------------------------
// Referenzbild-Kategorien (Personen / Stimmung / Hintergrund / Gegenstände)
// ---------------------------------------------------------------------------

function getFlattenedFilledRefs() {
  const out = [];
  REFERENCE_CATEGORIES.forEach((cat) => {
    refState[cat.key].forEach((slot, index) => {
      if (slot.status === 'done') out.push({ category: cat.key, index, ...slot });
    });
  });
  return out;
}

function getIncludedRefs() {
  if (!currentModel) return [];
  return getFlattenedFilledRefs().slice(0, currentModel.maxReferenceImages);
}

function refLabel(ref) {
  const cat = REFERENCE_CATEGORIES.find((c) => c.key === ref.category);
  if (ref.category === 'person' && ref.name && ref.name.trim()) return `Person „${ref.name.trim()}"`;
  return `${cat ? cat.label : ref.category} ${ref.index + 1}`;
}

function updateRefStatus() {
  const el = $('#ref-status');
  if (!currentModel) return;
  const flattened = getFlattenedFilledRefs();
  const cap = currentModel.maxReferenceImages;

  if (flattened.length === 0) {
    el.textContent = `Keine Referenzbilder gewählt (Limit für ${currentModel.label}: ${cap}).`;
    el.classList.remove('warn');
    return;
  }
  if (flattened.length <= cap) {
    el.textContent = `${flattened.length} von max. ${cap} Referenzbildern für ${currentModel.label} befüllt.`;
    el.classList.remove('warn');
  } else {
    const excluded = flattened.slice(cap).map(refLabel).join(', ');
    el.textContent = `${cap} von ${flattened.length} befüllten Referenzbildern gehen an ${currentModel.label}. Nicht berücksichtigt: ${excluded}.`;
    el.classList.add('warn');
  }
}

function renderReferenceSections() {
  const container = $('#reference-sections');
  if (!container) return;
  container.innerHTML = '';
  if (!currentModel) return;

  const includedKeys = new Set(getIncludedRefs().map((r) => `${r.category}:${r.index}`));

  REFERENCE_CATEGORIES.forEach((cat) => {
    const section = document.createElement('div');
    section.className = 'ref-category';

    const label = document.createElement('div');
    label.className = 'ref-category-label';
    label.textContent = `${cat.label} (bis zu ${cat.maxCount})`;
    section.appendChild(label);

    const grid = document.createElement('div');
    grid.className = 'slot-grid';

    for (let i = 0; i < cat.maxCount; i++) {
      const slotState = refState[cat.key][i];
      const slotEl = document.createElement('div');
      slotEl.className = 'ref-slot';

      if (cat.hasName) {
        const nameInput = document.createElement('input');
        nameInput.className = 'ref-slot-name';
        nameInput.placeholder = `Name ${i + 1}`;
        nameInput.value = slotState.name || '';
        nameInput.addEventListener('input', (e) => {
          refState[cat.key][i].name = e.target.value;
        });
        slotEl.appendChild(nameInput);
      }

      const tile = document.createElement('div');
      tile.className = 'ref-slot-tile';
      if (slotState.status === 'done') tile.classList.add('filled');
      if (slotState.status === 'uploading') tile.classList.add('uploading');
      if (slotState.status === 'done' && !includedKeys.has(`${cat.key}:${i}`)) tile.classList.add('excluded');

      if (slotState.previewUrl) {
        const img = document.createElement('img');
        img.src = slotState.previewUrl;
        tile.appendChild(img);
      } else if (slotState.status !== 'uploading') {
        tile.textContent = '+';
      }

      if (slotState.status === 'done' || slotState.status === 'error') {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'ref-slot-remove';
        removeBtn.type = 'button';
        removeBtn.textContent = '×';
        removeBtn.title = 'Entfernen';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          refState[cat.key][i] = emptySlot();
          renderReferenceSections();
          updateRefStatus();
        });
        tile.appendChild(removeBtn);
      }

      if (slotState.status === 'empty') {
        tile.addEventListener('click', () => {
          pendingUpload = { category: cat.key, index: i };
          sharedFileInput.value = '';
          sharedFileInput.click();
        });
      }

      slotEl.appendChild(tile);
      grid.appendChild(slotEl);
    }

    section.appendChild(grid);
    container.appendChild(section);
  });
}

function handleSharedFileChange() {
  const file = sharedFileInput.files[0];
  if (!file || !pendingUpload) return;
  const { category, index } = pendingUpload;
  pendingUpload = null;

  refState[category][index].status = 'uploading';
  renderReferenceSections();

  const reader = new FileReader();
  reader.onload = async () => {
    const dataUrl = reader.result;
    refState[category][index].previewUrl = dataUrl;
    renderReferenceSections();
    try {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ base64Data: dataUrl, fileName: file.name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Upload fehlgeschlagen');
      refState[category][index].url = data.url;
      refState[category][index].status = 'done';
    } catch (err) {
      console.error(err);
      refState[category][index].status = 'error';
    }
    renderReferenceSections();
    updateRefStatus();
  };
  reader.readAsDataURL(file);
}

function wireRefClearAll() {
  $('#ref-clear-all').addEventListener('click', () => {
    initRefState();
    renderReferenceSections();
    updateRefStatus();
  });
}

function populateUseRefSelect(select) {
  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'als Referenz…';
  select.appendChild(placeholder);
  let anyEmpty = false;
  REFERENCE_CATEGORIES.forEach((cat) => {
    refState[cat.key].forEach((slot, i) => {
      if (slot.status === 'empty') {
        anyEmpty = true;
        const opt = document.createElement('option');
        opt.value = `${cat.key}:${i}`;
        opt.textContent = `${cat.label} ${i + 1}`;
        select.appendChild(opt);
      }
    });
  });
  select.disabled = !anyEmpty;
  if (!anyEmpty) placeholder.textContent = 'alle Plätze belegt';
}

// ---------------------------------------------------------------------------
// Kontaktbogen-Karten (Start / Ende)
// ---------------------------------------------------------------------------

function buildSlot(labelText) {
  const slot = document.createElement('div');
  slot.className = 'slot';

  if (labelText) {
    const label = document.createElement('div');
    label.className = 'slot-label';
    label.textContent = labelText;
    slot.appendChild(label);
  }

  const media = document.createElement('div');
  media.className = 'slot-media';
  const fill = document.createElement('div');
  fill.className = 'developing-fill';
  const statusLabel = document.createElement('div');
  statusLabel.className = 'slot-status-label';
  statusLabel.textContent = 'wird entwickelt …';
  media.appendChild(fill);
  media.appendChild(statusLabel);
  slot.appendChild(media);

  const actions = document.createElement('div');
  actions.className = 'slot-actions hidden';
  slot.appendChild(actions);

  return { el: slot, media, fill, statusLabel, actions };
}

function finishSlotDone(slotRefs, url) {
  slotRefs.fill.remove();
  slotRefs.statusLabel.remove();

  const img = document.createElement('img');
  img.className = 'slot-img';
  img.src = url;
  slotRefs.media.appendChild(img);

  slotRefs.actions.classList.remove('hidden');

  const dl = document.createElement('a');
  dl.className = 'slot-download';
  dl.href = url;
  dl.textContent = '↓ Bild';
  dl.setAttribute('download', '');
  slotRefs.actions.appendChild(dl);

  const select = document.createElement('select');
  select.className = 'slot-use-ref';
  populateUseRefSelect(select);
  select.addEventListener('focus', () => populateUseRefSelect(select));
  select.addEventListener('change', () => {
    const val = select.value;
    if (!val) return;
    const [cat, idxStr] = val.split(':');
    const idx = parseInt(idxStr, 10);
    refState[cat][idx] = { name: '', url, previewUrl: url, status: 'done' };
    renderReferenceSections();
    updateRefStatus();
    select.value = '';
  });
  slotRefs.actions.appendChild(select);
}

function finishSlotError(slotRefs, message) {
  slotRefs.statusLabel.classList.add('is-error');
  slotRefs.statusLabel.textContent = message;
}

function buildCardShell(modelLabel, promptStart, promptEnd) {
  const hasEnd = !!promptEnd;
  const startSlot = buildSlot(hasEnd ? 'Start' : '');
  const endSlot = hasEnd ? buildSlot('Ende') : null;

  const card = document.createElement('div');
  card.className = 'card';

  const mediaRow = document.createElement('div');
  mediaRow.className = 'card-media-row';
  mediaRow.appendChild(startSlot.el);
  if (endSlot) mediaRow.appendChild(endSlot.el);
  card.appendChild(mediaRow);

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.innerHTML = `<span>${escapeHtml(modelLabel)}</span>`;
  card.appendChild(meta);

  const promptBox = document.createElement('div');
  promptBox.className = 'card-prompt';
  const startLine = document.createElement('div');
  startLine.className = 'prompt-line';
  startLine.innerHTML = `<span class="prompt-tag">${hasEnd ? 'Start:' : ''}</span>${escapeHtml(promptStart)}`;
  promptBox.appendChild(startLine);
  if (hasEnd) {
    const endLine = document.createElement('div');
    endLine.className = 'prompt-line';
    endLine.innerHTML = `<span class="prompt-tag">Ende:</span>${escapeHtml(promptEnd)}`;
    promptBox.appendChild(endLine);
  }
  card.appendChild(promptBox);

  return { card, startSlot, endSlot, hasEnd };
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
  const promptStartVal = $('#prompt-start').value.trim();
  const promptEndVal = $('#prompt-end').value.trim();
  const errorEl = $('#generate-error');
  errorEl.classList.add('hidden');

  if (!promptStartVal) {
    errorEl.textContent = 'Bitte mindestens einen Start-Prompt eingeben.';
    errorEl.classList.remove('hidden');
    return;
  }

  const aspectRatio = $('#aspect-ratio').value;
  const resolution = $('#resolution').value;
  const includedRefs = getIncludedRefs().map((r) => ({ category: r.category, name: r.name, url: r.url }));

  const btn = $('#generate-btn');
  btn.disabled = true;

  const { card, startSlot, endSlot, hasEnd } = buildCardShell(currentModel.label, promptStartVal, promptEndVal);
  $('#results-grid').prepend(card);

  const historyEntry = {
    modelLabel: currentModel.label,
    promptStart: promptStartVal,
    promptEnd: hasEnd ? promptEndVal : null,
    startUrl: null,
    endUrl: null,
    createdAt: Date.now(),
  };
  function maybeSaveHistory() {
    if (historyEntry.startUrl && (!hasEnd || historyEntry.endUrl)) {
      saveToHistory({ ...historyEntry });
    }
  }

  try {
    const res = await fetch('/api/generate-pair', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        modelKey: currentModel.key,
        promptStart: promptStartVal,
        promptEnd: hasEnd ? promptEndVal : undefined,
        aspectRatio,
        resolution,
        references: includedRefs,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generierung fehlgeschlagen.');

    btn.disabled = false; // darf parallel weiterlaufen

    if (data.start && data.start.taskId) {
      busyCount++;
      setStatus(`entwickelt … (${busyCount})`);
      pollSlot(data.start.taskId, startSlot, {
        onDone: (url) => {
          historyEntry.startUrl = url;
          maybeSaveHistory();
        },
        onFinally: () => {
          busyCount = Math.max(0, busyCount - 1);
          setStatus(busyCount > 0 ? `entwickelt … (${busyCount})` : 'bereit');
        },
      });
    } else if (data.start && data.start.error) {
      finishSlotError(startSlot, data.start.error);
    }

    if (endSlot) {
      if (data.end && data.end.taskId) {
        busyCount++;
        setStatus(`entwickelt … (${busyCount})`);
        pollSlot(data.end.taskId, endSlot, {
          onDone: (url) => {
            historyEntry.endUrl = url;
            maybeSaveHistory();
          },
          onFinally: () => {
            busyCount = Math.max(0, busyCount - 1);
            setStatus(busyCount > 0 ? `entwickelt … (${busyCount})` : 'bereit');
          },
        });
      } else if (data.end && data.end.error) {
        finishSlotError(endSlot, data.end.error);
      }
    }
  } catch (err) {
    console.error(err);
    finishSlotError(startSlot, err.message || 'Unbekannter Fehler.');
    if (endSlot) finishSlotError(endSlot, err.message || 'Unbekannter Fehler.');
    btn.disabled = false;
    errorEl.textContent = err.message || 'Generierung fehlgeschlagen.';
    errorEl.classList.remove('hidden');
  }
}

function pollSlot(taskId, slotRefs, { onDone, onError, onFinally } = {}) {
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
          finishSlotDone(slotRefs, url);
          onDone && onDone(url);
        } else {
          finishSlotError(slotRefs, 'Fertig gemeldet, aber keine Bild-URL erhalten.');
          onError && onError();
        }
        onFinally && onFinally();
        return;
      }
      if (data.state === 'fail') {
        finishSlotError(slotRefs, data.failMsg || 'Task fehlgeschlagen.');
        onError && onError();
        onFinally && onFinally();
        return;
      }

      const pct =
        typeof data.progress === 'number' ? Math.min(Math.max(data.progress, 5), 95) : Math.min(elapsed / 1500, 90);
      slotRefs.fill.style.height = `${pct}%`;
      slotRefs.statusLabel.textContent =
        typeof data.progress === 'number' ? `wird entwickelt … ${data.progress}%` : 'wird entwickelt …';

      elapsed += delay;
      if (elapsed > maxElapsed) {
        finishSlotError(slotRefs, `Zeitüberschreitung. Task-ID: ${taskId}`);
        onError && onError();
        onFinally && onFinally();
        return;
      }
      delay = Math.min(delay * 1.15, 6000);
      setTimeout(tick, delay);
    } catch (err) {
      failures++;
      if (failures > 5) {
        finishSlotError(slotRefs, 'Verbindung zum Server verloren.');
        onError && onError();
        onFinally && onFinally();
        return;
      }
      setTimeout(tick, 4000);
    }
  }

  setTimeout(tick, delay);
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
    const { card, startSlot, endSlot } = buildCardShell(entry.modelLabel, entry.promptStart, entry.promptEnd);
    if (entry.startUrl) finishSlotDone(startSlot, entry.startUrl);
    if (endSlot && entry.endUrl) finishSlotDone(endSlot, entry.endUrl);
    $('#results-grid').appendChild(card);
  });
}
