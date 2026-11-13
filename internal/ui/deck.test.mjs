import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDeck } from './static/js/deck.js';

class Element {
  children = [];
  dataset = {};
  style = { setProperty() {} };
  handlers = {};
  classList = { toggle() {} };
  append(child) {
    this.children.push(child);
  }
  addEventListener(type, handler) {
    this.handlers[type] = handler;
  }
}

globalThis.document = { createElement: () => new Element() };

function layoutDeck(info, send) {
  const elements = [];
  const above = info.knobPlacement === 'above';
  const studio = info.id === 'studio';
  for (let index = 0; index < info.rows * info.cols; index++) {
    elements.push({
      type: 'key',
      index,
      x: (index % info.cols) * 1.24 + (studio ? 1.24 : 0),
      y: Math.floor(index / info.cols) * 1.24 + (above ? 3.136 : 0),
      width: 1,
      height: 1,
    });
  }
  if (info.strip) elements.push({ type: 'strip', index: 0, x: 0, y: above ? 1.04 : info.rows * 1.24, width: 3.48, height: 1 });
  for (let index = 0; index < (info.dials ?? 0); index++) {
    elements.push({
      type: 'dial',
      index,
      x: studio ? (index === 0 ? 0.1 : 21.18) : index * 1.4,
      y: studio ? 0.72 : above ? 0 : info.rows * 1.24 + 1.24,
      width: 0.8,
      height: 0.8,
    });
  }
  if (info.touchKeys) elements.push({ type: 'touchKey', index: 0, x: 0, y: 3, width: 1, height: 0.5 });
  if (info.screen) elements.push({ type: 'screen', index: 0, x: 1, y: 3, width: 2, height: 0.5 });
  if (info.touchKeys > 1) elements.push({ type: 'touchKey', index: 1, x: 3, y: 3, width: 1, height: 0.5 });
  // These tests exercise the renderer with explicit geometry; layouts_test.go
  // validates the actual bundled YAML and completeness of its mappings.
  return createDeck(info, { id: info.id, width: 24, height: 10, elements }, send);
}

test('key orientation corrections preserve layout and input indices', () => {
  const models = [
    ['plus', 2, 4, false, false, 'face'],
    ['neo', 2, 4, true, false, 'face rotated'],
    ['mk2', 3, 5, true, false, 'face rotated'],
    ['xl', 4, 8, true, false, 'face rotated'],
    ['plus-xl', 4, 9, false, true, 'face quarter-turn'],
    ['module', 3, 5, true, false, 'face rotated'],
    ['module-vert', 5, 3, true, false, 'face rotated'],
    ['studio', 2, 16, false, false, 'face'],
    ['pedal', 1, 3, false, false, 'face'],
    ['galleon-100', 4, 3, false, false, 'face'],
  ];
  for (const [id, rows, cols, rotated, quarterTurn, className] of models) {
    const sent = [];
    const deck = layoutDeck({ id, rows, cols, rotated, quarterTurn }, (body) => sent.push(body));
    assert.equal(deck.panel.children.length, rows * cols, id);
    deck.panel.children.forEach((key, index) => {
      assert.equal(key.children[0].className, className, `${id} key ${index}`);
      key.handlers.pointerdown();
      key.handlers.pointerup();
      assert.deepEqual(sent.slice(-2), [
        { type: 'key', index, down: true },
        { type: 'key', index, down: false },
      ]);
    });
  }
});

test('Neo info screen retains its half-turn correction', () => {
  const deck = layoutDeck(
    {
      id: 'neo',
      rows: 2,
      cols: 4,
      rotated: true,
      quarterTurn: false,
      touchKeys: 2,
      screen: { w: 248, h: 58 },
    },
    () => {},
  );
  assert.equal(deck.panel.children[9].children[0].className, 'face rotated');
});

test('Galleon puts two dials above a 2-by-2 touchscreen above twelve keys', () => {
  const sent = [];
  const deck = layoutDeck(
    {
      id: 'galleon-100',
      rows: 4,
      cols: 3,
      dials: 2,
      knobPlacement: 'above',
      strip: { w: 720, h: 384 },
    },
    (body) => sent.push(body),
  );
  assert.equal(deck.panel.children.length, 15);
  const keys = deck.panel.children.slice(0, 12);
  const strip = deck.panel.children[12];
  const dials = deck.panel.children.slice(13);
  assert.equal(dials.length, 2);
  dials.forEach((dial, index) => {
    assert.equal(dial.className, 'dial-target');
    assert.ok(parseFloat(dial.style.top) < parseFloat(strip.style.top));
    assert.ok(parseFloat(strip.style.top) < parseFloat(keys[0].style.top));
    dial.handlers.pointerdown({ pointerId: 1, clientX: 0 });
    dial.handlers.pointerup();
    dial.handlers.wheel({ deltaY: -1, preventDefault() {} });
    assert.deepEqual(sent.slice(-3), [
      { type: 'dialPress', index, down: true },
      { type: 'dialPress', index, down: false },
      { type: 'dialRotate', index, ticks: 1 },
    ]);
  });
  assert.equal(strip.className, 'strip');
  strip.setPointerCapture = () => {};
  strip.getBoundingClientRect = () => ({ left: 10, top: 20, width: 360, height: 192 });
  for (const [x, y] of [
    [180, 96],
    [540, 96],
    [180, 288],
    [540, 288],
  ]) {
    const event = { pointerId: 1, clientX: 10 + x / 2, clientY: 20 + y / 2 };
    strip.handlers.pointerdown(event);
    strip.handlers.pointerup(event);
    assert.deepEqual(sent.at(-1), { type: 'touch', kind: 1, x, y });
  }
  keys.forEach((key, index) => {
    key.handlers.pointerdown();
    key.handlers.pointerup();
    assert.deepEqual(sent.slice(-2), [
      { type: 'key', index, down: true },
      { type: 'key', index, down: false },
    ]);
  });
});

test('+ XL strip stays horizontal with unchanged touch coordinates', () => {
  const sent = [];
  const deck = layoutDeck(
    {
      id: 'plus-xl',
      rows: 4,
      cols: 9,
      rotated: false,
      quarterTurn: true,
      strip: { w: 1200, h: 100 },
    },
    (body) => sent.push(body),
  );
  const strip = deck.panel.children[36];
  assert.equal(strip.className, 'strip');
  strip.setPointerCapture = () => {};
  strip.getBoundingClientRect = () => ({ left: 10, top: 20, width: 600, height: 50 });
  const event = { pointerId: 1, clientX: 310, clientY: 45 };
  strip.handlers.pointerdown(event);
  strip.handlers.pointerup(event);
  assert.deepEqual(sent, [{ type: 'touch', kind: 1, x: 600, y: 50 }]);
});

test('Studio places two working dials beside the unchanged 16-by-2 key grid', () => {
  const sent = [];
  const deck = layoutDeck(
    {
      id: 'studio',
      rows: 2,
      cols: 16,
      dials: 2,
    },
    (body) => sent.push(body),
  );
  assert.equal(deck.panel.children.length, 34);
  assert.deepEqual(deck.hints, ['hint.dial']);
  const keys = deck.panel.children.slice(0, 32);
  keys.forEach((key, index) => {
    assert.equal(key.style.left, `${(((index % 16) * 1.24 + 1.24) / 24) * 100}%`);
    assert.equal(key.style.top, `${((Math.floor(index / 16) * 1.24) / 10) * 100}%`);
    key.handlers.pointerdown();
    key.handlers.pointerup();
    assert.deepEqual(sent.slice(-2), [
      { type: 'key', index, down: true },
      { type: 'key', index, down: false },
    ]);
  });
  deck.panel.children.slice(32).forEach((dial, index) => {
    assert.equal(dial.className, 'dial-target');
    assert.equal(dial.style.left, `${((index === 0 ? 0.1 : 21.18) / 24) * 100}%`);
    assert.equal(dial.style.top, `${(0.72 / 10) * 100}%`);
    dial.handlers.pointerdown({ pointerId: 1, clientX: 0 });
    dial.handlers.pointerup({ pointerId: 1 });
    for (const deltaY of [-1, 1]) {
      let prevented = false;
      dial.handlers.wheel({
        deltaY,
        preventDefault() {
          prevented = true;
        },
      });
      assert.ok(prevented);
    }
    assert.deepEqual(sent.slice(-4), [
      { type: 'dialPress', index, down: true },
      { type: 'dialPress', index, down: false },
      { type: 'dialRotate', index, ticks: 1 },
      { type: 'dialRotate', index, ticks: -1 },
    ]);
    assert.equal(dial.children[0].style.rotate, '0deg');
  });
});

test('Plus models keep their dials in a centered row beneath the strip', () => {
  for (const [id, rows, cols, dials, width] of [
    ['plus', 2, 4, 4, 800],
    ['plus-xl', 4, 9, 6, 1200],
  ]) {
    const deck = layoutDeck(
      {
        id,
        rows,
        cols,
        dials,
        strip: { w: width, h: 100 },
      },
      () => {},
    );
    assert.equal(deck.panel.children[rows * cols].className, 'strip');
    deck.panel.children.slice(rows * cols + 1).forEach((dial, index) => {
      assert.equal(dial.className, 'dial-target');
      assert.ok(parseFloat(dial.style.top) > parseFloat(deck.panel.children[rows * cols].style.top));
      assert.equal(dial.style.left, `${((index * 1.4) / 24) * 100}%`);
    });
  }
});

function dialDeck() {
  const sent = [];
  const deck = layoutDeck({ id: 'plus', rows: 2, cols: 4, dials: 4 }, (body) => sent.push(body));
  const dial = deck.panel.children[8];
  return { sent, dial };
}

function swipe(dial, pointerId, ...points) {
  const [[x, y], ...moves] = points;
  dial.handlers.pointerdown({ pointerId, clientX: x, clientY: y });
  for (const [clientX, clientY] of moves) dial.handlers.pointermove({ pointerId, clientX, clientY });
  dial.handlers.pointerup({ pointerId });
}

test('swiping a dial sideways rotates it without pressing', () => {
  const { sent, dial } = dialDeck();
  swipe(dial, 1, [100, 100], [135, 100]);
  assert.deepEqual(sent, [{ type: 'dialRotate', index: 0, ticks: 2 }]);

  sent.length = 0;
  swipe(dial, 2, [100, 100], [70, 100]);
  assert.deepEqual(sent, [{ type: 'dialRotate', index: 0, ticks: -1 }]);
});

test('swiping a dial up turns it right and down turns it left', () => {
  const { sent, dial } = dialDeck();
  swipe(dial, 1, [100, 100], [100, 65]);
  assert.deepEqual(sent, [{ type: 'dialRotate', index: 0, ticks: 2 }]);

  sent.length = 0;
  swipe(dial, 2, [100, 100], [100, 135]);
  assert.deepEqual(sent, [{ type: 'dialRotate', index: 0, ticks: -2 }]);
});

test('a diagonal swipe turns a dial by the difference of its axes', () => {
  const { sent, dial } = dialDeck();
  // Up 50 and left 15: net +35, two ticks right.
  swipe(dial, 1, [100, 100], [85, 50]);
  assert.deepEqual(sent, [{ type: 'dialRotate', index: 0, ticks: 2 }]);

  sent.length = 0;
  // Up 20 and left 20 cancel out.
  swipe(dial, 2, [100, 100], [80, 80]);
  assert.deepEqual(sent, []);

  sent.length = 0;
  // Down and right together turn right only by their difference: 40 - 5.
  swipe(dial, 3, [100, 100], [140, 105]);
  assert.deepEqual(sent, [{ type: 'dialRotate', index: 0, ticks: 2 }]);
});

test('a swipe that changes direction reverses the dial', () => {
  const { sent, dial } = dialDeck();
  swipe(dial, 1, [100, 100], [100, 60], [100, 100], [100, 140]);
  assert.deepEqual(
    sent.map((m) => m.ticks),
    [2, -2, -2],
  );
});

test('tapping a dial presses and releases it', () => {
  const { sent, dial } = dialDeck();
  dial.handlers.pointerdown({ pointerId: 1, clientX: 100, clientY: 100 });
  dial.handlers.pointermove({ pointerId: 1, clientX: 103, clientY: 102 });
  dial.handlers.pointerup({ pointerId: 1 });
  assert.deepEqual(sent, [
    { type: 'dialPress', index: 0, down: true },
    { type: 'dialPress', index: 0, down: false },
  ]);
});
