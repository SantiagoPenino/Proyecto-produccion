// Fechas de último commit de archivos no alcanzables, duplicados por nombre, assets de public/ sin referencia.
const fs = require('fs'); const path = require('path'); const { execSync } = require('child_process');
const ROOT = path.resolve(process.argv[2]); const G = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const OUT = process.argv[4];
const sh = (c) => { try { return execSync(c, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };

function lastCommit(f) {
  const d = sh(`git log -1 --format=%cs -- "${f}"`);
  const tracked = sh(`git ls-files --error-unmatch "${f}"`) ? true : false;
  return { file: f, lastCommit: d || null, tracked };
}
const feUn = G.frontend.unreachable.map(lastCommit);
const beUn = G.backend.unreachable.map(lastCommit);

// Duplicados por basename (código) en src y backend
const all = [...G.frontend.sizes.map(s => s.file), ...G.backend.sizes.map(s => s.file)];
const byBase = {};
for (const f of all) { const b = path.basename(f); (byBase[b] ||= []).push(f); }
const dups = Object.entries(byBase).filter(([, l]) => l.length > 1).filter(([b]) => !/^index\.(js|jsx)$/.test(b)).map(([b, l]) => ({ base: b, files: l }));

// public/ assets sin referencia en código
const pubFiles = sh('git ls-files public').split('\n').filter(Boolean);
const scan = [];
function walk(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === 'node_modules' || e.name === 'public' || e.name.startsWith('.')) continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(jsx?|cjs|mjs|json|html|css|py|md)$/.test(e.name)) scan.push(p); } }
walk(path.join(ROOT, 'src')); walk(path.join(ROOT, 'backend'));
scan.push(path.join(ROOT, 'index.html'), path.join(ROOT, 'public', 'manifest.json'), path.join(ROOT, 'public', 'sw.js'), path.join(ROOT, 'public', 'offline.html'));
const contents = scan.map(f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } });
const pubUnref = [];
for (const pf of pubFiles) {
  const base = path.basename(pf);
  const dir = path.dirname(pf).replace(/^public\/?/, '');
  const hit = contents.some(c => c.includes(base) || (dir && c.includes('/' + dir)));
  if (!hit) pubUnref.push(pf);
}

// Últimos commits de backend/scripts (para separar one-off viejos de recientes)
const scripts = sh('git ls-files backend/scripts').split('\n').filter(Boolean).map(lastCommit);

// Todo lo tracked pero ignorado por .gitignore
const trackedIgnored = sh('git ls-files -i -c --exclude-standard').split('\n').filter(Boolean);

const out = { feUnreachable: feUn, beUnreachable: beUn, duplicateBasenames: dups, publicUnreferenced: pubUnref, backendScripts: scripts, trackedIgnored };
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));

console.log('== src no alcanzables: último commit ==');
feUn.forEach(x => console.log(`  ${(x.lastCommit || 'untracked').padEnd(11)} ${x.tracked ? '' : '[NO TRACKED] '}${x.file}`));
console.log('\n== backend no alcanzables (sin scripts/tests): último commit ==');
beUn.filter(x => !x.file.startsWith('backend/scripts/') && !x.file.startsWith('backend/__tests__/')).forEach(x => console.log(`  ${(x.lastCommit || 'untracked').padEnd(11)} ${x.tracked ? '' : '[NO TRACKED] '}${x.file}`));
console.log('\n== backend/scripts por fecha ==');
scripts.sort((a, b) => (a.lastCommit || '').localeCompare(b.lastCommit || '')).forEach(x => console.log(`  ${(x.lastCommit || '?').padEnd(11)} ${x.file}`));
console.log(`\n== duplicados por nombre (${dups.length}) ==`);
dups.forEach(d => console.log(`  ${d.base}: ${d.files.join(' | ')}`));
console.log(`\n== public/ sin referencia (${pubUnref.length}/${pubFiles.length}) ==`);
pubUnref.forEach(f => console.log('  ' + f));
console.log(`\n== tracked pero ignorados (${trackedIgnored.length}) ==`);
trackedIgnored.forEach(f => console.log('  ' + f));
