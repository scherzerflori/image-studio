// kie-image-studio – app.js
// Reines Vanilla JS, kein Build-Schritt. Spricht ausschliesslich mit dem
// eigenen Server (/api/...), niemals direkt mit api.kie.ai.

const HISTORY_KEY = 'kis_history';
const PASSWORD_KEY = 'kis_password';
const PROJECTS_KEY = 'kis_projects';
const LAST_PROJECT_KEY = 'kis_last_project';
const MAX_HISTORY = 40;

let MODELS = [];
let ASPECT_RATIOS = [];
let RESOLUTIONS = [];
let REFERENCE_CATEGORIES = [];
let DESCRIBE_ENABLED = false;
let currentModel = null;
let currentProjectName = null;
let refState = {}; // { [categoryKey]: [ {name, url, previewUrl, status} ] }
let busyCount = 0;
let pendingUpload = null; // { category, index }
let describeImageBase64 = null;
let describeFileName = null;

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

const describeFileInput = document.createElement('input');
describeFileInput.type = 'file';
describeFileInput.accept = 'image/png,image/jpeg,image/webp';
describeFileInput.hidden = true;
document.body.appendChild(describeFileInput);

document.addEventListener('DOMContentLoaded', () => {
  wireLogin();
  wireGenerate();
  wireRefClearAll();
  wireProjects();
  wireDescribe();
  wireKeepFilter();
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
    DESCRIBE_ENABLED = !!data.describeEnabled;
    $('#describe-section').classList.toggle('hidden', !DESCRIBE_ENABLED);
    initRefState();
    populateModelSelect();
    populateAspectRatios();
    populateResolutions();
    renderReferenceSections();
    updateRefStatus();
    populateProjectSelect();
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

async function uploadBase64ToKie(dataUrl, fileName) {
  const res = await fetch('/api/upload', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ base64Data: dataUrl, fileName }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload fehlgeschlagen');
  return data.url;
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
      refState[category][index].url = await uploadBase64ToKie(dataUrl, file.name);
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

// ---------------------------------------------------------------------------
// Projekte (gespeicherte Grundeinstellungen, rein lokal im Browser)
// ---------------------------------------------------------------------------

function readProjects() {
  try {
    return JSON.parse(localStorage.getItem(PROJECTS_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeProjects(obj) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(obj));
}

function currentProjectSnapshot() {
  return {
    model: currentModel ? currentModel.key : (MODELS[0] && MODELS[0].key),
    aspectRatio: $('#aspect-ratio').value,
    resolution: $('#resolution').value,
    style: $('#project-style').value,
  };
}

function applyProjectSnapshot(snap) {
  const model = MODELS.find((m) => m.key === snap.model) || MODELS[0];
  $('#model-select').value = model.key;
  applyModel(model);
  if (snap.aspectRatio) $('#aspect-ratio').value = snap.aspectRatio;
  if (snap.resolution) $('#resolution').value = snap.resolution;
  $('#project-style').value = snap.style || '';
}

function populateProjectSelect() {
  const sel = $('#project-select');
  sel.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = '— kein Projekt —';
  sel.appendChild(none);

  const projects = readProjects();
  Object.keys(projects).sort().forEach((name) => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });

  const addNew = document.createElement('option');
  addNew.value = '__new__';
  addNew.textContent = '+ Neues Projekt…';
  sel.appendChild(addNew);

  const lastUsed = localStorage.getItem(LAST_PROJECT_KEY);
  if (lastUsed && projects[lastUsed]) {
    sel.value = lastUsed;
    currentProjectName = lastUsed;
    applyProjectSnapshot(projects[lastUsed]);
  }
  $('#project-delete').classList.toggle('hidden', !currentProjectName);
}

function wireProjects() {
  const sel = $('#project-select');
  sel.addEventListener('change', () => {
    if (sel.value === '__new__') {
      const name = prompt('Name für das neue Projekt:');
      if (!name || !name.trim()) {
        sel.value = currentProjectName || '';
        return;
      }
      const projects = readProjects();
      projects[name.trim()] = currentProjectSnapshot();
      writeProjects(projects);
      currentProjectName = name.trim();
      localStorage.setItem(LAST_PROJECT_KEY, currentProjectName);
      populateProjectSelect();
      sel.value = currentProjectName;
      return;
    }
    currentProjectName = sel.value || null;
    if (currentProjectName) {
      localStorage.setItem(LAST_PROJECT_KEY, currentProjectName);
      const projects = readProjects();
      if (projects[currentProjectName]) applyProjectSnapshot(projects[currentProjectName]);
    } else {
      localStorage.removeItem(LAST_PROJECT_KEY);
    }
    $('#project-delete').classList.toggle('hidden', !currentProjectName);
  });

  $('#project-save').addEventListener('click', () => {
    if (!currentProjectName) {
      const name = prompt('Name für das neue Projekt:');
      if (!name || !name.trim()) return;
      currentProjectName = name.trim();
      localStorage.setItem(LAST_PROJECT_KEY, currentProjectName);
    }
    const projects = readProjects();
    projects[currentProjectName] = currentProjectSnapshot();
    writeProjects(projects);
    populateProjectSelect();
    sel.value = currentProjectName;
    $('#project-delete').classList.remove('hidden');
    setStatus(`„${currentProjectName}“ gespeichert`);
    setTimeout(() => setStatus(busyCount > 0 ? `entwickelt … (${busyCount})` : 'bereit'), 1500);
  });

  $('#project-delete').addEventListener('click', () => {
    if (!currentProjectName) return;
    if (!confirm(`Projekt „${currentProjectName}“ wirklich löschen?`)) return;
    const projects = readProjects();
    delete projects[currentProjectName];
    writeProjects(projects);
    currentProjectName = null;
    localStorage.removeItem(LAST_PROJECT_KEY);
    populateProjectSelect();
  });
}

function getProjectStyleText() {
  return $('#project-style').value.trim();
}

// ---------------------------------------------------------------------------
// Prompt aus Referenzbild (Claude)
// ---------------------------------------------------------------------------

function updateDescribeBtnState() {
  const hasImage = !!describeImageBase64;
  const hasIdea = !!$('#describe-idea').value.trim();
  $('#describe-btn').disabled = !hasImage && !hasIdea;
}

function wireDescribe() {
  $('#describe-tile').addEventListener('click', () => {
    describeFileInput.value = '';
    describeFileInput.click();
  });

  describeFileInput.addEventListener('change', () => {
    const file = describeFileInput.files[0];
    if (!file) return;
    describeFileName = file.name;
    const reader = new FileReader();
    reader.onload = () => {
      describeImageBase64 = reader.result;
      $('#describe-tile-hint').classList.add('hidden');
      const img = $('#describe-tile-img');
      img.src = describeImageBase64;
      img.classList.remove('hidden');
      $('#describe-result').classList.add('hidden');
      updateDescribeBtnState();
    };
    reader.readAsDataURL(file);
  });

  $('#describe-idea').addEventListener('input', updateDescribeBtnState);

  $('#describe-btn').addEventListener('click', async () => {
    const btn = $('#describe-btn');
    btn.disabled = true;
    btn.textContent = 'wird erstellt …';
    try {
      const res = await fetch('/api/generate-prompt', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          base64Data: describeImageBase64 || undefined,
          ideaText: $('#describe-idea').value,
          styleHint: getProjectStyleText(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Prompt-Erstellung fehlgeschlagen.');
      $('#describe-output').value = data.prompt;
      $('#describe-result').classList.remove('hidden');
      populateUseRefSelect($('#describe-as-ref'));
    } catch (err) {
      console.error(err);
      alert(err.message || 'Prompt-Erstellung fehlgeschlagen.');
    } finally {
      btn.textContent = 'Prompt erstellen';
      updateDescribeBtnState();
    }
  });

  $('#describe-use-start').addEventListener('click', () => insertDescribedPrompt('#prompt-start'));
  $('#describe-use-end').addEventListener('click', () => insertDescribedPrompt('#prompt-end'));

  const refSelect = $('#describe-as-ref');
  refSelect.addEventListener('focus', () => populateUseRefSelect(refSelect));
  refSelect.addEventListener('change', async () => {
    const val = refSelect.value;
    if (!val || !describeImageBase64) return;
    const [cat, idxStr] = val.split(':');
    const idx = parseInt(idxStr, 10);
    refState[cat][idx] = { name: '', url: null, previewUrl: describeImageBase64, status: 'uploading' };
    renderReferenceSections();
    try {
      refState[cat][idx].url = await uploadBase64ToKie(describeImageBase64, describeFileName || 'reference.png');
      refState[cat][idx].status = 'done';
    } catch (err) {
      refState[cat][idx].status = 'error';
    }
    renderReferenceSections();
    updateRefStatus();
    refSelect.value = '';
  });
}

function insertDescribedPrompt(targetSelector) {
  const target = $(targetSelector);
  const text = $('#describe-output').value;
  if (!text) return;
  if (target.value.trim() && !confirm('Vorhandenen Prompt-Text ersetzen?')) return;
  target.value = text;
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

function finishSlotDone(slotRefs, url, entry, role) {
  slotRefs.fill.remove();
  slotRefs.statusLabel.remove();

  const img = document.createElement('img');
  img.className = 'slot-img';
  img.src = url;
  slotRefs.media.appendChild(img);

  slotRefs.actions.classList.remove('hidden');

  if (entry && role) {
    const keepBtn = document.createElement('button');
    keepBtn.className = 'slot-keep';
    keepBtn.type = 'button';
    const paintKeep = () => {
      const isKept = role === 'start' ? entry.startKept : entry.endKept;
      keepBtn.textContent = isKept ? '★ behalten' : '☆ behalten';
      keepBtn.classList.toggle('kept', isKept);
    };
    paintKeep();
    keepBtn.addEventListener('click', () => {
      if (role === 'start') entry.startKept = !entry.startKept;
      else entry.endKept = !entry.endKept;
      paintKeep();
      upsertHistory(entry);
      const card = slotRefs.el.closest('.card');
      if (card) card.classList.toggle('card-kept', !!(entry.startKept || entry.endKept));
      applyKeepFilter();
    });
    slotRefs.actions.appendChild(keepBtn);
    const card0 = slotRefs.el.closest('.card');
    if (card0 && (entry.startKept || entry.endKept)) card0.classList.add('card-kept');
  }

  const dl = document.createElement('a');
  dl.className = 'slot-download';
  dl.href = url;
  dl.textContent = '↓ Bild';
  dl.setAttribute('download', '');
  slotRefs.actions.appendChild(dl);

  if (entry && role) {
    const copyBtn = document.createElement('button');
    copyBtn.className = 'slot-copy';
    copyBtn.type = 'button';
    copyBtn.textContent = '⎘ Prompt';
    copyBtn.addEventListener('click', async () => {
      const text = role === 'start' ? entry.promptStart : entry.promptEnd;
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = 'kopiert!';
      } catch (err) {
        copyBtn.textContent = 'geht nicht';
      }
      setTimeout(() => {
        copyBtn.textContent = '⎘ Prompt';
      }, 1500);
    });
    slotRefs.actions.appendChild(copyBtn);
  }

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

  const variantBtn = document.createElement('button');
  variantBtn.className = 'slot-variant-btn';
  variantBtn.type = 'button';
  variantBtn.textContent = '↻ Variieren';
  slotRefs.actions.appendChild(variantBtn);

  const variantForm = document.createElement('div');
  variantForm.className = 'slot-variant-form hidden';
  const variantInput = document.createElement('input');
  variantInput.type = 'text';
  variantInput.placeholder = 'z.B. Kamera weiter rechts, von oben, mehr Menschen…';
  const variantSubmit = document.createElement('button');
  variantSubmit.type = 'button';
  variantSubmit.textContent = 'Los';
  variantForm.appendChild(variantInput);
  variantForm.appendChild(variantSubmit);
  slotRefs.el.appendChild(variantForm);

  variantBtn.addEventListener('click', () => {
    variantForm.classList.toggle('hidden');
    if (!variantForm.classList.contains('hidden')) variantInput.focus();
  });
  const submitVariant = () => {
    if (!variantInput.value.trim()) return;
    createVariant(url, variantInput.value);
    variantInput.value = '';
    variantForm.classList.add('hidden');
  };
  variantSubmit.addEventListener('click', submitVariant);
  variantInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitVariant();
    }
  });
}

function finishSlotEmpty(slotRefs, message) {
  slotRefs.statusLabel.textContent = message;
}

function finishSlotError(slotRefs, message) {
  slotRefs.statusLabel.classList.add('is-error');
  slotRefs.statusLabel.textContent = message;
}

function buildCardShell(modelLabel, promptStart, promptEnd, singleTag = '') {
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
  const startTag = hasEnd ? 'Start:' : singleTag;
  startLine.innerHTML = `<span class="prompt-tag">${escapeHtml(startTag)}</span>${escapeHtml(promptStart)}`;
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
  applyKeepFilter();

  const historyEntry = {
    id: generateId(),
    modelLabel: currentModel.label,
    promptStart: promptStartVal,
    promptEnd: hasEnd ? promptEndVal : null,
    startUrl: null,
    endUrl: null,
    startKept: false,
    endKept: false,
    createdAt: Date.now(),
  };

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
        stylePrefix: getProjectStyleText(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Generierung fehlgeschlagen.');

    btn.disabled = false; // darf parallel weiterlaufen

    if (data.start && data.start.taskId) {
      busyCount++;
      setStatus(`entwickelt … (${busyCount})`);
      pollSlot(data.start.taskId, startSlot, {
        entry: historyEntry,
        role: 'start',
        onDone: (url) => {
          historyEntry.startUrl = url;
          upsertHistory(historyEntry);
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
          entry: historyEntry,
          role: 'end',
          onDone: (url) => {
            historyEntry.endUrl = url;
            upsertHistory(historyEntry);
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

// Einzelbild-Variante: nimmt ein fertiges Bild als einzige Referenz und einen
// frei eingetippten Änderungswunsch (Kamerawinkel, mehr Personen, ...).
async function createVariant(baseUrl, instructionText) {
  const text = instructionText.trim();
  if (!text || !currentModel) return;

  const aspectRatio = $('#aspect-ratio').value;
  const resolution = $('#resolution').value;

  const { card, startSlot } = buildCardShell(currentModel.label, text, null, 'Variante:');
  $('#results-grid').prepend(card);
  applyKeepFilter();

  const historyEntry = {
    id: generateId(),
    modelLabel: currentModel.label,
    promptStart: text,
    promptEnd: null,
    startUrl: null,
    endUrl: null,
    startKept: false,
    endKept: false,
    createdAt: Date.now(),
  };

  try {
    const res = await fetch('/api/generate-pair', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        modelKey: currentModel.key,
        promptStart: text,
        aspectRatio,
        resolution,
        references: [{ category: 'background', name: '', url: baseUrl }],
        stylePrefix: getProjectStyleText(),
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Variante fehlgeschlagen.');

    if (data.start && data.start.taskId) {
      busyCount++;
      setStatus(`entwickelt … (${busyCount})`);
      pollSlot(data.start.taskId, startSlot, {
        entry: historyEntry,
        role: 'start',
        onDone: (url) => {
          historyEntry.startUrl = url;
          upsertHistory(historyEntry);
        },
        onFinally: () => {
          busyCount = Math.max(0, busyCount - 1);
          setStatus(busyCount > 0 ? `entwickelt … (${busyCount})` : 'bereit');
        },
      });
    } else if (data.start && data.start.error) {
      finishSlotError(startSlot, data.start.error);
    }
  } catch (err) {
    console.error(err);
    finishSlotError(startSlot, err.message || 'Unbekannter Fehler.');
  }
}

function pollSlot(taskId, slotRefs, { entry, role, onDone, onError, onFinally } = {}) {
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
          finishSlotDone(slotRefs, url, entry, role);
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
// Verlauf (localStorage, rein lokal auf diesem Gerät) & "Behalten"-Filter
// ---------------------------------------------------------------------------

function generateId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readHistory() {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

// Legt einen History-Eintrag an oder aktualisiert ihn (per id). Behaltene
// Bilder (startKept/endKept) werden beim Kürzen auf MAX_HISTORY verschont,
// damit sie nicht versehentlich aus dem Verlauf fallen.
function upsertHistory(entry) {
  if (!entry.startUrl && !entry.endUrl) return;
  const list = readHistory();
  const idx = list.findIndex((e) => e.id === entry.id);
  if (idx >= 0) list[idx] = entry;
  else list.unshift(entry);

  const kept = list.filter((e) => e.startKept || e.endKept);
  const rest = list.filter((e) => !(e.startKept || e.endKept));
  const trimmedRest = rest.slice(0, Math.max(0, MAX_HISTORY - kept.length));
  const merged = [...kept, ...trimmedRest].sort((a, b) => b.createdAt - a.createdAt);

  localStorage.setItem(HISTORY_KEY, JSON.stringify(merged));
}

function hydrateHistory() {
  const list = readHistory();
  list.forEach((entry) => {
    if (!entry.id) entry.id = generateId(); // Kompatibilität mit älteren Verlaufseinträgen
    const { card, startSlot, endSlot } = buildCardShell(entry.modelLabel, entry.promptStart, entry.promptEnd);
    if (entry.startUrl) finishSlotDone(startSlot, entry.startUrl, entry, 'start');
    else finishSlotEmpty(startSlot, 'kein Ergebnis gespeichert');
    if (endSlot) {
      if (entry.endUrl) finishSlotDone(endSlot, entry.endUrl, entry, 'end');
      else finishSlotEmpty(endSlot, 'kein Ergebnis gespeichert');
    }
    $('#results-grid').appendChild(card);
  });
  applyKeepFilter();
}

function applyKeepFilter() {
  const btn = $('#filter-kept-btn');
  const onlyKept = btn.classList.contains('active');
  document.querySelectorAll('#results-grid .card').forEach((card) => {
    card.classList.toggle('hidden', onlyKept && !card.classList.contains('card-kept'));
  });
}

function wireKeepFilter() {
  const btn = $('#filter-kept-btn');
  btn.addEventListener('click', () => {
    btn.classList.toggle('active');
    applyKeepFilter();
  });
}
