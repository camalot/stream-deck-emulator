import { keyUrl, stripUrl, screenUrl } from './api.js';

const LONG_PRESS_MS = 500;
const DRAG_PX = 20;
const TOUCH_SHORT = 1,
  TOUCH_LONG = 2,
  TOUCH_DRAG = 3;
const DIAL_STEP_DEG = 12;
const DIAL_DRAG_PX = 16;
const DIAL_DRAG_START_PX = 6;
const DIAL_PRESS_MS = 150;
// A real panel at 0% brightness is dim, not black.
const MIN_BRIGHTNESS = 0.25;
const RGB_HEX_DIGITS = 6;

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  parent?.append(node);
  return node;
}

// picture makes an image that keeps its old picture on screen until the next
// one has loaded, and goes blank when the device has none. Coalesce updates
// during a download rather than replacing src and aborting the response.
function picture(className, parent, url) {
  const img = el('img', className, parent);
  img.alt = '';
  img.draggable = false;
  let loading = false;
  let pending = false;
  img.refresh = () => {
    if (loading) {
      pending = true;
      return;
    }
    loading = true;
    pending = false;
    img.src = url();
  };
  const finish = () => {
    loading = false;
    if (pending) img.refresh();
  };
  img.addEventListener('load', finish);
  img.addEventListener('error', () => {
    img.removeAttribute('src');
    finish();
  });
  return img;
}

// pressable reports presses of node, releasing it when the pointer leaves.
function pressable(node, report) {
  let down = false;
  const set = (value) => {
    if (down === value) return;
    down = value;
    node.classList.toggle('down', value);
    report(value);
  };
  node.addEventListener('pointerdown', () => set(true));
  node.addEventListener('pointerup', () => set(false));
  node.addEventListener('pointerleave', () => set(false));
}

function buildKey(deck, info, send, index) {
  const key = el('div', 'key', deck.panel);
  deck.keys[index] = picture(info.quarterTurn ? 'face quarter-turn' : info.rotated ? 'face rotated' : 'face', key, () => keyUrl(info.id, index));
  pressable(key, (down) => send({ type: 'key', index, down }));
  return key;
}

function buildStrip(deck, info, send) {
  const { w, h } = info.strip;
  const strip = (deck.strip = picture('strip', deck.panel, () => stripUrl(info.id)));
  strip.style.setProperty('--w', w);
  strip.style.setProperty('--h', h);
  const point = (e) => {
    const r = strip.getBoundingClientRect();
    const clamp = (v, max) => Math.max(0, Math.min(max - 1, Math.round(v)));
    return { x: clamp(((e.clientX - r.left) * w) / r.width, w), y: clamp(((e.clientY - r.top) * h) / r.height, h) };
  };
  let start = null;
  strip.addEventListener('pointerdown', (e) => {
    strip.setPointerCapture(e.pointerId);
    start = { ...point(e), time: performance.now() };
  });
  strip.addEventListener('pointerup', (e) => {
    if (!start) return;
    const from = start,
      to = point(e);
    start = null;
    if (Math.hypot(to.x - from.x, to.y - from.y) > DRAG_PX) {
      send({ type: 'touch', kind: TOUCH_DRAG, x: from.x, y: from.y, x2: to.x, y2: to.y });
    } else {
      const kind = performance.now() - from.time >= LONG_PRESS_MS ? TOUCH_LONG : TOUCH_SHORT;
      send({ type: 'touch', kind, x: from.x, y: from.y });
    }
  });
  strip.addEventListener('pointercancel', () => {
    start = null;
  });
  return strip;
}

function buildDial(deck, send, index) {
  // Rotate the face, not the positioned hit target.
  const target = el('div', 'dial-target', deck.panel);
  const dial = el('div', 'dial', target);
  let angle = 0;
  const rotate = (ticks) => {
    angle += ticks * DIAL_STEP_DEG;
    dial.style.rotate = `${angle}deg`;
    send({ type: 'dialRotate', index, ticks });
  };
  target.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      rotate(e.deltaY < 0 ? 1 : -1);
    },
    { passive: false },
  );
  dragDial(target, rotate, (down) => {
    dial.classList.toggle('down', down);
    send({ type: 'dialPress', index, down });
  });
  return target;
}

// dragDial turns a pointer (mouse or touch) on node into presses and
// rotation: a drag in any direction rotates by one tick per DIAL_DRAG_PX of
// net travel, where right and up are positive and left and down negative, so
// a diagonal drag turns by the difference of its two axes. Anything else is a
// press. The press starts after DIAL_PRESS_MS or on release, and a drag
// cancels it, so a swipe never presses the dial.
function dragDial(node, rotate, press) {
  let active = null;
  const setDown = (value) => {
    if (!active || active.down === value) return;
    active.down = value;
    node.classList.toggle('down', value);
    press(value);
  };
  const finish = () => {
    if (!active) return;
    clearTimeout(active.timer);
    if (!active.dragged) setDown(true);
    setDown(false);
    active = null;
  };
  node.addEventListener('pointerdown', (e) => {
    if (active) return;
    node.setPointerCapture?.(e.pointerId);
    active = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      travel: 0,
      down: false,
      dragged: false,
      timer: setTimeout(() => setDown(true), DIAL_PRESS_MS),
    };
  });
  node.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== active.id) return;
    const dx = e.clientX - active.x;
    const dy = e.clientY - active.y;
    if (!active.dragged && Math.hypot(dx, dy) < DIAL_DRAG_START_PX) return;
    if (!active.dragged) {
      active.dragged = true;
      clearTimeout(active.timer);
      setDown(false);
    }
    active.x = e.clientX;
    active.y = e.clientY;
    // Screen y grows downwards, so up counts as positive.
    active.travel += dx - dy;
    const ticks = Math.trunc(active.travel / DIAL_DRAG_PX);
    if (ticks) {
      active.travel -= ticks * DIAL_DRAG_PX;
      rotate(ticks);
    }
  });
  node.addEventListener('pointerup', finish);
  node.addEventListener('pointercancel', () => {
    if (active) active.dragged = true;
    finish();
  });
}

function buildTouchKey(deck, info, send, index) {
  const node = (deck.touchKeys[index] = el('div', 'touchkey', deck.panel));
  pressable(node, (down) => send({ type: 'key', index: info.rows * info.cols + index, down }));
  return node;
}

function buildScreen(deck, info) {
  const screen = el('div', 'screen', deck.panel);
  deck.screen = picture(info.rotated ? 'face rotated' : 'face', screen, () => screenUrl(info.id));
  return screen;
}

// Layout geometry is presentation-only; every input and image uses source indices.
export function createDeck(info, layout, send) {
  const deck = { panel: el('div', 'panel'), keys: [], touchKeys: [], strip: null, screen: null };
  deck.panel.dataset.model = info.id;
  deck.panel.dataset.layout = layout.id;
  deck.panel.style.setProperty('--layout-width', layout.width);
  deck.panel.style.setProperty('--layout-height', layout.height);
  for (const item of layout.elements) {
    let node;
    switch (item.type) {
      case 'key':
        node = buildKey(deck, info, send, item.index);
        break;
      case 'dial':
        node = buildDial(deck, send, item.index);
        break;
      case 'strip':
        node = buildStrip(deck, info, send);
        break;
      case 'touchKey':
        node = buildTouchKey(deck, info, send, item.index);
        break;
      case 'screen':
        node = buildScreen(deck, info);
        break;
      default:
        throw new Error(`Unknown layout element: ${item.type}`);
    }
    node.dataset.index = item.index;
    node.style.left = `${(item.x / layout.width) * 100}%`;
    node.style.top = `${(item.y / layout.height) * 100}%`;
    node.style.width = `${(item.width / layout.width) * 100}%`;
    node.style.height = `${(item.height / layout.height) * 100}%`;
  }

  const hints = [];
  if (info.dials) hints.push('hint.dial');
  if (info.strip) hints.push('hint.strip');
  if (info.touchKeys) hints.push('hint.touchkey');

  const refreshKey = (i) => {
    deck.keys[i].refresh();
  };
  const refreshStrip = () => {
    if (deck.strip) deck.strip.refresh();
  };
  const refreshScreen = () => {
    if (deck.screen) deck.screen.refresh();
  };

  return {
    panel: deck.panel,
    hints,
    refreshKey,
    refreshStrip,
    refreshScreen,
    refreshAll() {
      deck.keys.forEach((_, i) => refreshKey(i));
      refreshStrip();
      refreshScreen();
    },
    setTouchColor(i, rgb) {
      const node = deck.touchKeys[i];
      if (!node) return;
      if (rgb) node.style.setProperty('--color', `#${rgb.toString(16).padStart(RGB_HEX_DIGITS, '0')}`);
      else node.style.removeProperty('--color');
    },
    setBrightness(percent) {
      deck.panel.style.setProperty('--brightness', MIN_BRIGHTNESS + ((1 - MIN_BRIGHTNESS) * percent) / 100);
    },
  };
}
