import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { promisify } from "node:util";

const chrome = process.env.CHROME_BIN;
const run = promisify(execFile);

// The app draws a Studio key as a 96x96 face at (24, 8) inside a 144x112 image.
test("Studio keys show only the visible face of the app's image", { skip: !chrome }, async () => {
  const app = await readFile(new URL("./static/css/app.css", import.meta.url), "utf8");
  const deck = await readFile(new URL("./static/css/deck.css", import.meta.url), "utf8");
  const html = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
    <style>${app}\n${deck}</style>
    <body><main class="device"><div class="panel" style="--cols:16;--rows:2" data-model="studio"></div></main>
    <script>
      const canvas = document.createElement('canvas');
      canvas.width = 144;
      canvas.height = 112;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 144, 112);
      ctx.fillStyle = '#0f0';
      ctx.fillRect(24, 8, 96, 96);
      const src = canvas.toDataURL();
      const panel = document.querySelector('.panel');
      const key = document.createElement('div');
      key.className = 'key';
      const face = document.createElement('img');
      face.className = 'face';
      key.append(face);
      panel.append(key);
      const measure = () => {
        const k = key.getBoundingClientRect();
        const f = face.getBoundingClientRect();
        const inner = { left: k.left + key.clientLeft, top: k.top + key.clientTop, width: key.clientWidth, height: key.clientHeight };
        // The image region that lands on the key's visible area, in image pixels.
        const sx = 144 / f.width, sy = 112 / f.height;
        return {
          x0: (inner.left - f.left) * sx, x1: (inner.left + inner.width - f.left) * sx,
          y0: (inner.top - f.top) * sy, y1: (inner.top + inner.height - f.top) * sy,
        };
      };
      face.onload = () => {
        const normal = measure();
        document.body.className = 'kiosk';
        const kiosk = measure();
        panel.dataset.model = 'plus';
        const plus = measure();
        document.body.dataset.result = JSON.stringify({ normal, kiosk, plus });
      };
      face.src = src;
    </script>`;
  const url = `data:text/html;base64,${Buffer.from(html).toString("base64")}`;
  const { stdout } = await run(chrome, ["--headless", "--disable-gpu", "--no-sandbox", "--window-size=1480,320", "--virtual-time-budget=2000", "--dump-dom", url], { timeout: 30000, maxBuffer: 1024 * 1024 });
  const encoded = stdout.match(/data-result="([^"]+)"/)?.[1];
  assert.ok(encoded, "browser did not produce layout measurements");
  const result = JSON.parse(encoded.replaceAll("&quot;", '"'));
  for (const mode of ["normal", "kiosk"]) {
    const r = result[mode];
    for (const [name, got, want] of [
      ["x0", r.x0, 24],
      ["x1", r.x1, 120],
      ["y0", r.y0, 8],
      ["y1", r.y1, 104],
    ]) {
      assert.ok(Math.abs(got - want) < 0.5, `${mode} ${name}: ${got}, want ${want}`);
    }
  }
  // Other models keep showing the whole image.
  assert.ok(Math.abs(result.plus.x0) < 0.5 && Math.abs(result.plus.x1 - 144) < 0.5, `plus: ${JSON.stringify(result.plus)}`);
});
