#!/usr/bin/env node
/**
 * Migración de matrices TPU: planilla "PARCHES TPU" (sistema viejo de Apps Script) → SQL.
 *
 * Trae al sistema nuevo las matrices que los clientes ya tenían hechas, para que aparezcan en
 * "Mis matrices" del portal y se puedan reusar. Plan completo y criterios:
 * docs/tpu-migracion-matrices-sheets.md
 *
 * Uso (desde backend/):
 *   node scripts/migrar-matrices-tpu.js                  → DRY-RUN, no escribe nada
 *   node scripts/migrar-matrices-tpu.js --commit         → escribe
 *   node scripts/migrar-matrices-tpu.js --commit --sin-thumbs   → sin bajar de Drive
 *   node scripts/migrar-matrices-tpu.js --commit --limite=5     → primeras N (para probar)
 *
 * Es IDEMPOTENTE: si ya existe una orden con ese CodigoOrden, la saltea. Se puede correr las
 * veces que haga falta. Para deshacer: todas quedan con [MIGRADO-TPU-SHEETS] en la Nota.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const path = require('path');
const fs = require('fs');
const { google } = require('googleapis');
const sql = require('mssql');
const { getPool } = require('../config/db');
const { generateThumbnail } = require('../utils/thumbnailGenerator');

const SPREADSHEET_ID = '1GJWKnuGx5h47uJvf6GC5OtPZ_UBy90fxaRryYAKMMCQ';
const MARCA = '[MIGRADO-TPU-SHEETS]';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const SIN_THUMBS = args.includes('--sin-thumbs');
const LIMITE = (() => {
    const a = args.find(x => x.startsWith('--limite='));
    return a ? parseInt(a.split('=')[1], 10) : 0;
})();

// ── Mapeo de "Tipo de parche" (planilla) → artículo actual ───────────────────
// Los nombres viejos ya no están en el catálogo. El artículo NO es cosmético: reuseMatrizTPU lo
// copia a la orden nueva y con eso se cotiza. OJO: 8x8 va a 152 (parche común) y NO a 154, que
// es el de estrellas y sale más caro.
const ARTICULOS = {
    'parche (de hasta 10x8)':                                152,
    'escudo (de hasta 8x8)':                                 152,
    'parche con un maximo de 4 estrellas (de hasta 10x8)':   154,
    'escudo con estrella (de hasta 10x8)':                   154,
    'parche (hasta 7,5 x 4)':                                155,
    'logo de marca (hasta 7,5 x 4)':                         155,
    'parche (hasta 4x4)':                                    153,
    'etiqueta producto oficial (hasta 4x4) (4 opciones al dar siguiente se eligen)': 153,
    // TP-41: sin medida en el nombre ni tamaño de referencia. Se dedujo del costo registrado en
    // la planilla — 60,00 ÷ 30 u = US$ 2,00, el precio exacto de "Parche (Hasta 4x4)".
    'logo de marca':                                         153,
};

// Nombre de cada capa, en el orden en que aparecen los links dentro de la celda SPOT.
// El primero es el CMYK y el nombre NO es decorativo: getOrderFiles filtra por '%cmyk%' cuando
// el área es TPU, así que de ahí sale lo que ve el cliente.
const CAPAS = [
    'CMYK.pdf',
    'Spot 1 (relieve).pdf',
    'Spot 2 (relieve).pdf',
    'Spot 3 (barniz).pdf',
];
const NOMBRE_CORTE = 'Corte.plt';

// Órdenes sin arte en la hoja MATRIZ: se migran igual usando el DISEÑO ORIGEN (col G de BASE,
// "Carga logo") — lo que el cliente subió al hacer el pedido. Son 110 y TODAS tienen al menos un
// link. La mayoría trae uno solo; para las que traen varios, el número lo eligió el usuario
// revisando los archivos uno por uno. Las que no figuran acá usan el primero.
const DISENO_ORIGEN_INDICE = {
    'TP-256': 2, 'TP-361': 2, 'TP-417': 2, 'TP-467': 2,
    'TP-307': 5,   // la única con 5 links
};

// Cantidades corregidas a mano: el cliente escribió texto libre en el campo de cantidad y el
// parser saca los dígitos, así que "15 parches URUGUAY 2025 …" daba 152025 unidades. Importa
// porque la Magnitud de la matriz es lo que decide si un reuso tiene que regenerar el arte.
const CANTIDAD_FIJA = {
    'TP-409': 15,
};

// El ID del cliente cambió entre la planilla vieja y la base. Son los únicos 3 sin match exacto
// (5 órdenes), confirmados uno por uno contra Clientes.IDCliente. La clave va en minúsculas
// porque el cruce normaliza así.
const ALIAS_CLIENTE = {
    'leopalla':   'leo.palla',      // Palla y Palla
    'voidnexus':  'Voidnexus.uy',   // Fabiana Limpias
    'germanlf34': 'GERMANLF',       // German Lalinde
};

const norm = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const cod = s => (String(s || '').match(/TP-\d+/i) || [])[0]?.toUpperCase() || null;
const links = s => (String(s || '').match(/https?:\/\/[^\s,]+/g) || []);
const driveId = url => (String(url).match(/[?&]id=([\w-]+)/) || String(url).match(/\/d\/([\w-]+)/) || [])[1] || null;
const fecha = s => {
    const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]*(\d{1,2}):?(\d{2})?/);
    if (!m) return null;
    return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));
};

function authGoogle() {
    const creds = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'oauth-credentials.json'), 'utf8'));
    const cfg = creds.installed || creds.web;
    const oa = new google.auth.OAuth2(cfg.client_id, cfg.client_secret,
        process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/google/auth/callback');
    oa.setCredentials(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'token.json'), 'utf8')));
    return oa;
}

/** Filas de la planilla → candidatas, con los mismos criterios del Excel de revisión. */
async function leerPlanilla(auth) {
    const sheets = google.sheets({ version: 'v4', auth });
    const get = async rango => ((await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: rango })).data.values || []);
    const base = (await get('BASE!A2:W600')).filter(r => r[0]);
    const mat = (await get('MATRIZ!A2:D1300')).filter(r => r[0]);

    // Un mismo código puede tener varias filas en MATRIZ: son versiones del arte. Nos quedamos
    // con la MÁS RECIENTE por marca temporal.
    const porCodigo = {};
    for (const r of mat) {
        const c = cod(r[0]);
        if (!c) continue;
        (porCodigo[c] = porCodigo[c] || []).push({ spot: links(r[1]), corte: links(r[2]), f: fecha(r[3]) });
    }
    const arte = {};
    for (const [c, versiones] of Object.entries(porCodigo)) {
        arte[c] = [...versiones].sort((a, b) => (b.f?.getTime() || 0) - (a.f?.getTime() || 0))[0];
    }

    const candidatas = [], descartes = [];
    for (const r of base) {
        const c = cod(r[0]);
        if (!c) continue;
        const estado = String(r[9] || '').trim().toUpperCase();
        const trabajo = String(r[3] || '').trim();
        const tipo = String(r[4] || '').trim();
        // Diseño origen: se toma el link que eligió el usuario (1-based); si esa posición no
        // existe se cae al primero, así un índice mal puesto nunca deja la orden sin archivo.
        const logos = links(r[6]);
        const logo = logos[(DISENO_ORIGEN_INDICE[c] || 1) - 1] || logos[0] || null;
        const fila = {
            tp: c, fechaIngreso: fecha(r[1]), idCliente: String(r[2] || '').trim(),
            trabajo, tipo,
            cantidad: CANTIDAD_FIJA[c] ?? (parseInt(String(r[5] || '0').replace(/\D/g, ''), 10) || 0),
            estado, logo, arte: arte[c] || null,
        };
        // Mismo orden de descarte que el Excel de revisión.
        if (estado === 'CANCELADO') { descartes.push({ ...fila, motivo: 'Cancelada' }); continue; }
        if (/^TP-\d+/i.test(trabajo)) { descartes.push({ ...fila, motivo: `Es un REUSO de ${cod(trabajo)}` }); continue; }
        // Sin arte NI diseño origen no hay nada que migrar. Con diseño origen sí se migra: entra
        // como boceto (ver más abajo) y alcanza para que la matriz sea reusable.
        if (!fila.arte && !fila.logo) { descartes.push({ ...fila, motivo: 'Sin arte ni diseño origen' }); continue; }
        if (!ARTICULOS[norm(tipo)]) { descartes.push({ ...fila, motivo: `Tipo de parche sin artículo: ${tipo}` }); continue; }
        candidatas.push(fila);
    }
    return { candidatas, descartes };
}

/** Baja el archivo de Drive y le genera el thumbnail. Nunca tira abajo la migración. */
async function thumbDesdeDrive(auth, url, codigoOrden, archivoId) {
    const id = driveId(url);
    if (!id) return null;
    try {
        const drive = google.drive({ version: 'v3', auth });
        const meta = await drive.files.get({ fileId: id, fields: 'mimeType,name' });
        const bin = await drive.files.get({ fileId: id, alt: 'media' }, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(bin.data);
        await generateThumbnail(buffer, codigoOrden, archivoId, meta.data.mimeType || meta.data.name || '');
        return meta.data.name || null;
    } catch (e) {
        console.log(`      ⚠ thumbnail: ${e.message}`);
        return null;
    }
}

(async () => {
    console.log(COMMIT ? '### MODO ESCRITURA (--commit)' : '### DRY-RUN — no se escribe nada. Usá --commit para aplicar.');
    const auth = authGoogle();
    const { candidatas, descartes } = await leerPlanilla(auth);

    const pool = await getPool();
    const cli = await pool.request().query('SELECT IDCliente, CodCliente, CliIdCliente, Nombre FROM Clientes WHERE IDCliente IS NOT NULL');
    const mapaCli = new Map(cli.recordset.map(c => [String(c.IDCliente).trim().toLowerCase(), c]));
    const art = await pool.request().query(`SELECT CodArticulo, ProIdProducto, LTRIM(RTRIM(Descripcion)) AS Descripcion
                                            FROM articulos WHERE CodArticulo IN ('152','153','154','155')`);
    const mapaArt = new Map(art.recordset.map(a => [parseInt(String(a.CodArticulo).trim(), 10), a]));

    let migradas = 0, salteadas = 0, fallidas = 0;
    const sinCliente = [];
    let lote = candidatas;
    if (LIMITE > 0) lote = lote.slice(0, LIMITE);

    for (const m of lote) {
        const idCli = m.idCliente.toLowerCase();
        const c = mapaCli.get(idCli) || mapaCli.get((ALIAS_CLIENTE[idCli] || '').toLowerCase());
        if (!c) { sinCliente.push(`${m.tp} (${m.idCliente})`); continue; }

        const yaEsta = await pool.request()
            .input('Cod', sql.VarChar(50), m.tp)
            .query('SELECT TOP 1 OrdenID FROM Ordenes WHERE CodigoOrden = @Cod');
        if (yaEsta.recordset.length) { salteadas++; continue; }

        const articulo = mapaArt.get(ARTICULOS[norm(m.tipo)]);
        // Con arte en MATRIZ van las capas de impresión. Sin arte, el array queda vacío y la
        // orden se migra solo con el boceto (el diseño origen) — suficiente para que aparezca
        // como matriz reusable, pero producción va a tener que hacer el arte.
        // Las 18 matrices con un link de más en SPOT caen en el nombre genérico: la planilla no
        // dice qué es esa capa extra, así que no se inventa.
        const archivos = m.arte ? [
            ...m.arte.spot.map((u, i) => ({ url: u, nombre: CAPAS[i] || `Spot ${i} (extra).pdf` })),
            ...m.arte.corte.map(u => ({ url: u, nombre: NOMBRE_CORTE })),
        ] : [];

        if (!COMMIT) {
            console.log(`[dry] ${m.tp.padEnd(8)} ${String(m.cantidad).padStart(6)}u  ${articulo.Descripcion.slice(0, 30).padEnd(32)} ${(c.Nombre || '').slice(0, 20).padEnd(22)} ${archivos.length ? `${archivos.length} capas + boceto` : 'SOLO DISEÑO ORIGEN'}`);
            migradas++;
            continue;
        }

        const tx = new sql.Transaction(pool);
        await tx.begin();
        try {
            const ins = await new sql.Request(tx)
                .input('Cliente', sql.NVarChar(200), c.Nombre)
                .input('CodCli', sql.Int, c.CodCliente)
                .input('CliId', sql.Int, c.CliIdCliente)
                .input('Desc', sql.NVarChar(300), m.trabajo || m.tp)
                // Material = descripción del artículo ACTUAL, no el nombre viejo: es lo que copia
                // reuseMatrizTPU y lo que el resto del sistema entiende. El original va en la Nota.
                .input('Mat', sql.VarChar(255), articulo.Descripcion)
                .input('Cod', sql.VarChar(50), m.tp)
                .input('Nota', sql.NVarChar(sql.MAX), `${MARCA} Tipo original: ${m.tipo}`)
                .input('Mag', sql.VarChar(50), String(m.cantidad))
                .input('CodArt', sql.VarChar(50), String(articulo.CodArticulo).trim())
                .input('ProId', sql.Int, articulo.ProIdProducto)
                .input('Fecha', sql.DateTime, m.fechaIngreso || new Date())
                .query(`
                    INSERT INTO Ordenes (AreaID, Cliente, CodCliente, CliIdCliente, DescripcionTrabajo, Prioridad,
                        FechaIngreso, Material, Variante, CodigoOrden, Nota, Magnitud, UM, Estado, EstadoenArea,
                        CodArticulo, ProIdProducto)
                    OUTPUT INSERTED.OrdenID
                    VALUES ('TPU', @Cliente, @CodCli, @CliId, @Desc, 'Normal',
                        @Fecha, @Mat, 'TPU', @Cod, @Nota, @Mag, 'u', 'Finalizado', 'Finalizado',
                        @CodArt, @ProId)`);
            const ordenId = ins.recordset[0].OrdenID;

            const insArchivo = async (nombre, url) => {
                const r = await new sql.Request(tx)
                    .input('OID', sql.Int, ordenId)
                    .input('Nom', sql.NVarChar(255), nombre)
                    .input('Ruta', sql.NVarChar(sql.MAX), url)
                    .query(`INSERT INTO ArchivosOrden (OrdenID, NombreArchivo, TipoArchivo, Copias, Metros,
                                EstadoArchivo, FechaSubida, RutaAlmacenamiento, Ancho, Alto, Observaciones)
                            OUTPUT INSERTED.ArchivoID
                            VALUES (@OID, @Nom, 'Impresion', 1, 0, 'OK', GETDATE(), @Ruta, 0, 0, '${MARCA}')`);
                return r.recordset[0].ArchivoID;
            };

            for (const a of archivos) await insArchivo(a.nombre, a.url);

            // El "diseños origen" entra como BOCETO: es el arte reconocible y, por el LIKE '%boceto%'
            // de getMisMatrices, es el que se usa como vista previa de la matriz.
            let bocetoId = null;
            if (m.logo) bocetoId = await insArchivo(`BOCETO-${m.tp}`, m.logo);

            await tx.commit();
            migradas++;

            if (bocetoId && !SIN_THUMBS) await thumbDesdeDrive(auth, m.logo, m.tp, bocetoId);
            console.log(`  ✓ ${m.tp.padEnd(8)} ${String(m.cantidad).padStart(4)}u  ${articulo.Descripcion.slice(0, 30).padEnd(32)} ${c.Nombre?.slice(0, 20) || ''}`);
        } catch (e) {
            await tx.rollback();
            fallidas++;
            console.log(`  ✗ ${m.tp}: ${e.message}`);
        }
    }

    console.log('\n──────── RESUMEN ────────');
    console.log('Candidatas               :', candidatas.length);
    console.log(COMMIT ? 'Migradas                 :' : 'Se migrarían             :', migradas);
    console.log('Ya existían (salteadas)  :', salteadas);
    console.log('Fallidas                 :', fallidas);
    console.log('Sin cliente en la base   :', sinCliente.length, sinCliente.length ? `→ ${sinCliente.join(', ')}` : '');
    const porMotivo = {};
    descartes.forEach(d => { const k = d.motivo.startsWith('Es un REUSO') ? 'Es un REUSO de otra matriz' : d.motivo; porMotivo[k] = (porMotivo[k] || 0) + 1; });
    console.log('Descartadas de la planilla:');
    Object.entries(porMotivo).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log('   ', k.padEnd(34), v));
    if (!COMMIT) console.log('\nDRY-RUN: no se escribió nada. Repetí con --commit para aplicar.');
    process.exit(0);
})().catch(e => { console.error('ERROR FATAL:', e.message); process.exit(1); });
