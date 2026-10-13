// Convierte los JSON de resultados (verify/area/scripts) en markdown compacto para leer.
const fs = require('fs'); const path = require('path');
const S = 'C:/Users/Santiago/AppData/Local/Temp/claude/C--Users-Santiago-Desktop-proyecto-Proyecto-produccion/33c41667-becc-417a-aa09-297e3faec7b2/scratchpad/resultados';
const files = fs.readdirSync(S).filter(f => f.endsWith('.json') && !f.startsWith('_'));
const t = (s, n = 260) => (s || '').replace(/\s+/g, ' ').slice(0, n);
let verify = '# Verificación de no alcanzables\n', area = '# Áreas\n', scripts = '# Scripts y docs\n';
for (const f of files) {
  const v = JSON.parse(fs.readFileSync(path.join(S, f), 'utf8'));
  if (v.items && v.items[0] && v.items[0].veredicto) {
    verify += '\n## ' + f + '\n' + (v.notas ? 'NOTAS: ' + t(v.notas, 1500) + '\n\n' : '');
    for (const i of v.items) verify += '- **' + i.veredicto + '** `' + i.archivo + '` (riesgo ' + i.riesgo + (i.ultimoCommit ? ', ' + i.ultimoCommit : '') + ')\n  - qué es: ' + t(i.queEs, 200) + (i.reemplazadoPor && !/^ninguno/i.test(i.reemplazadoPor) ? '\n  - reemplazado por: ' + t(i.reemplazadoPor, 160) : '') + (i.funcionalidadPerdida && !/^nada/i.test(i.funcionalidadPerdida) ? '\n  - perdería: ' + t(i.funcionalidadPerdida, 220) : '') + '\n  - evidencia: ' + t(i.evidencia, 320) + '\n';
  } else if (v.items && v.items[0] && v.items[0].clase) {
    scripts += '\n## ' + f + '\n' + (v.notas ? 'NOTAS: ' + t(v.notas, 2000) + '\n\n' : '');
    if (v.gitignore) scripts += 'GITIGNORE:\n' + v.gitignore.map(g => '- ' + t(g, 300)).join('\n') + '\n\n';
    const byAcc = {};
    for (const i of v.items) (byAcc[i.accion] ||= []).push(i);
    for (const [acc, list] of Object.entries(byAcc)) {
      scripts += '### ' + acc + ' (' + list.length + ')\n';
      for (const i of list) scripts += '- `' + i.ruta + '` [' + i.clase + (i.fecha ? ', ' + i.fecha : '') + '] ' + t(i.queEs, 160) + (i.destinoSugerido ? ' → ' + t(i.destinoSugerido, 120) : '') + '\n  - ev: ' + t(i.evidencia, 220) + '\n';
    }
  } else if (v.refactor) {
    area += '\n## ' + (v.area || f) + ' (archivos revisados: ' + v.archivosRevisados + ')\n' + (v.notas ? 'NOTAS: ' + t(v.notas, 1500) + '\n' : '');
    area += '\n### Refactor (' + v.refactor.length + ')\n';
    for (const r of v.refactor) area += '- [' + r.prioridad + '/' + r.esfuerzo + '] `' + r.archivo + '`' + (r.lineas ? ' (' + r.lineas + ' líneas)' : '') + ': ' + t(r.problema, 300) + '\n  - propuesta: ' + t(r.propuesta, 300) + '\n  - ev: ' + t(r.evidencia, 200) + '\n';
    area += '\n### Duplicación (' + v.duplicacion.length + ')\n';
    for (const d of v.duplicacion) area += '- ' + d.archivos.map(x => '`' + x + '`').join(', ') + ': ' + t(d.queSeDuplica, 260) + '\n  - propuesta: ' + t(d.propuesta, 220) + '\n  - ev: ' + t(d.evidencia, 200) + '\n';
    area += '\n### Basura (' + v.basura.length + ')\n';
    for (const b of v.basura) area += '- **' + b.accion + '** `' + b.ruta + '` [' + t(b.tipo, 80) + ']\n  - ev: ' + t(b.evidencia, 300) + '\n';
    area += '\n### Código muerto en vivos (' + (v.codigoMuertoEnVivos || []).length + ')\n';
    for (const m of (v.codigoMuertoEnVivos || [])) area += '- `' + m.archivo + '`' + (m.lineas ? ' (' + m.lineas + ')' : '') + ': ' + t(m.que, 200) + '\n  - ev: ' + t(m.evidencia, 220) + '\n';
    area += '\n### Mal ubicados (' + (v.malUbicados || []).length + ')\n';
    for (const m of (v.malUbicados || [])) area += '- `' + m.ruta + '` → ' + t(m.destinoSugerido, 120) + ' — ' + t(m.porque, 180) + '\n';
    area += '\n### Patrones de riesgo (' + (v.patronesRiesgo || []).length + ')\n';
    for (const p of (v.patronesRiesgo || [])) area += '- ' + t(p.patron, 120) + (p.cantidad != null ? ' (' + p.cantidad + ')' : '') + ' — ' + t(p.donde, 200) + ' — ' + t(p.comentario, 260) + '\n';
  }
}
fs.writeFileSync(path.join(S, '_verify-resumen.md'), verify);
fs.writeFileSync(path.join(S, '_areas-resumen.md'), area);
fs.writeFileSync(path.join(S, '_scripts-resumen.md'), scripts);
console.log('verify', verify.length, 'area', area.length, 'scripts', scripts.length);
