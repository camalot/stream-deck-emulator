import * as api from './api.js';
import { createDeck } from './deck.js';
import { loadFallback, pickLang, setLang, t, translate } from './i18n.js';

const card = document.getElementById('device');
const picker = document.getElementById('picker');
const statusLamp = document.getElementById('status');
const toggle = document.getElementById('toggle');
const notice = document.getElementById('notice');
const stage = document.getElementById('stage');
const hints = document.getElementById('hints');

// kioskId selects the view of a /kiosk/<layout-id> page.
const kioskId = decodeURIComponent(location.pathname.match(/^\/kiosk\/([^/]+)\/?$/)?.[1] ?? '') || null;
if (kioskId) document.body.classList.add('kiosk');

const devices = new Map();
const layouts = new Map();
// The layout on the page.
let current = null;

function isLive(d) {
  return d.link.state === 'connected' || d.link.state === 'connecting';
}

function renderLink(d) {
  const { state } = d.link;
  d.option.textContent = isLive(d) ? `${d.layout.name} (${t(`status.${state}`)})` : d.layout.name;
  if (d === current) renderBar();
}

// renderBar shows the link of the current device in the controls above it.
function renderBar() {
  const { state, code, detail } = current.link;
  card.classList.toggle('off', state !== 'connected');
  statusLamp.dataset.state = state;
  statusLamp.title = t(`status.${state}`);
  statusLamp.setAttribute('aria-label', statusLamp.title);
  toggle.textContent = t(isLive(current) ? 'action.disconnect' : 'action.connect');
  const shown = current.actionError ?? code;
  notice.replaceChildren(...linked(shown ? t(`error.${shown}`, { detail: detail ?? '' }) : ''));
}

// linked splits text into nodes, turning the https links in it into anchors.
function linked(text) {
  return text.split(/(https:\/\/\S+)/).map((part, i) => {
    if (i % 2 === 0) return part;
    const a = document.createElement('a');
    a.href = a.textContent = part;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  });
}

function renderText() {
  document.title = t('app.title');
  picker.setAttribute('aria-label', t('device.label'));
  translate(document);
  for (const d of layouts.values()) renderLink(d);
}

function addLayout(info, layout) {
  const d = { info, link: info.link, actionError: null };
  d.layout = layout;
  d.deck = createDeck(info, layout, (body) => api.sendInput(info.id, body));
  d.deck.panel.hidden = true;
  stage.append(d.deck.panel);
  d.option = new Option('', layout.id);
  picker.add(d.option);
  layouts.set(layout.id, d);
}

function savedDevice() {
  try {
    return localStorage.getItem('device');
  } catch {
    return null;
  }
}

// pickDevice prefers the last choice, then a device that is already live.
function pickDevice() {
  if (kioskId) return kioskId;
  const saved = savedDevice();
  if (layouts.has(saved)) return saved;
  const live = [...layouts.values()].find(isLive);
  return (live ?? layouts.values().next().value)?.layout.id;
}

function showDevice(id) {
  current = layouts.get(id) ?? null;
  if (!current) return;
  for (const d of layouts.values()) d.deck.panel.hidden = d !== current;
  picker.value = id;
  hints.replaceChildren();
  for (const key of current.deck.hints) {
    const line = document.createElement('p');
    line.className = 'hint';
    line.dataset.i18n = key;
    line.textContent = t(key);
    hints.append(line);
  }
  if (!kioskId) {
    try {
      localStorage.setItem('device', id);
    } catch {
      /* private mode */
    }
  }
  renderBar();
}

// Fan source-device events out to every view of that device.
const known =
  (fn) =>
  (id, ...args) => {
    for (const d of layouts.values()) {
      if (d.info.id === id) fn(d, ...args);
    }
  };

function listen() {
  api.listen({
    open: () => layouts.forEach((d) => d.deck.refreshAll()),
    key: known((d, index) => d.deck.refreshKey(index)),
    strip: known((d) => d.deck.refreshStrip()),
    screen: known((d) => d.deck.refreshScreen()),
    touchkey: known((d, index, rgb) => d.deck.setTouchColor(index, rgb)),
    brightness: known((d, percent) => d.deck.setBrightness(percent)),
    reset: known((d) => {
      d.deck.refreshAll();
      for (let i = 0; i < d.info.touchKeys; i++) d.deck.setTouchColor(i, 0);
    }),
    link: known((d, status) => {
      d.link = status;
      d.actionError = null;
      renderLink(d);
    }),
  });
}

async function init() {
  await loadFallback();
  const [deviceList, layoutList] = await Promise.all([api.listDevices(), api.listLayouts()]);
  for (const info of deviceList) devices.set(info.id, info);
  for (const layout of layoutList) {
    const info = devices.get(layout.sourceId);
    if (!info) throw new Error(`Unknown layout source: ${layout.sourceId}`);
    if (!kioskId || layout.id === kioskId) addLayout(info, layout);
  }
  picker.addEventListener('change', () => showDevice(picker.value));
  toggle.addEventListener('click', async () => {
    const d = current;
    if (!d) return;
    d.actionError = await (isLive(d) ? api.disconnect : api.connect)(d.info.id);
    renderLink(d);
  });
  showDevice(pickDevice());
  await setLang(pickLang());
  renderText();
  listen();
  if (kioskId && current && !isLive(current)) {
    current.actionError = await api.connect(current.info.id);
    renderLink(current);
  }
}

init().catch((error) => {
  notice.textContent = error.message;
  console.error(error);
});
