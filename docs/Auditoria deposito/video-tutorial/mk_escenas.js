// escenas.json = guion + capturas + resaltes/clics/zoom según capturas/rects.json (+ ajustes a mano tomados de las capturas)
const fs = require('fs');
const DIR = __dirname.replace(/\\/g, '/');
const guion = JSON.parse(fs.readFileSync(DIR + '/guion.json', 'utf8').replace(/^\uFEFF/, ''));
const R = JSON.parse(fs.readFileSync(DIR + '/capturas/rects.json', 'utf8'));
const r = (k, f) => (R[k] && R[k][f] && R[k][f].w > 0) ? { x: R[k][f].x, y: R[k][f].y, w: R[k][f].w, h: R[k][f].h } : null;
const H = (rect, frase, etiqueta) => rect ? { ...rect, frase, etiqueta } : null;
const C = (rect, frase) => rect ? { x: Math.round(rect.x + rect.w / 2), y: Math.round(rect.y + rect.h / 2), frase } : null;
const lim = (a) => a.filter(Boolean);
const img = (k, f = 'img') => (R[k] && R[k][f]) || null;
const b06 = (R['06'] && R['06'].botones) || [];

const mapa = {
  '02_que_es': { imagen: img('02'), resaltes: lim([H({ x: 8, y: 224, w: 48, h: 46 }, 'Se entra desde el menú', 'Menú: Auditoría de Depósito'), H(r('02', 'tabs'), 'cinco pestañas', 'Las 5 pestañas')]), secuencial: true, clics: lim([C({ x: 8, y: 224, w: 48, h: 46 }, 'opción Auditoría')]) },
  '03_barra': { imagen: img('03'), resaltes: lim([H(r('03', 'barra'), 'Arriba está la barra', 'Barra de la auditoría'), H(r('03', 'aviso') || r('03', 'input'), 'el escaneo queda bloqueado', 'Escaneo bloqueado'), H(r('03', 'btnAbrir'), 'Primero hay que abrir', 'Abrir auditoría')]), secuencial: true },
  '04_abrir': { imagen: img('04'), zoom: { x: 384, y: 145, w: 512, h: 430, frase: 'Al abrir' }, resaltes: lim([H({ x: 404, y: 281, w: 354, h: 30 }, 'elegimos el alcance', 'Alcance'), H(r('04', 'chipTP') || { x: 615, y: 351, w: 54, h: 27 }, 'por ejemplo TP', 'TP'), H({ x: 404, y: 421, w: 440, h: 14 }, 'Con alcance parcial', 'Las otras áreas no se tocan'), H(r('04', 'confirmar'), 'Solo puede haber una', 'Tomar fotografía y abrir')]), secuencial: true, clics: lim([C(r('04', 'prefijoBtn'), 'solo algunas áreas'), C(r('04', 'chipTP'), 'por ejemplo TP')]) },
  '05_escaneo': { imagen: img('05'), resaltes: lim([H(r('05', 'input'), 'campo de escaneo', 'Pistola láser aquí'), H(r('05', 'cardOk2') || r('05', 'card1'), 'Cada lectura genera una tarjeta', 'Tarjeta de la lectura'), H(r('05', 'cardOk2') || r('05', 'card1'), 'Verde es OK', 'OK: estaba en la fotografía')]), secuencial: true, clics: lim([C(r('05', 'input'), 'escaneamos cada etiqueta')]) },
  '06_tarjetas': { imagenes: lim([{ imagen: img('05'), t0: 0 }, img('06', 'imgAyuda') ? { imagen: img('06', 'imgAyuda'), frase: 'Con el signo de pregunta' } : null]), resaltes: lim([H(r('06', 'cardEntregada'), 'Entregada:', 'Entregada'), H(r('06', 'cardNoIngresada'), 'No ingresada:', 'No ingresada'), H(r('06', 'cardDesconocida'), 'Desconocida:', 'No existe'), H(b06[0], 'Con el signo de pregunta', '?  qué significa'), H(b06[1], 'con la llave', 'Acciones para corregir'), H(b06[2], 'con la cruz', 'Quitar la lectura'), H(r('05', 'input'), 'dos veces la misma', 'Ya escaneada: no cuenta')]), secuencial: true, clics: lim([C(b06[0], 'Con el signo de pregunta')]) },
  '07_termometro': { imagen: img('07') || img('05'), resaltes: lim([H(r('07', 'termo') || r('07', 'pct'), 'El termómetro', 'Avance del escaneo'), H(r('07', 'filtros'), 'Los filtros', 'Filtros de tarjetas')]), secuencial: true },
  '08_situacion': { imagen: img('08'), resaltes: lim([H(r('08', 'tabla'), 'todas las órdenes activas', 'Órdenes activas'), H({ x: 138, y: 453, w: 190, h: 28 }, 'Los interruptores', 'Plazo · Escaneo · Aviso'), H(r('08', 'pago') || { x: 333, y: 455, w: 96, h: 23 }, 'El icono de pago', 'Situación de pago'), H({ x: 138, y: 488, w: 900, h: 16 }, 'facturada sin cobrar', 'Señalética'), H({ x: 630, y: 372, w: 456, h: 70 }, 'Desde acá también', 'Acciones sobre las seleccionadas')]), secuencial: true },
  '09_cerrar': { imagen: img('09'), resaltes: lim([H(r('09', 'btnCerrar'), 'cerramos la auditoría', 'Cerrar auditoría y generar casos'), H(r('09', 'btnAnular'), 'Anular, en cambio', 'Anular: sin casos')]), secuencial: true, clics: lim([C(r('09', 'btnCerrar'), 'cerramos la auditoría')]) },
  '10_resumen': { imagen: img('10'), resaltes: lim([H(r('10', 'nuevos'), 'cuántos casos son nuevos', 'Nuevos'), H(r('10', 'yaEstaban'), 'cuántos ya existían', 'Ya estaban: no se duplican'), H(r('10', 'reincidentes'), 'cuántos reincidieron', 'Reincidentes'), H(r('10', 'resueltos'), 'se resolvieron solos', 'Resueltos solos'), H({ x: 276, y: 407, w: 620, h: 42 }, 'se informan como movidas', 'Hallazgos por tipo')]), secuencial: true },
  '11_casos': { imagen: img('11'), resaltes: lim([H(r('11', 'tabla'), 'Cada orden con problemas', 'Una fila por orden'), H(r('11', 'kpis'), 'Las tarjetas resumen', 'Indicadores'), H(r('11', 'kpiAlta'), 'Severidad alta significa', 'Criterios de severidad alta')]), secuencial: true, zoom: r('11', 'kpis') ? { ...r('11', 'kpis'), frase: 'Severidad alta significa' } : null },
  '12_detalle': { imagen: img('12'), resaltes: lim([H({ x: 138, y: 127, w: 1068, h: 49 }, 'Al abrir una orden', 'La orden'), H({ x: 154, y: 218, w: 1036, h: 66 }, 'vemos sus problemas', 'Problemas de la orden'), H({ x: 154, y: 366, w: 512, h: 268 }, 'la historia completa', 'Historia'), H({ x: 679, y: 366, w: 510, h: 268 }, 'Las acciones de seguimiento', 'Seguimiento'), H({ x: 154, y: 298, w: 1036, h: 54 }, 'Las acciones sobre depósito', 'Acciones sobre depósito')]), secuencial: true },
  '13_sync': { imagen: img('13'), resaltes: lim([H(r('13', 'fila'), 'el caso se cierra solo', 'Resuelto solo'), H(r('13', 'filtro'), 'filtro de cerrados', 'Cerrados recientes')]), secuencial: true },
  '14_reportes': { imagenes: lim([{ imagen: img('14'), t0: 0 }, img('14', 'imgGraficos') ? { imagen: img('14', 'imgGraficos'), frase: 'trae el análisis gráfico' } : null, { imagen: img('14'), frase: 'Se imprime a PDF' }]), resaltes: lim([H(r('14', 'selector'), 'elegimos una auditoría', 'Auditoría o foto en vivo'), H(r('14', 'versiones'), 'La versión ejecutiva', 'Ejecutivo · Completo'), H({ x: 158, y: 70, w: 1028, h: 560 }, 'trae el análisis gráfico', 'Análisis gráfico'), H(r('14', 'botones'), 'Se imprime a PDF', 'Imprimir / PDF · Excel')]), secuencial: true },
  '15_ciclico': { imagen: img('15'), resaltes: lim([H(r('15', 'tabla'), 'propone qué área', 'Áreas por urgencia'), H(r('15', 'leyenda') || r('15', 'th'), 'Las áreas A', 'Clase A · B · C'), H(r('15', 'btn'), 'Con el botón Auditar', 'Auditar solo esta área')]), secuencial: true, clics: lim([C(r('15', 'btn'), 'con un clic')]) },
  '16_cierre': { bullets: [
    { texto: 'Abrir la auditoría', detalle: 'toma la fotografía del depósito', frase: 'abrir la auditoría' },
    { texto: 'Escanear los estantes', detalle: 'una tarjeta por lectura: verde OK, roja problema', frase: 'escanear los estantes' },
    { texto: 'Cerrar la auditoría', detalle: 'compara y genera los casos', frase: 'cerrar para generar' },
    { texto: 'Trabajar cada caso', detalle: 'hasta resolverlo o asumirlo', frase: 'trabajar cada caso' },
    { texto: 'Reportes y conteo cíclico', detalle: 'para mantener el depósito bajo control', frase: 'usar los reportes' }] },
};
const escenas = guion.map(e => ({ ...e, ...(mapa[e.id] || {}) }));
const faltan = escenas.filter(e => e.tipo === 'pantalla' && !e.imagen && !(e.imagenes && e.imagenes.length)).map(e => e.id);
fs.writeFileSync(DIR + '/escenas.json', JSON.stringify(escenas, null, 1));
console.log('escenas.json listo ·', escenas.length, 'escenas · sin captura:', faltan.join(', ') || 'ninguna');
for (const e of escenas) if (e.tipo === 'pantalla') console.log(' ', e.id, '→', e.imagen || (e.imagenes || []).map(i => i.imagen).join(' → '), '· resaltes', (e.resaltes || []).length, '· clics', (e.clics || []).length, e.zoom ? '· zoom' : '');
