// kie-image-studio – app.js
// Reines Vanilla JS, kein Build-Schritt. Spricht ausschliesslich mit dem
// eigenen Server (/api/...), niemals direkt mit api.kie.ai.

const HISTORY_KEY = 'kis_history';
const VIDEO_HISTORY_KEY = 'kis_video_history';
const PASSWORD_KEY = 'kis_password';
const PROJECTS_KEY = 'kis_projects';
const LAST_PROJECT_KEY = 'kis_last_project';
const CUSTOM_STYLE_KEY = 'kis_custom_style_entries';
const LIBRARY_KEY = 'kis_library';
const MAX_HISTORY = 40;
const MAX_VIDEO_HISTORY = 30;

const LIBRARY_CATEGORIES = [
  { key: 'character', label: 'Charaktere', refCategory: 'person', hasName: true },
  { key: 'landscape', label: 'Landschaften/Hintergründe', refCategory: 'background', hasName: false },
  { key: 'object', label: 'Gegenstände', refCategory: 'object', hasName: false },
];

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
let lastFocusedPromptField = 'start'; // 'start' | 'end' – Ziel für "→ Einfügen"

// Video
let VIDEO_MODELS = [];
let VIDEO_ASPECT_RATIOS = [];
let currentVideoModel = null;
let videoStartFrame = null; // { url, previewUrl }
let videoEndFrame = null; // { url, previewUrl }
let videoBusyCount = 0;
let libraryPendingUpload = null; // { categoryKey }

// Feste Bildsprache-Bausteine: Deutsches Label fürs Dropdown, englische
// Formulierung, die tatsächlich in den Prompt eingefügt wird. Bei den
// Stil-Referenzen bewusst nur Licht/Farbe/Komposition beschrieben, keine
// Filmtitel, Figuren oder Handlung im eingefügten Text – der Titel dient nur
// der Orientierung im Dropdown.
const STYLE_CATEGORIES = [
  {
    key: 'angle',
    label: 'Kamerawinkel',
    entries: [
      { label: 'Augenhöhe', phrase: 'eye-level camera angle, neutral perspective, subject as an equal' },
      { label: 'Froschperspektive (von unten)', phrase: 'low-angle shot from below, subject looks powerful and imposing' },
      { label: 'Vogelperspektive (von oben)', phrase: "high-angle shot looking down, subject appears small and vulnerable" },
      { label: 'Steile Draufsicht (direkt von oben)', phrase: "top-down bird's-eye view, directly overhead, abstract diagrammatic composition" },
      { label: 'Bodenhöhe', phrase: 'extreme low camera near ground level, subject looms monumental and imposing' },
      { label: 'Schulterblick', phrase: 'over-the-shoulder shot, framing a relationship between two subjects' },
      { label: 'Subjektive Kamera (POV)', phrase: "first-person point-of-view shot, as if seen through the subject's own eyes" },
      { label: 'Schräge Kamera (Dutch Angle)', phrase: 'dutch angle, tilted horizon, creating unease and tension' },
      { label: 'Weite Übersicht (Establishing Shot)', phrase: 'wide establishing shot, placing the subject within its full environment' },
      { label: 'Nahaufnahme', phrase: 'close-up shot, focused on facial expression and emotion' },
      { label: 'Extreme Detailaufnahme', phrase: 'extreme close-up on a single detail (eye, hand, object), heightened intensity' },
    ],
  },
  {
    key: 'lens',
    label: 'Objektiv',
    entries: [
      { label: 'Sehr weiter Blickwinkel', phrase: 'ultra-wide-angle lens look, exaggerated sense of space and scale' },
      { label: 'Neutrale Perspektive', phrase: 'natural, undistorted perspective matching the human eye' },
      { label: 'Schmeichelnde Porträt-Kompression', phrase: 'flattering portrait lens compression, soft creamy background blur' },
      { label: 'Starke Distanz-Kompression', phrase: 'strong telephoto compression, background appears closer and larger, isolating the subject' },
      { label: 'Sehr geringe Schärfentiefe', phrase: 'extremely shallow depth of field, only the subject in sharp focus, everything else soft' },
      { label: 'Große Schärfentiefe', phrase: 'deep focus, sharp from foreground to background, documentary feel' },
      { label: 'Gewölbte Extremverzerrung (Fisheye)', phrase: 'fisheye lens distortion, surreal warped dreamlike look' },
      { label: 'Miniatur-Effekt (Tilt-Shift)', phrase: 'tilt-shift miniature effect, real scene looking like a small-scale model' },
    ],
  },
  {
    key: 'technique',
    label: 'Cineastischer Kniff',
    entries: [
      { label: 'Silhouette im Gegenlicht', phrase: 'subject in silhouette against strong backlight' },
      { label: 'Rembrandt-Licht', phrase: 'Rembrandt lighting, strong chiaroscuro with a small triangle of light on the cheek' },
      { label: 'Sichtbare Lichtquelle im Bild', phrase: 'visible practical light source in frame (candle, lantern, window light)' },
      { label: 'Lichtstrahlen im Nebel (God Rays)', phrase: 'god rays, visible light beams cutting through mist or dust' },
      { label: 'Spiegelung', phrase: 'reflection in wet pavement, glass, or water doubling the subject' },
      { label: 'Rahmen im Rahmen', phrase: 'frame within a frame, subject framed by a doorway, window, or archway' },
      { label: 'Unschärfe im Vordergrund', phrase: 'blurred foreground element, voyeuristic sense of depth' },
      { label: 'Teal-&-Orange-Look', phrase: 'teal and orange color grade, warm skin tones against cool blue shadows' },
      { label: 'Filmkorn', phrase: 'visible film grain, analog nostalgic texture' },
      { label: 'Nebel/Dunst zwischen Bildebenen', phrase: 'layered fog and haze separating foreground and background, mystical atmosphere' },
      { label: 'Symmetrische Komposition', phrase: 'perfectly symmetrical composition, formal and quietly unsettling' },
      { label: 'Leerer Raum um die Figur (Negative Space)', phrase: 'vast negative space around the subject, emphasizing isolation' },
    ],
  },
  {
    key: 'filmref',
    label: 'Stil-Referenz',
    entries: [
      { label: 'Barry Lyndon', phrase: 'lit only by candlelight and natural light, painterly historical composition, muted earth tones' },
      { label: 'Nosferatu (2024)', phrase: 'deep gothic shadows, cold moonlight, flickering candlelight contrast, dread-filled atmosphere' },
      { label: "Pan's Labyrinth", phrase: 'desaturated fantasy blue-grey palette, warm firelight contrast, dark fairy-tale mood' },
      { label: '1917', phrase: 'immersive, almost documentary-style handheld camera movement, natural muted daylight' },
      { label: 'The Revenant', phrase: 'entirely natural light, harsh wilderness, cold desaturated color palette' },
      { label: 'The Grand Budapest Hotel', phrase: 'symmetrical, pastel color palette, formal storybook composition' },
      { label: 'The Lighthouse', phrase: 'high-contrast black and white, claustrophobic square aspect ratio' },
      { label: 'Se7en', phrase: 'grimy green-tinted darkness, oppressive close quarters, hard shadows' },
      { label: 'Chernobyl (Miniserie)', phrase: 'desaturated Soviet grey-green palette, documentary dread' },
      { label: 'Mad Max: Fury Road', phrase: 'high contrast teal-and-orange grade, kinetic vast desert scale' },
      { label: 'Blade Runner 2049', phrase: 'neon-soaked haze, monumental isolation in cold vast spaces' },
      { label: 'The Godfather', phrase: 'warm amber interior lighting, deep shadow, formal classical composition' },
      { label: 'Amélie', phrase: 'rich warm gold and green tones, playfully staged compositions' },
    ],
  },
];

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
  wireDescribe();
  wireKeepFilter();
  wirePromptFocusTracking();
  wireModeTabs();
  wireVideoPanel();
  sharedFileInput.addEventListener('change', handleSharedFileChange);
  boot();
});

async function boot() {
  const ok = await loadModels();
  if (ok) {
    $('#login-overlay').classList.add('hidden');
    $('#app').classList.remove('hidden');
    hydrateHistory();
    hydrateVideoHistory();
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
    VIDEO_MODELS = data.videoModels || [];
    VIDEO_ASPECT_RATIOS = data.videoAspectRatios || [];
    $('#describe-section').classList.toggle('hidden', !DESCRIBE_ENABLED);
    $('#video-describe-section').classList.toggle('hidden', !DESCRIBE_ENABLED);
    initRefState();
    populateModelSelect();
    populateAspectRatios();
    populateResolutions();
    renderReferenceSections();
    updateRefStatus();
    populateVideoModelSelect();
    populateVideoAspectRatios();
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
  const el = $('#project-style');
  return el ? el.value.trim() : '';
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
      const useBlocksEl = $('#describe-use-blocks');
      const useBlocks = useBlocksEl ? useBlocksEl.checked : false;
      const buildingBlocks = useBlocks ? getCurrentStyleSelections() : [];
      const novelEl = $('#describe-novel-angle');
      const res = await fetch('/api/generate-prompt', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          base64Data: describeImageBase64 || undefined,
          ideaText: $('#describe-idea').value,
          styleHint: getProjectStyleText(),
          buildingBlocks,
          wantsNovelPerspective: novelEl ? novelEl.checked : false,
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

// ---------------------------------------------------------------------------
// Bildsprache: Kamerawinkel / Objektiv / Cineastischer Kniff / Stil-Referenz
// ---------------------------------------------------------------------------

function wirePromptFocusTracking() {
  $('#prompt-start').addEventListener('focus', () => {
    lastFocusedPromptField = 'start';
  });
  $('#prompt-end').addEventListener('focus', () => {
    lastFocusedPromptField = 'end';
  });
}

function readCustomStyleEntries() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_STYLE_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeCustomStyleEntries(obj) {
  localStorage.setItem(CUSTOM_STYLE_KEY, JSON.stringify(obj));
}

function resolveStyleEntry(categoryKey, value) {
  if (!value) return null;
  const [kind, idxStr] = value.split(':');
  const idx = parseInt(idxStr, 10);
  if (kind === 'built') {
    const cat = STYLE_CATEGORIES.find((c) => c.key === categoryKey);
    return cat ? cat.entries[idx] : null;
  }
  const custom = readCustomStyleEntries();
  return (custom[categoryKey] || [])[idx] || null;
}

function addCustomStyleEntry(categoryKey) {
  const label = prompt('Kurzer Name für das Dropdown (z.B. "Regenschauer"):');
  if (!label || !label.trim()) return;
  const phrase = prompt('Englischer Prompt-Text, der beim Einfügen verwendet wird:');
  if (!phrase || !phrase.trim()) return;

  const custom = readCustomStyleEntries();
  if (!custom[categoryKey]) custom[categoryKey] = [];
  custom[categoryKey].push({ label: label.trim(), phrase: phrase.trim() });
  writeCustomStyleEntries(custom);

  renderStyleSections();
  const sel = document.querySelector(`.style-select[data-category="${categoryKey}"]`);
  if (sel) {
    sel.value = `custom:${custom[categoryKey].length - 1}`;
    sel.dispatchEvent(new Event('change'));
  }
}

function insertStylePhrase(phrase) {
  const targetId = lastFocusedPromptField === 'end' ? '#prompt-end' : '#prompt-start';
  const el = $(targetId);
  const sep = el.value.trim() ? ', ' : '';
  el.value = el.value + sep + phrase;
}

// Erzeugt ein einzelnes Beispielbild aus der Stilbeschreibung heraus (mit
// einer neutralen Platzhalter-Szene), damit man sieht, was der Baustein
// bewirkt — ohne echte Filmstills zu verwenden. Läuft über dieselbe
// Generierungs-Pipeline wie ein normales Bild.
async function generateStylePreview(phrase, label) {
  if (!currentModel) return;
  const previewPrompt = `${phrase}, a person standing in a softly lit interior`;

  const { card, startSlot } = buildCardShell(currentModel.label, previewPrompt, null, `Vorschau – ${label}:`);
  $('#results-grid').prepend(card);
  applyKeepFilter();

  const historyEntry = makeHistoryEntry(previewPrompt, null, $('#aspect-ratio').value);

  try {
    const res = await fetch('/api/generate-pair', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        modelKey: currentModel.key,
        promptStart: previewPrompt,
        aspectRatio: $('#aspect-ratio').value,
        resolution: $('#resolution').value,
        references: [],
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Vorschau fehlgeschlagen.');

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

function getCurrentStyleSelections() {
  const phrases = [];
  document.querySelectorAll('.style-select').forEach((sel) => {
    const entry = resolveStyleEntry(sel.dataset.category, sel.value);
    if (entry) phrases.push(entry.phrase);
  });
  return phrases;
}

function renderStyleSections() {
  const container = $('#style-sections');
  if (!container) return;
  container.innerHTML = '';
  const custom = readCustomStyleEntries();

  STYLE_CATEGORIES.forEach((cat) => {
    const section = document.createElement('div');
    section.className = 'ref-category';

    const label = document.createElement('div');
    label.className = 'ref-category-label';
    label.textContent = cat.label;
    section.appendChild(label);

    const select = document.createElement('select');
    select.className = 'style-select';
    select.dataset.category = cat.key;
    cat.entries.forEach((entry, i) => {
      const opt = document.createElement('option');
      opt.value = `built:${i}`;
      opt.textContent = entry.label;
      select.appendChild(opt);
    });
    (custom[cat.key] || []).forEach((entry, i) => {
      const opt = document.createElement('option');
      opt.value = `custom:${i}`;
      opt.textContent = `${entry.label} ✎`;
      select.appendChild(opt);
    });
    section.appendChild(select);

    const preview = document.createElement('p');
    preview.className = 'style-preview-text';
    const updatePreviewText = () => {
      const entry = resolveStyleEntry(cat.key, select.value);
      preview.textContent = entry ? entry.phrase : '';
    };
    updatePreviewText();
    select.addEventListener('change', updatePreviewText);
    section.appendChild(preview);

    const row = document.createElement('div');
    row.className = 'describe-actions';

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '+ Eigener Eintrag';
    addBtn.addEventListener('click', () => addCustomStyleEntry(cat.key));
    row.appendChild(addBtn);

    const previewBtn = document.createElement('button');
    previewBtn.type = 'button';
    previewBtn.textContent = '👁 Vorschaubild';
    previewBtn.addEventListener('click', () => {
      const entry = resolveStyleEntry(cat.key, select.value);
      if (entry) generateStylePreview(entry.phrase, entry.label);
    });
    row.appendChild(previewBtn);

    const insertBtn = document.createElement('button');
    insertBtn.type = 'button';
    insertBtn.className = 'style-insert-btn';
    insertBtn.textContent = '→ Einfügen';
    insertBtn.addEventListener('click', () => {
      const entry = resolveStyleEntry(cat.key, select.value);
      if (entry) insertStylePhrase(entry.phrase);
    });
    row.appendChild(insertBtn);

    section.appendChild(row);
    container.appendChild(section);
  });
}

// ---------------------------------------------------------------------------
// Bibliothek: Charaktere / Landschaften / Gegenstände (dauerhaft, localStorage)
// ---------------------------------------------------------------------------

const libraryFileInput = document.createElement('input');
libraryFileInput.type = 'file';
libraryFileInput.accept = 'image/png,image/jpeg,image/webp';
libraryFileInput.hidden = true;
document.body.appendChild(libraryFileInput);

function readLibrary() {
  try {
    return JSON.parse(localStorage.getItem(LIBRARY_KEY) || '{}');
  } catch {
    return {};
  }
}

function writeLibrary(obj) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(obj));
}

function wireLibrary() {
  libraryFileInput.addEventListener('change', async () => {
    const file = libraryFileInput.files[0];
    const categoryKey = libraryPendingUpload;
    libraryPendingUpload = null;
    if (!file || !categoryKey) return;

    const catMeta = LIBRARY_CATEGORIES.find((c) => c.key === categoryKey);
    const name = prompt(catMeta.hasName ? 'Name der Figur:' : `Kurzer Name (${catMeta.label}):`);
    if (!name || !name.trim()) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result;
      const lib = readLibrary();
      if (!lib[categoryKey]) lib[categoryKey] = [];
      const entry = { id: generateId(), name: name.trim(), description: '', url: null, previewUrl: dataUrl, status: 'uploading' };
      lib[categoryKey].push(entry);
      writeLibrary(lib);
      renderLibrarySections();

      try {
        const url = await uploadBase64ToKie(dataUrl, file.name);
        const lib2 = readLibrary();
        const e2 = (lib2[categoryKey] || []).find((x) => x.id === entry.id);
        if (e2) {
          e2.url = url;
          e2.status = 'done';
          writeLibrary(lib2);
        }
      } catch (err) {
        const lib2 = readLibrary();
        const e2 = (lib2[categoryKey] || []).find((x) => x.id === entry.id);
        if (e2) {
          e2.status = 'error';
          writeLibrary(lib2);
        }
      }
      renderLibrarySections();
    };
    reader.readAsDataURL(file);
  });
}

async function generateLibraryDescription(categoryKey, entryId) {
  const lib = readLibrary();
  const entry = (lib[categoryKey] || []).find((e) => e.id === entryId);
  if (!entry || !entry.previewUrl || !DESCRIBE_ENABLED) return;
  const catMeta = LIBRARY_CATEGORIES.find((c) => c.key === categoryKey);
  const ideaText =
    categoryKey === 'character'
      ? `Beschreibe diese Person prägnant und stichpunktartig für die Wiederverwendung in künftigen Bild-/Video-Prompts (Aussehen, Kleidung, markante Merkmale) – kein Name, keine Handlung.`
      : `Beschreibe dieses/diese ${catMeta.label} prägnant und stichpunktartig für die Wiederverwendung in künftigen Bild-/Video-Prompts.`;
  try {
    const res = await fetch('/api/generate-prompt', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ base64Data: entry.previewUrl, ideaText, styleHint: '' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Beschreibung fehlgeschlagen.');
    const lib2 = readLibrary();
    const e2 = (lib2[categoryKey] || []).find((e) => e.id === entryId);
    if (e2) {
      e2.description = data.prompt;
      writeLibrary(lib2);
      renderLibrarySections();
    }
  } catch (err) {
    alert(err.message || 'Beschreibung fehlgeschlagen.');
  }
}

function useLibraryEntry(categoryKey, entryId) {
  const lib = readLibrary();
  const entry = (lib[categoryKey] || []).find((e) => e.id === entryId);
  if (!entry || entry.status !== 'done') return;
  const catMeta = LIBRARY_CATEGORIES.find((c) => c.key === categoryKey);
  const refCat = catMeta.refCategory;

  const slots = refState[refCat];
  const emptyIdx = slots.findIndex((s) => s.status === 'empty');
  if (emptyIdx === -1) {
    alert(`Alle Referenz-Plätze für "${catMeta.label}" sind belegt. Erst einen Platz leeren.`);
  } else {
    slots[emptyIdx] = { name: catMeta.hasName ? entry.name : '', url: entry.url, previewUrl: entry.previewUrl, status: 'done' };
    renderReferenceSections();
    updateRefStatus();
  }
  if (entry.description) insertStylePhrase(entry.description);
}

function deleteLibraryEntry(categoryKey, entryId) {
  if (!confirm('Diesen Bibliothekseintrag wirklich löschen?')) return;
  const lib = readLibrary();
  lib[categoryKey] = (lib[categoryKey] || []).filter((e) => e.id !== entryId);
  writeLibrary(lib);
  renderLibrarySections();
}

function renderLibrarySections() {
  const container = $('#library-sections');
  if (!container) return;
  container.innerHTML = '';
  const lib = readLibrary();

  LIBRARY_CATEGORIES.forEach((cat) => {
    const section = document.createElement('div');
    section.className = 'ref-category';

    const label = document.createElement('div');
    label.className = 'ref-category-label';
    label.textContent = cat.label;
    section.appendChild(label);

    const list = document.createElement('div');
    list.className = 'library-list';

    (lib[cat.key] || []).forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'library-item';

      const tile = document.createElement('div');
      tile.className = 'library-item-tile';
      tile.title = entry.description ? entry.description : 'Klicken zum Verwenden';
      if (entry.previewUrl) {
        const img = document.createElement('img');
        img.src = entry.previewUrl;
        tile.appendChild(img);
      }
      if (entry.status === 'done') {
        tile.addEventListener('click', () => useLibraryEntry(cat.key, entry.id));
      }

      const removeBtn = document.createElement('button');
      removeBtn.className = 'library-item-remove';
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteLibraryEntry(cat.key, entry.id);
      });
      tile.appendChild(removeBtn);

      const nameEl = document.createElement('div');
      nameEl.className = 'library-item-name';
      nameEl.textContent = entry.status === 'uploading' ? `${entry.name} …` : entry.status === 'error' ? `${entry.name} ✕` : entry.name;

      item.appendChild(tile);
      item.appendChild(nameEl);

      if (DESCRIBE_ENABLED && entry.status === 'done' && !entry.description) {
        const genBtn = document.createElement('button');
        genBtn.className = 'library-item-remove';
        genBtn.style.cssText = 'position:static;width:auto;height:auto;border-radius:3px;font-size:9px;padding:1px 4px;background:var(--panel-alt);color:var(--text-faint);';
        genBtn.type = 'button';
        genBtn.textContent = '✎ Beschreiben';
        genBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          generateLibraryDescription(cat.key, entry.id);
        });
        item.appendChild(genBtn);
      }

      list.appendChild(item);
    });

    const addTile = document.createElement('div');
    addTile.className = 'library-add-tile';
    addTile.textContent = '+';
    addTile.title = `${cat.label} hinzufügen`;
    addTile.addEventListener('click', () => {
      libraryPendingUpload = cat.key;
      libraryFileInput.value = '';
      libraryFileInput.click();
    });
    list.appendChild(addTile);

    section.appendChild(list);
    container.appendChild(section);
  });
}

function wireRefClearAll() {
  $('#ref-clear-all').addEventListener('click', () => {
    initRefState();
    renderReferenceSections();
    updateRefStatus();
  });
}

// ---------------------------------------------------------------------------
// Modus-Tabs (Bild / Video)
// ---------------------------------------------------------------------------

function wireModeTabs() {
  $('#mode-tab-image').addEventListener('click', () => setMode('image'));
  $('#mode-tab-video').addEventListener('click', () => setMode('video'));
}

function setMode(mode) {
  $('#mode-tab-image').classList.toggle('active', mode === 'image');
  $('#mode-tab-video').classList.toggle('active', mode === 'video');
  $('#image-panel').classList.toggle('hidden', mode !== 'image');
  $('#video-panel').classList.toggle('hidden', mode !== 'video');
}

// ---------------------------------------------------------------------------
// Video: Modell / Seitenverhältnis / Dauer
// ---------------------------------------------------------------------------

function populateVideoModelSelect() {
  const sel = $('#video-model-select');
  if (!VIDEO_MODELS.length) return;
  sel.innerHTML = '';
  VIDEO_MODELS.forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.key;
    opt.textContent = `${m.label} — ${m.vendor}`;
    sel.appendChild(opt);
  });
  sel.value = VIDEO_MODELS[0].key;
  applyVideoModel(VIDEO_MODELS[0]);
  sel.addEventListener('change', (e) => {
    applyVideoModel(VIDEO_MODELS.find((m) => m.key === e.target.value));
  });
}

function populateVideoAspectRatios() {
  const sel = $('#video-aspect-ratio');
  sel.innerHTML = '';
  VIDEO_ASPECT_RATIOS.forEach((r) => {
    const opt = document.createElement('option');
    opt.value = r.value;
    opt.textContent = r.label;
    sel.appendChild(opt);
  });
}

function applyVideoModel(model) {
  currentVideoModel = model;
  $('#video-model-blurb').textContent = model.blurb;
  $('#video-end-wrap').classList.toggle('hidden', !model.supportsStartEnd);
  const elSection = $('#video-elements-section');
  if (elSection) elSection.classList.toggle('hidden', !model.supportsElements);
  $('#video-generate-audio').closest('label').classList.toggle('hidden', !model.supportsAudio);

  const durSel = $('#video-duration');
  durSel.innerHTML = '';
  model.durations.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = `${d}s`;
    durSel.appendChild(opt);
  });

  if (model.supportsElements) renderVideoElementsList();
}

// ---------------------------------------------------------------------------
// Video: Start-/Endbild-Frames
// ---------------------------------------------------------------------------

const videoFrameFileInput = document.createElement('input');
videoFrameFileInput.type = 'file';
videoFrameFileInput.accept = 'image/png,image/jpeg,image/webp';
videoFrameFileInput.hidden = true;
document.body.appendChild(videoFrameFileInput);
let videoFramePendingRole = null;

function renderVideoFrameTile(role) {
  const tile = $(role === 'start' ? '#video-start-tile' : '#video-end-tile');
  const clearBtn = $(role === 'start' ? '#video-start-clear' : '#video-end-clear');
  const frame = role === 'start' ? videoStartFrame : videoEndFrame;
  tile.innerHTML = '';
  if (frame && frame.previewUrl) {
    const img = document.createElement('img');
    img.src = frame.previewUrl;
    tile.appendChild(img);
    tile.classList.add('filled');
    clearBtn.classList.remove('hidden');
  } else {
    const hint = document.createElement('span');
    hint.className = 'video-frame-hint';
    hint.textContent = frame && frame.status === 'uploading' ? 'lädt hoch …' : 'Bild wählen';
    tile.appendChild(hint);
    tile.classList.remove('filled');
    clearBtn.classList.add('hidden');
  }
}

function setVideoFrameFromUrl(role, url) {
  const frame = { previewUrl: url, url, status: 'done' };
  if (role === 'start') videoStartFrame = frame;
  else videoEndFrame = frame;
  renderVideoFrameTile(role);
}

function wireVideoPanel() {
  $('#video-start-tile').addEventListener('click', () => {
    if (videoStartFrame) return;
    videoFramePendingRole = 'start';
    videoFrameFileInput.value = '';
    videoFrameFileInput.click();
  });
  $('#video-end-tile').addEventListener('click', () => {
    if (videoEndFrame) return;
    videoFramePendingRole = 'end';
    videoFrameFileInput.value = '';
    videoFrameFileInput.click();
  });
  $('#video-start-clear').addEventListener('click', () => {
    videoStartFrame = null;
    renderVideoFrameTile('start');
  });
  $('#video-end-clear').addEventListener('click', () => {
    videoEndFrame = null;
    renderVideoFrameTile('end');
  });

  videoFrameFileInput.addEventListener('change', () => {
    const file = videoFrameFileInput.files[0];
    const role = videoFramePendingRole;
    videoFramePendingRole = null;
    if (!file || !role) return;

    const frame = { previewUrl: null, url: null, status: 'uploading' };
    if (role === 'start') videoStartFrame = frame;
    else videoEndFrame = frame;
    renderVideoFrameTile(role);

    const reader = new FileReader();
    reader.onload = async () => {
      frame.previewUrl = reader.result;
      renderVideoFrameTile(role);
      try {
        frame.url = await uploadBase64ToKie(reader.result, file.name);
        frame.status = 'done';
      } catch (err) {
        frame.status = 'error';
      }
      renderVideoFrameTile(role);
    };
    reader.readAsDataURL(file);
  });

  $('#video-describe-btn').addEventListener('click', requestVideoPrompt);
  $('#video-describe-use').addEventListener('click', () => {
    const text = $('#video-describe-output').value;
    if (!text) return;
    const target = $('#video-prompt');
    if (target.value.trim() && !confirm('Vorhandenen Video-Prompt ersetzen?')) return;
    target.value = text;
  });

  $('#video-generate-btn').addEventListener('click', startVideoGeneration);
}

// ---------------------------------------------------------------------------
// Video: Elemente aus der Bibliothek (Charaktere/Gegenstände)
// ---------------------------------------------------------------------------

function renderVideoElementsList() {
  const container = $('#video-elements-list');
  if (!container) return;
  container.innerHTML = '';
  const lib = readLibrary();
  ['character', 'object'].forEach((catKey) => {
    (lib[catKey] || []).forEach((entry) => {
      if (entry.status !== 'done') return;
      const label = document.createElement('label');
      label.className = 'describe-checkbox';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = `${catKey}:${entry.id}`;
      label.appendChild(cb);
      label.appendChild(document.createTextNode(` ${entry.name} (@${slugifyElementName(entry.name)})`));
      container.appendChild(label);
    });
  });
  if (!container.children.length) {
    const p = document.createElement('p');
    p.className = 'field-hint';
    p.textContent = 'Noch keine Charaktere/Gegenstände in der Bibliothek.';
    container.appendChild(p);
  }
}

function slugifyElementName(name) {
  return (name || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'element';
}

function getSelectedVideoElements() {
  const lib = readLibrary();
  const out = [];
  const listEl = $('#video-elements-list');
  if (!listEl) return out;
  listEl.querySelectorAll('input[type=checkbox]:checked').forEach((cb) => {
    const [catKey, id] = cb.value.split(':');
    const entry = (lib[catKey] || []).find((e) => e.id === id);
    if (entry && entry.url) {
      out.push({ name: slugifyElementName(entry.name), description: entry.description || entry.name, url: entry.url });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Video: Claude-Prompt-Generator
// ---------------------------------------------------------------------------

async function requestVideoPrompt() {
  const btn = $('#video-describe-btn');
  const ideaText = $('#video-describe-idea').value;
  if (!ideaText.trim() && !videoStartFrame && !videoEndFrame) {
    alert('Bitte ein Startbild setzen oder eine Idee eintippen.');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'wird erstellt …';
  try {
    const res = await fetch('/api/generate-video-prompt', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        startImage: videoStartFrame ? videoStartFrame.previewUrl || videoStartFrame.url : null,
        endImage: videoEndFrame ? videoEndFrame.previewUrl || videoEndFrame.url : null,
        ideaText,
        styleHint: getProjectStyleText(),
        duration: $('#video-duration').value,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Video-Prompt-Erstellung fehlgeschlagen.');
    $('#video-describe-output').value = data.prompt;
    $('#video-describe-result').classList.remove('hidden');
  } catch (err) {
    console.error(err);
    alert(err.message || 'Video-Prompt-Erstellung fehlgeschlagen.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Prompt erstellen';
  }
}

// ---------------------------------------------------------------------------
// Video: Generierung, Polling, Ergebniskarten, Verlauf
// ---------------------------------------------------------------------------

function setVideoStatus(text) {
  const el = $('#topbar-status');
  el.textContent = text;
}

function buildVideoCardShell(modelLabel, prompt) {
  const card = document.createElement('div');
  card.className = 'card';

  const media = document.createElement('div');
  media.className = 'video-card-media';
  const fill = document.createElement('div');
  fill.className = 'developing-fill';
  const statusLabel = document.createElement('div');
  statusLabel.className = 'slot-status-label';
  statusLabel.textContent = 'wird gerendert …';
  media.appendChild(fill);
  media.appendChild(statusLabel);
  card.appendChild(media);

  const meta = document.createElement('div');
  meta.className = 'card-meta';
  meta.innerHTML = `<span>🎬 ${escapeHtml(modelLabel)}</span>`;
  card.appendChild(meta);

  const promptBox = document.createElement('div');
  promptBox.className = 'card-prompt';
  const line = document.createElement('div');
  line.className = 'prompt-line';
  line.textContent = prompt;
  promptBox.appendChild(line);
  card.appendChild(promptBox);

  const actions = document.createElement('div');
  actions.className = 'slot-actions hidden';
  card.appendChild(actions);

  return { card, media, fill, statusLabel, actions };
}

function finishVideoDone(refs, url, entry) {
  refs.fill.remove();
  refs.statusLabel.remove();
  const video = document.createElement('video');
  video.src = url;
  video.controls = true;
  video.loop = true;
  video.playsInline = true;
  refs.media.appendChild(video);

  refs.actions.classList.remove('hidden');

  const quickRow = document.createElement('div');
  quickRow.className = 'slot-quickrow';

  const keepBtn = document.createElement('button');
  keepBtn.className = 'slot-keep';
  keepBtn.type = 'button';
  const paintKeep = () => {
    keepBtn.textContent = entry.kept ? '★ behalten' : '☆ behalten';
    keepBtn.classList.toggle('kept', entry.kept);
  };
  paintKeep();
  keepBtn.addEventListener('click', () => {
    entry.kept = !entry.kept;
    paintKeep();
    upsertVideoHistory(entry);
    refs.card.classList.toggle('card-kept', entry.kept);
    applyKeepFilter();
  });
  quickRow.appendChild(keepBtn);
  if (entry.kept) refs.card.classList.add('card-kept');

  const dl = document.createElement('button');
  dl.type = 'button';
  dl.className = 'slot-download';
  dl.textContent = '↓ Video';
  dl.addEventListener('click', async () => {
    const filename = buildVideoFileName(entry, url);
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('fetch fehlgeschlagen');
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch (err) {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  });
  quickRow.appendChild(dl);

  const copyBtn = document.createElement('button');
  copyBtn.className = 'slot-copy';
  copyBtn.type = 'button';
  copyBtn.textContent = '⎘ Prompt';
  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(entry.prompt || '');
      copyBtn.textContent = 'kopiert!';
    } catch (err) {
      copyBtn.textContent = 'geht nicht';
    }
    setTimeout(() => (copyBtn.textContent = '⎘ Prompt'), 1500);
  });
  quickRow.appendChild(copyBtn);

  refs.actions.appendChild(quickRow);
}

function finishVideoError(refs, message) {
  refs.statusLabel.classList.add('is-error');
  refs.statusLabel.textContent = message;
}

function buildVideoFileName(entry, url) {
  const d = new Date(entry.createdAt || Date.now());
  const yy = String(d.getFullYear() % 100).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const project = sanitizeSlug(entry.projectName || 'OhneProjekt');
  const keyword = sanitizeSlug(entry.slug || deriveSlugFromPrompt(entry.prompt));
  const ratio = (entry.aspectRatio || '16:9').replace(/:/g, 'zu');
  const VIDEO_MODEL_SLUGS = { 'kling-3': 'Kling3', 'seedance-2-fast': 'Seedance2', 'sora2': 'Sora2', 'wan-2-7': 'Wan27' };
  const model = VIDEO_MODEL_SLUGS[entry.modelKey] || sanitizeSlug(entry.modelLabel || 'Video');
  const ext = guessExtension(url) === 'png' ? 'mp4' : guessExtension(url);
  return `${yy}${mm}${dd}_${project}_${keyword}_${ratio}_${model}.${ext}`;
}

async function startVideoGeneration() {
  const prompt = $('#video-prompt').value.trim();
  const errorEl = $('#video-generate-error');
  errorEl.classList.add('hidden');
  if (!prompt) {
    errorEl.textContent = 'Bitte einen Prompt eingeben.';
    errorEl.classList.remove('hidden');
    return;
  }
  if (!currentVideoModel) return;

  const aspectRatio = $('#video-aspect-ratio').value;
  const duration = $('#video-duration').value;
  const generateAudio = $('#video-generate-audio').checked;
  const elements = currentVideoModel.supportsElements ? getSelectedVideoElements() : [];
  const referenceImageUrls =
    !currentVideoModel.supportsStartEnd && !currentVideoModel.supportsElements && videoStartFrame && videoStartFrame.url
      ? [videoStartFrame.url]
      : [];

  const btn = $('#video-generate-btn');
  btn.disabled = true;

  const { card, media, fill, statusLabel, actions } = buildVideoCardShell(currentVideoModel.label, prompt);
  const refs = { card, media, fill, statusLabel, actions };
  $('#results-grid').prepend(card);
  applyKeepFilter();

  const entry = {
    id: generateId(),
    modelKey: currentVideoModel.key,
    modelLabel: currentVideoModel.label,
    projectName: currentProjectName || null,
    aspectRatio,
    duration,
    prompt,
    slug: null,
    videoUrl: null,
    kept: false,
    createdAt: Date.now(),
  };

  try {
    const res = await fetch('/api/generate-video', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        modelKey: currentVideoModel.key,
        prompt,
        aspectRatio,
        duration,
        generateAudio,
        startImageUrl: videoStartFrame && videoStartFrame.url ? videoStartFrame.url : null,
        endImageUrl: videoEndFrame && videoEndFrame.url ? videoEndFrame.url : null,
        referenceImageUrls,
        elements,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Video-Generierung fehlgeschlagen.');

    btn.disabled = false;
    videoBusyCount++;
    setVideoStatus(`Video wird gerendert … (${videoBusyCount})`);

    pollVideoTask(data.taskId, refs, entry);
  } catch (err) {
    console.error(err);
    finishVideoError(refs, err.message || 'Unbekannter Fehler.');
    btn.disabled = false;
    errorEl.textContent = err.message || 'Video-Generierung fehlgeschlagen.';
    errorEl.classList.remove('hidden');
  }
}

function pollVideoTask(taskId, refs, entry) {
  let delay = 4000;
  let elapsed = 0;
  const maxElapsed = 12 * 60 * 1000; // Videos brauchen deutlich laenger als Bilder
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
          entry.videoUrl = url;
          finishVideoDone(refs, url, entry);
          upsertVideoHistory(entry);
        } else {
          finishVideoError(refs, 'Fertig gemeldet, aber keine Video-URL erhalten.');
        }
        settle();
        return;
      }
      if (data.state === 'fail') {
        finishVideoError(refs, data.failMsg || 'Task fehlgeschlagen.');
        settle();
        return;
      }

      const pct = typeof data.progress === 'number' ? Math.min(Math.max(data.progress, 5), 95) : Math.min(elapsed / 4000, 90);
      refs.fill.style.height = `${pct}%`;
      refs.statusLabel.textContent =
        typeof data.progress === 'number' ? `wird gerendert … ${data.progress}%` : 'wird gerendert …';

      elapsed += delay;
      if (elapsed > maxElapsed) {
        finishVideoError(refs, `Zeitüberschreitung. Task-ID: ${taskId}`);
        settle();
        return;
      }
      delay = Math.min(delay * 1.15, 10000);
      setTimeout(tick, delay);
    } catch (err) {
      failures++;
      if (failures > 5) {
        finishVideoError(refs, 'Verbindung zum Server verloren.');
        settle();
        return;
      }
      setTimeout(tick, 6000);
    }
  }

  function settle() {
    videoBusyCount = Math.max(0, videoBusyCount - 1);
    setVideoStatus(videoBusyCount > 0 ? `Video wird gerendert … (${videoBusyCount})` : 'bereit');
  }

  setTimeout(tick, delay);
}

function readVideoHistory() {
  try {
    return JSON.parse(localStorage.getItem(VIDEO_HISTORY_KEY) || '[]');
  } catch {
    return [];
  }
}

function upsertVideoHistory(entry) {
  if (!entry.videoUrl) return;
  const list = readVideoHistory();
  const idx = list.findIndex((e) => e.id === entry.id);
  if (idx >= 0) list[idx] = entry;
  else list.unshift(entry);
  const kept = list.filter((e) => e.kept);
  const rest = list.filter((e) => !e.kept);
  const trimmed = rest.slice(0, Math.max(0, MAX_VIDEO_HISTORY - kept.length));
  const merged = [...kept, ...trimmed].sort((a, b) => b.createdAt - a.createdAt);
  localStorage.setItem(VIDEO_HISTORY_KEY, JSON.stringify(merged));
}

function hydrateVideoHistory() {
  readVideoHistory().forEach((entry) => {
    const { card, media, fill, statusLabel, actions } = buildVideoCardShell(entry.modelLabel, entry.prompt);
    const refs = { card, media, fill, statusLabel, actions };
    if (entry.videoUrl) finishVideoDone(refs, entry.videoUrl, entry);
    $('#results-grid').appendChild(card);
  });
  applyKeepFilter();
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

  // --- Quick-Reihe: behalten / herunterladen / Prompt kopieren -----------
  const quickRow = document.createElement('div');
  quickRow.className = 'slot-quickrow';

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
    quickRow.appendChild(keepBtn);
    const card0 = slotRefs.el.closest('.card');
    if (card0 && (entry.startKept || entry.endKept)) card0.classList.add('card-kept');
  }

  const dl = document.createElement('button');
  dl.type = 'button';
  dl.className = 'slot-download';
  dl.textContent = '↓ Bild';
  dl.addEventListener('click', async () => {
    const filename = entry && role ? buildFileName(entry, role, url) : 'bild.png';
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('fetch fehlgeschlagen');
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10000);
    } catch (err) {
      // Fallback, falls der Cross-Origin-Fetch blockiert wird: Bild in neuem
      // Tab öffnen, Dateiname wird dann vom Browser ggf. nicht übernommen.
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.target = '_blank';
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
  });
  quickRow.appendChild(dl);

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
    quickRow.appendChild(copyBtn);
  }

  slotRefs.actions.appendChild(quickRow);

  // --- Datei-Stichwort, eigene Zeile --------------------------------------
  if (entry && role) {
    const slugWrap = document.createElement('div');
    slugWrap.className = 'slot-slug-wrap';
    const slugLabel = document.createElement('span');
    slugLabel.className = 'slot-slug-label';
    slugLabel.textContent = 'Datei:';
    const slugInput = document.createElement('input');
    slugInput.type = 'text';
    slugInput.className = 'slot-slug-input';
    slugInput.value = (role === 'start' ? entry.startSlug : entry.endSlug) || deriveSlugFromPrompt(role === 'start' ? entry.promptStart : entry.promptEnd);
    slugInput.title = 'Stichwort im Dateinamen – frei editierbar';
    slugInput.addEventListener('input', () => {
      if (role === 'start') entry.startSlug = slugInput.value;
      else entry.endSlug = slugInput.value;
    });
    slugInput.addEventListener('blur', () => upsertHistory(entry));
    slugWrap.appendChild(slugLabel);
    slugWrap.appendChild(slugInput);
    slotRefs.actions.appendChild(slugWrap);
  }

  // --- als Referenz verwenden, eigene Zeile -------------------------------
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

  // --- als Video-Start/-Endbild, eigene Zeile -----------------------------
  const videoSelect = document.createElement('select');
  videoSelect.className = 'slot-use-ref';
  videoSelect.innerHTML = '<option value="">🎬 Video…</option><option value="vstart">als Video-Startbild</option><option value="vend">als Video-Endbild</option>';
  videoSelect.addEventListener('change', () => {
    if (videoSelect.value === 'vstart') setVideoFrameFromUrl('start', url);
    else if (videoSelect.value === 'vend') setVideoFrameFromUrl('end', url);
    videoSelect.value = '';
  });
  slotRefs.actions.appendChild(videoSelect);

  // --- KI-Check, eigene Zeile + Ergebnis darunter -------------------------
  if (entry && role && DESCRIBE_ENABLED) {
    const checkBtn = document.createElement('button');
    checkBtn.className = 'slot-check-btn';
    checkBtn.type = 'button';
    checkBtn.textContent = '🔍 KI-Check';

    const checkResultEl = document.createElement('div');
    checkResultEl.className = 'slot-check-result hidden';

    const renderCheckResult = (text) => {
      checkResultEl.innerHTML = '';
      checkResultEl.classList.remove('hidden');
      const isClean = /keine auff/i.test(text || '');
      checkResultEl.classList.toggle('is-clean', isClean);
      checkResultEl.classList.toggle('is-warn', !isClean);
      (text || '').split('\n').filter((l) => l.trim()).forEach((line) => {
        const p = document.createElement('p');
        p.textContent = line.trim();
        checkResultEl.appendChild(p);
      });
    };

    const existingReport = role === 'start' ? entry.startCheck : entry.endCheck;
    if (existingReport) renderCheckResult(existingReport);

    checkBtn.addEventListener('click', async () => {
      checkBtn.disabled = true;
      checkBtn.textContent = 'prüft …';
      try {
        const res = await fetch('/api/check-image', {
          method: 'POST',
          headers: authHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ imageUrl: url }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Prüfung fehlgeschlagen.');
        if (role === 'start') entry.startCheck = data.report;
        else entry.endCheck = data.report;
        upsertHistory(entry);
        renderCheckResult(data.report);
      } catch (err) {
        console.error(err);
        renderCheckResult(`⚠ Prüfung fehlgeschlagen: ${err.message || 'unbekannter Fehler'}`);
      } finally {
        checkBtn.disabled = false;
        checkBtn.textContent = '🔍 KI-Check';
      }
    });

    slotRefs.actions.appendChild(checkBtn);
    slotRefs.actions.appendChild(checkResultEl);
  }

  // --- Variieren, eigene Zeile + Formular darunter ------------------------
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
  slotRefs.actions.appendChild(variantForm);

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

  const historyEntry = makeHistoryEntry(promptStartVal, hasEnd ? promptEndVal : null, aspectRatio);

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

  const historyEntry = makeHistoryEntry(text, null, aspectRatio);

  try {
    const res = await fetch('/api/generate-pair', {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        modelKey: currentModel.key,
        promptStart: text,
        aspectRatio,
        resolution,
        references: [{ category: 'subject', name: '', url: baseUrl }],
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

function makeHistoryEntry(promptStart, promptEnd, aspectRatio) {
  return {
    id: generateId(),
    modelKey: currentModel.key,
    modelLabel: currentModel.label,
    projectName: currentProjectName || null,
    aspectRatio: aspectRatio || 'auto',
    promptStart,
    promptEnd: promptEnd || null,
    startUrl: null,
    endUrl: null,
    startKept: false,
    endKept: false,
    startSlug: null,
    endSlug: null,
    startCheck: null,
    endCheck: null,
    createdAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Einheitliche Dateinamen: JJMMTT_Projekt_Stichwort_Seitenverhaeltnis_Modell
// ---------------------------------------------------------------------------

const MODEL_FILE_SLUGS = {
  'nano-banana-pro': 'NanoBanana',
  'flux-2-pro': 'Flux2',
  'gpt-image-2.5-flare': 'GPTImage25Flare',
  'gpt-image-2.5-sunburst': 'GPTImage25Sunburst',
  'seedream-5-lite': 'Seedream5',
  'ideogram-v3': 'IdeogramV3',
  'grok-imagine': 'GrokImagine',
  'imagen4': 'Imagen4',
  'imagen4-ultra': 'Imagen4Ultra',
  'qwen3': 'Qwen3',
};

const SLUG_STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'in', 'on', 'with', 'and', 'is', 'are', 'this', 'that',
  'from', 'at', 'to', 'by', 'into', 'onto', 'for', 'as', 'her', 'his', 'their',
  'she', 'he', 'they', 'it', 'shot', 'image', 'photo',
]);

function sanitizeSlug(text) {
  const clean = (text || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // Akzente/Umlaut-Diakritika entfernen
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (clean || 'x').slice(0, 40);
}

function deriveSlugFromPrompt(text) {
  if (!text) return 'bild';
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !SLUG_STOPWORDS.has(w));
  return sanitizeSlug(words.slice(0, 4).join('-'));
}

function guessExtension(url) {
  const m = /\.([a-zA-Z0-9]{2,5})(?:\?|#|$)/.exec((url || '').split('?')[0]);
  return m ? m[1].toLowerCase() : 'png';
}

function buildFileName(entry, role, url) {
  const d = new Date(entry.createdAt || Date.now());
  const yy = String(d.getFullYear() % 100).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');

  const project = sanitizeSlug(entry.projectName || 'OhneProjekt');
  const manualSlug = role === 'start' ? entry.startSlug : entry.endSlug;
  const promptText = role === 'start' ? entry.promptStart : entry.promptEnd;
  const keyword = sanitizeSlug(manualSlug || deriveSlugFromPrompt(promptText));
  const ratio = (entry.aspectRatio || 'auto').replace(/:/g, 'zu');
  const model = MODEL_FILE_SLUGS[entry.modelKey] || sanitizeSlug(entry.modelLabel || 'Modell');
  const ext = guessExtension(url);

  return `${yy}${mm}${dd}_${project}_${keyword}_${ratio}_${model}.${ext}`;
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
