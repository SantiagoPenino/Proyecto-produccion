// Driver del compositor: sirve la carpeta por HTTP local, abre compose.html en Chrome headless y
//   --modo previa  → dibuja fotogramas de cada escena a previa/*.png (sin grabar)
//   --modo grabar  → graba el tutorial completo a tutorial.mp4 y lo verifica (duración + fotogramas a verif/*.png)
const fs = require('fs'); const path = require('path'); const http = require('http');
const puppeteer = require('puppeteer');
const DIR = __dirname.replace(/\\/g, '/');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const modo = (process.argv.find(a => a.startsWith('--modo=')) || '--modo=previa').split('=')[1];
const escenasArchivo = (process.argv.find(a => a.startsWith('--escenas=')) || '--escenas=escenas.json').split('=')[1];
const salida = (process.argv.find(a => a.startsWith('--salida=')) || '--salida=tutorial.mp4').split('=')[1];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.json': 'application/json', '.mp4': 'video/mp4' };

function servidor() {
  return new Promise((res) => {
    const srv = http.createServer((req, resp) => {
      const p = path.join(DIR, decodeURIComponent(req.url.split('?')[0]));
      if (!p.startsWith(DIR.replace(/\//g, path.sep)) && !p.startsWith(DIR)) { resp.writeHead(403); return resp.end(); }
      fs.readFile(p, (err, data) => { if (err) { resp.writeHead(404); return resp.end('no: ' + req.url); } resp.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); resp.end(data); });
    });
    srv.listen(0, '127.0.0.1', () => res({ srv, url: `http://127.0.0.1:${srv.address().port}` }));
  });
}

(async () => {
  const { srv, url } = await servidor();
  const escenas = JSON.parse(fs.readFileSync(path.join(DIR, escenasArchivo), 'utf8').replace(/^\uFEFF/, ''));
  const browser = await puppeteer.launch({ headless: true, executablePath: CHROME, protocolTimeout: 900000, args: ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--window-size=1300,760'], defaultViewport: { width: 1280, height: 720 } });
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'warning' || m.type() === 'error') console.log('[page]', m.text()); });
  const chunks = []; let bytes = 0;
  await page.exposeFunction('saveChunk', (b64) => { const b = Buffer.from(b64, 'base64'); chunks.push(b); bytes += b.length; });
  await page.goto(url + '/compose.html');
  const plan = await page.evaluate(async (esc, base) => await window.cargar(esc, base), escenas, url);
  console.log(`escenas: ${plan.escenas.length} · duración total ${plan.total.toFixed(1)} s · con imagen: ${plan.escenas.filter(e => e.img).length}`);
  const clip = { x: 0, y: 0, width: 1280, height: 720 };
  if (modo === 'previa') {
    fs.mkdirSync(path.join(DIR, 'previa'), { recursive: true });
    for (const e of plan.escenas) {
      for (const [k, off] of [['a', 0.9], ['b', e.dur * 0.55], ['c', e.dur - 0.8]]) {
        await page.evaluate(t => window.dibujarEn(t), e.t0 + off);
        await page.screenshot({ path: path.join(DIR, 'previa', `${e.id}_${k}.png`), clip });
      }
    }
    console.log('previa lista en previa/');
  } else {
    const t0 = Date.now();
    console.log('grabando…');
    // no se espera la promesa larga por CDP (protocolTimeout): se dispara y se sondea window.__listo
    const vbps = Number((process.argv.find(a => a.startsWith('--vbps=')) || '--vbps=3500000').split('=')[1]);
    const abps = Number((process.argv.find(a => a.startsWith('--abps=')) || '--abps=128000').split('=')[1]);
    const mono = process.argv.includes('--mono');
    console.log(`bitrate video ${vbps} · audio ${abps}${mono ? ' mono' : ''}`);
    await page.evaluate((o) => { window.__listo = null; window.__error = null; window.grabar(o).catch(e => { window.__error = String(e && e.stack || e); }); }, { vbps, abps, mono });
    await page.waitForFunction(() => window.__listo || window.__error, { timeout: Math.ceil(plan.total * 1000) + 120000, polling: 1000 });
    const r = await page.evaluate(() => window.__listo || { error: window.__error });
    if (r.error) throw new Error('grabar(): ' + r.error);
    const buf = Buffer.concat(chunks); const crudo = path.join(DIR, salida.replace(/\.mp4$/, '') + '.crudo.mp4'); fs.writeFileSync(crudo, buf);
    const out = path.join(DIR, salida);
    const fix = require('./mp4_fix').fixDuration(crudo, out);
    console.log(`grabado: ${r.frames} fotogramas dibujados · ${(buf.length / 1048576).toFixed(1)} MB · ${((Date.now() - t0) / 1000).toFixed(0)} s de pared → ${out} · duración corregida ${fix.segundos.toFixed(1)} s (${fix.fragmentos} fragmentos)`);
    // verificación: duración, y fotogramas a verif/
    fs.mkdirSync(path.join(DIR, 'verif'), { recursive: true });
    const v = await browser.newPage(); await v.setViewport({ width: 1280, height: 720 }); await v.goto(url + '/compose.html');
    const chk = await v.evaluate(async (src) => { const vid = document.createElement('video'); vid.src = src; vid.muted = true; document.body.appendChild(vid); const r = await new Promise(res => { vid.onloadedmetadata = () => res('ok'); vid.onerror = () => res('error ' + (vid.error && vid.error.message)); setTimeout(() => res('timeout'), 8000); }); return { load: r, duration: vid.duration, w: vid.videoWidth, h: vid.videoHeight }; }, url + '/' + salida);
    console.log('verificación:', JSON.stringify(chk));
    if (chk.load === 'ok') {
      const tiempos = plan.escenas.map(e => e.t0 + Math.min(3, e.dur / 2));
      for (let i = 0; i < tiempos.length; i++) {
        const dataUrl = await v.evaluate(async (t) => { const vid = document.querySelector('video'); vid.currentTime = t; await new Promise(res => { vid.onseeked = res; setTimeout(res, 4000); }); const c = document.createElement('canvas'); c.width = 640; c.height = 360; c.getContext('2d').drawImage(vid, 0, 0, 640, 360); return c.toDataURL('image/png'); }, tiempos[i]);
        fs.writeFileSync(path.join(DIR, 'verif', `${plan.escenas[i].id}.png`), Buffer.from(dataUrl.split(',')[1], 'base64'));
      }
      console.log('fotogramas del MP4 en verif/');
    }
  }
  await browser.close(); srv.close();
})().catch(e => { console.error('FALLO', e.stack.split('\n').slice(0, 5).join(' | ')); process.exit(1); });
