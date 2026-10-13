// Verificación manual (lente "referencias") de los BORRAR propuestos: grep de nombre base, exports y path en el repo vivo.
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const ROOT = 'C:/Users/Santiago/Desktop/proyecto/Proyecto-produccion';
const S = 'C:/Users/Santiago/AppData/Local/Temp/claude/C--Users-Santiago-Desktop-proyecto-Proyecto-produccion/33c41667-becc-417a-aa09-297e3faec7b2/scratchpad';
const propuestos = JSON.parse(fs.readFileSync(S + '/resultados/_borrar-propuestos.json', 'utf8'));
const sh = (c) => { try { return execSync(c, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };

// Corpus a escanear: todo archivo de texto del repo salvo node_modules, .git, backend/public, worktrees, logs
const EXT = /\.(jsx?|cjs|mjs|tsx?|json|html|css|py|sh|bat|md|sql|yml|yaml|txt|csv)$/i;
const SKIP = new Set(['node_modules', '.git', 'public_build', 'logs', '__pycache__', 'thumbnails', 'uploads', 'ordenes', 'worktrees', 'servicio-tecnico', 'ComprobantesPagos', 'tickets']);
const corpus = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (p.replace(/\\/g, '/').endsWith('/backend/public')) continue; walk(p); }
    else if (EXT.test(e.name) && e.name !== 'package-lock.json') corpus.push(p);
  }
})(ROOT);
const textos = corpus.map(f => ({ f: path.relative(ROOT, f).replace(/\\/g, '/'), s: fs.readFileSync(f, 'utf8') }));
const esDeadFile = new Set(propuestos.map(p => p.archivo.trim()));

function exportsDe(src) {
  const names = new Set(); let m;
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
  const r1 = /\bexport\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g; while ((m = r1.exec(clean))) names.add(m[1]);
  const r2 = /\bexport\s*\{([^}]*)\}/g; while ((m = r2.exec(clean))) for (const p of m[1].split(',')) { const n = p.trim().split(/\s+as\s+/).pop(); if (n && n !== 'default') names.add(n.trim()); }
  const r3 = /\b(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g; while ((m = r3.exec(clean))) names.add(m[1]);
  const r4 = /\bmodule\.exports\s*=\s*\{([^}]*)\}/g; while ((m = r4.exec(clean))) for (const p of m[1].split(',')) { const n = p.trim().split(/\s*:\s*/)[0].replace(/^\.\.\./, '').trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n); }
  const r5 = /\bexport\s+default\s+(?:function\s+|class\s+)?([A-Za-z_$][\w$]*)/g; while ((m = r5.exec(clean))) if (!['function', 'class', 'async'].includes(m[1])) names.add(m[1]);
  return [...names].filter(n => n.length >= 4 && !['default', 'props', 'module', 'exports'].includes(n));
}
const GENERICOS = new Set(['Card', 'Input', 'check', 'success', 'Chat', 'Workflow', 'Despacho', 'Planilla', 'Metricas', 'u', 'pwa', 'nul', 'index', 'main', 'App', 'Button', 'Toast', 'Modal', 'render', 'getData', 'useEffect']);

const out = [];
for (const p of propuestos) {
  const a = p.archivo.trim();
  const esDep = /package\.json/.test(a) && a.includes('→');
  const esRango = /:\d|\(l[ií]neas|líneas|\d+-\d+\)|imports sin|Comentarios|Imports/i.test(a) && !fs.existsSync(path.join(ROOT, a.split(/[ (:]/)[0]));
  if (esRango) { out.push({ ...p, tipo: 'rango-en-vivo', nota: 'bloque dentro de archivo vivo; no requiere grep de referencias' }); continue; }
  if (esDep) {
    const pkg = a.split('→')[1].trim().split(/\s+/)[0];
    const hits = textos.filter(t => !/package\.json$/.test(t.f) && (t.s.includes("'" + pkg) || t.s.includes('"' + pkg) || t.s.includes('`' + pkg) || t.s.includes(pkg + '/'))).map(t => t.f);
    out.push({ ...p, tipo: 'dep', pkg, hits: hits.slice(0, 10), nHits: hits.length });
    continue;
  }
  const rutas = a.split(/,\s*|\s·\s/).map(x => x.trim().split(' ')[0]).filter(Boolean);
  for (const ruta of rutas) {
    const abs = path.join(ROOT, ruta);
    const existe = fs.existsSync(abs);
    const esDir = existe && fs.statSync(abs).isDirectory();
    const base = path.basename(ruta).replace(/\.[^.]+$/, '');
    const tracked = sh('git ls-files --error-unmatch "' + ruta + '"') ? true : false;
    const ultimo = sh('git log -1 --format=%cs -- "' + ruta + '"');
    let exps = [];
    if (existe && !esDir && /\.(jsx?|cjs|mjs)$/.test(ruta)) { try { exps = exportsDe(fs.readFileSync(abs, 'utf8')); } catch {} }
    // hits por nombre base (excluyendo el propio archivo y otros muertos propuestos)
    const vivos = textos.filter(t => t.f !== ruta && !esDeadFile.has(t.f) && !t.f.startsWith(ruta + '/'));
    const generic = GENERICOS.has(base) || base.length < 4;
    const hitsBase = generic ? [] : vivos.filter(t => t.s.includes(base)).map(t => t.f);
    const hitsPath = vivos.filter(t => t.s.includes(ruta) || t.s.includes(ruta.replace(/^src\//, '/src/'))).map(t => t.f);
    const hitsExports = {};
    for (const e of exps) {
      if (GENERICOS.has(e)) continue;
      const re = new RegExp('\\b' + e.replace(/[$]/g, '\\$') + '\\b');
      const h = vivos.filter(t => re.test(t.s) && /\.(jsx?|cjs|mjs)$/.test(t.f)).map(t => t.f);
      if (h.length) hitsExports[e] = h.slice(0, 6);
    }
    const docsMention = vivos.filter(t => /^(docs\/|CHANGELOG\.md|specs\/)/.test(t.f) && (t.s.includes(base) && !generic || t.s.includes(ruta))).map(t => t.f);
    out.push({ origen: p.origen, archivo: ruta, existe, esDir, tracked, ultimoCommit: ultimo, base, generic, exports: exps.length, hitsBase: hitsBase.slice(0, 8), nHitsBase: hitsBase.length, hitsPath: hitsPath.slice(0, 8), hitsExports, docsMention: docsMention.slice(0, 6), evidenciaAgente: p.evidencia });
  }
}
fs.writeFileSync(S + '/resultados/_borrar-verificados.json', JSON.stringify(out, null, 2));
// Resumen legible
for (const o of out) {
  if (o.tipo === 'rango-en-vivo') { console.log('RANGO   ', o.archivo); continue; }
  if (o.tipo === 'dep') { console.log('DEP     ', (o.pkg || '').padEnd(32), 'hits:', o.nHits, o.hits.join(' | ')); continue; }
  const flag = (o.nHitsBase || o.hitsPath.length || Object.keys(o.hitsExports).length) ? '!!' : 'ok';
  console.log(flag.padEnd(3), (o.existe ? (o.tracked ? 'T' : 'u') : 'X'), (o.ultimoCommit || '-').padEnd(11), o.archivo);
  if (o.nHitsBase) console.log('        base "' + o.base + '" en: ' + o.hitsBase.join(' | ') + (o.nHitsBase > 8 ? ' …(' + o.nHitsBase + ')' : ''));
  if (o.hitsPath.length) console.log('        path en: ' + o.hitsPath.join(' | '));
  for (const [e, h] of Object.entries(o.hitsExports)) console.log('        export ' + e + ' en: ' + h.join(' | '));
  if (o.docsMention.length) console.log('        docs/changelog: ' + o.docsMention.join(' | '));
}
