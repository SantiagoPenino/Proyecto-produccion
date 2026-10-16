// Carga un MP4 en Chrome (servido por HTTP local), informa duración/seekable y extrae fotogramas en los tiempos pedidos → carpeta dada.
const fs = require('fs'); const path = require('path'); const http = require('http');
const puppeteer = require('puppeteer');
const DIR = __dirname.replace(/\\/g, '/');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const archivo = process.argv[2]; const carpeta = process.argv[3] || 'verif'; const tiempos = (process.argv[4] || '2,20,45,80,120,180,240,300,335').split(',').map(Number);
(async () => {
  const srv = http.createServer((req, resp) => { const p = path.join(DIR, decodeURIComponent(req.url.split('?')[0])); fs.stat(p, (e, st) => { if (e) { resp.writeHead(404); return resp.end(); } const range = req.headers.range; if (range) { const m = /bytes=(\d+)-(\d*)/.exec(range); const a = Number(m[1]), b = m[2] ? Number(m[2]) : st.size - 1; resp.writeHead(206, { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': b - a + 1 }); fs.createReadStream(p, { start: a, end: b }).pipe(resp); } else { resp.writeHead(200, { 'Content-Type': p.endsWith('.html') ? 'text/html' : 'video/mp4', 'Content-Length': st.size, 'Accept-Ranges': 'bytes' }); fs.createReadStream(p).pipe(resp); } }); });
  await new Promise(r => srv.listen(0, '127.0.0.1', r)); const url = `http://127.0.0.1:${srv.address().port}`;
  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME, protocolTimeout: 300000, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox'] });
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 }); await page.goto(url + '/compose.html');
  const info = await page.evaluate(async (src) => { const v = document.createElement('video'); v.src = src; v.muted = true; v.preload = 'auto'; document.body.appendChild(v); const r = await new Promise(res => { v.onloadedmetadata = () => res('ok'); v.onerror = () => res('error ' + (v.error && v.error.message)); setTimeout(() => res('timeout'), 15000); }); await new Promise(res => setTimeout(res, 1500)); return { load: r, duration: v.duration, seekableEnd: v.seekable.length ? v.seekable.end(v.seekable.length - 1) : null, w: v.videoWidth, h: v.videoHeight }; }, url + '/' + archivo);
  console.log('video:', JSON.stringify(info));
  fs.mkdirSync(path.join(DIR, carpeta), { recursive: true });
  let ok = 0;
  for (const t of tiempos) {
    const r = await page.evaluate(async (t) => { const v = document.querySelector('video'); const t0 = performance.now(); v.currentTime = t; const res = await new Promise(res => { v.onseeked = () => res('seeked'); setTimeout(() => res('timeout'), 8000); }); const c = document.createElement('canvas'); c.width = 640; c.height = 360; c.getContext('2d').drawImage(v, 0, 0, 640, 360); return { res, real: v.currentTime, ms: Math.round(performance.now() - t0), data: c.toDataURL('image/png') }; }, t);
    fs.writeFileSync(path.join(DIR, carpeta, `t${String(t).padStart(3, '0')}.png`), Buffer.from(r.data.split(',')[1], 'base64'));
    if (r.res === 'seeked' && Math.abs(r.real - t) < 0.5) ok++;
    console.log(`  t=${t}s → ${r.res} en ${r.ms} ms (currentTime ${r.real.toFixed(2)})`);
  }
  console.log(`saltos correctos: ${ok}/${tiempos.length}`);
  await browser.close(); srv.close();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
