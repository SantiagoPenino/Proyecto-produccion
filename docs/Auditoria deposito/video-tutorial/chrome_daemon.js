// Abre un Chrome VISIBLE con perfil propio (no toca el Chrome del usuario) en la pantalla de login de la app.
// El usuario inicia sesión ahí; los scripts de captura se conectan por el ws endpoint guardado en ws.txt.
const fs = require('fs');
const puppeteer = require('puppeteer');
const DIR = __dirname.replace(/\\/g, '/');
(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    userDataDir: DIR + '/chrome-profile',
    defaultViewport: null,
    args: ['--window-size=1400,900', '--window-position=60,40', '--no-first-run', '--no-default-browser-check', '--disable-infobars', '--lang=es-UY'],
  });
  fs.writeFileSync(DIR + '/ws.txt', browser.wsEndpoint());
  const pages = await browser.pages();
  const page = pages[0] || await browser.newPage();
  await page.goto('http://localhost:5173/login', { waitUntil: 'domcontentloaded' }).catch(e => console.log('goto:', e.message));
  console.log('Chrome abierto. ws:', browser.wsEndpoint());
  browser.on('disconnected', () => { console.log('Chrome cerrado'); process.exit(0); });
  await new Promise(() => {});
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
