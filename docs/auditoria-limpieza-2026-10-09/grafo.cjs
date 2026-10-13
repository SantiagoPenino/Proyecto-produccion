#!/usr/bin/env node
/* Grafo de imports del proyecto (frontend Vite + backend Node CJS/ESM).
 * Uso: node grafo.cjs <raizProyecto> <salidaJson>
 * No instala nada. Regex-based, best-effort; los resultados se verifican después.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || '.');
const OUT = process.argv[3] || 'grafo.json';

const EXT_CODE = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];
const EXT_RESOLVE = ['', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.json', '.css',
  '/index.js', '/index.jsx', '/index.ts', '/index.tsx', '/index.cjs', '/index.mjs'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'public', 'logs', '__pycache__', 'dist', 'thumbnails', 'uploads', 'ordenes']);

function walk(dir, acc = []) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, acc); }
    else acc.push(p);
  }
  return acc;
}

const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

const RE_IMPORTS = [
  /\bimport\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"\n]+)['"]/g,
  /\bexport\s+(?:\*|\{[^}]*\})\s*from\s*['"]([^'"\n]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /\brequire\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g,
  /new\s+URL\s*\(\s*['"]([^'"\n]+)['"]\s*,\s*import\.meta\.url/g,
];
const RE_CSS_IMPORT = /@import\s+(?:url\()?['"]([^'"\n]+)['"]/g;

function stripComments(src) {
  // Quita comentarios de bloque y de línea (best-effort; no toca strings con // dentro de URLs… acepta el ruido).
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

function extractSpecifiers(file, src) {
  const specs = new Set();
  const isCss = file.endsWith('.css');
  const clean = isCss ? src : stripComments(src);
  const res = isCss ? [RE_CSS_IMPORT] : RE_IMPORTS;
  for (const re of res) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(clean))) specs.add(m[1]);
  }
  return [...specs];
}

function resolveSpec(fromFile, spec) {
  if (spec.startsWith('.') || spec.startsWith('/')) {
    const base = spec.startsWith('/') ? path.join(ROOT, spec.replace(/^\//, '')) : path.resolve(path.dirname(fromFile), spec);
    const clean = base.split('?')[0];
    for (const ext of EXT_RESOLVE) {
      const cand = clean + ext;
      try { if (fs.statSync(cand).isFile()) return { kind: 'local', file: cand }; } catch {}
    }
    return { kind: 'unresolved', spec };
  }
  if (/^(node:|https?:|data:|virtual:)/.test(spec)) return { kind: 'builtin', spec };
  const parts = spec.split('/');
  const pkg = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return { kind: 'external', pkg, spec };
}

const NODE_BUILTINS = new Set(['fs', 'path', 'os', 'crypto', 'http', 'https', 'url', 'util', 'stream', 'events', 'child_process', 'zlib', 'net', 'tls', 'dns', 'buffer', 'querystring', 'readline', 'assert', 'worker_threads', 'perf_hooks', 'string_decoder', 'timers', 'cluster', 'v8', 'vm', 'module', 'process', 'async_hooks', 'constants', 'tty', 'dgram', 'inspector', 'punycode', 'repl', 'trace_events', 'fs/promises', 'stream/promises', 'timers/promises', 'util/types', 'path/posix', 'path/win32']);

// ---- Exports / imports nominales (best-effort) ----
function extractExports(src) {
  const clean = stripComments(src);
  const names = new Set();
  let hasDefault = false;
  let m;
  const reDecl = /\bexport\s+(?:async\s+)?(?:const|let|var|function\*?|class)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = reDecl.exec(clean))) names.add(m[1]);
  const reList = /\bexport\s*\{([^}]*)\}\s*(?:from\s*['"][^'"]+['"])?/g;
  while ((m = reList.exec(clean))) {
    for (const part of m[1].split(',')) {
      const seg = part.trim(); if (!seg) continue;
      const asM = seg.match(/^([\w$]+)\s+as\s+([\w$]+)$/);
      const name = asM ? asM[2] : seg.split(/\s+/)[0];
      if (name === 'default') hasDefault = true; else names.add(name);
    }
  }
  if (/\bexport\s+default\b/.test(clean)) hasDefault = true;
  if (/\bexport\s+\*\s+from/.test(clean)) names.add('*');
  // CJS
  const reCjs = /\b(?:module\.)?exports\.([A-Za-z_$][\w$]*)\s*=/g;
  while ((m = reCjs.exec(clean))) names.add(m[1]);
  const reCjsObj = /\bmodule\.exports\s*=\s*\{([^}]*)\}/g;
  while ((m = reCjsObj.exec(clean))) {
    for (const part of m[1].split(',')) {
      const seg = part.trim(); if (!seg) continue;
      const name = seg.split(/\s*:\s*/)[0].replace(/^\.\.\./, '').trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }
  if (/\bmodule\.exports\s*=\s*(?!\{)/.test(clean)) hasDefault = true;
  return { names: [...names], hasDefault };
}

function extractImportsByFile(src) {
  // Devuelve [{spec, names:[...], ns:boolean, def:boolean, sideEffect:boolean}]
  const clean = stripComments(src);
  const out = [];
  let m;
  const re = /\bimport\s+(?:type\s+)?([\s\S]*?)\s+from\s*['"]([^'"\n]+)['"]/g;
  while ((m = re.exec(clean))) {
    const clause = m[1].trim(); const spec = m[2];
    const item = { spec, names: [], ns: false, def: false, sideEffect: false };
    if (/\*\s+as\s+/.test(clause)) item.ns = true;
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const seg = part.trim(); if (!seg) continue;
        item.names.push(seg.split(/\s+as\s+/)[0].trim());
      }
    }
    const beforeBrace = clause.replace(/\{[^}]*\}/, '').replace(/\*\s+as\s+[\w$]+/, '').replace(/,/g, '').trim();
    if (beforeBrace) item.def = true;
    out.push(item);
  }
  const reSide = /\bimport\s*['"]([^'"\n]+)['"]/g;
  while ((m = reSide.exec(clean))) out.push({ spec: m[1], names: [], ns: false, def: false, sideEffect: true });
  const reDyn = /\bimport\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  while ((m = reDyn.exec(clean))) out.push({ spec: m[1], names: [], ns: true, def: true, sideEffect: false });
  // CJS: const { a, b } = require('x'); const x = require('x'); require('x').a
  const reReqDestr = /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  while ((m = reReqDestr.exec(clean))) {
    const item = { spec: m[2], names: [], ns: false, def: false, sideEffect: false };
    for (const part of m[1].split(',')) { const seg = part.trim(); if (seg) item.names.push(seg.split(/\s*:\s*/)[0].trim()); }
    out.push(item);
  }
  const reReqAll = /require\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;
  while ((m = reReqAll.exec(clean))) {
    if (!out.some(o => o.spec === m[1] && o.names.length)) out.push({ spec: m[1], names: [], ns: true, def: true, sideEffect: false });
  }
  return out;
}

function analyze(label, allFiles, entries) {
  const codeFiles = allFiles.filter(f => EXT_CODE.includes(path.extname(f)) || f.endsWith('.css'));
  const fileSet = new Set(allFiles);
  const edges = new Map();      // file -> [{spec, resolved}]
  const inDegree = new Map();   // file -> Set(importers)
  const externals = new Map();  // pkg -> Set(files)
  const unresolved = [];
  for (const f of codeFiles) {
    let src; try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const specs = extractSpecifiers(f, src);
    const list = [];
    for (const s of specs) {
      const r = resolveSpec(f, s);
      list.push({ spec: s, ...r });
      if (r.kind === 'local') {
        if (!inDegree.has(r.file)) inDegree.set(r.file, new Set());
        inDegree.get(r.file).add(f);
      } else if (r.kind === 'external') {
        if (NODE_BUILTINS.has(r.pkg) || NODE_BUILTINS.has(r.spec)) continue;
        if (!externals.has(r.pkg)) externals.set(r.pkg, new Set());
        externals.get(r.pkg).add(f);
      } else if (r.kind === 'unresolved') {
        unresolved.push({ from: rel(f), spec: s });
      }
    }
    edges.set(f, list);
  }
  // Alcanzabilidad desde entries
  const reachable = new Set();
  const stack = entries.filter(e => fileSet.has(e));
  while (stack.length) {
    const f = stack.pop();
    if (reachable.has(f)) continue;
    reachable.add(f);
    for (const e of (edges.get(f) || [])) if (e.kind === 'local' && !reachable.has(e.file)) stack.push(e.file);
  }
  const unreachable = allFiles.filter(f => !reachable.has(f));
  // Exports sin uso (solo archivos alcanzables, código)
  const exportUsage = [];
  for (const f of codeFiles) {
    if (!reachable.has(f)) continue;
    let src; try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const ex = extractExports(src);
    if (!ex.names.length) continue;
    const importers = [...(inDegree.get(f) || [])];
    const used = new Set(); let nsUsed = false;
    for (const imp of importers) {
      let isrc; try { isrc = fs.readFileSync(imp, 'utf8'); } catch { continue; }
      for (const item of extractImportsByFile(isrc)) {
        const r = resolveSpec(imp, item.spec);
        if (r.kind !== 'local' || r.file !== f) continue;
        if (item.ns) nsUsed = true;
        item.names.forEach(n => used.add(n));
      }
    }
    if (nsUsed) continue;
    const unused = ex.names.filter(n => n !== '*' && !used.has(n));
    if (unused.length) exportUsage.push({ file: rel(f), unusedExports: unused, importers: importers.length });
  }
  return {
    label,
    totalFiles: allFiles.length,
    codeFiles: codeFiles.length,
    entries: entries.map(rel),
    reachable: [...reachable].map(rel).sort(),
    unreachable: unreachable.map(rel).sort(),
    inDegree: Object.fromEntries([...inDegree].map(([f, s]) => [rel(f), s.size])),
    externals: Object.fromEntries([...externals].map(([p, s]) => [p, s.size]).sort((a, b) => b[1] - a[1])),
    unresolved,
    unusedExports: exportUsage.sort((a, b) => b.unusedExports.length - a.unusedExports.length),
    edges: Object.fromEntries([...edges].map(([f, l]) => [rel(f), l.filter(e => e.kind === 'local').map(e => rel(e.file))])),
  };
}

// ---------- FRONTEND ----------
const srcDir = path.join(ROOT, 'src');
const feFiles = walk(srcDir);
const feEntries = [path.join(ROOT, 'src', 'main.jsx')];
// Lo que index.html referencia directamente
try {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const m of html.matchAll(/src=["']\/?(src\/[^"']+)["']/g)) feEntries.push(path.join(ROOT, m[1]));
} catch {}
const fe = analyze('frontend', feFiles, [...new Set(feEntries)]);
const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
fe.packageJson = { deps: Object.keys(rootPkg.dependencies || {}), devDeps: Object.keys(rootPkg.devDependencies || {}) };
fe.depsNotImported = fe.packageJson.deps.filter(d => !fe.externals[d]);
fe.importedNotDeclared = Object.keys(fe.externals).filter(p => !fe.packageJson.deps.includes(p) && !fe.packageJson.devDeps.includes(p));

// ---------- BACKEND ----------
const beDir = path.join(ROOT, 'backend');
const beFilesAll = walk(beDir).filter(f => !/[\\/]backend[\\/](public|logs|servicio-tecnico|catalogos)[\\/]/.test(f));
const beEntries = [path.join(beDir, 'server.js'), path.join(beDir, 'scheduler.js')];
const be = analyze('backend', beFilesAll, beEntries);
// Separar scripts/, __tests__/, python/ (entradas propias) del resto
be.unreachableGrouped = {};
for (const f of be.unreachable) {
  const grp = f.split('/')[1] || '(raiz backend)';
  (be.unreachableGrouped[grp] ||= []).push(f);
}
const bePkg = JSON.parse(fs.readFileSync(path.join(beDir, 'package.json'), 'utf8'));
be.packageJson = { deps: Object.keys(bePkg.dependencies || {}), devDeps: Object.keys(bePkg.devDependencies || {}) };
// Para deps del backend contamos imports de TODOS los archivos js del backend (scripts incluidos) para no marcar falso "sin uso"
const beExternalsAll = {};
for (const f of beFilesAll.filter(f => EXT_CODE.includes(path.extname(f)))) {
  let src; try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  for (const s of extractSpecifiers(f, src)) {
    const r = resolveSpec(f, s);
    if (r.kind === 'external' && !NODE_BUILTINS.has(r.pkg) && !NODE_BUILTINS.has(r.spec)) beExternalsAll[r.pkg] = (beExternalsAll[r.pkg] || 0) + 1;
  }
}
be.externalsAll = beExternalsAll;
be.depsNotImported = be.packageJson.deps.filter(d => !beExternalsAll[d]);
be.depsOnlyInScripts = be.packageJson.deps.filter(d => beExternalsAll[d] && !be.externals[d]);
be.importedNotDeclared = Object.keys(beExternalsAll).filter(p => !be.packageJson.deps.includes(p) && !be.packageJson.devDeps.includes(p));

// ---------- Referencias por string a archivos no alcanzables (dinámicas) ----------
function grepStemRefs(unreachableRel, scanFiles) {
  const result = {};
  const stems = unreachableRel.map(f => ({ f, stem: path.basename(f).replace(/\.[^.]+$/, '') })).filter(x => x.stem.length >= 4);
  const contents = scanFiles.map(f => { try { return { f: rel(f), s: fs.readFileSync(f, 'utf8') }; } catch { return null; } }).filter(Boolean);
  for (const { f, stem } of stems) {
    const hits = [];
    for (const c of contents) {
      if (c.f === f) continue;
      if (c.s.includes(stem)) hits.push(c.f);
      if (hits.length >= 8) break;
    }
    if (hits.length) result[f] = hits;
  }
  return result;
}
const scanAll = [...feFiles, ...beFilesAll, path.join(ROOT, 'index.html'), path.join(ROOT, 'vite.config.js')]
  .filter(f => /\.(jsx?|cjs|mjs|tsx?|json|html|py|sh|bat|css)$/.test(f));
fe.stringRefsToUnreachable = grepStemRefs(fe.unreachable, scanAll);
be.stringRefsToUnreachable = grepStemRefs(be.unreachable.filter(f => !f.startsWith('backend/scripts/') && !f.startsWith('backend/__tests__/')), scanAll);

// ---------- Tamaños ----------
function sizes(files) {
  return files.map(f => { let s = 0, l = 0; try { const t = fs.readFileSync(f, 'utf8'); s = t.length; l = t.split('\n').length; } catch {} return { file: rel(f), bytes: s, lines: l }; });
}
fe.sizes = sizes(feFiles.filter(f => EXT_CODE.includes(path.extname(f)))).sort((a, b) => b.lines - a.lines);
be.sizes = sizes(beFilesAll.filter(f => EXT_CODE.includes(path.extname(f)))).sort((a, b) => b.lines - a.lines);

const out = { generatedFor: ROOT, frontend: fe, backend: be };
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

// ---------- Resumen a stdout ----------
function hdr(t) { console.log('\n==== ' + t + ' ===='); }
hdr('FRONTEND');
console.log(`archivos en src: ${fe.totalFiles} | código: ${fe.codeFiles} | alcanzables desde main.jsx: ${fe.reachable.length} | NO alcanzables: ${fe.unreachable.length}`);
console.log('\n-- NO alcanzables (src) --');
fe.unreachable.forEach(f => console.log('  ' + f + (fe.stringRefsToUnreachable[f] ? '   [ref string en: ' + fe.stringRefsToUnreachable[f].slice(0, 3).join(', ') + ']' : '')));
console.log('\n-- imports sin resolver (frontend) --'); fe.unresolved.forEach(u => console.log(`  ${u.from} -> ${u.spec}`));
console.log('\n-- deps declaradas en package.json raíz que ningún archivo importa --'); console.log('  ' + fe.depsNotImported.join(', '));
console.log('-- paquetes importados no declarados (raíz) --'); console.log('  ' + fe.importedNotDeclared.join(', '));
console.log('\n-- top 40 archivos más grandes (frontend) --'); fe.sizes.slice(0, 40).forEach(s => console.log(`  ${String(s.lines).padStart(6)}  ${s.file}`));
console.log(`\n-- exports sin importador nominal (frontend): ${fe.unusedExports.length} archivos --`);
fe.unusedExports.slice(0, 80).forEach(u => console.log(`  ${u.file}  [${u.unusedExports.join(', ')}]`));

hdr('BACKEND');
console.log(`archivos: ${be.totalFiles} | código: ${be.codeFiles} | alcanzables desde server.js+scheduler.js: ${be.reachable.length} | NO alcanzables: ${be.unreachable.length}`);
for (const [grp, list] of Object.entries(be.unreachableGrouped)) {
  console.log(`\n-- NO alcanzables: ${grp} (${list.length}) --`);
  list.forEach(f => console.log('  ' + f + (be.stringRefsToUnreachable[f] ? '   [ref string en: ' + be.stringRefsToUnreachable[f].slice(0, 3).join(', ') + ']' : '')));
}
console.log('\n-- imports sin resolver (backend) --'); be.unresolved.forEach(u => console.log(`  ${u.from} -> ${u.spec}`));
console.log('\n-- deps backend que nadie importa (ni scripts) --'); console.log('  ' + be.depsNotImported.join(', '));
console.log('-- deps backend usadas SOLO por scripts/tests (no por server) --'); console.log('  ' + be.depsOnlyInScripts.join(', '));
console.log('-- paquetes importados no declarados (backend) --'); console.log('  ' + be.importedNotDeclared.join(', '));
console.log('\n-- top 40 archivos más grandes (backend) --'); be.sizes.slice(0, 40).forEach(s => console.log(`  ${String(s.lines).padStart(6)}  ${s.file}`));
console.log(`\n-- exports sin importador nominal (backend): ${be.unusedExports.length} archivos --`);
be.unusedExports.slice(0, 80).forEach(u => console.log(`  ${u.file}  [${u.unusedExports.join(', ')}]`));
console.log('\nJSON completo en: ' + OUT);
