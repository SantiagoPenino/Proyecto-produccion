const { conectar, estado, shot } = require('./cap_lib');
(async () => {
  const { browser, page } = await conectar();
  const e = await estado(page);
  console.log(JSON.stringify(e));
  if (process.argv.includes('--shot')) console.log(await shot(page, '_estado'));
  browser.disconnect();
})().catch(e => { console.error('FALLO', e.message); process.exit(1); });
