import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { promisify } from "node:util";

const chrome = process.env.CHROME_BIN;
const run = promisify(execFile);

test("kiosk panels fit the viewport and empty notices take no space", { skip: !chrome }, async () => {
  const app = await readFile(new URL("./static/css/app.css", import.meta.url), "utf8");
  const deck = await readFile(new URL("./static/css/deck.css", import.meta.url), "utf8");
  const html = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${app}\n${deck}</style>
    <body class="kiosk"><main class="device"><h1 class="title">Stream Deck Emulator</h1><p class="notice"></p>
    <div class="panel" style="--cols:16;--rows:2" data-model="studio"></div></main>
    <script>
      const panel = document.querySelector('.panel');
      const device = document.querySelector('.device');
      const notice = document.querySelector('.notice');
      for (let i = 0; i < 32; i++) {
        const key = document.createElement('div');
        key.className = 'key';
        key.style.gridColumnStart = i % 16 + 2;
        key.style.gridRowStart = Math.floor(i / 16) + 1;
        panel.append(key);
      }
      for (const column of [1, 18]) {
        const dial = document.createElement('div');
        dial.className = 'dial';
        dial.style.gridColumnStart = column;
        dial.style.gridRow = '1 / span 2';
        panel.append(dial);
      }
      const measure = () => panel.getBoundingClientRect().width;
      const studio = measure();
      const rect = device.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const panelRect = panel.getBoundingClientRect();
      const panelCenterY = panelRect.top + panelRect.height / 2;
      const scrollWidth = document.documentElement.scrollWidth;
      const padding = getComputedStyle(device).padding;
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
        panelWidth: measure()
      };
      notice.style.height = '';
      panel.replaceChildren();
      panel.dataset.model = 'plus';
      panel.style.setProperty('--cols', 4);
      const plus = measure();
      document.body.className = '';
      const normalNoticeMinHeight = getComputedStyle(notice).minHeight;
      document.body.dataset.result = JSON.stringify({
        viewport: innerWidth, viewportHeight: innerHeight, centerX, centerY, panelCenterY, scrollWidth, padding,
        studio, plus, emptyHeight, emptyMargin, noticeHeight, normalNoticeMinHeight, rotations, verticalOverflow
      });
    </script>`;
  const url = `data:text/html;base64,${Buffer.from(html).toString("base64")}`;

  for (const [width, height] of [
    [1480, 320],
    [320, 1480],
  ]) {
    const { stdout } = await run(chrome, ["--headless", "--disable-gpu", "--no-sandbox", `--window-size=${width},${height}`, "--dump-dom", url], { timeout: 30000, maxBuffer: 1024 * 1024 });
    const encoded = stdout.match(/data-result="([^"]+)"/)?.[1];
    assert.ok(encoded, "browser did not produce layout measurements");
    const result = JSON.parse(encoded.replaceAll("&quot;", '"'));
    assert.equal(result.viewport, width);
    assert.ok(Math.abs(result.studio - width) < 1, `Studio width: ${result.studio}`);
    assert.ok(Math.abs(result.plus - width) < 1, `Plus width: ${result.plus}`);
    assert.equal(result.scrollWidth, width);
    assert.equal(result.padding, "0px");
    assert.ok(Math.abs(result.centerX - width / 2) < 1, `horizontal center: ${result.centerX}`);
    assert.ok(Math.abs(result.centerY - result.viewportHeight / 2) < 1, `vertical center: ${result.centerY}`);
    assert.ok(Math.abs(result.panelCenterY - result.viewportHeight / 2) < 1, `panel center: ${result.panelCenterY}`);
    assert.equal(result.emptyHeight, 0);
    assert.equal(result.emptyMargin, "0px");
    assert.ok(result.noticeHeight > 0);
    assert.notEqual(result.normalNoticeMinHeight, "0px");
    for (const rotation of result.rotations) {
      assert.equal(rotation.width, rotation.clientWidth);
      assert.equal(rotation.height, rotation.clientHeight);
    }
    assert.ok(result.verticalOverflow.height > result.verticalOverflow.clientHeight);
    assert.equal(result.verticalOverflow.width, result.verticalOverflow.clientWidth);
    assert.ok(Math.abs(result.verticalOverflow.panelWidth - result.verticalOverflow.clientWidth) < 1);
  }
});
