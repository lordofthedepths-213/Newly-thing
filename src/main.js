import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { UTILITIES, LOCATE_METHODS, utilityById } from './utilities.js';
import { loadState, saveState, makeId } from './store.js';
import {
  lineLengthMeters,
  parseDepth,
  depthValue,
  formatDepth,
  formatLength,
  depthRange,
  toGeoJSON,
  fromGeoJSON,
} from './geo.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const state = loadState();
const unit = () => state.settings.unit;
let draft = null; // utility currently being drawn/edited on the map
let lastFix = null; // most recent GPS position

function persist() {
  if (!saveState(state)) toast('Could not save — device storage is full');
}

/* ------------------------------------------------------------------ map */

const map = L.map('map', { zoomControl: false, maxZoom: 21, attributionControl: true }).setView(
  [39.5, -98.35],
  4,
);
map.attributionControl.setPrefix(false);

const baseLayers = {
  street: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 21,
    maxNativeZoom: 19,
    attribution: '© OpenStreetMap contributors',
  }),
  satellite: L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 21, maxNativeZoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
  ),
};

function applyBase() {
  const which = state.settings.base === 'satellite' ? 'satellite' : 'street';
  Object.values(baseLayers).forEach((l) => map.removeLayer(l));
  baseLayers[which].addTo(map);
  $('#btn-base').textContent = which === 'street' ? 'Satellite' : 'Street map';
}

const featureLayer = L.layerGroup().addTo(map);
const draftLayer = L.layerGroup().addTo(map);
const meLayer = L.layerGroup().addTo(map);

const updateLabelVisibility = () =>
  $('#map').classList.toggle('show-labels', map.getZoom() >= 17);
map.on('zoomend', updateLabelVisibility);

function drawFeature(f, group, { interactive, numbered }) {
  const u = utilityById(f.type);
  const latlngs = f.points.map((p) => [p.lat, p.lng]);
  const open = interactive ? () => showDetails(f.id) : null;

  if (latlngs.length > 1) {
    // Dark casing keeps every colour (white and yellow especially) visible on any basemap.
    L.polyline(latlngs, { color: '#0b0d11', weight: 9, opacity: 0.9, interactive: false }).addTo(group);
    L.polyline(latlngs, {
      color: u.color,
      weight: 5,
      dashArray: f.type === 'proposed' ? '10 9' : null,
      interactive: false,
    }).addTo(group);
    if (open) {
      // Wide invisible line so the utility is easy to tap with a finger.
      L.polyline(latlngs, { color: '#000', weight: 28, opacity: 0 }).on('click', open).addTo(group);
    }
  }

  f.points.forEach((p, i) => {
    let marker;
    if (numbered) {
      marker = L.marker([p.lat, p.lng], {
        interactive: false,
        icon: L.divIcon({
          className: '',
          iconSize: [24, 24],
          html: `<div class="vertex-num" style="background:${u.color}">${i + 1}</div>`,
        }),
      });
    } else {
      marker = L.circleMarker([p.lat, p.lng], {
        radius: latlngs.length === 1 ? 9 : 5,
        color: '#0b0d11',
        weight: 2,
        fillColor: u.color,
        fillOpacity: 1,
        interactive: !!open,
      });
      if (open) marker.on('click', open);
    }
    if (p.depth != null) {
      marker.bindTooltip(formatDepth(p.depth, unit()), {
        permanent: true,
        direction: 'top',
        offset: [0, numbered ? -12 : -6],
        className: 'depth-label',
      });
    }
    marker.addTo(group);
  });
}

function render() {
  featureLayer.clearLayers();
  draftLayer.clearLayers();
  const hidden = state.settings.hidden;
  for (const f of state.features) {
    if (hidden.includes(f.type)) continue;
    if (draft && f.id === draft.id) continue;
    drawFeature(f, featureLayer, { interactive: !draft, numbered: false });
  }
  if (draft) drawFeature(draft, draftLayer, { interactive: false, numbered: true });
  updateLabelVisibility();
}

function renderLegend() {
  const hidden = state.settings.hidden;
  $('#legend').innerHTML = UTILITIES.map(
    (u) => `<button type="button" class="chip ${hidden.includes(u.id) ? 'off' : ''}" data-type="${u.id}"
      aria-pressed="${!hidden.includes(u.id)}">
      <span class="swatch" style="background:${u.color}"></span>${esc(u.label)}</button>`,
  ).join('');
}

$('#legend').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  const id = chip.dataset.type;
  const hidden = state.settings.hidden;
  state.settings.hidden = hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id];
  persist();
  renderLegend();
  render();
});

$('#btn-base').addEventListener('click', () => {
  state.settings.base = state.settings.base === 'satellite' ? 'street' : 'satellite';
  persist();
  applyBase();
});

function zoomTo(f) {
  const b = L.latLngBounds(f.points.map((p) => [p.lat, p.lng]));
  map.fitBounds(b, { padding: [60, 60], maxZoom: 19 });
}

/* ------------------------------------------------------------------ GPS */

let watchId = null;

function showMe(pos) {
  lastFix = {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracy: pos.coords.accuracy,
    time: Date.now(),
  };
  meLayer.clearLayers();
  L.circle([lastFix.lat, lastFix.lng], {
    radius: lastFix.accuracy,
    color: '#4c9dff',
    weight: 1,
    fillOpacity: 0.12,
    interactive: false,
  }).addTo(meLayer);
  L.marker([lastFix.lat, lastFix.lng], {
    interactive: false,
    icon: L.divIcon({ className: '', iconSize: [18, 18], html: '<div class="me-dot"></div>' }),
  }).addTo(meLayer);
}

function startGps(thenCenter) {
  if (!navigator.geolocation) {
    toast('This device does not provide location');
    return;
  }
  let center = thenCenter;
  if (watchId == null) {
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        showMe(pos);
        $('#btn-locate').classList.add('on');
        if (center) {
          map.setView([lastFix.lat, lastFix.lng], Math.max(map.getZoom(), 18));
          center = false;
        }
      },
      (err) => {
        toast(err.code === 1 ? 'Location permission denied — allow it in settings' : 'Could not get a GPS position');
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
        $('#btn-locate').classList.remove('on');
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
  } else if (center && lastFix) {
    map.setView([lastFix.lat, lastFix.lng], Math.max(map.getZoom(), 18));
  }
}

$('#btn-locate').addEventListener('click', () => startGps(true));

/* ---------------------------------------------------------------- sheet */

const sheet = $('#sheet');
const scrim = $('#scrim');

function openSheet(title, bodyHtml, footHtml = '') {
  sheet.innerHTML = `
    <div class="sheet-head"><h2>${title}</h2>
      <button type="button" class="sheet-close" data-act="close" aria-label="Close">✕</button></div>
    <div class="sheet-body">${bodyHtml}</div>
    ${footHtml ? `<div class="sheet-foot">${footHtml}</div>` : ''}`;
  sheet.hidden = false;
  scrim.hidden = false;
  $('.sheet-body', sheet).scrollTop = 0;
}

function closeSheet() {
  sheet.hidden = true;
  scrim.hidden = true;
  sheet.innerHTML = '';
  sheet.onclick = null;
}

scrim.addEventListener('click', () => $('[data-act="close"]', sheet)?.click());

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3500);
}

const swatch = (type) => `<span class="swatch" style="background:${utilityById(type).color}"></span>`;

function summary(f) {
  const bits = [];
  bits.push(f.points.length === 1 ? 'Point' : formatLength(lineLengthMeters(f.points), unit()));
  const r = depthRange(f.points);
  if (r) {
    bits.push(
      r.min === r.max
        ? `${formatDepth(r.min, unit())} deep`
        : `${depthValue(r.min, unit())}–${formatDepth(r.max, unit())} deep`,
    );
  }
  if (f.installDate) bits.push(formatDate(f.installDate));
  return bits.join(' · ');
}

function formatDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

const displayName = (f) => f.name || `${utilityById(f.type).label} ${f.points.length === 1 ? 'point' : 'line'}`;

/* ---------------------------------------------------- add: choose type */

function chooseType() {
  openSheet(
    'What are you mapping?',
    `<div class="type-grid">${UTILITIES.map(
      (u) => `<button type="button" class="type-btn" data-type="${u.id}">
        <span class="swatch" style="background:${u.color}"></span>${esc(u.label)}</button>`,
    ).join('')}</div>
    <p class="note">White is for a proposed new utility installation or construction that is not in the ground yet.</p>`,
  );
  sheet.onclick = (e) => {
    if (e.target.closest('[data-act="close"]')) return closeSheet();
    const btn = e.target.closest('.type-btn');
    if (!btn) return;
    closeSheet();
    startDraw({
      id: makeId(),
      isNew: true,
      type: btn.dataset.type,
      name: '',
      installDate: '',
      size: '',
      material: '',
      locateMethod: btn.dataset.type === 'proposed' ? 'Design (proposed)' : '',
      notes: '',
      points: [],
    });
  };
}

$('#btn-add').addEventListener('click', chooseType);

/* ------------------------------------------------------------- drawing */

const drawbar = $('#drawbar');

function setChrome(drawing) {
  $('#btn-add').hidden = drawing;
  $('#btn-menu').disabled = drawing;
  $('#btn-locate').style.bottom = drawing ? 'calc(var(--bottom) + 232px)' : '';
}

function startDraw(d) {
  draft = d;
  setChrome(true);
  drawbar.hidden = false;
  drawbar.innerHTML = `
    <div class="status">${swatch(draft.type)}<span id="draw-status"></span></div>
    <div class="hint">Tap the map along the utility. One point = valve, manhole or meter.</div>
    <label class="depth-row">Depth of next point
      <input id="draw-depth" type="number" inputmode="decimal" min="0" step="0.1" placeholder="optional" />
      ${unit()}</label>
    <div class="btn-row">
      <button type="button" class="btn" data-act="gps">Point at my GPS</button>
      <button type="button" class="btn" data-act="undo">Undo</button>
    </div>
    <div class="btn-row" style="margin-top:8px">
      <button type="button" class="btn" data-act="cancel">Cancel</button>
      <button type="button" class="btn primary" data-act="done">Done</button>
    </div>`;
  updateDrawStatus();
  render();
}

function updateDrawStatus() {
  const n = draft.points.length;
  const len = n > 1 ? ` · ${formatLength(lineLengthMeters(draft.points), unit())}` : '';
  $('#draw-status').textContent = `${utilityById(draft.type).label}: ${n} point${n === 1 ? '' : 's'}${len}`;
  $('[data-act="undo"]', drawbar).disabled = n === 0;
  $('[data-act="done"]', drawbar).disabled = n === 0;
}

function addDraftPoint(lat, lng) {
  const depth = parseDepth($('#draw-depth').value, unit());
  draft.points.push({ lat, lng, depth });
  updateDrawStatus();
  render();
}

function endDraw() {
  draft = null;
  drawbar.hidden = true;
  drawbar.innerHTML = '';
  setChrome(false);
  render();
}

map.on('click', (e) => {
  if (draft && sheet.hidden) addDraftPoint(e.latlng.lat, e.latlng.lng);
});

drawbar.addEventListener('click', (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act || !draft) return;
  if (act === 'undo') {
    draft.points.pop();
    updateDrawStatus();
    render();
  } else if (act === 'cancel') {
    if (draft.points.length && draft.isNew && !confirm('Discard this utility?')) return;
    endDraw();
  } else if (act === 'done') {
    openForm();
  } else if (act === 'gps') {
    startGps(false);
    if (!lastFix || Date.now() - lastFix.time > 15000) {
      toast('Waiting for a GPS position — try again in a moment');
      return;
    }
    addDraftPoint(lastFix.lat, lastFix.lng);
    map.panTo([lastFix.lat, lastFix.lng]);
    toast(`Point added — GPS accuracy ±${formatLength(lastFix.accuracy, unit())}`);
  }
});

/* ---------------------------------------------------------------- form */

function openForm() {
  const f = draft;
  const proposed = () => $('#f-type', sheet).value === 'proposed';
  const today = new Date().toISOString().slice(0, 10);

  openSheet(
    f.isNew ? 'Utility details' : 'Edit utility',
    `<form id="utility-form" autocomplete="off">
      <label class="field">Utility type
        <select id="f-type">${UTILITIES.map(
          (u) => `<option value="${u.id}" ${u.id === f.type ? 'selected' : ''}>${esc(u.label)}</option>`,
        ).join('')}</select></label>
      <label class="field">Name / description
        <input id="f-name" type="text" maxlength="80" placeholder="e.g. 8 in main, Elm St" value="${esc(f.name)}" /></label>
      <label class="field"><span id="f-date-label"></span>
        <input id="f-date" type="date" value="${esc(f.installDate)}" /></label>
      <div class="two-col">
        <label class="field">Size
          <input id="f-size" type="text" maxlength="40" placeholder="e.g. 8 in" value="${esc(f.size)}" /></label>
        <label class="field">Material
          <input id="f-material" type="text" maxlength="40" placeholder="e.g. PVC" value="${esc(f.material)}" /></label>
      </div>
      <label class="field">How was it located?
        <select id="f-method"><option value="">Not recorded</option>${LOCATE_METHODS.map(
          (m) => `<option ${m === f.locateMethod ? 'selected' : ''}>${esc(m)}</option>`,
        ).join('')}</select></label>
      <label class="field">Notes
        <textarea id="f-notes" maxlength="1000">${esc(f.notes)}</textarea></label>

      <div class="section-title">Depth at each point (${unit()} below ground)</div>
      <div class="pt-row" style="border:0">
        <span></span><span>Set every point to</span>
        <input id="f-all-depth" type="number" inputmode="decimal" min="0" step="0.1" placeholder="depth" />
      </div>
      ${f.points
        .map(
          (p, i) => `<div class="pt-row"><span class="pt-num">${i + 1}</span>
          <span>${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</span>
          <input class="f-depth" data-i="${i}" type="number" inputmode="decimal" min="0" step="0.1"
            placeholder="depth" value="${depthValue(p.depth, unit())}" aria-label="Depth at point ${i + 1}" /></div>`,
        )
        .join('')}
    </form>`,
    `<div class="btn-row">
      <button type="button" class="btn" data-act="points">Edit points on map</button>
      <button type="button" class="btn primary" data-act="save">Save</button>
    </div>`,
  );

  const syncDateLabel = () => {
    $('#f-date-label', sheet).textContent = proposed() ? 'Planned installation date' : 'Date of installation';
    // Existing utilities cannot have been installed in the future.
    $('#f-date', sheet).max = proposed() ? '' : today;
  };
  syncDateLabel();
  $('#f-type', sheet).addEventListener('change', syncDateLabel);
  $('#f-all-depth', sheet).addEventListener('input', (e) => {
    sheet.querySelectorAll('.f-depth').forEach((inp) => (inp.value = e.target.value));
  });

  const readForm = () => {
    f.type = $('#f-type', sheet).value;
    f.name = $('#f-name', sheet).value.trim();
    f.installDate = $('#f-date', sheet).value;
    f.size = $('#f-size', sheet).value.trim();
    f.material = $('#f-material', sheet).value.trim();
    f.locateMethod = $('#f-method', sheet).value;
    f.notes = $('#f-notes', sheet).value.trim();
    sheet.querySelectorAll('.f-depth').forEach((inp) => {
      f.points[+inp.dataset.i].depth = parseDepth(inp.value, unit());
    });
  };

  sheet.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    readForm();
    if (act === 'close' || act === 'points') {
      // Back to the map with everything typed so far kept in the draft.
      closeSheet();
      startDraw(f);
      return;
    }
    if (act === 'save') {
      if (!proposed() && f.installDate > today) {
        toast('Installation date cannot be in the future for an existing utility');
        return;
      }
      const { isNew, ...record } = f;
      record.updatedAt = new Date().toISOString();
      if (isNew) {
        record.createdAt = record.updatedAt;
        state.features.push(record);
      } else {
        state.features = state.features.map((x) => (x.id === record.id ? record : x));
      }
      // Make sure the saved utility is not hidden by a legend filter.
      state.settings.hidden = state.settings.hidden.filter((h) => h !== record.type);
      persist();
      closeSheet();
      endDraw();
      renderLegend();
      toast('Saved');
    }
  };
}

/* ------------------------------------------------------------- details */

function showDetails(id) {
  const f = state.features.find((x) => x.id === id);
  if (!f) return;
  const u = utilityById(f.type);
  const r = depthRange(f.points);
  const depthText = !r
    ? 'Not recorded'
    : r.min === r.max
      ? formatDepth(r.min, unit())
      : `${depthValue(r.min, unit())} – ${formatDepth(r.max, unit())}`;
  const row = (k, v) => (v ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '');

  openSheet(
    `${swatch(f.type)} ${esc(displayName(f))}`,
    `<dl class="facts">
      ${row('Type', u.label)}
      ${row(f.type === 'proposed' ? 'Planned install' : 'Installed', f.installDate ? formatDate(f.installDate) : 'Not recorded')}
      ${row('Depth', depthText)}
      ${row('Length', f.points.length > 1 ? formatLength(lineLengthMeters(f.points), unit()) : '')}
      ${row('Size', f.size)}
      ${row('Material', f.material)}
      ${row('Located by', f.locateMethod)}
      ${row('Notes', f.notes)}
    </dl>
    <div class="section-title">Points</div>
    ${f.points
      .map(
        (p, i) => `<div class="pt-row"><span class="pt-num">${i + 1}</span>
        <span>${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}</span>
        <span>${formatDepth(p.depth, unit())}</span></div>`,
      )
      .join('')}`,
    `<div class="btn-row">
      <button type="button" class="btn danger" data-act="delete">Delete</button>
      <button type="button" class="btn" data-act="zoom">Zoom to</button>
      <button type="button" class="btn primary" data-act="edit">Edit</button>
    </div>`,
  );

  sheet.onclick = (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') closeSheet();
    else if (act === 'zoom') {
      closeSheet();
      zoomTo(f);
    } else if (act === 'edit') {
      closeSheet();
      draft = structuredClone(f);
      setChrome(true);
      render();
      openForm();
    } else if (act === 'delete') {
      if (!confirm(`Delete “${displayName(f)}”? This cannot be undone.`)) return;
      state.features = state.features.filter((x) => x.id !== f.id);
      persist();
      closeSheet();
      render();
      toast('Deleted');
    }
  };
}

/* ---------------------------------------------------------------- menu */

function showMenu() {
  const items = [...state.features].sort(
    (a, b) =>
      UTILITIES.findIndex((u) => u.id === a.type) - UTILITIES.findIndex((u) => u.id === b.type) ||
      displayName(a).localeCompare(displayName(b)),
  );
  openSheet(
    `Utilities (${items.length})`,
    `${
      items.length
        ? items
            .map(
              (f) => `<button type="button" class="list-item" data-id="${f.id}">${swatch(f.type)}
              <span class="main"><span class="title">${esc(displayName(f))}</span>
              <span class="sub">${esc(summary(f))}</span></span></button>`,
            )
            .join('')
        : '<p class="empty">Nothing mapped yet. Tap “+ Add utility” to start.</p>'
    }
    <div class="section-title">Settings &amp; data</div>
    <div class="stack">
      <div class="btn-row">
        <button type="button" class="btn" data-act="unit">Depth units: ${unit() === 'ft' ? 'feet' : 'metres'}</button>
        <button type="button" class="btn" data-act="fit" ${items.length ? '' : 'disabled'}>Show all on map</button>
      </div>
      <div class="btn-row">
        <button type="button" class="btn" data-act="export" ${items.length ? '' : 'disabled'}>Export (GeoJSON)</button>
        <button type="button" class="btn" data-act="import">Import</button>
      </div>
    </div>
    <p class="note"><strong>Safety:</strong> a phone cannot sense buried utilities by itself. This app records
      and maps positions and depths you measure with a locator, ground-penetrating radar, potholing,
      mark-outs or record drawings. Phone GPS is typically accurate to only 3–10 m (10–30 ft). Always
      call 811 (or your local one-call service) and verify before you dig.</p>`,
  );

  sheet.onclick = (e) => {
    const item = e.target.closest('.list-item');
    if (item) {
      const f = state.features.find((x) => x.id === item.dataset.id);
      state.settings.hidden = state.settings.hidden.filter((h) => h !== f.type);
      persist();
      renderLegend();
      render();
      zoomTo(f);
      showDetails(f.id);
      return;
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') closeSheet();
    else if (act === 'unit') {
      state.settings.unit = unit() === 'ft' ? 'm' : 'ft';
      persist();
      render();
      showMenu();
    } else if (act === 'fit') {
      closeSheet();
      fitAll();
    } else if (act === 'export') exportData();
    else if (act === 'import') $('#file-import').click();
  };
}

$('#btn-menu').addEventListener('click', showMenu);

function fitAll() {
  const pts = state.features.flatMap((f) => f.points.map((p) => [p.lat, p.lng]));
  if (pts.length) map.fitBounds(L.latLngBounds(pts), { padding: [70, 70], maxZoom: 19 });
}

async function exportData() {
  const name = `utility-map-${new Date().toISOString().slice(0, 10)}.geojson`;
  const text = JSON.stringify(toGeoJSON(state.features), null, 2);
  const file = new File([text], name, { type: 'application/geo+json' });
  // The share sheet is the reliable way to hand a file to Files/Drive/email on phones.
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Utility map' });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

$('#file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const added = fromGeoJSON(JSON.parse(await file.text()), makeId);
    if (!added.length) throw new Error('No utilities found in that file');
    const now = new Date().toISOString();
    added.forEach((f) => Object.assign(f, { createdAt: now, updatedAt: now }));
    state.features.push(...added);
    persist();
    closeSheet();
    render();
    fitAll();
    toast(`Imported ${added.length} utilit${added.length === 1 ? 'y' : 'ies'}`);
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  }
});

/* ---------------------------------------------------------------- boot */

applyBase();
renderLegend();
render();
if (state.features.length) fitAll();
else startGps(true);

// Offline support when served over https (not needed inside the native app shell).
if ('serviceWorker' in navigator && !window.Capacitor && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Small hook used by automated checks.
window.__utilityMapper = { map, state };
