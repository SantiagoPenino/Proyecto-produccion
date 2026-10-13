'use strict';
// =====================================================================
// TIENDA → CONFECCIONADO A PEDIDO (F3 del plan de la tienda, 09/10/2026)
// =====================================================================
// El cliente arma en el portal el pedido de una prenda CONFECCIONADA con molde de TIZADA PRO:
// modelo y tela por pieza (entre lo que ofrece el producto), sus diseños con el arte (.ai / .pdf)
// y la lista de talles con las columnas de la planilla del molde. Antes de pagar se REVISA con las
// mismas reglas de la solicitud y, si la integración está prendida, TIZADA dice si lo aceptaría
// (incluido el control de letras del arte). Así el cliente corrige ANTES de pagar.
//
// Fase 1 (este archivo): borrador + opciones + arte + revisión. Nada de esto crea una solicitud.
// Fases siguientes: el borrador revisado entra al carrito, se cobra en la tienda y, con el pago,
// se crea la solicitud (vendedor del cliente, o AgustinP), se manda a Diseño y a TIZADA.
//
// Reutiliza lo de la solicitud sin cambiarlo:
//   - solicitudesVendedorSublimacion.opcionesDelMolde → modelos, piezas con tela fija y telas a elegir
//   - solicitudesVendedorTizadaPro.estructura / revisar / conPiezas / armarPedidoJson → planilla y revisión
//   - tizadaProArte.revisarArtes → letras del arte
// Tabla propia: TiendaConfecciones (se crea sola la primera vez, como el resto de la tienda).
// =====================================================================
const fs = require('fs');
const { sql } = require('../config/db');
const logger = require('../utils/logger');
const api = require('./tizadaProApi');

const fallo = (status, msg, extra) => Object.assign(new Error(msg), { status, ...(extra || {}) });
const txt = (v, max = 200) => String(v == null ? '' : v).trim().slice(0, max);
const leer = (v, def) => { try { return v ? JSON.parse(v) : def; } catch (_) { return def; } };
const EXT_ARTE = ['ai', 'pdf'];
const MAX_DISENOS = 12;
const MAX_FILAS = 2000;

// Estados del borrador: BORRADOR (se está armando o cambió después de revisar) · LISTA (la revisión
// pasó: puede ir al carrito) · PAGADA · EN_SOLICITUD (ya se creó la solicitud) · CANCELADA.
let tablaLista = false;
async function asegurarTabla(pool) {
    if (tablaLista) return;
    await pool.request().query(`
        IF OBJECT_ID('dbo.TiendaConfecciones', 'U') IS NULL
        CREATE TABLE dbo.TiendaConfecciones (
            ConfeccionID     INT IDENTITY(1,1) NOT NULL CONSTRAINT PK_TiendaConfecciones PRIMARY KEY,
            CodCliente       INT           NOT NULL,
            ProIdProducto    INT           NOT NULL,
            Estado           VARCHAR(20)   NOT NULL CONSTRAINT DF_TiendaConf_Estado DEFAULT 'BORRADOR',
            DatosJson        NVARCHAR(MAX) NULL,   -- { modeloClave, modeloNombre, piezas, disenos, planilla }
            ArchivosJson     NVARCHAR(MAX) NULL,   -- [{ id, nombre, url, tamano, fecha }]
            RevisionJson     NVARCHAR(MAX) NULL,   -- { fecha, ok, errores, alarmas, conTizada }
            SolicitudID      INT           NULL,
            FechaAlta        DATETIME      NOT NULL CONSTRAINT DF_TiendaConf_Alta DEFAULT GETDATE(),
            FechaActualizado DATETIME      NULL
        );
        IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_TiendaConf_Cliente' AND object_id = OBJECT_ID('dbo.TiendaConfecciones'))
            CREATE INDEX IX_TiendaConf_Cliente ON dbo.TiendaConfecciones (CodCliente, Estado);
    `);
    tablaLista = true;
}

// ─────────────────────────────────────────────────────────────────────
// Producto de la tienda + su configuración de venta (molde)
// ─────────────────────────────────────────────────────────────────────
async function productoTienda(pool, proId) {
    const r = await pool.request().input('P', sql.Int, proId).query(`
        SELECT tp.ProIdProducto, tp.TipoVitrina, tp.Publicado,
               COALESCE(NULLIF(LTRIM(RTRIM(tp.TituloVenta)), ''), LTRIM(RTRIM(a.Descripcion))) AS Titulo,
               pb.Precio, pb.Moneda,
               CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'TizadaProMoldeRef') IS NULL THEN NULL
                    ELSE (SELECT LTRIM(RTRIM(vc.TizadaProMoldeRef)) FROM dbo.ProductoVentaConfig vc WHERE vc.ProIdProducto = tp.ProIdProducto) END AS MoldeRef,
               CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'Molde') IS NULL THEN 'OBLIGATORIO'
                    ELSE (SELECT vc.Molde FROM dbo.ProductoVentaConfig vc WHERE vc.ProIdProducto = tp.ProIdProducto) END AS Molde,
               CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'TecnicaPrincipal') IS NULL THEN 'SB'
                    ELSE (SELECT vc.TecnicaPrincipal FROM dbo.ProductoVentaConfig vc WHERE vc.ProIdProducto = tp.ProIdProducto) END AS TecnicaPrincipal
        FROM dbo.TiendaProductos tp
        INNER JOIN dbo.Articulos a ON a.ProIdProducto = tp.ProIdProducto
        LEFT JOIN dbo.PreciosBase pb ON pb.ProIdProducto = tp.ProIdProducto
        WHERE tp.ProIdProducto = @P AND ISNULL(a.borrar, 0) = 0`);
    const p = r.recordset[0];
    if (!p || !p.Publicado) throw fallo(404, 'Ese producto no está en la tienda.');
    if (String(p.TipoVitrina || '').toUpperCase() !== 'CONFECCIONADO') throw fallo(400, 'Ese producto no se fabrica a pedido.');
    if (!p.MoldeRef) throw fallo(409, 'Este producto todavía no se puede pedir desde la tienda: falta vincularle el molde. Escribinos por soporte.');
    return p;
}

// Lo que el cliente puede elegir: modelos (con piezas y telas fijas), telas, y la planilla del molde.
async function opcionesDeProducto(pool, p) {
    const sub = require('./solicitudesVendedorSublimacion');
    const tz = require('./solicitudesVendedorTizadaPro');
    const molde = await sub.opcionesDelMolde(pool, p);
    if (!molde.aplica) throw fallo(409, `Este producto no se puede pedir desde la tienda: ${molde.motivo}`);
    let est = null;
    try { est = await tz.estructura(pool, p.MoldeRef); } catch (e) { logger.warn(`[TIENDA-CONF] estructura de ${p.MoldeRef}: ${e.message}`); }
    if (!est?.columnas?.length) throw fallo(503, 'No pudimos leer la lista de talles de este producto. Probá de nuevo en un rato.');
    return { molde, est };
}

async function opciones(pool, proId) {
    await asegurarTabla(pool);
    const p = await productoTienda(pool, proId);
    const { molde, est } = await opcionesDeProducto(pool, p);
    return {
        producto: { proIdProducto: p.ProIdProducto, titulo: p.Titulo, precio: p.Precio != null ? Number(p.Precio) : null, moneda: p.Moneda || null },
        modelos: molde.modelos.map(m => ({
            clave: m.clave, nombre: m.nombre, esDefault: m.esDefault,
            piezas: m.piezas.map(z => ({ pieza: z.pieza, generico: z.generico, telaFija: z.telaFija })),
        })),
        telas: molde.telas,
        planilla: { columnas: est.columnas, talles: est.talles, columnaTalle: est.columnaTalle },
        formatosArte: EXT_ARTE,
        // Sin la integración prendida la revisión es solo la nuestra: TIZADA la revisa recién al mandarla
        revisionTizada: api.estadoConfig().ok,
    };
}

// ─────────────────────────────────────────────────────────────────────
// Borrador
// ─────────────────────────────────────────────────────────────────────
function aRespuesta(f) {
    return {
        confeccionId: f.ConfeccionID, proIdProducto: f.ProIdProducto, estado: f.Estado,
        datos: leer(f.DatosJson, {}),
        archivos: leer(f.ArchivosJson, []).map(a => ({ id: a.id, nombre: a.nombre, tamano: a.tamano, fecha: a.fecha })),
        revision: leer(f.RevisionJson, null),
        solicitudId: f.SolicitudID || null,
    };
}

async function delCliente(pool, codCliente, confeccionId) {
    const r = await pool.request().input('C', sql.Int, confeccionId).input('Cli', sql.Int, codCliente)
        .query('SELECT * FROM dbo.TiendaConfecciones WHERE ConfeccionID = @C AND CodCliente = @Cli');
    const f = r.recordset[0];
    if (!f) throw fallo(404, 'No encontramos ese pedido.');
    return f;
}

function exigirEditable(f) {
    if (!['BORRADOR', 'LISTA'].includes(f.Estado)) throw fallo(409, 'Este pedido ya se pagó: ya no se puede cambiar desde acá.');
}

async function crear(pool, codCliente, proId) {
    await asegurarTabla(pool);
    if (!codCliente) throw fallo(403, 'Sesión sin cliente asociado.');
    const p = await productoTienda(pool, proId);
    const r = await pool.request().input('Cli', sql.Int, codCliente).input('P', sql.Int, p.ProIdProducto)
        .query(`INSERT INTO dbo.TiendaConfecciones (CodCliente, ProIdProducto, DatosJson, ArchivosJson, FechaActualizado)
                OUTPUT INSERTED.* VALUES (@Cli, @P, '{}', '[]', GETDATE())`);
    logger.info(`[TIENDA-CONF] borrador ${r.recordset[0].ConfeccionID} — CodCliente ${codCliente}, producto ${p.ProIdProducto}`);
    return aRespuesta(r.recordset[0]);
}

async function ver(pool, codCliente, confeccionId) {
    await asegurarTabla(pool);
    return aRespuesta(await delCliente(pool, codCliente, confeccionId));
}

// Guarda lo que eligió el cliente, saneado contra las opciones del producto. Cualquier cambio deja el
// borrador sin revisar (vuelve a BORRADOR): la revisión vale para lo que se revisó.
async function guardar(pool, codCliente, confeccionId, b) {
    await asegurarTabla(pool);
    const f = await delCliente(pool, codCliente, confeccionId);
    exigirEditable(f);
    const p = await productoTienda(pool, f.ProIdProducto);
    const { molde, est } = await opcionesDeProducto(pool, p);
    const archivos = leer(f.ArchivosJson, []);

    // Modelo + tela por pieza (la fija no se elige)
    const modelo = molde.modelos.length === 1 ? molde.modelos[0] : molde.modelos.find(m => m.clave === txt(b?.modeloClave, 96));
    const telasOk = new Map(molde.telas.map(t => [Number(t.proIdProducto), t]));
    const pedidas = new Map((Array.isArray(b?.piezas) ? b.piezas : []).map(x => [txt(x.pieza, 60), x]));
    const piezas = modelo ? modelo.piezas.map(pz => {
        if (pz.telaFija) return { pieza: pz.pieza, generico: pz.generico, telaProIdProducto: pz.telaFija.proIdProducto, telaNombre: pz.telaFija.nombre, fija: true };
        const t = telasOk.get(parseInt(pedidas.get(pz.pieza)?.telaProIdProducto, 10));
        return { pieza: pz.pieza, generico: pz.generico, telaProIdProducto: t ? t.proIdProducto : null, telaNombre: t ? t.nombre : null, fija: false };
    }) : [];

    // Diseños: nombre + arte (uno de los archivos subidos a este pedido)
    const idsArte = new Set(archivos.map(a => a.id));
    const disenos = (Array.isArray(b?.disenos) ? b.disenos : []).slice(0, MAX_DISENOS).map(d => ({
        nombre: txt(d.nombre, 40).toUpperCase(),
        arteId: idsArte.has(parseInt(d.arteId, 10)) ? parseInt(d.arteId, 10) : null,
    }));

    // Lista de talles: solo las columnas de la planilla del molde
    const ids = new Set(est.columnas.map(c => c.id));
    const planilla = (Array.isArray(b?.planilla) ? b.planilla : []).slice(0, MAX_FILAS).map(fila => {
        const out = { diseno: disenos.length === 1 ? disenos[0].nombre : txt(fila?.diseno, 40).toUpperCase() };
        Object.keys(fila || {}).forEach(k => { if (ids.has(k)) { const v = txt(fila[k], 80); if (v) out[k] = v; } });
        return out;
    }).filter(fila => Object.keys(fila).some(k => k !== 'diseno'));

    const datos = { modeloClave: modelo?.clave || null, modeloNombre: modelo?.nombre || null, piezas, disenos, planilla };
    await pool.request().input('C', sql.Int, confeccionId).input('D', sql.NVarChar(sql.MAX), JSON.stringify(datos))
        .query("UPDATE dbo.TiendaConfecciones SET DatosJson = @D, Estado = 'BORRADOR', RevisionJson = NULL, FechaActualizado = GETDATE() WHERE ConfeccionID = @C");
    return ver(pool, codCliente, confeccionId);
}

// ─────────────────────────────────────────────────────────────────────
// Arte del cliente → Drive (misma carpeta que los archivos de las solicitudes: después pasan a la solicitud)
// ─────────────────────────────────────────────────────────────────────
async function subirArte(pool, codCliente, confeccionId, file) {
    if (!file) throw fallo(400, 'Falta el archivo.');
    const tmpPath = file.path || null;
    try {
        await asegurarTabla(pool);
        const f = await delCliente(pool, codCliente, confeccionId);
        exigirEditable(f);
        const nombre = txt(file.originalname, 260) || 'arte';
        const ext = (nombre.split('.').pop() || '').toLowerCase();
        if (!EXT_ARTE.includes(ext)) throw fallo(400, `"${nombre}" no sirve: el arte tiene que ser .ai o .pdf.`);
        const driveService = require('./driveService');
        const url = await driveService.uploadToDrive(tmpPath ? fs.createReadStream(tmpPath) : file.buffer, `TIENDA-${confeccionId}_${nombre}`, 'SOLICITUDES');

        // Se agrega con un id correlativo dentro del pedido. Releer y escribir en la misma sentencia evita
        // perder un archivo si el cliente sube dos a la vez.
        const tx = new sql.Transaction(pool);
        await tx.begin();
        let archivo;
        try {
            const r = await new sql.Request(tx).input('C', sql.Int, confeccionId)
                .query('SELECT ArchivosJson FROM dbo.TiendaConfecciones WITH (UPDLOCK, ROWLOCK) WHERE ConfeccionID = @C');
            const lista = leer(r.recordset[0]?.ArchivosJson, []);
            archivo = { id: lista.reduce((m, a) => Math.max(m, a.id), 0) + 1, nombre, url, tamano: file.size || null, fecha: new Date().toISOString() };
            lista.push(archivo);
            await new sql.Request(tx).input('C', sql.Int, confeccionId).input('A', sql.NVarChar(sql.MAX), JSON.stringify(lista))
                .query("UPDATE dbo.TiendaConfecciones SET ArchivosJson = @A, Estado = 'BORRADOR', RevisionJson = NULL, FechaActualizado = GETDATE() WHERE ConfeccionID = @C");
            await tx.commit();
        } catch (e) {
            try { await tx.rollback(); } catch (_) { /* ya revertida */ }
            throw e;
        }
        return { id: archivo.id, nombre: archivo.nombre, tamano: archivo.tamano, fecha: archivo.fecha };
    } finally {
        if (tmpPath) fs.promises.unlink(tmpPath).catch(() => {});
    }
}

// ─────────────────────────────────────────────────────────────────────
// Revisión: las reglas de la solicitud + (si está prendida) la de TIZADA, sin mandar nada
// ─────────────────────────────────────────────────────────────────────
// Del borrador a la forma que usan las funciones de la solicitud: "sublimacion" (modelo + telas por pieza)
// y "tizadaPro" (diseños con su arte + planilla). Los archivos llevan ArchivoID = id dentro del pedido.
function comoSolicitud(datos, archivos) {
    const tz = require('./solicitudesVendedorTizadaPro');
    const sublimacion = datos.modeloClave
        ? { modeloClave: datos.modeloClave, modeloNombre: datos.modeloNombre, piezas: datos.piezas || [], completo: (datos.piezas || []).every(z => z.telaProIdProducto) }
        : null;
    const tizadaPro = {
        disenos: (datos.disenos || []).map(d => ({ nombre: d.nombre, arteArchivoId: d.arteId })),
        planilla: datos.planilla || [],
    };
    const archivosSol = archivos.map(a => ({ ArchivoID: a.id, NombreOriginal: a.nombre, UrlDrive: a.url, Vigente: true }));
    return { datosSol: tz.conPiezas(tizadaPro, sublimacion), sublimacion, archivosSol };
}

async function revisar(pool, codCliente, confeccionId) {
    await asegurarTabla(pool);
    const tz = require('./solicitudesVendedorTizadaPro');
    const f = await delCliente(pool, codCliente, confeccionId);
    exigirEditable(f);
    const p = await productoTienda(pool, f.ProIdProducto);
    const { est } = await opcionesDeProducto(pool, p);
    const datos = leer(f.DatosJson, {});
    const archivos = leer(f.ArchivosJson, []);
    const { datosSol, sublimacion, archivosSol } = comoSolicitud(datos, archivos);

    // 1. Nuestras reglas: modelo y telas completos + las de la solicitud (diseños, arte y lista de talles)
    const errores = [];
    if (!sublimacion) errores.push({ donde: 'modelo', mensaje: 'Elegí el modelo de la prenda.' });
    else (sublimacion.piezas || []).filter(z => !z.telaProIdProducto).forEach(z => errores.push({ donde: `piezas.${z.pieza}`, mensaje: `Elegí la tela de ${z.generico || z.pieza}.` }));
    // Los textos de la solicitud hablan de la pantalla interna: se adaptan a lo que ve el cliente
    const paraCliente = (m) => m.replace(' (elegilo y guardalo en "2 · Piezas y telas")', '').replace(' (elegila y guardala en "2 · Piezas y telas")', '')
        .replace('ya no está en la solicitud', 'ya no está en el pedido').replace('(qué diseño la imprime)', '(a qué diseño corresponde)');
    errores.push(...tz.revisar(est, datosSol, archivosSol).map(e => ({ ...e, mensaje: paraCliente(e.mensaje) })));

    // 2. TIZADA (solo si nuestras reglas pasan y la integración está prendida): letras del arte + /pedidos/validar
    let alarmas = [];
    const conTizada = api.estadoConfig().ok;
    if (!errores.length && conTizada) {
        try {
            const artes = []; const rutasArte = {};
            for (const [i, d] of datosSol.disenos.entries()) {
                if (rutasArte[d.arteArchivoId]) continue;
                const a = archivos.find(x => x.id === Number(d.arteArchivoId));
                const ext = (a.nombre.split('.').pop() || 'pdf').toLowerCase();
                const ruta = `artes/${String(d.nombre).replace(/[^A-Za-z0-9]+/g, '_')}_${a.id}.${ext}`;
                artes.push({ ruta, buffer: await tz.bajarDeDrive(a.url), nombre: a.nombre, campo: `disenos[${i}].arte` });
                rutasArte[d.arteArchivoId] = ruta;
            }
            const t = await api.tipografias();
            alarmas = await require('./tizadaProArte').revisarArtes(artes, (Array.isArray(t) ? t : t?.tipografias) || [], est?.piezas || []);
            if (!alarmas.some(a => a.frena !== false)) {
                const referencia = `TIENDA-${confeccionId}-REV`;
                const solFalsa = { SolicitudID: `T${confeccionId}`, NombreTrabajo: p.Titulo, ClienteNombre: null };
                const pedido = tz.armarPedidoJson(solFalsa, { ProductoSolID: null }, datosSol, est, referencia, rutasArte);
                const v = await api.validar(null, await tz.zipEnMemoria(pedido, artes));
                alarmas = [...alarmas, ...(v?.alarmas || [])];
            }
        } catch (e) {
            if (e instanceof api.ErrorTizada && (e.status === 422 || e.status === 415)) alarmas = [...alarmas, ...(e.alarmas || [{ codigo: 'rechazado', frena: true, mensaje: e.message }])];
            else {
                // TIZADA no contesta: no se le cobra al cliente un pedido que no pudimos revisar
                logger.warn(`[TIENDA-CONF] revisión de ${confeccionId} con TIZADA: ${e.message}`);
                throw fallo(503, 'No pudimos revisar tu pedido con el sistema de moldería. Probá de nuevo en unos minutos.');
            }
        }
    }
    const frenan = alarmas.filter(a => a.frena !== false);
    const ok = !errores.length && !frenan.length;
    const revision = {
        fecha: new Date().toISOString(), ok, conTizada,
        errores: [...errores, ...frenan.map(a => ({ donde: a.donde?.campo || 'tizada', mensaje: a.mensaje || a.codigo }))],
        avisos: alarmas.filter(a => a.frena === false).map(a => a.mensaje || a.codigo),
    };
    await pool.request().input('C', sql.Int, confeccionId).input('R', sql.NVarChar(sql.MAX), JSON.stringify(revision)).input('E', sql.VarChar(20), ok ? 'LISTA' : 'BORRADOR')
        .query('UPDATE dbo.TiendaConfecciones SET RevisionJson = @R, Estado = @E, FechaActualizado = GETDATE() WHERE ConfeccionID = @C');
    logger.info(`[TIENDA-CONF] revisión ${confeccionId}: ${ok ? 'OK' : `${revision.errores.length} error(es)`}${conTizada ? ' (con TIZADA)' : ' (sin TIZADA)'}`);
    return ver(pool, codCliente, confeccionId);
}

module.exports = { opciones, crear, ver, guardar, subirArte, revisar, asegurarTabla };
