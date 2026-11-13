import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { promisify } from 'node:util';

const chrome = process.env.CHROME_BIN;
const run = promisify(execFile);

test('kiosk panels fit the viewport and empty notices take no space', { skip: !chrome }, async () => {
  const app = await readFile(new URL('./static/css/app.css', import.meta.url), 'utf8');
  const deck = await readFile(new URL('./static/css/deck.css', import.meta.url), 'utf8');
  const html = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${app}\n${deck}</style>
    <body class="kiosk"><main class="device"><h1 class="title">Stream Deck Emulator</h1><p class="notice"></p>
    <div class="panel" style="--layout-width:22.08;--layout-height:2.24" data-model="studio"></div></main>
    <script>
      const panel = document.querySelector('.panel');
      const device = document.querySelector('.device');
      const notice = document.querySelector('.notice');
      for (let i = 0; i < 32; i++) {
        const key = document.createElement('div');
        key.className = 'key';
        key.style.left = ((i % 16 * 1.24 + 1.24) / 22.08 * 100) + '%';
        key.style.top = (Math.floor(i / 16) * 1.24 / 2.24 * 100) + '%';
        key.style.width = (100 / 22.08) + '%';
        key.style.height = (100 / 2.24) + '%';
        panel.append(key);
      }
      for (const x of [0.1, 21.18]) {
        const target = document.createElement('div');
        target.className = 'dial-target';
        target.style.left = (x / 22.08 * 100) + '%';
        target.style.top = (0.72 / 2.24 * 100) + '%';
        target.style.width = (0.8 / 22.08 * 100) + '%';
        target.style.height = (0.8 / 2.24 * 100) + '%';
        const dial = document.createElement('div');
        dial.className = 'dial';
        target.append(dial);
        panel.append(target);
      }
      const measure = () => panel.getBoundingClientRect().width;
      const contentWidth = () => {
        const style = getComputedStyle(device);
        return device.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      };
      const studioContent = contentWidth();
      const studio = measure();
      const viewport = innerWidth;
      const viewportHeight = innerHeight;
      const rect = device.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const panelRect = panel.getBoundingClientRect();
      const panelCenterY = panelRect.top + panelRect.height / 2;
      const scrollWidth = document.documentElement.scrollWidth;
      const { paddingTop, paddingBottom, paddingLeft } = getComputedStyle(device);
      const padding = { paddingTop, paddingBottom, paddingLeft };
      const emptyHeight = notice.getBoundingClientRect().height;
      const emptyMargin = getComputedStyle(notice).margin;
      const rotations = [];
      for (const dial of panel.querySelectorAll('.dial')) {
        for (const angle of [0, 12, 24, 36, 45, 90]) {
          dial.style.rotate = angle + 'deg';
          rotations.push({
            width: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            height: document.documentElement.scrollHeight,
            clientHeight: document.documentElement.clientHeight
          });
        }
      }
      notice.textContent = 'Connection error';
      const noticeHeight = notice.getBoundingClientRect().height;
      notice.style.height = '2000px';
      const verticalOverflow = {
        width: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        height: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
        panelWidth: measure(),
        contentWidth: contentWidth()
      };
      notice.style.height = '';
      panel.replaceChildren();
      panel.dataset.model = 'plus';
      panel.style.setProperty('--layout-width', 5.2);
      panel.style.setProperty('--layout-height', 4.05);
      const plus = measure();
      const plusContent = contentWidth();
      document.body.className = '';
      const normalNoticeMinHeight = getComputedStyle(notice).minHeight;
      document.body.dataset.result = JSON.stringify({
        viewport, viewportHeight, centerX, centerY, panelCenterY, scrollWidth, padding,
        studio, studioContent, plus, plusContent, emptyHeight, emptyMargin, noticeHeight, normalNoticeMinHeight, rotations, verticalOverflow
      });
    </script>`;
  const url = `data:text/html;base64,${Buffer.from(html).toString('base64')}`;

  for (const [width, height] of [
    [1480, 320],
    [640, 1480],
  ]) {
    const { stdout } = await run(chrome, ['--headless', '--disable-gpu', '--no-sandbox', `--window-size=${width},${height}`, '--dump-dom', url], { timeout: 30000, maxBuffer: 1024 * 1024 });
    const encoded = stdout.match(/data-result="([^"]+)"/)?.[1];
    assert.ok(encoded, 'browser did not produce layout measurements');
    const result = JSON.parse(encoded.replaceAll('&quot;', '"'));
    // Native window borders can reduce the requested size on Windows.
    const viewport = result.viewport;
    assert.ok(viewport > 0 && viewport <= width, JSON.stringify(result));
    // The device may reserve a little right padding; panels fill the rest of the width.
    assert.ok(result.studioContent > viewport - 16, `Studio content width: ${result.studioContent}`);
    assert.ok(Math.abs(result.studio - result.studioContent) < 1, `Studio width: ${result.studio}, want ${result.studioContent}`);
    assert.ok(Math.abs(result.plus - result.plusContent) < 1, `Plus width: ${result.plus}, want ${result.plusContent}`);
    assert.equal(result.scrollWidth, viewport);
    assert.deepEqual(result.padding, { paddingTop: '0px', paddingBottom: '0px', paddingLeft: '0px' });
    assert.ok(Math.abs(result.centerX - viewport / 2) < 1, `horizontal center: ${result.centerX}`);
    assert.ok(Math.abs(result.centerY - result.viewportHeight / 2) < 1, `vertical center: ${result.centerY}`);
    assert.ok(Math.abs(result.panelCenterY - result.viewportHeight / 2) < 1, `panel center: ${result.panelCenterY}`);
    assert.equal(result.emptyHeight, 0);
    assert.equal(result.emptyMargin, '0px');
    assert.ok(result.noticeHeight > 0);
    assert.notEqual(result.normalNoticeMinHeight, '0px');
    for (const rotation of result.rotations) {
      assert.equal(rotation.width, rotation.clientWidth);
      assert.equal(rotation.height, rotation.clientHeight);
    }
    assert.ok(result.verticalOverflow.height > result.verticalOverflow.clientHeight);
    assert.equal(result.verticalOverflow.width, result.verticalOverflow.clientWidth);
    assert.ok(Math.abs(result.verticalOverflow.panelWidth - result.verticalOverflow.contentWidth) < 1);
  }
});
