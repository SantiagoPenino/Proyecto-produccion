/**
 * [TPU] "Hago mi matriz": el cliente sube su vector, elige zonas y texturas, y el sistema genera
 * el arte de producción (python/tpu_matriz.py) sin pasar por el operario ni por la aprobación.
 *
 * Dos momentos:
 *  1. ANÁLISIS (sincrónico, desde el form): `guardarFuente` + `analizar` — el PDF queda en
 *     uploads/tpu-matriz/<codCliente>-<uuid>.pdf identificado por un TOKEN que el form devuelve
 *     en el pedido. El análisis dice si es vector y lista los trazados para el editor de zonas.
 *  2. GENERACIÓN (asíncrona, al crear el pedido): `encolarGeneracion` — corre el generador, sube
 *     los PDFs a Drive, los registra como arte de la orden (ArchivosOrden), guarda las elecciones
 *     en OrdenTexturasTPU y pasa la orden a 'Diseñado'. Si algo falla, la orden queda con la
 *     marca en la Nota + HistorialOrdenes y el operario resuelve a mano (peor caso = trabajo
 *     nuevo de siempre).
 *
 * Decisiones del usuario (04/09/2026, docs/tpu-cliente-sube-vectorizado-plan.md §0.6):
 *  - PDF vectorial como entrada; sin revisión ni aprobación; entra a producción como llega.
 *  - Nombres: tpu<NoDocERP>-cmyk-spots.pdf / -corte.plt (HPGL, desde el 15/10; antes PDF) / -boceto.pdf (los filtros %cmyk% /
 *    %corte% / %boceto% del resto del sistema los reconocen).
 *  - Imposición (decidida 04/09; ancho 27 cm desde el 14/10, 27,5 desde el 13/10, antes 30): UNA plancha de 27 cm de ancho
 *    y hasta 50 cm de alto, 5 mm entre filas, SIEMPRE filas completas (sobran hasta columnas−1 parches). En el ancho
 *    las copias van adentro de los puntos de registro y el sobrante se reparte en partes iguales entre los huecos
 *    (mínimo 5 mm entre cortes; desde el 14/10).
 *    Si ni la plancha más alta alcanza la cantidad pedida, los archivos de impresión y corte
 *    llevan el sufijo "-<N>copias" (N = VECES que hay que imprimir la plancha para cubrir el pedido).
 *
 * Config (env): PYTHON_DTF_BIN (mismo binario que dtf_blanco), TPU_MATRIZ_ENABLED ('0' apaga).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

const SCRIPT = path.join(__dirname, '..', 'python', 'tpu_matriz.py');
const DIR_FUENTES = require('../utils/rutasUploads').rutaUploads('tpu-matriz'); // UPLOADS_PATH
const DIR_SALIDA = path.join(os.tmpdir(), 'tpu-matriz-out');
// 3 días desde el 21/10/2026 (antes 24 h): el cliente arma la matriz, deja la pestaña abierta y manda el
// pedido al otro día. Caso real: PDF subido el 19/10 11:34, pedido el 21/10 02:25 → ya se había borrado.
const TTL_FUENTE_MS = 3 * 24 * 60 * 60 * 1000;
const MAX_PDF_BYTES = 50 * 1024 * 1024;

// Imposición — los defaults del script de Illustrator + las decisiones del 04/09 (ver arriba).
// sep_mm / sep_filas_mm se miden entre LÍNEAS DE CORTE (08/09): 5 mm entre parches vecinos, o sea
// 2,5 mm que aporta cada uno; contra el borde de la plancha no se agrega margen. El generador les
// descuenta el sangrado de los dos parches.
// Ancho de la plancha: 270 mm desde el 14/10/2026 (pedido de Santiago; 275 desde el 13/10, antes 300).
// En el ancho sep_mm es el MÍNIMO: el generador reparte lo que sobra entre los huecos de la fila.
// Arte de VARIAS piezas (15/10): el generador sube los dos a 12 mm para el rectángulo de corte de cada
// copia en el .plt (RECUADRO_* en tpu_matriz.py).
const IMPOSICION = { plancha_mm: 270, sep_mm: 5, sep_filas_mm: 5, max_alto_mm: 500, completar_filas: true };
const SANGRADO_MM = 1.0;
// PDF de control de capas (una página por capa del parche): temporal, para verificar el generador.
const CAPAS_CONTROL = true;
// Capas de relieve (Spot 1/2/3) como IMAGEN con su tinta plana, a 600 dpi, en vez de vectores con
// recortes anidados: es la receta de la tinta blanca de DTF, que PhotoPrint ya separa bien. Con las
// capas vectoriales el RIP mostraba las zonas lisas pero NO las texturadas (07/09). El arte CMYK
// sigue vectorial. `false` vuelve al vector.
const SPOTS_RASTER = true;
// Un solo cabezal blanco en la impresora (verificado 09/09 con la prueba 16): el canal Spot_1 no
// imprime, solo Spot_2, así que las zonas con "relieve normal" salían vacías. Mientras esté en true,
// el generador pone TODAS las zonas también en Spot 2 y el archivo sale igual en la máquina de uno
// y en la de dos cabezales. Cuando llegue el segundo cabezal: false acá y en RELIEVE_DOBLE_SIEMPRE
// del visor (Tpu3DViewer.jsx), que por la misma razón muestra todo al relieve máximo.
const RELIEVE_DOBLE_SIEMPRE = true;
// Canaleta entre zonas (08/10, pedido de Santiago): entre dos zonas de relieve que se tocan queda 1 pt
// (0,35 mm) sin relieve ni barniz, donde solo cae el color. La cede la zona MÁS GRANDE (casi siempre el
// fondo): las letras y el dibujo quedan enteros. Las manchitas de menos de 0,5 mm no hacen ceder a nadie.
// 0 la apaga. El visor muestra lo mismo con SEPARACION_ZONAS_PT de Tpu3DViewer.jsx: cambiar los dos
// juntos (y el default de tpu_matriz.py).
const SEPARACION_ZONAS_PT = 1;

const habilitado = () => process.env.TPU_MATRIZ_ENABLED !== '0';

// ── Python (misma prioridad que dtfBlancoService, pero VERIFICANDO cada candidato) ────
// dtfBlancoService acepta 'python3' sin probarlo, y en Windows no existe (spawn ENOENT). Acá
// los nombres pelados se prueban con `--version` y en Windows se ofrece 'python' primero.
let pythonBin = null;
function resolverPython() {
    if (pythonBin) return pythonBin;
    const { spawnSync } = require('child_process');
    const pelados = process.platform === 'win32' ? ['python', 'python3'] : ['python3', 'python'];
    const candidatos = [process.env.PYTHON_DTF_BIN, '/opt/suite_user/venv/bin/python', ...pelados].filter(Boolean);
    for (const c of candidatos) {
        try {
            if (c.includes('/') || c.includes('\\')) {
                if (!fs.existsSync(c)) continue;
            } else {
                const r = spawnSync(c, ['--version'], { windowsHide: true, timeout: 5000 });
                if (r.error || r.status !== 0) continue;
            }
            pythonBin = c;
            return c;
        } catch (_) { /* siguiente */ }
    }
    pythonBin = pelados[0];
    return pythonBin;
}

function correrPython(args, timeoutMs) {
    return new Promise((resolve, reject) => {
        execFile(resolverPython(), [SCRIPT, ...args], {
            timeout: timeoutMs,
            maxBuffer: 64 * 1024 * 1024,      // el análisis devuelve los trazados del arte
            windowsHide: true,
        }, (err, stdout, stderr) => {
            // El script imprime SIEMPRE una línea JSON al final, incluso al fallar (exit 1).
            const linea = String(stdout || '').trim().split('\n').pop();
            let json = null;
            try { json = JSON.parse(linea); } catch (_) { }
            if (json && json.ok) return resolve(json);
            reject(new Error((json && json.error) || (err && err.message) || String(stderr).slice(0, 300) || 'fallo desconocido'));
        });
    });
}

// ── Catálogo de texturas (misma resolución que webOrdersController.carpetaTexturas) ──
function carpetaTexturas() {
    const candidatas = [
        path.join(__dirname, '../public/assets/textures'),      // prod (build)
        path.join(__dirname, '../../public/assets/textures'),   // dev (repo)
    ];
    return candidatas.find(c => fs.existsSync(c)) || null;
}

// ── Fuentes (el PDF del cliente entre el análisis y el pedido) ───────────────
const RE_TOKEN = /^(\d+)-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function limpiarFuentesViejas() {
    try {
        if (!fs.existsSync(DIR_FUENTES)) return;
        const ahora = Date.now();
        for (const f of fs.readdirSync(DIR_FUENTES)) {
            const ruta = path.join(DIR_FUENTES, f);
            try {
                if (ahora - fs.statSync(ruta).mtimeMs > TTL_FUENTE_MS) fs.unlinkSync(ruta);
            } catch (_) { }
        }
    } catch (e) {
        logger.warn('[TPU-Matriz] limpieza de fuentes: ' + e.message);
    }
}
limpiarFuentesViejas();
setInterval(limpiarFuentesViejas, 60 * 60 * 1000).unref();

/**
 * Mueve el tmp de multer a la carpeta de fuentes con un token ligado al cliente.
 * Devuelve { token, ruta }.
 */
function guardarFuente(tmpPath, codCliente) {
    fs.mkdirSync(DIR_FUENTES, { recursive: true });
    const token = `${parseInt(codCliente, 10)}-${crypto.randomUUID()}`;
    const ruta = path.join(DIR_FUENTES, `${token}.pdf`);
    try {
        fs.renameSync(tmpPath, ruta);
    } catch (_) {
        fs.copyFileSync(tmpPath, ruta);
        try { fs.unlinkSync(tmpPath); } catch (_) { }
    }
    return { token, ruta };
}

/** Ruta del PDF de un token, solo si el token es del cliente y el archivo sigue ahí. */
function rutaDeToken(token, codCliente) {
    const m = RE_TOKEN.exec(String(token || ''));
    if (!m || parseInt(m[1], 10) !== parseInt(codCliente, 10)) return null;
    const ruta = path.join(DIR_FUENTES, `${token}.pdf`);
    return fs.existsSync(ruta) ? ruta : null;
}

function descartarFuente(token) {
    try { fs.unlinkSync(path.join(DIR_FUENTES, `${token}.pdf`)); } catch (_) { }
}

/** Análisis del vector: {vector, motivo, pagina, bbox, formas[], colores[], avisos[]}. */
async function analizar(rutaPdf) {
    return correrPython(['analizar', rutaPdf], 2 * 60 * 1000);
}

// ── Validación del payload del pedido (metadata.matrizPropia) ────────────────
const num = (v, def, min, max) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
};

/**
 * Normaliza lo que manda el form. Lanza con mensaje para el cliente si no sirve.
 * { token, medida: {ancho, alto} (mm, opcional), zonas: [{indice, nombre, seqnos[], textura,
 *   repeticiones, escala, dx, dy, doble, barniz}] }
 */
// Error que es del pedido del cliente (no del servidor): createWebOrder lo devuelve como 400 con su
// `codigo`, y el formulario lo usa (MATRIZ_VENCIDA → pide subir el PDF de nuevo).
function errorCliente(mensaje, codigo = 'MATRIZ_INVALIDA') {
    const e = new Error(mensaje);
    e.status = 400;
    e.codigo = codigo;
    return e;
}

function validarMatriz(matriz, codCliente) {
    if (!matriz || typeof matriz !== 'object') throw errorCliente('Falta la matriz del cliente.');
    if (!rutaDeToken(matriz.token, codCliente)) {
        throw errorCliente('El PDF de tu matriz ya no está disponible (se guarda 3 días desde que lo subís): volvé a subirlo.', 'MATRIZ_VENCIDA');
    }
    const zonas = Array.isArray(matriz.zonas) ? matriz.zonas : [];
    if (!zonas.length) throw errorCliente('La matriz no tiene ninguna zona de relieve.');
    const dir = carpetaTexturas();
    const catalogo = dir ? new Set(fs.readdirSync(dir)) : new Set();
    const vistos = new Set();
    const limpias = zonas.map((z, i) => {
        const seqnos = [...new Set((Array.isArray(z.seqnos) ? z.seqnos : []).map(s => parseInt(s, 10)).filter(Number.isInteger))];
        if (!seqnos.length) throw errorCliente(`La zona ${i + 1} no tiene trazados.`);
        for (const s of seqnos) {
            if (vistos.has(s)) throw errorCliente(`Un trazado está en dos zonas a la vez (zona ${i + 1}).`);
            vistos.add(s);
        }
        const textura = z.textura ? String(z.textura).substring(0, 255) : null;
        if (textura && !catalogo.has(textura)) throw errorCliente(`La textura ${textura} no existe en el catálogo.`);
        if (textura && !/\.svg$/i.test(textura)) throw errorCliente(`La textura ${textura} no es vectorial (SVG).`);
        return {
            indice: Number.isInteger(parseInt(z.indice, 10)) ? parseInt(z.indice, 10) : i,
            nombre: String(z.nombre || `Zona ${i + 1}`).substring(0, 80),
            seqnos,
            textura,
            repeticiones: textura ? num(z.repeticiones, null, 1, 200) : null,
            // Polaridad de la textura tal como la vio el cliente en el 3D (la manda el visor);
            // null = que la calcule el generador.
            invertida: (z.invertida === true || z.invertida === false) ? z.invertida : null,
            escala: num(z.escala, 1, 0.1, 10),
            dx: num(z.dx, 0.5, 0, 1),
            dy: num(z.dy, 0.5, 0, 1),
            doble: !!z.doble,
            barniz: !!z.barniz,
        };
    });
    let medida = null;
    if (matriz.medida && (matriz.medida.ancho || matriz.medida.alto)) {
        medida = {
            ancho: num(matriz.medida.ancho, null, 5, 500),
            alto: num(matriz.medida.alto, null, 5, 500),
        };
        if (!medida.ancho && !medida.alto) medida = null;
    }
    return { token: String(matriz.token), medida, zonas: limpias };
}

// ── Medida del parche (21/10) ────────────────────────────────────────────────
// El tope sale del NOMBRE del producto ("Parche (De hasta 10x8)": 10 de alto, 8 de ancho), igual que
// en el portal (medidaMaximaTPU). La medida pedida viaja como "[Medida: alto x ancho cm]" en la nota
// (con un decimal desde el 21/10) y, en "Hago mi matriz", también en mm en metadata.matrizPropia.
const RE_TOPE_TPU = /(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/i;
const RE_MEDIDA_NOTA = /\[Medida:\s*(\d+(?:[.,]\d+)?)\s*x\s*(\d+(?:[.,]\d+)?)\s*cm\]/i;
const aNum = (s) => parseFloat(String(s).replace(',', '.'));
const fmtCm = (n) => String(Math.round(n * 10) / 10).replace('.', ',');

function topeTpu(material) {
    const m = RE_TOPE_TPU.exec(String(material || ''));
    if (!m) return null;
    const alto = aNum(m[1]), ancho = aNum(m[2]);
    return (alto > 0 && ancho > 0) ? { alto, ancho } : null;
}

/** "[Medida: 9,2 x 5,8 cm]" de una nota → { alto, ancho, texto } (cm), o null. */
function medidaDeNota(nota) {
    const m = RE_MEDIDA_NOTA.exec(String(nota || ''));
    return m ? { alto: aNum(m[1]), ancho: aNum(m[2]), texto: m[0] } : null;
}

/**
 * Lo del navegador se puede saltear: la medida pedida (la de la nota y, en "Hago mi matriz", la que
 * va al generador) no puede pasar el tope del producto. Lanza un error del cliente (400).
 */
function validarMedidaTpu(material, nota, matrizPropia) {
    const tope = topeTpu(material);
    if (!tope) return;
    const medidas = [];
    const deNota = medidaDeNota(nota);
    if (deNota) medidas.push(deNota);
    const mm = matrizPropia?.medida;
    if (mm?.alto > 0 && mm?.ancho > 0) medidas.push({ alto: mm.alto / 10, ancho: mm.ancho / 10 });
    for (const md of medidas) {
        if (md.alto > tope.alto + 0.05 || md.ancho > tope.ancho + 0.05) {
            throw errorCliente(`La medida máxima de este producto es ${fmtCm(tope.alto)} cm de alto por ${fmtCm(tope.ancho)} cm de ancho `
                + `(pediste ${fmtCm(md.alto)} x ${fmtCm(md.ancho)} cm).`, 'MEDIDA_EXCEDIDA');
        }
    }
}

/**
 * Después de generar: si el parche sale de otra medida que la pedida (el arte se ENCAJA en la caja
 * pedida sin deformarse, así que con otra proporción un lado queda más corto), la línea para la
 * nota del operario. El portal ya ata alto y ancho a la proporción del arte (21/10), así que esto
 * solo salta con un formulario viejo o un pedido armado a mano. Tolerancia: 1 mm por lado.
 */
function textoMedidaGenerada(res, medidaPedidaMm) {
    const p = res?.parche_mm;
    if (!p || !(medidaPedidaMm?.alto > 0) || !(medidaPedidaMm?.ancho > 0)) return '';
    const s = Number(p.sangrado) || 0;
    const alto = Number(p.alto) - 2 * s, ancho = Number(p.ancho) - 2 * s;   // mm, sin el sangrado
    if (Math.abs(alto - medidaPedidaMm.alto) <= 1 && Math.abs(ancho - medidaPedidaMm.ancho) <= 1) return '';
    return `[MATRIZ PROPIA] El parche sale de ${fmtCm(alto / 10)} x ${fmtCm(ancho / 10)} cm (alto x ancho) y se pidió `
        + `${fmtCm(medidaPedidaMm.alto / 10)} x ${fmtCm(medidaPedidaMm.ancho / 10)} cm: la proporción del arte no coincide con la medida pedida.`;
}

// ── Cola serial de generación ────────────────────────────────────────────────
let cola = Promise.resolve();
let pendientes = 0;

/**
 * Desde createWebOrder, DESPUÉS del commit. Nunca lanza.
 * { ordenId, codCliente, matriz (ya validada), cantidad, io }
 */
function encolarGeneracion({ ordenId, codCliente, matriz, cantidad, io }) {
    try {
        if (!habilitado() || !ordenId || !matriz) return;
        pendientes++;
        cola = cola
            .then(() => procesarOrden({ ordenId, codCliente, matriz, cantidad, io }))
            .catch(e => logger.error(`[TPU-Matriz] orden ${ordenId}: ${e.message}`))
            .finally(() => { pendientes--; });
    } catch (e) {
        logger.warn('[TPU-Matriz] no se pudo encolar: ' + e.message);
    }
}

async function procesarOrden({ ordenId, codCliente, matriz, cantidad, io }) {
    const pool = await getPool();
    const q = await pool.request()
        .input('OID', sql.Int, ordenId)
        .query(`SELECT OrdenID, CodigoOrden, NoDocERP, Magnitud, Nota FROM Ordenes WHERE OrdenID = @OID`);
    if (!q.recordset.length) return;
    const orden = q.recordset[0];
    const cod = (orden.CodigoOrden || '').trim();
    const base = orden.NoDocERP ? `tpu${String(orden.NoDocERP).trim()}` : cod;
    const copias = parseInt(String(orden.Magnitud || '').trim(), 10) || parseInt(cantidad, 10) || 0;

    const fuente = rutaDeToken(matriz.token, codCliente);
    if (!fuente) throw await marcarError(pool, ordenId, cod, 'el PDF del cliente ya no estaba disponible al generar');
    if (!(copias > 0)) throw await marcarError(pool, ordenId, cod, 'la orden no tiene cantidad (Magnitud 0)');

    const salidaDir = path.join(DIR_SALIDA, String(ordenId));
    fs.mkdirSync(salidaDir, { recursive: true });
    const job = {
        pdf: fuente,
        salida_dir: salidaDir,
        base,
        medida_mm: matriz.medida || null,
        sangrado_mm: SANGRADO_MM,
        texturas_dir: carpetaTexturas(),
        zonas: matriz.zonas,
        imposicion: { cantidad: copias, ...IMPOSICION },
        boceto: true,
        vista: true,
        capas: CAPAS_CONTROL,
        spots_raster: SPOTS_RASTER,
        relieve_doble_siempre: RELIEVE_DOBLE_SIEMPRE,
        separacion_zonas_pt: SEPARACION_ZONAS_PT,
    };
    const jobPath = path.join(salidaDir, 'job.json');
    fs.writeFileSync(jobPath, JSON.stringify(job, null, 2));

    const t0 = Date.now();
    let res;
    try {
        res = await correrPython(['generar', jobPath], 10 * 60 * 1000);
    } catch (e) {
        throw await marcarError(pool, ordenId, cod, e.message);
    }
    const pl = res.plancha || {};
    const textoPlancha = `${pl.copias_total} copias (${pl.copias_por_fila} × ${pl.filas}) en plancha de ${pl.ancho_mm} × ${pl.alto_mm} mm`
        + (pl.suficiente ? '' : ` — NO alcanza para ${pl.cantidad_pedida}: imprimir ${pl.impresiones_necesarias} veces`);
    logger.info(`[TPU-Matriz] ${cod}: arte generado en ${((Date.now() - t0) / 1000).toFixed(1)}s — ${textoPlancha}, ${res.islas} isla(s)`);

    try {
        const driveService = require('./driveService');
        const subir = (ruta, nombre) => driveService.uploadToDrive(fs.createReadStream(ruta), nombre, 'TPU');

        // 1. Arte de producción: impresión + corte (+ boceto para el cliente / "Mis matrices").
        //    Los nombres los pone el generador: `tpu<NoDocERP>-cmyk-spots[-Ncopias].pdf` y
        //    `-corte[-Ncopias].plt` (el sufijo, solo cuando la plancha no alcanza la cantidad, es
        //    la cantidad de veces que hay que imprimirla).
        const arte = [
            { ruta: res.archivos.impresion, nombre: path.basename(res.archivos.impresion) },
            { ruta: res.archivos.corte, nombre: path.basename(res.archivos.corte) },
        ];
        if (res.archivos.boceto) arte.push({ ruta: res.archivos.boceto, nombre: path.basename(res.archivos.boceto) });
        for (const a of arte) {
            const url = await subir(a.ruta, a.nombre);
            await pool.request()
                .input('OID', sql.Int, ordenId)
                .input('Nom', sql.NVarChar(255), a.nombre)
                .input('Url', sql.NVarChar(sql.MAX), url)
                .query(`INSERT INTO ArchivosOrden (OrdenID, NombreArchivo, TipoArchivo, Copias, EstadoArchivo, FechaSubida, RutaAlmacenamiento)
                        VALUES (@OID, @Nom, 'Impresion', 1, 'Pendiente', GETDATE(), @Url)`);
        }

        // 2. Referencias para poder REGENERAR (otra cantidad, otra plancha): el vector del cliente
        //    y el job con zonas/texturas/parámetros.
        const refs = [
            { ruta: fuente, nombre: `${base}-matriz-fuente.pdf`, tipo: 'MATRIZ FUENTE' },
            { ruta: jobPath, nombre: `${base}-matriz.json`, tipo: 'MATRIZ JOB' },
        ];
        // Vista para humanos: arte + zonas tintadas + corte. El PDF del RIP pinta las tintas planas
        // opacas encima del arte (igual que el de Illustrator) y en Drive no se ve el diseño debajo.
        if (res.archivos.vista) refs.push({ ruta: res.archivos.vista, nombre: `${base}-vista.png`, tipo: 'VISTA MATRIZ' });
        // PDF de control con una página por capa (pedido 07/09, "temporal"): CAPAS_CONTROL=false lo apaga.
        if (CAPAS_CONTROL && res.archivos.capas) refs.push({ ruta: res.archivos.capas, nombre: `${base}-capas.pdf`, tipo: 'CAPAS CONTROL' });
        for (const r of refs) {
            const url = await subir(r.ruta, r.nombre);
            await pool.request()
                .input('OID', sql.Int, ordenId)
                .input('Tipo', sql.VarChar(50), r.tipo)
                .input('Nom', sql.VarChar(200), r.nombre.substring(0, 200))
                .input('Url', sql.NVarChar(sql.MAX), url)
                .query(`INSERT INTO ArchivosReferencia (OrdenID, TipoArchivo, NombreOriginal, FechaSubida, UbicacionStorage)
                        VALUES (@OID, @Tipo, @Nom, GETDATE(), @Url)`);
        }

        // 3. Elecciones por zona, como las del visor 3D (ZonaIndice = índice de la zona del cliente).
        const { guardarTexturasOrden } = require('../controllers/webOrdersController');
        const elecciones = {};
        for (const z of matriz.zonas) {
            elecciones[z.indice] = { textura: z.textura, barniz: z.barniz, escala: z.escala, altura: z.doble ? 2 : 1, dx: z.dx, dy: z.dy };
        }
        await guardarTexturasOrden(pool, ordenId, elecciones, 'CLIENTE');

        // 4. El cliente aprobó su propio diseño al enviarlo → la orden queda lista para fabricar.
        //    Si el arte vino en RGB con negro, o el parche sale de otra medida que la pedida, el aviso
        //    al operario va como línea propia de la nota (una por aviso).
        const notaColor = textoColorArte(res.color_arte);
        const notaMedida = textoMedidaGenerada(res, matriz.medida);
        const notaAdd = [notaMedida, notaColor].filter(Boolean).map(t => ` || ${t}`).join('');
        await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('NotaAdd', sql.NVarChar(sql.MAX), notaAdd)
            .query(`UPDATE Ordenes SET FechaAprobacionCliente = GETDATE(), TexturasElige = 'CLIENTE',
                           Nota = CASE WHEN @NotaAdd = '' THEN Nota ELSE ISNULL(Nota, '') + @NotaAdd END
                    WHERE OrdenID = @OID`);
        for (const t of [notaMedida, notaColor]) if (t) logger.info(`[TPU-Matriz] ${cod}: ${t}`);

        const { changeOrderState } = require('./stateManagerService');
        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            await changeOrderState(tx, {
                target: { type: 'ORDER', id: ordenId },
                estado: 'Diseñado',
                userObj: 'Sistema',
                detalle: `Matriz propia del cliente: arte generado — ${textoPlancha}` + [notaMedida, notaColor].filter(Boolean).map(t => `. ${t}`).join(''),
                io,
            });
            await tx.commit();
        } catch (e) {
            try { await tx.rollback(); } catch (_) { }
            throw e;
        }
        logger.info(`[TPU-Matriz] ${cod}: en Diseñado con ${arte.length} archivos.`);
        descartarFuente(matriz.token);
    } catch (e) {
        throw await marcarError(pool, ordenId, cod, e.message);
    } finally {
        try { fs.rmSync(salidaDir, { recursive: true, force: true }); } catch (_) { }
    }
}

/**
 * Aviso al operario sobre el color del arte (16/10, pedido de Santiago). El generador pasa los negros
 * RGB o gris a negro K 100 (NEGRO_* en tpu_matriz.py) y devuelve `color_arte`: { rgb, gris,
 * negros_k: [[r,g,b]], cerca_limite: [{ rgb, a_k }] }, con valores de 0 a 255. Si el arte
 * trae negro RGB, o un negro RGB cerca del límite (NEGRO_AVISO_*), devuelve la línea para la nota;
 * si no, ''. Ej.: "[MATRIZ PROPIA] El archivo del cliente está en RGB y tiene negro: se pasó a negro
 * K 100 (RGB 3,3,3)."
 */
function textoColorArte(c) {
    if (!c) return '';
    const negros = Array.isArray(c.negros_k) ? c.negros_k : [];
    const cerca = Array.isArray(c.cerca_limite) ? c.cerca_limite : [];
    if (!negros.length && !cerca.length) return '';
    const lista = (items, fmt) => {
        const MAX = 6;
        const txt = items.slice(0, MAX).map(fmt).join(' / ');   // los colores ya llevan comas
        return items.length > MAX ? `${txt} y ${items.length - MAX} más` : txt;
    };
    const rgb = (v) => (Array.isArray(v) ? v.join(',') : String(v));
    const espacio = c.rgb ? 'RGB' : 'escala de grises';
    let t = `[MATRIZ PROPIA] El archivo del cliente está en ${espacio}`;
    t += negros.length
        ? ` y tiene negro: se pasó a negro K 100 (RGB ${lista(negros, rgb)}).`
        : '.';
    if (cerca.length) {
        t += ` Verificar: hay negros RGB cerca del límite: ${lista(cerca, x => `${rgb(x.rgb)} (${x.a_k ? 'pasado a K 100' : 'quedó en RGB'})`)}.`;
    }
    return t;
}

/** Deja constancia para el operario: Nota + HistorialOrdenes. Devuelve el Error para relanzar. */
async function marcarError(pool, ordenId, cod, mensaje) {
    const msg = String(mensaje || 'error desconocido').substring(0, 400);
    try {
        await pool.request()
            .input('OID', sql.Int, ordenId)
            .input('Det', sql.NVarChar(sql.MAX), `[MATRIZ PROPIA] No se pudo generar el arte automáticamente: ${msg}. Hay que hacerlo a mano (el PDF del cliente está en las referencias o en uploads/tpu-matriz).`)
            .query(`INSERT INTO HistorialOrdenes (OrdenID, Estado, FechaInicio, FechaFin, Usuario, Detalle)
                    VALUES (@OID, 'MATRIZ_PROPIA_ERROR', GETDATE(), GETDATE(), 'Sistema', @Det);
                    UPDATE Ordenes SET Nota = ISNULL(Nota, '') + ' [MATRIZ PROPIA: ERROR AL GENERAR EL ARTE — ver historial]' WHERE OrdenID = @OID`);
    } catch (e2) {
        logger.error(`[TPU-Matriz] ${cod}: no se pudo registrar el error: ${e2.message}`);
    }
    return new Error(msg);
}

// ── Ver la matriz de una orden ya creada (visor 3D interno y del portal) ─────
// Las referencias 'MATRIZ FUENTE' (el PDF del cliente) y 'MATRIZ JOB' (zonas/texturas) quedaron
// en Drive al generar. Con eso el visor abre en modo matriz igual que cuando el cliente la armó,
// en vez de mezclar el boceto (parche unitario) con la plancha de corte, que no están alineados.
const RE_DRIVE_ID = /(?:id=|\/d\/)([\w-]+)/;

async function descargarDrive(url) {
    const driveId = (String(url || '').match(RE_DRIVE_ID) || [])[1];
    if (!driveId) throw new Error('Referencia sin archivo en Drive.');
    const driveService = require('./driveService');
    const file = await driveService.getFileStream(driveId);
    const chunks = [];
    for await (const c of file.stream) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return { buffer: Buffer.concat(chunks), mimeType: file.mimeType || 'application/octet-stream' };
}

// Caché del visor (19/10/2026). Abrir el visor 3D de una orden de matriz bajaba de Drive el JOB y el
// PDF del cliente, analizaba el PDF con Python y después volvía a bajar el MISMO PDF para mandarlo al
// navegador: 4-5 s medidos con la pantalla vacía. Se guarda la PROMESA, así el análisis y la fuente
// (que el visor ahora pide a la vez) comparten una sola descarga, y reabrir el visor no vuelve a
// Drive. Los archivos de una referencia no cambian: uno nuevo es otra referencia, con otra URL.
// Acotado por cantidad y por tamaño (el VPS anda justo de memoria): un PDF grande no se guarda.
const CACHE_VISOR_MS = 10 * 60 * 1000;
const CACHE_VISOR_MAX = 10;
const CACHE_VISOR_MAX_BYTES = 8 * 1024 * 1024;
const cacheVisor = new Map();   // clave → { t, p }

function cacheado(clave, fn, pesa = () => 0) {
    const hit = cacheVisor.get(clave);
    if (hit && Date.now() - hit.t < CACHE_VISOR_MS) return hit.p;
    const p = fn();
    cacheVisor.set(clave, { t: Date.now(), p });
    p.then(v => { if (pesa(v) > CACHE_VISOR_MAX_BYTES) cacheVisor.delete(clave); },
           () => cacheVisor.delete(clave));   // un error no queda guardado
    while (cacheVisor.size > CACHE_VISOR_MAX) cacheVisor.delete(cacheVisor.keys().next().value);
    return p;
}

const descargarDriveCacheado = (url) =>
    cacheado(`drive:${url}`, () => descargarDrive(url), (v) => v?.buffer?.length || 0);

/** Referencias de matriz propia de la orden (scope opcional por CodCliente). null si no es una. */
async function referenciasMatriz(pool, ordenId, codCliente = null) {
    const r = await pool.request()
        .input('OID', sql.Int, ordenId)
        .input('cod', sql.Int, codCliente || 0)
        .query(`SELECT ar.RefID, ar.TipoArchivo, ar.UbicacionStorage
                FROM dbo.ArchivosReferencia ar WITH(NOLOCK)
                JOIN dbo.Ordenes o WITH(NOLOCK) ON o.OrdenID = ar.OrdenID
                WHERE ar.OrdenID = @OID AND ar.TipoArchivo IN ('MATRIZ FUENTE', 'MATRIZ JOB')
                  ${codCliente ? 'AND o.CodCliente = @cod' : ''}
                  AND ar.UbicacionStorage IS NOT NULL AND ar.UbicacionStorage <> 'Pendiente'
                ORDER BY ar.RefID DESC`);
    const fuente = r.recordset.find(x => x.TipoArchivo === 'MATRIZ FUENTE');
    const job = r.recordset.find(x => x.TipoArchivo === 'MATRIZ JOB');
    if (!fuente || !job) return null;
    return { fuente, job };
}

/** { job, analisis } de la matriz de la orden, o null si la orden no es de matriz propia. */
async function leerMatrizDeOrden(pool, ordenId, codCliente = null) {
    const refs = await referenciasMatriz(pool, ordenId, codCliente);
    if (!refs) return null;
    const urlFuente = refs.fuente.UbicacionStorage;
    const [jobBuf, analisis] = await Promise.all([
        descargarDriveCacheado(refs.job.UbicacionStorage),
        // El análisis depende solo del PDF: se guarda junto con él.
        cacheado(`analisis:${urlFuente}`, async () => {
            const pdfBuf = await descargarDriveCacheado(urlFuente);
            fs.mkdirSync(DIR_SALIDA, { recursive: true });
            const tmp = path.join(DIR_SALIDA, `fuente-${ordenId}-${Date.now()}.pdf`);
            fs.writeFileSync(tmp, pdfBuf.buffer);
            try { return await analizar(tmp); } finally { try { fs.unlinkSync(tmp); } catch (_) { } }
        }),
    ]);
    const job = JSON.parse(jobBuf.buffer.toString('utf8'));   // descargarDrive devuelve { buffer, mimeType }
    // separacion_zonas_pt: la canaleta con la que se generó ESTA orden. Las generadas antes del
    // 08/10 no la tienen (0): el visor no les dibuja una canaleta que su archivo no lleva.
    return {
        job: {
            zonas: job.zonas || [], medida_mm: job.medida_mm || null, imposicion: job.imposicion || null,
            separacion_zonas_pt: Number(job.separacion_zonas_pt) || 0,
        },
        analisis,
    };
}

/** Manda el PDF fuente de la matriz de la orden al response (para que el visor lo abra con pdf.js). */
async function responderFuenteMatriz(pool, ordenId, codCliente, res) {
    const refs = await referenciasMatriz(pool, ordenId, codCliente);
    if (!refs) return res.status(404).json({ error: 'La orden no tiene matriz propia.' });
    const { buffer } = await descargarDriveCacheado(refs.fuente.UbicacionStorage);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(buffer);
}

module.exports = {
    habilitado,
    leerMatrizDeOrden,
    responderFuenteMatriz,
    guardarFuente,
    rutaDeToken,
    descartarFuente,
    analizar,
    validarMatriz,
    encolarGeneracion,
    // También lo usa la matriz automática de Bordado (bordadoMatrizService) para bajar su borrador.
    descargarDrive,
    MAX_PDF_BYTES,
    _pendientes: () => pendientes,
    _textoColorArte: textoColorArte,
    validarMedidaTpu,
    medidaDeNota,
    _textoMedidaGenerada: textoMedidaGenerada,
};
