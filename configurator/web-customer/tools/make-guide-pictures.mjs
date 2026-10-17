// Makes the five small pictures on the guided-start cards (src/assets/guide/*.jpg) from OUR OWN 3D
// model - the same drawing the builder shows, light background, one picture per building style.
//   1. start the dev server (preview "design-web-dev", or: vite --config <web dev config>)
//   2. node web-customer/tools/make-guide-pictures.mjs http://localhost:5613/ web-customer/src/assets/guide
// Headless Chrome with its own throwaway profile (never the owner's browser). The pictures only
// need redoing if the 3D model's look changes or a style is added.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) {
  console.error('usage: node make-guide-pictures.mjs <dev url> <out dir>');
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9300 + Math.floor(Math.random() * 400);
const prof = path.join(os.tmpdir(), `ss-guide-pics-${PORT}`);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--no-first-run', '--no-default-browser-check',
  '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// style -> which starting size, colors, and a garage door so a garage reads as one
const PICS = {
  carport: { size: '2 cars', colors: { roof: 'galvalume', walls: 'pewter-gray', trim: 'pewter-gray' } },
  partial: { size: '2 cars', colors: { roof: 'barn-red', walls: 'barn-red', trim: 'white' } },
  garage: { size: '2 cars', colors: { roof: 'evergreen', walls: 'evergreen', trim: 'white' }, door: true },
  utility: { size: '2 cars + storage', colors: { roof: 'earth-brown', walls: 'sandstone', trim: 'earth-brown' } },
  ag: { size: 'Ag / barn', colors: { roof: 'slate-blue', walls: 'slate-blue', trim: 'white' } },
};

let ws;
try {
  let info;
  for (let i = 0; i < 50 && !info; i++) { try { info = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { await sleep(200); } }
  ws = new WebSocket(info.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (js) => {
    const r = await send('Runtime.evaluate', { expression: `(async () => { ${js} })()`, awaitPromise: true, returnByValue: true });
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'page error');
    return r.result?.result?.value;
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await sleep(4500);
  for (const [style, cfg] of Object.entries(PICS)) {
    const jpg = await ev(`
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const store = window.__ssStore; if (!store) throw new Error('no dev hook: is this the dev server?');
      const G = await import('/src/model/guide.ts');
      const D = await import('/src/model/design.ts');
      store.getState().setGuide(null);
      const s = G.STYLES.find((x) => x.key === ${JSON.stringify(style)});
      const preset = s.sizes.find((p) => p.label === ${JSON.stringify(cfg.size)});
      if (!preset) throw new Error('no size ${cfg.size} for ${style}');
      store.getState().update((d) => {
        G.applyStyle(d, ${JSON.stringify(style)}, preset);
        Object.assign(d.colors, ${JSON.stringify(cfg.colors)});
        d.openings = ${cfg.door ? 'D.OLD_STARTER_OPENINGS.filter((o) => o.kind === "rollup").map((o) => ({ ...o }))' : '[]'};
      });
      await sleep(2500);
      const shots = await window.__ssCapture3D({ theme: 'light' });
      const img = new Image();
      await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = shots.iso; });
      // crop to the building (everything that is not the light background), pad, fit a 640x400 card picture
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0);
      const px = x.getImageData(0, 0, c.width, c.height).data;
      const bg = [px[0], px[1], px[2]];
      let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
      for (let y = 0; y < c.height; y += 2) for (let xx = 0; xx < c.width; xx += 2) {
        const i = (y * c.width + xx) * 4;
        if (Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]) > 24) { if (xx < x0) x0 = xx; if (xx > x1) x1 = xx; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      const o = document.createElement('canvas'); o.width = 640; o.height = 400;
      const g = o.getContext('2d'); g.fillStyle = 'rgb(' + bg.join(',') + ')'; g.fillRect(0, 0, 640, 400);
      const k = Math.min(560 / bw, 330 / bh);
      g.imageSmoothingQuality = 'high';
      g.drawImage(c, x0, y0, bw, bh, (640 - bw * k) / 2, (400 - bh * k) / 2, bw * k, bh * k);
      return o.toDataURL('image/jpeg', 0.86);
    `);
    const file = path.join(outDir, `${style}.jpg`);
    writeFileSync(file, Buffer.from(jpg.split(',')[1], 'base64'));
    console.log(style, '->', file, Math.round(jpg.length * 0.75 / 1024) + ' KB');
  }
} finally {
  try { ws?.close(); } catch {}
  chrome.kill();
}
