/**
 * [BORDADO] Matriz AUTOMÁTICA (borrador) con Ink/Stitch.
 *
 * Cuando entra un pedido de bordado, arma un SVG con las piezas de la paleta del diseño (la que
 * calculó el portal al subir el logo: contorno, color y puntada de cada parada) a la medida
 * cargada, lo pasa por Ink/Stitch y deja el DST en la orden como referencia 'MATRIZ AUTOMATICA'
 * (pestaña «Archivos de Referencia» del detalle).
 *
 * Es un BORRADOR (decisión del usuario, 20/10): no cumple el requisito MATRIZ. El diseñador lo
 * descarga, lo revisa en Wilcom y, si sirve, lo pasa a matriz con «Usar como matriz»
 * (`usarComoMatriz`), que va por la subida de siempre (ordersController.uploadProductionFile) y
 * recién ahí cumple el requisito.
 *
 * Ink/Stitch no genera EMB (el formato de Wilcom es cerrado): sale DST, que Wilcom abre.
 *
 * Config (env): INKSTITCH_BIN — el ejecutable de Ink/Stitch (en el VPS, el de la versión de Linux:
 * <carpeta>/inkstitch/bin/inkstitch). Sin él no se genera nada y el pedido sigue igual que antes.
 * BORDADO_MATRIZ_AUTO='0' lo apaga.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

const TIPO_REFERENCIA = 'MATRIZ AUTOMATICA';
// El mismo borrador en PES (formato Brother): el DST no guarda colores, el PES sí, y Wilcom lo abre
// con cada parada coloreada. Es solo para ver: «Usar como matriz» va con el DST.
const TIPO_REFERENCIA_PES = 'MATRIZ AUTOMATICA PES';

// ── Carta de hilos ───────────────────────────────────────────────────────────
// La paleta guarda solo el código de cada hilo; el nombre y el color salen del nomenclador
// (dbo.CatalogoHilos, Configurar Productos › Hilos), con los inactivos incluidos: un pedido viejo
// puede usar uno que ya no se ofrece. Sin la tabla (falta configurador_hilos.sql), del JSON del
// portal; sin ninguno de los dos, el borrador sale igual, con los códigos y el color del arte.
// Se vuelve a leer cada minuto, así lo que se edita en el configurador llega sin reiniciar.
const RUTA_CARTA = path.join(__dirname, '..', '..', 'src', 'client-portal', 'modulos', 'order-form', 'utils', 'cartaHilosBordado.json');
const CARTA_TTL_MS = 60 * 1000;
let carta = null;
let cartaHasta = 0;
async function cargarCarta() {
    if (carta && Date.now() < cartaHasta) return;
    let filas = null;
    try {
        const pool = await getPool();
        const t = await pool.request().query(`SELECT OBJECT_ID('dbo.CatalogoHilos', 'U') AS t`);
        if (t.recordset[0].t != null) {
            filas = (await pool.request().query(`SELECT Codigo AS codigo, Nombre AS nombre, Hex AS hex FROM dbo.CatalogoHilos`)).recordset;
        }
    } catch (e) {
        logger.warn('[Bordado-Matriz] no se pudo leer el nomenclador de hilos: ' + e.message);
    }
    if (!filas || !filas.length) {
        try { filas = JSON.parse(fs.readFileSync(RUTA_CARTA, 'utf8')); } catch (e) { filas = []; }
    }
    carta = new Map(filas.map(h => [h.codigo, h]));
    cartaHasta = Date.now() + CARTA_TTL_MS;
}
const hiloDe = (codigo) => (carta && carta.get(codigo)) || null;

const NOMBRE_PUNTADA = { TATAMI: 'relleno', SATEN: 'satén', PESPUNTE: 'pespunte', ZIGZAG: 'zigzag', TAFETA: 'tafeta' };
const TIMEOUT_MS = 3 * 60 * 1000;
// Versión del formato SVG de Ink/Stitch. Sin esta marca, Ink/Stitch toma el archivo por un diseño
// viejo y abre una ventana preguntando si lo actualiza: en Windows se queda esperando un clic.
const INKSTITCH_SVG_VERSION = 3;
// Una parte más chica que esto no se puede rellenar (Ink/Stitch la descarta con aviso): se saltea.
const AREA_MINIMA_MM2 = 0.5;
// Ancho medio mínimo (mm) de una parte de relleno o satén. Más angosta es una tira del borde
// difuminado del PNG (el antialias entre dos colores: en XLEGA, BOR-31892, una parada «Gris Perla»
// del 0,2 % que salía como puntaditas sueltas y un cambio de hilo de más). El hilo más fino que
// se borda en satén anda por 0,8-1 mm. El pespunte no se filtra: es una línea a propósito.
const ANCHO_MINIMO_MM = 0.6;

const binario = () => {
    const b = process.env.INKSTITCH_BIN;
    return b && fs.existsSync(b) ? b : null;
};
const habilitado = () => process.env.BORDADO_MATRIZ_AUTO !== '0' && !!binario();

// ── Geometría ────────────────────────────────────────────────────────────────
// Los contornos de la paleta («anillos») son los que sacó el portal al vectorizar el logo, en
// píxeles de su lienzo de análisis (~420 px). Vienen todos sueltos: el contorno de afuera de cada
// parte y los de sus huecos, mezclados. Se reagrupan por anidamiento: un anillo adentro de otro
// es un hueco; adentro de un hueco, otra parte.

const areaAnillo = (a) => {
    let s = 0;
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) s += (a[j][0] + a[i][0]) * (a[j][1] - a[i][1]);
    return Math.abs(s / 2);
};

const perimetroAnillo = (a) => {
    let p = 0;
    for (let i = 0, j = a.length - 1; i < a.length; j = i++) p += Math.hypot(a[i][0] - a[j][0], a[i][1] - a[j][1]);
    return p;
};

/** Ancho medio de una parte (mm): 2 × área / perímetro. Para una tira larga y angosta es su ancho. */
const anchoMedio = (pt) => {
    const area = areaAnillo(pt.exterior) - pt.huecos.reduce((s, h) => s + areaAnillo(h), 0);
    const perimetro = perimetroAnillo(pt.exterior) + pt.huecos.reduce((s, h) => s + perimetroAnillo(h), 0);
    return perimetro > 0 ? (2 * area) / perimetro : 0;
};

const adentro = ([x, y], anillo) => {
    let dentro = false;
    for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
        const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) dentro = !dentro;
    }
    return dentro;
};

/** [{ exterior, huecos: [] }]: cada parte de la pieza con sus huecos. */
function partes(anillos) {
    const validos = (anillos || []).filter(a => Array.isArray(a) && a.length >= 3);
    const info = validos.map((a) => ({ a, area: areaAnillo(a), contenedores: [] }));
    info.forEach((r, i) => {
        info.forEach((o, j) => {
            if (i !== j && o.area > r.area && adentro(r.a[0], o.a)) r.contenedores.push(o);
        });
    });
    const exteriores = info.filter(r => r.contenedores.length % 2 === 0);
    const out = exteriores.map(e => ({ exterior: e.a, area: e.area, huecos: [] }));
    info.filter(r => r.contenedores.length % 2 === 1).forEach((h) => {
        // El hueco es de la parte más chica que lo contiene.
        const duenia = h.contenedores.filter(c => c.contenedores.length % 2 === 0).sort((x, y) => x.area - y.area)[0];
        const p = duenia && out.find(o => o.exterior === duenia.a);
        if (p) p.huecos.push(h.a);
    });
    return out;
}

/**
 * Ángulo de Ink/Stitch para que las puntadas CRUCEN la parte (como un satén): perpendicular a su
 * eje largo. Medido el 20/10 con una barra en diagonal: Ink/Stitch cuenta el ángulo al revés que la
 * pantalla (con 45 las filas quedan a 135° en pantalla), así que va con el signo cambiado.
 */
function anguloAtravesado(puntos) {
    const n = puntos.length;
    if (n < 3) return 0;
    let mx = 0, my = 0;
    for (const [x, y] of puntos) { mx += x; my += y; }
    mx /= n; my /= n;
    let cxx = 0, cyy = 0, cxy = 0;
    for (const [x, y] of puntos) { cxx += (x - mx) ** 2; cyy += (y - my) ** 2; cxy += (x - mx) * (y - my); }
    const eje = 0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180 / Math.PI;   // en pantalla (y hacia abajo)
    const filas = eje + 90;
    return Math.round((((-filas) % 180) + 180) % 180);
}

const num = (v) => Math.round(v * 1000) / 1000;
const dDe = (anillos) => anillos.map(a => 'M ' + a.map(([x, y]) => `${num(x)},${num(y)}`).join(' L ') + ' Z').join(' ');
const esc = (s) => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/**
 * El SVG para Ink/Stitch: una capa por parada, en el orden de la secuencia de bordado, a la medida
 * del diseño (mm). Puntadas:
 *   · Relleno (tatami): relleno automático con base, alternando 45° / 135° entre paradas.
 *   · Satén y zigzag: Ink/Stitch no arma columnas de satén solo; va un relleno con las puntadas
 *     atravesadas a cada parte y largas (hasta 7 mm), que en partes angostas queda como un satén.
 *   · Pespunte y tafeta: pespunte por el contorno. En la tafeta es la línea de colocación de la
 *     tela; el borde lo agrega el diseñador.
 */
function armarSvg(paleta, anchoMm, altoMm) {
    const piezas = (paleta || []).filter(p => Array.isArray(p.anillos) && p.anillos.length);
    if (!piezas.length) throw new Error('la paleta no tiene contornos (el logo no se pudo vectorizar)');
    if (!(anchoMm > 0) || !(altoMm > 0)) throw new Error('faltan el ancho y el largo del bordado');

    // Caja del dibujo en píxeles del lienzo del portal → mm de la medida cargada.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of piezas) for (const a of p.anillos) for (const [x, y] of a) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (!(x1 > x0) || !(y1 > y0)) throw new Error('los contornos de la paleta están vacíos');
    const sx = anchoMm / (x1 - x0), sy = altoMm / (y1 - y0);
    const aMm = (a) => a.map(([x, y]) => [(x - x0) * sx, (y - y0) * sy]);

    const avisos = new Set();
    // Las paradas que de verdad entran al archivo, para la lista de hilos de la nota.
    const paradas = [];
    const capas = piezas.map((p, i) => {
        // El color del HILO elegido (no el del arte): es lo que el PES le pasa a Wilcom.
        const hilo = hiloDe(p.hilo);
        const color = esc((hilo && hilo.hex) || p.colorOriginal || '#000000');
        const puntada = p.relieve ? 'SATEN' : String(p.puntada || 'TATAMI').toUpperCase();
        const esLinea = puntada === 'PESPUNTE' || puntada === 'TAFETA';
        const ps = partes(p.anillos)
            .map(pt => ({ exterior: aMm(pt.exterior), huecos: pt.huecos.map(aMm) }))
            .filter(pt => areaAnillo(pt.exterior) >= AREA_MINIMA_MM2 && (esLinea || anchoMedio(pt) >= ANCHO_MINIMO_MM));
        if (!ps.length) return '';
        const id = `p${i + 1}`;
        paradas.push({ codigo: p.hilo || '', nombre: hilo ? hilo.nombre : '', hex: hilo ? hilo.hex : (p.colorOriginal || ''), puntada });
        // Un objeto por parte separada, con CORTE de hilo al terminarla (salvo la última: ahí viene
        // el cambio de hilo). Todo en un solo objeto, Ink/Stitch pasaba de una letra a la otra con una
        // puntada larga que quedaba a la vista (en XLEGA, el hilo blanco cruzando el borde azul).
        // Es lo que hace Wilcom: cortar entre partes que no se tocan.
        const corte = (k, n) => (k < n - 1 ? ' inkstitch:trim_after="true"' : '');
        let elementos;
        if (esLinea) {
            if (puntada === 'TAFETA') avisos.add('La tafeta va solo con la línea de colocación: el borde que sujeta la tela lo agrega el diseñador.');
            const anillos = ps.flatMap(pt => [pt.exterior, ...pt.huecos]);
            elementos = anillos.map((a, k) => `<path id="${id}_${k + 1}" d="${dDe([a])}" style="fill:none;stroke:${color};stroke-width:0.3" inkstitch:stroke_method="running_stitch" inkstitch:running_stitch_length_mm="2"${corte(k, anillos.length)}/>`).join('\n    ');
        } else if (puntada === 'SATEN' || puntada === 'ZIGZAG') {
            elementos = ps.map((pt, k) => `<path id="${id}_${k + 1}" d="${dDe([pt.exterior, ...pt.huecos])}" style="fill:${color};fill-rule:evenodd;stroke:none" inkstitch:fill_method="auto_fill" inkstitch:angle="${anguloAtravesado(pt.exterior)}" inkstitch:max_stitch_length_mm="7" inkstitch:row_spacing_mm="0.25"${corte(k, ps.length)}/>`).join('\n    ');
        } else {
            elementos = ps.map((pt, k) => `<path id="${id}_${k + 1}" d="${dDe([pt.exterior, ...pt.huecos])}" style="fill:${color};fill-rule:evenodd;stroke:none" inkstitch:fill_method="auto_fill" inkstitch:angle="${i % 2 ? 135 : 45}"${corte(k, ps.length)}/>`).join('\n    ');
        }
        return `  <g id="parada${i + 1}">\n    ${elementos}\n  </g>`;
    }).filter(Boolean);
    if (!capas.length) throw new Error('las piezas de la paleta son demasiado chicas para bordar a esta medida');

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkstitch="http://inkstitch.org/namespace" width="${num(anchoMm)}mm" height="${num(altoMm)}mm" viewBox="0 0 ${num(anchoMm)} ${num(altoMm)}">
  <metadata><inkstitch:inkstitch_svg_version>${INKSTITCH_SVG_VERSION}</inkstitch:inkstitch_svg_version></metadata>
${capas.join('\n')}
</svg>
`;
    return { svg, avisos: [...avisos], paradas };
}

/** «1) Negro (USR-1020) · relleno; 2) …» — para asignar los hilos en Wilcom (el DST no los trae). */
const textoParadas = (paradas) => paradas.map((h, i) =>
    `${i + 1}) ${h.nombre ? `${h.nombre} (${h.codigo})` : (h.codigo || h.hex)} · ${NOMBRE_PUNTADA[h.puntada] || h.puntada.toLowerCase()}`
).join('; ');

// ── Ink/Stitch ───────────────────────────────────────────────────────────────

// Cómo se reconoce cada formato que devuelve Ink/Stitch (la cabecera del archivo).
const FIRMAS = { dst: (b) => b.length >= 512 && b.slice(0, 3).toString('latin1') === 'LA:', pes: (b) => b.slice(0, 4).toString('latin1') === '#PES' };

/** Corre una extensión de Ink/Stitch sobre el SVG y devuelve lo que escribe (Buffer). */
async function correrInkstitch(svg, args) {
    const bin = binario();
    if (!bin) throw new Error('Ink/Stitch no está configurado en el servidor (INKSTITCH_BIN)');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bordado-matriz-'));
    const svgPath = path.join(dir, 'diseno.svg');
    fs.writeFileSync(svgPath, svg);
    try {
        return await new Promise((resolve, reject) => {
            execFile(bin, [...args, svgPath], {
                cwd: dir, encoding: 'buffer', maxBuffer: 256 * 1024 * 1024, timeout: TIMEOUT_MS, windowsHide: true,
            }, (err, stdout, stderr) => {
                const avisos = String(stderr || '').trim();
                if (avisos) logger.warn('[Bordado-Matriz] Ink/Stitch: ' + avisos.slice(0, 500));
                if (err) return reject(new Error('Ink/Stitch falló: ' + (avisos.slice(0, 300) || err.message)));
                resolve(stdout);
            });
        });
    } finally {
        try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { }
    }
}

/** El archivo de máquina (Buffer) en `formato` ('dst' | 'pes'). */
async function generarArchivo(svg, formato) {
    const archivo = await correrInkstitch(svg, ['--extension=output', `--format=${formato}`]);
    if (!archivo || !FIRMAS[formato](archivo)) throw new Error(`Ink/Stitch no devolvió un ${formato.toUpperCase()}`);
    return archivo;
}

/**
 * VISTA DE PUNTADAS: lo que se va a bordar, dibujado puntada por puntada con el brillo del hilo
 * (Ink/Stitch «stitch plan preview», modo realistic-vector: filtros SVG, sin Inkscape). La pide el
 * portal apenas analiza el logo, para mostrarla en «Viendo tu diseño» en lugar del prediseño: son
 * las mismas puntadas del borrador que recibe el taller. Devuelve el SVG (texto); lo dibuja el
 * navegador (librsvg, el de sharp, lo dibujaba con puntadas gruesas y el negro gris, y tardaba más).
 * Se guardan las últimas en memoria: el portal la vuelve a pedir si el cliente cambia algo y vuelve.
 */
const cacheVistas = new Map();
const CACHE_VISTAS_MAX = 20;
async function vistaPuntadas(paleta, anchoMm, altoMm) {
    await cargarCarta();
    const { svg } = armarSvg(paleta, anchoMm, altoMm);
    const clave = require('crypto').createHash('sha1').update(svg).digest('hex');
    if (cacheVistas.has(clave)) return cacheVistas.get(clave);
    const vista = await enCola(async () => {
        const out = await correrInkstitch(svg, [
            '--extension=stitch_plan_preview', '--render-mode=realistic-vector', '--layer-visibility=hidden',
            '--move-to-side=False', '--render-jumps=False', '--needle-points=False', '--visual-commands=False',
        ]);
        const texto = out.toString('utf8');
        if (!/__inkstitch_stitch_plan__/.test(texto)) throw new Error('Ink/Stitch no devolvió la vista de puntadas');
        // Fuera el diseño de entrada (las capas paradaN, ocultas): no se ve y solo pesa.
        return texto.replace(/<g[^>]*\bid="parada\d+"[^>]*>[\s\S]*?<\/g>/g, '');
    });
    cacheVistas.set(clave, vista);
    if (cacheVistas.size > CACHE_VISTAS_MAX) cacheVistas.delete(cacheVistas.keys().next().value);
    return vista;
}
const generarDst = (svg) => generarArchivo(svg, 'dst');

/** La cabecera del DST: puntadas, colores y medida (en 0,1 mm). */
function leerCabeceraDst(buf) {
    const t = buf.slice(0, 512).toString('latin1');
    const campo = (k) => {
        const m = t.match(new RegExp(k + ':\\s*([-+]?\\s*\\d+)'));
        return m ? parseInt(m[1].replace(/\s/g, ''), 10) : 0;
    };
    return {
        puntadas: campo('ST'),
        colores: campo('CO') + 1,
        anchoMm: (campo('\\+X') + campo('-X')) / 10,
        altoMm: (campo('\\+Y') + campo('-Y')) / 10,
    };
}

// ── La orden ─────────────────────────────────────────────────────────────────

async function historial(pool, ordenId, usuario, detalle) {
    try {
        await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('User', sql.VarChar, String(usuario || 'Sistema'))
            .input('Det', sql.NVarChar, String(detalle).substring(0, 499))
            .query(`
                INSERT INTO HistorialOrdenes (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                SELECT @OID, ISNULL(EstadoenArea, 'Pendiente'), GETDATE(), GETDATE(), @User, @Det FROM Ordenes WHERE OrdenID = @OID
            `);
    } catch (e) {
        logger.warn(`[Bordado-Matriz] orden ${ordenId}: no se pudo escribir el historial: ${e.message}`);
    }
}

/**
 * Genera el borrador de una orden de Bordado y lo deja como referencia 'MATRIZ AUTOMATICA'.
 * Lee todo de la base (la ficha 'BORDADO': paleta, ancho y alto), así sirve igual para el pedido
 * del portal, el de prendas y el botón del detalle. Devuelve lo generado; si no se puede, lanza.
 */
async function generarParaOrden(ordenId, usuario = 'Sistema') {
    const pool = await getPool();
    const o = (await pool.request().input('OID', sql.Int, ordenId)
        .query(`SELECT OrdenID, CodigoOrden, AreaID FROM Ordenes WHERE OrdenID = @OID`)).recordset[0];
    if (!o) throw new Error('la orden no existe');
    if (String(o.AreaID || '').trim().toUpperCase() !== 'EMB') throw new Error('la orden no es de Bordado');
    const cod = String(o.CodigoOrden || ordenId).trim();

    const ficha = (await pool.request().input('OID', sql.Int, ordenId).query(`
        SELECT TOP 1 PaletaBordado, Ancho, Alto FROM ArchivosOrden
        WHERE OrdenID = @OID AND TipoArchivo = 'BORDADO' AND ISNULL(EstadoArchivo, '') <> 'Cancelado'
        ORDER BY ArchivoID DESC`)).recordset[0];
    if (!ficha || !ficha.PaletaBordado) throw new Error('la orden no tiene la paleta de hilos del diseño (el logo no se pudo analizar)');
    let paleta;
    try { paleta = JSON.parse(ficha.PaletaBordado); } catch (_) { throw new Error('la paleta de hilos guardada está dañada'); }

    const anchoMm = (parseFloat(ficha.Ancho) || 0) * 10;
    const altoMm = (parseFloat(ficha.Alto) || 0) * 10;
    await cargarCarta();
    const { svg, avisos, paradas } = armarSvg(paleta, anchoMm, altoMm);
    const t0 = Date.now();
    const dst = await generarDst(svg);
    const cab = leerCabeceraDst(dst);
    // El PES es un extra para ver los colores: si falla, el borrador sale igual con el DST.
    let pes = null;
    try { pes = await generarArchivo(svg, 'pes'); } catch (e) { logger.warn(`[Bordado-Matriz] ${cod}: sin PES (${e.message})`); }
    const segundos = ((Date.now() - t0) / 1000).toFixed(1);

    const base = cod.replace(/[\\/:*?"<>|]/g, '-');
    const nombre = `${base} - matriz automatica.dst`;
    const hilos = textoParadas(paradas);
    const nota = `Borrador generado automáticamente (Ink/Stitch): ${cab.puntadas.toLocaleString('es-UY')} puntadas, `
        + `${cab.colores} ${cab.colores === 1 ? 'color' : 'colores'}, ${cab.anchoMm} × ${cab.altoMm} mm. `
        + 'NO es la matriz final: revisalo en Wilcom antes de usarlo. El DST no guarda colores'
        + (pes ? ': para verlos abrí el PES.' : '.')
        + (avisos.length ? ' ' + avisos.join(' ') : '')
        + (hilos ? ` Hilos por parada: ${hilos}` : '');

    const driveService = require('./driveService');
    const subir = async (buffer, nombreArchivo, tipo, notaRef) => {
        const tmp = path.join(os.tmpdir(), `${Date.now()}-${ordenId}-${nombreArchivo.replace(/[^\w.-]+/g, '_')}`);
        fs.writeFileSync(tmp, buffer);
        try {
            const url = await driveService.uploadToDrive(fs.createReadStream(tmp), nombreArchivo, 'EMB');
            return (await pool.request()
                .input('OID', sql.Int, ordenId)
                .input('Tipo', sql.VarChar(50), tipo)
                .input('Nom', sql.VarChar(200), nombreArchivo.substring(0, 199))
                .input('Not', sql.NVarChar(sql.MAX), notaRef)
                .input('Url', sql.NVarChar(sql.MAX), url)
                .query(`
                    INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, NotasAdicionales, FechaSubida, UbicacionStorage)
                    OUTPUT INSERTED.RefID
                    VALUES (@OID, @Tipo, @Nom, @Not, GETDATE(), @Url)
                `)).recordset[0].RefID;
        } finally {
            try { fs.unlinkSync(tmp); } catch (_) { }
        }
    };

    const refId = await subir(dst, nombre, TIPO_REFERENCIA, nota);
    let refIdPes = null;
    if (pes) {
        refIdPes = await subir(pes, `${base} - matriz automatica (colores).pes`, TIPO_REFERENCIA_PES,
            'El mismo borrador en PES (formato Brother): guarda el color de cada parada, así que Wilcom lo abre con los hilos coloreados (el más parecido de su carta). Es solo para ver: «Usar como matriz» va con el DST.'
            + (hilos ? ` Hilos por parada: ${hilos}` : ''));
    }

    // Al volver a generar, el borrador anterior se reemplaza (salvo uno que ya se usó como matriz,
    // que queda como constancia). Si no, «Volver a generar» iba apilando borradores iguales. Se borra
    // DESPUÉS de guardar el nuevo, así un error al subir no deja la orden sin ninguno.
    await pool.request()
        .input('OID', sql.Int, ordenId)
        .input('Nuevo', sql.Int, refId)
        .input('NuevoPes', sql.Int, refIdPes || refId)
        .query(`
            DELETE FROM ArchivosReferencia
            WHERE OrdenID = @OID AND TipoArchivo IN ('${TIPO_REFERENCIA}', '${TIPO_REFERENCIA_PES}')
              AND RefID NOT IN (@Nuevo, @NuevoPes)
              AND ISNULL(NotasAdicionales, '') NOT LIKE 'Usado como matriz%'`);
    await historial(pool, ordenId, usuario, `Matriz automática (borrador) generada: ${nombre}${pes ? ' + PES con colores' : ''} — ${cab.puntadas} puntadas, ${cab.colores} colores. Revisarla y pasarla a matriz desde Archivos de Referencia.`);
    logger.info(`[Bordado-Matriz] ${cod}: borrador en ${segundos}s — ${cab.puntadas} puntadas, ${cab.colores} colores, ${cab.anchoMm} × ${cab.altoMm} mm${pes ? ', con PES' : ''}`);
    return { refId, refIdPes, nombre, ...cab, avisos, paradas };
}

// Una a la vez: Ink/Stitch usa bastante memoria y el VPS anda justo.
let cola = Promise.resolve();
const enCola = (fn) => {
    const p = cola.then(fn);
    cola = p.catch(() => { });
    return p;
};

/** Para el botón del detalle: genera en la cola y devuelve el resultado o el error. */
const generarEnCola = (ordenId, usuario) => enCola(() => generarParaOrden(ordenId, usuario));

/**
 * Encola la generación al crear el pedido (después del commit). Nunca lanza: si no se puede, queda
 * una línea en el historial de la orden y el diseñador hace la matriz como siempre.
 */
function encolarGeneracion({ ordenId, usuario = 'Sistema' }) {
    if (!habilitado() || !ordenId) return Promise.resolve(null);
    return generarEnCola(ordenId, usuario).catch(async (e) => {
        logger.warn(`[Bordado-Matriz] orden ${ordenId}: ${e.message}`);
        try { await historial(await getPool(), ordenId, usuario, `Matriz automática: no se pudo generar (${e.message}). La matriz la hace el diseñador como siempre.`); } catch (_) { }
        return null;
    });
}

/** Baja la referencia de Drive (mismo camino que el visor de la matriz de TPU). */
async function descargarReferencia(url) {
    return require('./tpuMatrizService').descargarDrive(url);
}

module.exports = {
    TIPO_REFERENCIA,
    TIPO_REFERENCIA_PES,
    habilitado,
    armarSvg,
    leerCabeceraDst,
    generarDst,
    generarArchivo,
    vistaPuntadas,
    textoParadas,
    cargarCarta,
    generarParaOrden,
    generarEnCola,
    encolarGeneracion,
    descargarReferencia,
    _partes: partes,
    _anguloAtravesado: anguloAtravesado,
};
