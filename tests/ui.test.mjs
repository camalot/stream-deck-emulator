import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import { createDeck } from '../internal/ui/static/js/deck.js';

class Node {
  children = [];
  dataset = {};
  listeners = new Map();
  attributes = new Map();
  classes = new Set();
  style = {
    setProperty(name, value) {
      this[name] = value;
    },
    removeProperty(name) {
      delete this[name];
    },
  };
  classList = {
    add: (name) => this.classes.add(name),
    toggle: (name, value) => (value ? this.classes.add(name) : this.classes.delete(name)),
  };
  constructor(tag = 'div', className = '') {
    this.tagName = tag;
    this.className = className;
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  add(node) {
    this.append(node);
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }
  removeAttribute(name) {
    this.attributes.delete(name);
  }
  addEventListener(name, listener) {
    this.listeners.set(name, listener);
  }
  emit(name, event = {}) {
    return this.listeners.get(name)?.(event);
  }
  setPointerCapture() {}
  getBoundingClientRect() {
    return { left: 10, top: 20, width: 600, height: 50 };
  }
}

function documentFixture() {
  const ids = new Map(['device', 'picker', 'status', 'toggle', 'notice', 'stage', 'hints'].map((id) => [id, new Node()]));
  globalThis.document = {
    createElement: (tag) => new Node(tag),
    getElementById: (id) => ids.get(id),
    querySelectorAll: () => [],
    documentElement: {},
    body: new Node(),
  };
  return ids;
}

const info = {
  id: 'plus-xl',
  name: 'Stream Deck + XL',
  rows: 4,
  cols: 9,
  dials: 6,
  quarterTurn: true,
  strip: { w: 1200, h: 100 },
  touchKeys: 0,
  link: { id: 'plus-xl', state: 'disconnected' },
};
const layout = {
  id: 'custom',
  name: 'Custom XL',
  sourceId: 'plus-xl',
  width: 25.8,
  height: 4.54,
  elements: [
    ...Array.from({ length: 36 }, (_, index) => ({
      type: 'key',
      index,
      x: 1.36 + (index % 18) * 1.3,
      y: 0.2 + Math.floor(index / 18) * 1.24,
      width: 1,
      height: 1,
    })),
    { type: 'strip', index: 0, x: 1.36, y: 2.58, width: 23.08, height: 1.923333 },
    ...Array.from({ length: 6 }, (_, index) => ({
      type: 'dial',
      index,
      x: index < 3 ? 0.1 : 24.9,
      y: 0.32 + (index % 3) * 1.64,
      width: 0.8,
      height: 0.8,
    })),
  ],
};

test('layout geometry preserves source indices, images and input coordinates', () => {
  documentFixture();
  const inputs = [];
  // Deliberately change DOM order to prove it is not the HID/image order.
  const shuffled = { ...layout, elements: [...layout.elements].reverse() };
  const deck = createDeck(info, shuffled, (body) => inputs.push(body));
  assert.equal(deck.panel.dataset.layout, 'custom');
  const key = deck.panel.children.find((n) => n.className === 'key' && n.dataset.index === 35);
  assert.equal(key.style.top, `${(1.44 / layout.height) * 100}%`);
  key.emit('pointerdown');
  key.emit('pointerup');
  assert.deepEqual(inputs.splice(0), [
    { type: 'key', index: 35, down: true },
    { type: 'key', index: 35, down: false },
  ]);
  deck.refreshKey(35);
  assert.match(key.children[0].src, /^\/api\/devices\/plus-xl\/key\/35\?/);
  assert.equal(key.children[0].className, 'face quarter-turn');

  const dial = deck.panel.children.find((n) => n.className === 'dial-target' && n.dataset.index === 5);
  dial.emit('wheel', { deltaY: -1, preventDefault() {} });
  dial.emit('pointerdown', { pointerId: 1, clientX: 0, clientY: 0 });
  dial.emit('pointerup');
  assert.deepEqual(inputs.splice(0), [
    { type: 'dialRotate', index: 5, ticks: 1 },
    { type: 'dialPress', index: 5, down: true },
    { type: 'dialPress', index: 5, down: false },
  ]);
  dial.emit('pointerdown', { pointerId: 2, clientX: 0, clientY: 0 });
  dial.emit('pointermove', { pointerId: 2, clientX: 32, clientY: 0 });
  dial.emit('pointerup');
  assert.deepEqual(inputs.splice(0), [{ type: 'dialRotate', index: 5, ticks: 2 }]);

  const strip = deck.panel.children.find((n) => n.className === 'strip');
  strip.emit('pointerdown', { pointerId: 3, clientX: 310, clientY: 45 });
  strip.emit('pointerup', { clientX: 310, clientY: 45 });
  assert.deepEqual(inputs.splice(0), [{ type: 'touch', kind: 1, x: 600, y: 50 }]);
  strip.emit('pointerdown', { pointerId: 4, clientX: 10, clientY: 20 });
  strip.emit('pointerup', { clientX: 610, clientY: 70 });
  assert.deepEqual(inputs.splice(0), [{ type: 'touch', kind: 3, x: 0, y: 0, x2: 1199, y2: 99 }]);
  deck.setBrightness(0);
  assert.equal(deck.panel.style['--brightness'], 0.25);
  deck.refreshAll();
  assert.match(strip.src, /^\/api\/devices\/plus-xl\/strip\?/);
});

test('Neo screen and touch keys retain their distinct source behavior', () => {
  documentFixture();
  const inputs = [];
  const neo = { id: 'neo', rows: 2, cols: 4, touchKeys: 2, rotated: true, screen: { w: 248, h: 58 } };
  const deck = createDeck(
    neo,
    {
      id: 'neo-custom',
      width: 4,
      height: 1,
      elements: [
        { type: 'screen', index: 0, x: 1, y: 0, width: 2, height: 1 },
        { type: 'touchKey', index: 1, x: 3, y: 0, width: 1, height: 1 },
        { type: 'touchKey', index: 0, x: 0, y: 0, width: 1, height: 1 },
      ],
    },
    (body) => inputs.push(body),
  );
  const right = deck.panel.children[1];
  right.emit('pointerdown');
  right.emit('pointerleave');
  assert.deepEqual(inputs, [
    { type: 'key', index: 9, down: true },
    { type: 'key', index: 9, down: false },
  ]);
  deck.setTouchColor(1, 0xabcdef);
  assert.equal(right.style['--color'], '#abcdef');
  deck.setTouchColor(1, 0);
  assert.equal(right.style['--color'], undefined);
  deck.refreshScreen();
  assert.match(deck.panel.children[0].children[0].src, /^\/api\/devices\/neo\/screen\?/);
  assert.equal(deck.panel.children[0].children[0].className, 'face rotated');
});

async function startPage(pathname, availableLayouts) {
  const ids = documentFixture();
  globalThis.location = { pathname };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { languages: ['en'] } });
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.Option = class extends Node {
    constructor(text, value) {
      super('option');
      this.textContent = text;
      this.value = value;
    }
  };
  const requests = [];
  let events;
  globalThis.EventSource = class {
    constructor() {
      events = this;
    }
  };
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    const data = url === '/api/devices' ? [info] : url === '/api/layouts' ? availableLayouts : {};
    return { ok: true, json: async () => data };
  };
  await import(`../internal/ui/static/js/main.js?page=${encodeURIComponent(pathname)}&n=${Math.random()}`);
  for (let i = 0; i < 20 && !events; i++) await new Promise((resolve) => setImmediate(resolve));
  assert.ok(events, 'page finished initialization');
  const message = (data) => events.onmessage({ data: JSON.stringify(data) });
  return { ids, requests, events, message };
}

test('dropdown views share source connection, display and brightness events', async () => {
  const page = await startPage('/', [{ ...layout, id: 'plus-xl', name: 'Stock XL' }, layout]);
  const picker = page.ids.get('picker');
  assert.deepEqual(
    picker.children.map((n) => n.value),
    ['plus-xl', 'custom'],
  );
  assert.equal(picker.children[1].textContent, 'Custom XL');
  picker.value = 'custom';
  picker.emit('change');
  const panels = page.ids.get('stage').children;
  assert.equal(panels[0].hidden, true);
  assert.equal(panels[1].hidden, false);
  await page.ids.get('toggle').emit('click');
  assert.equal(page.requests.at(-1).url, '/api/devices/plus-xl/connect');
  page.message({ kind: 'link', device: 'plus-xl', link: { state: 'connected' } });
  assert.ok(picker.children.every((n) => n.textContent.includes('status.connected')));
  assert.equal(page.ids.get('device').classes.has('off'), false);
  page.message({ kind: 'brightness', device: 'plus-xl', value: 50 });
  page.message({ kind: 'key', device: 'plus-xl', index: 35 });
  for (const panel of panels) {
    assert.equal(panel.style['--brightness'], 0.625);
    const key = panel.children.find((n) => n.className === 'key' && n.dataset.index === 35);
    assert.match(key.children[0].src, /^\/api\/devices\/plus-xl\/key\/35\?/);
  }
});

test('kiosk selects a layout ID but auto-connects only its source device', async () => {
  const page = await startPage('/kiosk/custom', [{ ...layout, id: 'plus-xl' }, layout]);
  assert.equal(document.body.classes.has('kiosk'), true);
  assert.equal(page.ids.get('stage').children.length, 1);
  assert.equal(page.ids.get('stage').children[0].dataset.layout, 'custom');
  assert.equal(page.requests.at(-1).url, '/api/devices/plus-xl/connect');
});

test('custom layout renders both key rows, strip and side dials in real web and kiosk pages', { skip: !process.env.CHROME_BIN }, async () => {
  const requests = [];
  const root = new URL('../internal/ui/', import.meta.url);
  const index = await readFile(new URL('static/index.html', root), 'utf8');
  const measure = `<script type="module">
    for (let i = 0; i < 100 && !document.querySelector('.panel'); i++) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    const picker = document.getElementById('picker');
    picker.value = 'custom';
    picker.dispatchEvent(new Event('change'));
    const panel = document.querySelector('[data-layout="custom"]');
    const rect = node => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    document.body.dataset.result = JSON.stringify({
      panel: rect(panel), viewport: document.documentElement.clientWidth,
      keys: [...panel.querySelectorAll('.key')].map(rect),
      dials: [...panel.querySelectorAll('.dial-target')].map(rect),
      strip: rect(panel.querySelector('.strip')),
      pickerLabel: picker.selectedOptions[0].textContent,
      visiblePanels: [...document.querySelectorAll('.panel')].filter(n => !n.hidden).length,
    });
  </script>`;
  const server = createServer((req, res) => {
    const path = req.url.split('?')[0];
    requests.push(path);
    if (path === '/api/devices' || path === '/api/layouts') {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(path === '/api/devices' ? [{ ...info, link: { state: 'connected' } }] : [{ ...layout, id: 'plus-xl', name: 'Stock XL' }, layout]));
    } else if (path === '/api/events') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.end('data: {"kind":"brightness","device":"plus-xl","value":100}\n\n');
    } else if (path.startsWith('/api/devices/')) {
      res.writeHead(204);
      res.end();
    } else if (path === '/' || path === '/kiosk/custom') {
      res.setHeader('Content-Type', 'text/html');
      res.end(index.replace('</body>', `${measure}</body>`));
    } else if (path.startsWith('/static/') || path.startsWith('/locales/')) {
      const relative = path.slice(1);
      if (!/^(static\/(js|css)\/[a-z0-9]+\.(js|css)|locales\/en\.json)$/.test(relative)) {
        res.writeHead(404);
        res.end();
        return;
      }
      readFile(new URL(relative, root)).then(
        (data) => {
          res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'application/json');
          res.end(data);
        },
        (error) => {
          res.writeHead(500);
          res.end(error.message);
        },
      );
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const path of ['/', '/kiosk/custom']) {
      const { stdout } = await promisify(execFile)(process.env.CHROME_BIN, ['--headless', '--disable-gpu', '--no-sandbox', '--window-size=1480,600', '--virtual-time-budget=3000', '--dump-dom', `${base}${path}`], {
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      });
      const encoded = stdout.match(/data-result="([^"]+)"/)?.[1];
      assert.ok(encoded, `page initialized: ${path}`);
      const result = JSON.parse(encoded.replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
      assert.equal(result.visiblePanels, 1);
      assert.match(result.pickerLabel, /Custom XL/);
      assert.equal(result.keys.length, 36);
      assert.equal(result.dials.length, 6);
      assert.equal(new Set(result.keys.map((k) => k.y)).size, 2);
      assert.ok(result.strip.y > result.keys[35].y + result.keys[35].height);
      for (const [i, dial] of result.dials.entries()) {
        assert.ok(i < 3 ? dial.x + dial.width < result.strip.x : dial.x > result.strip.x + result.strip.width);
        if (i % 3) assert.ok(dial.y > result.dials[i - 1].y);
      }
      if (path.startsWith('/kiosk/')) assert.ok(Math.abs(result.panel.width - (result.viewport - 5)) < 1);
      for (const item of [...result.keys, ...result.dials, result.strip]) {
        assert.ok(item.x >= result.panel.x - 1 && item.x + item.width <= result.panel.x + result.panel.width + 1);
        assert.ok(item.y >= result.panel.y - 1 && item.y + item.height <= result.panel.y + result.panel.height + 1);
      }
    }
    assert.ok(requests.includes('/api/layouts'));
    assert.ok(!requests.some((path) => path.endsWith('/connect')), 'fixture was connected; no USB attachment requested');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
