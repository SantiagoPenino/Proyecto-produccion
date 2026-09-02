/**
 * wmsImportSnapshot.js — importa el WMS externo (Johnson / Ventas_Dev) a las tablas Wms_* propias.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * RE-EJECUTABLE: cada corrida deja nuestra copia idéntica al origen en ese instante (MERGE por
 * lotes). Se corre las veces que haga falta hasta el cutover; la corrida final (con el depósito
 * quieto) es la foto de cierre. Requiere las tablas de docs/wms-data/DDL-wms-propio.sql creadas.
 *
 * Uso (en el server, o donde el .env apunte a la base correcta):
 *   node scripts/wmsImportSnapshot.js                  → lee EN VIVO del proxy del WMS (default)
 *   node scripts/wmsImportSnapshot.js --dir=/ruta      → lee los snap_*.json de un backup local
 *   node scripts/wmsImportSnapshot.js --solo-paridad   → no escribe nada: compara y reporta
 *
 * Qué hace, en orden (FKs respetadas):
 *   1. Depósitos, categorías, maestros, variantes (ids CONSERVADOS — todo el sistema los usa).
 *      Las variantes se enriquecen con Articulos_WMS_Variantes (ProIdProducto/Talle/Color).
 *   2. Proveedores, compras (GUID viejo → INT nuestro, mapa por GuidViejo), detalle, importaciones.
 *   3. Etiquetas (ids conservados; CompraId mapeado desde el GUID).
 *   4. Movimiento de APERTURA por etiqueta activa (IdempotencyKey APERTURA:<id> — el re-run
 *      actualiza la cantidad, no duplica). Las etiquetas no activas quedan sin movimiento:
 *      son prehistoria, su película vive en Wms_HistoricoExterno.
 *   5. Remitos internos + items y solicitudes + items (IDENTITY_INSERT conservando ids + reseed).
 *   6. Wms_HistoricoExterno: TRUNCATE + carga completa de Stock_Movimientos (solo consulta).
 *   7. PARIDAD: unidades y etiquetas activas por depósito, origen vs destino. Diferencia ≠ 0 → exit 1.
 */

const path = require('path');
const fs = require('fs');
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

const args = Object.fromEntries(process.argv.slice(2).map(a => {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    return m ? [m[1], m[2] ?? true] : [a, true];
}));

const WMS_URL = process.env.WMS_SQL_URL || 'http://3.85.26.173:5005';

async function wmsQuery(q) {
    const res = await fetch(`${WMS_URL}/sql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: `USE Ventas_Dev; CREATE TABLE #WmsSecureTx_v17 (id INT); ${q}` }),
        signal: AbortSignal.timeout(120000)
    });
    const json = await res.json();
    if (!json.success) throw new Error(`WMS: ${json.error}`);
    return json.data || [];
}

// ── Origen de datos: proxy en vivo (default) o carpeta de snap_*.json ────────
async function cargarOrigen() {
    const tablas = ['Stock_Depositos', 'Stock_Categorias', 'Stock_Productos_Maestros', 'Stock_Variantes',
        'Stock_Proveedores', 'Stock_Compras', 'Stock_Compras_Detalle', 'Stock_Importaciones',
        'wms_remitos_internos', 'wms_remitos_internos_items', 'wms_solicitudes', 'wms_solicitudes_items',
        'Stock_Alertas_Depositos', 'Stock_Monedas', 'Stock_TiposFactura', 'Stock_Pagos_Motivos', 'Stock_Pagos',
        'Stock_Plantillas_Progreso', 'Stock_Plantillas_Progreso_Pasos',
        'Stock_Movimientos'];
    const data = {};
    if (args.dir) {
        for (const t of [...tablas, 'Stock_Etiquetas']) {
            const f = path.join(String(args.dir), `snap_${t}.json`);
            data[t] = JSON.parse(fs.readFileSync(f, 'utf8'));
        }
        logger.info(`[WMS-IMPORT] Origen: backup ${args.dir}`);
    } else {
        for (const t of tablas) {
            data[t] = await wmsQuery(`SELECT * FROM ${t}`);
        }
        // etiquetas paginadas (54k+)
        data.Stock_Etiquetas = [];
        let ultimo = 0;
        for (;;) {
            const lote = await wmsQuery(`SELECT TOP 8000 * FROM Stock_Etiquetas WHERE id > ${ultimo} ORDER BY id`);
            if (!lote.length) break;
            data.Stock_Etiquetas.push(...lote);
            ultimo = lote[lote.length - 1].id;
        }
        logger.info('[WMS-IMPORT] Origen: proxy en vivo');
    }
    for (const t of Object.keys(data)) logger.info(`[WMS-IMPORT]   ${t}: ${data[t].length} filas`);
    return data;
}

// ── Upsert genérico: bulk a #stg + MERGE (rápido y re-ejecutable) ────────────
// cols: [[nombreDestino, tipoSql, fn(filaOrigen)]...]
// opts.pk        → clave del MERGE (nunca se updatea)
// opts.identity  → el pk es IDENTITY: IDENTITY_INSERT ON + reseed al máximo
// opts.reload    → tabla espejo sin clave estable: DELETE total + INSERT (sin MERGE)
async function upsert(pool, tabla, cols, filas, { pk, identity = false, reload = false } = {}) {
    if (!filas.length) { logger.info(`[WMS-IMPORT] ${tabla}: origen vacío, nada que hacer`); return; }
    const stg = new sql.Table('#stg_' + tabla);
    stg.create = true;
    cols.forEach(([nombre, tipo]) => stg.columns.add(nombre, tipo, { nullable: true }));
    filas.forEach(f => stg.rows.add(...cols.map(([, , fn]) => {
        const v = fn(f);
        return v === undefined ? null : v;
    })));

    const nombres = cols.map(([n]) => n);
    // OJO: la #stg es POR CONEXIÓN — bulk y MERGE deben viajar por la misma. Una transacción
    // ancla todo a una única conexión del pool (y de paso el upsert es atómico).
    const tran = new sql.Transaction(pool);
    await tran.begin();
    try {
        await new sql.Request(tran).bulk(stg);
        let cuerpo;
        if (reload) {
            cuerpo = `
                DELETE FROM dbo.${tabla};
                INSERT INTO dbo.${tabla} (${nombres.join(', ')})
                SELECT ${nombres.join(', ')} FROM #stg_${tabla};
            `;
        } else {
            const sets = nombres.filter(n => n !== pk).map(n => `T.${n} = S.${n}`).join(', ');
            cuerpo = `
                ${identity ? `SET IDENTITY_INSERT dbo.${tabla} ON;` : ''}
                MERGE dbo.${tabla} AS T
                USING #stg_${tabla} AS S ON T.${pk} = S.${pk}
                ${sets ? `WHEN MATCHED THEN UPDATE SET ${sets}` : ''}
                WHEN NOT MATCHED THEN INSERT (${nombres.join(', ')}) VALUES (${nombres.map(n => 'S.' + n).join(', ')});
                ${identity ? `SET IDENTITY_INSERT dbo.${tabla} OFF; DECLARE @m INT = (SELECT ISNULL(MAX(${pk}), 0) FROM dbo.${tabla}); DBCC CHECKIDENT('dbo.${tabla}', RESEED, @m);` : ''}
            `;
        }
        await new sql.Request(tran).query(cuerpo + `\nDROP TABLE #stg_${tabla};`);
        await tran.commit();
    } catch (e) {
        try { await tran.rollback(); } catch (_) {}
        throw new Error(`${tabla}: ${e.message}`);
    }
    logger.info(`[WMS-IMPORT] ${tabla}: ${filas.length} filas ${reload ? 'recargadas' : 'upserteadas'}`);
}

const D = (v) => (v == null ? null : new Date(v));
const N = (v) => (v == null ? null : Number(v));

async function main() {
    const pool = await getPool();
    const o = await cargarOrigen();

    // Foto de paridad del ORIGEN (antes de escribir nada)
    const paridadOrigen = {};
    o.Stock_Etiquetas.filter(e => (e.estado || '') === 'activo').forEach(e => {
        const d = e.deposito_id ?? 0;
        paridadOrigen[d] = paridadOrigen[d] || { etiquetas: 0, unidades: 0 };
        paridadOrigen[d].etiquetas++;
        paridadOrigen[d].unidades += Number(e.cantidad_actual || 0);
    });

    if (!args['solo-paridad']) {
        // 1 ── catálogo (ids conservados)
        await upsert(pool, 'Wms_Depositos', [
            ['DepId', sql.Int, f => f.id], ['Nombre', sql.VarChar(100), f => f.nombre || ('Depósito ' + f.id)],
            ['Tipo', sql.VarChar(50), f => f.tipo], ['Ubicacion', sql.VarChar(255), f => f.ubicacion],
        ], o.Stock_Depositos, { pk: 'DepId' });

        await upsert(pool, 'Wms_Categorias', [
            ['CatId', sql.Int, f => f.id], ['Nombre', sql.NVarChar(100), f => f.nombre || 'Sin nombre'],
            ['Descripcion', sql.NVarChar(255), f => f.descripcion],
        ], o.Stock_Categorias, { pk: 'CatId' });

        // Unidades: el origen trae 'ud'/'uds'/'unidad' mezclados (texto libre de allá);
        // acá se unifica a 'uni' (pedido 1/09). kg/lts/mts pasan tal cual.
        const normUnidad = (u) => {
            const v = String(u || '').trim().toLowerCase();
            return (!v || ['ud', 'uds', 'u', 'unidad', 'unidades'].includes(v)) ? 'uni' : v;
        };
        await upsert(pool, 'Wms_ProductosMaestros', [
            ['PmaId', sql.Int, f => f.id], ['Nombre', sql.NVarChar(255), f => f.nombre || 'Sin nombre'],
            ['Sku', sql.NVarChar(100), f => f.sku], ['CatId', sql.Int, f => f.categoria_id],
            ['UnidadBase', sql.NVarChar(50), f => normUnidad(f.unidad_base)],
            ['TipoGestion', sql.VarChar(50), f => f.tipo_gestion || 'granel'],
            ['LlevaPeso', sql.Bit, f => f.lleva_peso ? 1 : 0],
            ['AtributosConfig', sql.NVarChar(sql.MAX), f => f.atributos_config],
            ['CostoUnitarioBase', sql.Decimal(18, 2), f => N(f.costo_unitario_base) ?? 0],
            ['FechaCreacion', sql.DateTime, f => D(f.fecha_creacion) || new Date()],
        ], o.Stock_Productos_Maestros, { pk: 'PmaId' });

        await upsert(pool, 'Wms_Variantes', [
            ['VarId', sql.Int, f => f.id], ['PmaId', sql.Int, f => f.producto_maestro_id],
            ['NombreVariante', sql.NVarChar(255), f => f.nombre_variante || 'Sin nombre'],
            ['CodigoVariante', sql.NVarChar(150), f => f.codigo_variante],
            ['Costo', sql.Decimal(18, 2), f => N(f.costo) ?? 0],
            ['Moneda', sql.VarChar(20), f => f.moneda || 'UYU'],
            ['MetadataJson', sql.NVarChar(sql.MAX), f => f.metadata_json],
            ['StockMinimo', sql.Decimal(18, 2), f => N(f.stock_minimo_esperado) ?? 0],
            ['CantidadAlerta', sql.Int, f => N(f.cantidad_alerta) ?? 0],
            ['CantidadCritica', sql.Int, f => N(f.cantidad_critica) ?? 0],
            ['CantidadIdeal', sql.Int, f => N(f.cantidad_ideal) ?? 0],
            ['AlertaActivada', sql.Bit, f => f.alerta_activada ? 1 : 0],
            ['FechaCreacion', sql.DateTime, f => D(f.fecha_creacion) || new Date()],
        ], o.Stock_Variantes.filter(v => v.producto_maestro_id != null), { pk: 'VarId' });

        // Unificación (decisión e): ejes y vínculo ERP desde nuestra tabla puente histórica.
        // NUNCA pisa un dato ya cargado a mano en Wms_Variantes (solo llena NULLs).
        await new sql.Request(pool).query(`
            IF OBJECT_ID('dbo.Articulos_WMS_Variantes') IS NOT NULL
            UPDATE v SET
                v.ProIdProducto = ISNULL(v.ProIdProducto, awv.Idproid),
                v.Talle = ISNULL(v.Talle, awv.Talle),
                v.Color = ISNULL(v.Color, awv.Color)
            FROM dbo.Wms_Variantes v
            JOIN dbo.Articulos_WMS_Variantes awv ON awv.wms_variante_id = v.VarId;
        `);

        // 2 ── abastecimiento (catálogos y plantillas primero: las compras los referencian)
        await upsert(pool, 'Wms_Monedas', [
            ['MonId', sql.Int, f => f.id], ['Codigo', sql.VarChar(10), f => f.codigo || '?'],
            ['Simbolo', sql.VarChar(10), f => f.simbolo], ['Nombre', sql.NVarChar(100), f => f.nombre],
        ], o.Stock_Monedas || [], { pk: 'MonId' });

        await upsert(pool, 'Wms_TiposFactura', [
            ['TfaId', sql.Int, f => f.id], ['Nombre', sql.NVarChar(100), f => f.nombre || '?'],
        ], o.Stock_TiposFactura || [], { pk: 'TfaId' });

        await upsert(pool, 'Wms_PagosMotivos', [
            ['PmoId', sql.Int, f => f.id], ['Nombre', sql.NVarChar(100), f => f.nombre || '?'],
        ], o.Stock_Pagos_Motivos || [], { pk: 'PmoId' });

        await upsert(pool, 'Wms_PlantillasProgreso', [
            ['PlaId', sql.Int, f => f.id], ['Nombre', sql.NVarChar(150), f => f.nombre || '?'],
            ['Descripcion', sql.NVarChar(500), f => f.descripcion],
        ], o.Stock_Plantillas_Progreso || [], { pk: 'PlaId' });

        await upsert(pool, 'Wms_PlantillasProgresoPasos', [
            ['PasId', sql.Int, f => f.id], ['PlaId', sql.Int, f => f.plantilla_id],
            ['Clave', sql.VarChar(50), f => String(f.clave)], ['Etiqueta', sql.NVarChar(150), f => f.etiqueta || '?'],
            ['Icono', sql.VarChar(50), f => f.icono], ['Orden', sql.Int, f => f.orden || 0],
        ], (o.Stock_Plantillas_Progreso_Pasos || []).filter(p => p.plantilla_id != null), { pk: 'PasId' });

        // Umbrales por depósito (en el origen la tabla está vacía; se migra igual por si se cargan)
        await upsert(pool, 'Wms_AlertasDepositos', [
            ['VarId', sql.Int, f => f.variante_id], ['DepId', sql.Int, f => f.deposito_id],
            ['CantidadCritica', sql.Decimal(18, 4), f => N(f.cantidad_critica) ?? 0],
            ['CantidadAlerta', sql.Decimal(18, 4), f => N(f.cantidad_alerta) ?? 0],
            ['CantidadIdeal', sql.Decimal(18, 4), f => N(f.cantidad_ideal) ?? 0],
        ], (o.Stock_Alertas_Depositos || []).filter(a => a.variante_id && a.deposito_id), { reload: true });

        await upsert(pool, 'Wms_Proveedores', [
            ['PrvId', sql.Int, f => f.id], ['Nombre', sql.NVarChar(200), f => f.nombre || 'Sin nombre'],
            ['RazonSocial', sql.NVarChar(200), f => f.razon_social], ['Documento', sql.VarChar(50), f => f.documento],
            ['Contacto', sql.NVarChar(200), f => f.contacto], ['Ciudad', sql.NVarChar(100), f => f.ciudad],
        ], o.Stock_Proveedores, { pk: 'PrvId', identity: true, reseed: true });

        // Compras: GUID viejo → INT nuestro. MERGE por GuidViejo (columna única del origen).
        await upsert(pool, 'Wms_Importaciones', [
            ['GuidViejo', sql.UniqueIdentifier, f => f.id],
            ['Origen', sql.NVarChar(200), f => f.origen],
            ['EmpresaImportadora', sql.NVarChar(200), f => f.empresa_importadora],
            ['ContactoImportadora', sql.NVarChar(200), f => f.contacto_importadora],
            ['EmpresaTransporteLocal', sql.NVarChar(200), f => f.empresa_transporte_local],
            ['ContactoTransporteLocal', sql.NVarChar(200), f => f.contacto_transporte_local],
            ['Estado', sql.VarChar(50), f => f.estado], ['Progreso', sql.VarChar(50), f => f.progreso],
            ['PlaId', sql.Int, f => f.plantilla_progreso_id],
            ['FechaCreacion', sql.DateTime, f => D(f.fecha_creacion) || new Date()],
        ], o.Stock_Importaciones, { pk: 'GuidViejo' });

        await upsert(pool, 'Wms_Compras', [
            ['GuidViejo', sql.UniqueIdentifier, f => f.id],
            ['PrvId', sql.Int, f => f.proveedor_id],
            ['ReferenciaFactura', sql.NVarChar(200), f => f.referencia_factura],
            ['MonedaId', sql.Int, f => f.moneda_id],
            ['TotalCompra', sql.Decimal(18, 2), f => N(f.total_compra) ?? 0],
            ['GastosExtras', sql.Decimal(18, 2), f => N(f.gastos_extras) ?? 0],
            ['Estado', sql.NVarChar(50), f => f.estado || 'completada'],
            ['Progreso', sql.VarChar(50), f => f.progreso],
            ['AutorizadoRecepcion', sql.Bit, f => f.autorizado_recepcion ? 1 : 0],
            ['PlaId', sql.Int, f => f.plantilla_progreso_id],
            ['TfaId', sql.Int, f => f.tipo_factura_id],
            ['FechaCreacion', sql.DateTime, f => D(f.fecha_creacion) || new Date()],
        ], o.Stock_Compras, { pk: 'GuidViejo' });

        const mapaCompras = {};
        (await new sql.Request(pool).query('SELECT CompId, GuidViejo FROM dbo.Wms_Compras WHERE GuidViejo IS NOT NULL'))
            .recordset.forEach(r => { mapaCompras[String(r.GuidViejo).toLowerCase()] = r.CompId; });

        // Vincular cada compra con su importación (el origen las relaciona por GUID)
        const mapaImp0 = {};
        (await new sql.Request(pool).query('SELECT ImpId, GuidViejo FROM dbo.Wms_Importaciones WHERE GuidViejo IS NOT NULL'))
            .recordset.forEach(r => { mapaImp0[String(r.GuidViejo).toLowerCase()] = r.ImpId; });
        for (const c of o.Stock_Compras.filter(x => x.importacion_id)) {
            const impId = mapaImp0[String(c.importacion_id).toLowerCase()];
            const compId = mapaCompras[String(c.id).toLowerCase()];
            if (impId && compId) {
                await new sql.Request(pool).input('C', sql.Int, compId).input('I', sql.Int, impId)
                    .query('UPDATE dbo.Wms_Compras SET ImportacionId = @I WHERE CompId = @C');
            }
        }

        const varIds = new Set(o.Stock_Variantes.map(v => v.id));
        await upsert(pool, 'Wms_ComprasDetalle', [
            ['CompId', sql.Int, f => mapaCompras[String(f.compra_id).toLowerCase()]],
            ['VarId', sql.Int, f => f.variante_id],
            ['Cantidad', sql.Decimal(18, 4), f => N(f.cantidad) ?? 0],
            ['PrecioUnitario', sql.Decimal(18, 2), f => N(f.precio_unitario) ?? 0],
            ['CostoPuestoLocal', sql.Decimal(18, 2), f => N(f.costo_puesto_local)],
        ], o.Stock_Compras_Detalle
            .filter(d => mapaCompras[String(d.compra_id).toLowerCase()] && varIds.has(d.variante_id)),
            { reload: true });

        // Pagos de compras/importaciones (después de compras: usan el mapa de GUIDs)
        const mapaImport = {};
        (await new sql.Request(pool).query('SELECT ImpId, GuidViejo FROM dbo.Wms_Importaciones WHERE GuidViejo IS NOT NULL'))
            .recordset.forEach(r => { mapaImport[String(r.GuidViejo).toLowerCase()] = r.ImpId; });
        await upsert(pool, 'Wms_Pagos', [
            ['CompId', sql.Int, f => f.compra_id ? mapaCompras[String(f.compra_id).toLowerCase()] ?? null : null],
            ['ImpId', sql.Int, f => f.importacion_id ? mapaImport[String(f.importacion_id).toLowerCase()] ?? null : null],
            ['Monto', sql.Decimal(18, 2), f => N(f.monto) ?? 0],
            ['TipoPago', sql.NVarChar(100), f => f.tipo_pago],
            ['Motivo', sql.NVarChar(300), f => f.motivo],
            ['Fecha', sql.DateTime, f => D(f.fecha) || new Date()],
        ], o.Stock_Pagos || [], { reload: true });

        // 3 ── etiquetas (ids conservados; solo variantes existentes)
        await upsert(pool, 'Wms_Etiquetas', [
            ['EtiId', sql.Int, f => f.id], ['VarId', sql.Int, f => f.variante_id],
            ['DepId', sql.Int, f => f.deposito_id],
            ['CantidadInicial', sql.Decimal(18, 4), f => N(f.cantidad_inicial) ?? N(f.cantidad_actual) ?? 0],
            ['CantidadActual', sql.Decimal(18, 4), f => N(f.cantidad_actual) ?? 0],
            ['MedidaSecundaria', sql.Decimal(10, 2), f => N(f.medida_secundaria)],
            ['Peso', sql.Decimal(18, 3), f => N(f.peso)],
            ['CostoUnitarioReal', sql.Decimal(18, 2), f => N(f.costo_unitario_real) ?? 0],
            ['CodigoBarras', sql.VarChar(255), f => f.codigo_barras],
            ['CompraId', sql.Int, f => f.compra_id ? mapaCompras[String(f.compra_id).toLowerCase()] ?? null : null],
            ['Estado', sql.VarChar(50), f => f.estado || 'activo'],
            ['UltimaActualizacion', sql.DateTime, f => D(f.ultima_actualizacion) || new Date()],
        ], o.Stock_Etiquetas.filter(e => e.variante_id != null && varIds.has(e.variante_id) && e.deposito_id != null),
            { pk: 'EtiId' });

        // 4 ── apertura del ledger: 1 movimiento por etiqueta ACTIVA (idempotente por clave;
        // el re-run actualiza la cantidad del movimiento de apertura, no duplica)
        const activas = o.Stock_Etiquetas.filter(e => (e.estado || '') === 'activo' && Number(e.cantidad_actual) > 0 && varIds.has(e.variante_id) && e.deposito_id != null);
        await upsert(pool, 'Wms_Movimientos', [
            ['EtiId', sql.Int, f => f.id],
            ['Tipo', sql.VarChar(50), () => 'apertura_migracion'],
            ['Cantidad', sql.Decimal(18, 4), f => N(f.cantidad_actual) ?? 0],
            ['MedidaSecundaria', sql.Decimal(10, 2), f => N(f.medida_secundaria)],
            ['DepDestinoId', sql.Int, f => f.deposito_id],
            ['RefTipo', sql.VarChar(30), () => 'MIGRACION'],
            ['IdempotencyKey', sql.VarChar(120), f => 'APERTURA:' + f.id],
            ['Fecha', sql.DateTime, () => new Date()],
        ], activas, { pk: 'IdempotencyKey' });

        // 5 ── remitos y solicitudes (ids conservados)
        await upsert(pool, 'Wms_RemitosInternos', [
            ['RemId', sql.Int, f => f.id], ['Numeracion', sql.VarChar(50), f => f.numeracion || String(f.id)],
            ['DepOrigenId', sql.Int, f => f.deposito_origen_id], ['DepDestinoId', sql.Int, f => f.deposito_destino_id],
            ['Estado', sql.VarChar(50), f => f.estado || 'EN_TRANSITO'],
            // creado_por del origen es el NOMBRE del responsable, no un id
            ['Responsable', sql.NVarChar(120), f => (f.creado_por || '').toString().trim() || null],
            ['Observaciones', sql.NVarChar(sql.MAX), f => f.observaciones_generales],
            ['FechaCreacion', sql.DateTime, f => D(f.fecha_creacion) || new Date()],
            ['MotivoCancelacion', sql.NVarChar(500), f => (f.motivo_cancelacion || '').substring(0, 500) || null],
            ['FechaCancelacion', sql.DateTime, f => D(f.fecha_cancelacion)],
        ], o.wms_remitos_internos.filter(r => r.deposito_origen_id != null && r.deposito_destino_id != null),
            { pk: 'RemId', identity: true, reseed: true });

        const remIds = new Set(o.wms_remitos_internos.map(r => r.id));
        await upsert(pool, 'Wms_RemitosInternosItems', [
            ['RemId', sql.Int, f => f.remito_id],
            ['VarId', sql.Int, f => f.variante_id],
            ['CantidadEnviada', sql.Decimal(18, 4), f => N(f.cantidad_enviada) ?? 0],
            ['CantidadRecibida', sql.Decimal(18, 4), f => N(f.cantidad_recibida)],
            ['Estado', sql.VarChar(50), f => f.estado || 'PENDIENTE'],
            ['EtiGeneradaId', sql.Int, f => f.etiqueta_generada_id],
        ], o.wms_remitos_internos_items.filter(i => remIds.has(i.remito_id) && varIds.has(i.variante_id)),
            { reload: true });

        await upsert(pool, 'Wms_Solicitudes', [
            ['SolId', sql.Int, f => f.id], ['Numeracion', sql.VarChar(50), f => f.numeracion || String(f.id)],
            ['DepSolicitanteId', sql.Int, f => f.deposito_solicitante_id],
            ['Estado', sql.VarChar(50), f => f.estado || 'PENDIENTE'],
            ['FechaCreacion', sql.DateTime, f => D(f.fecha_creacion) || new Date()],
        ], o.wms_solicitudes.filter(s => s.deposito_solicitante_id != null), { pk: 'SolId', identity: true, reseed: true });

        const solIds = new Set(o.wms_solicitudes.map(s => s.id));
        await upsert(pool, 'Wms_SolicitudesItems', [
            ['SolId', sql.Int, f => f.solicitud_id],
            ['VarId', sql.Int, f => f.variante_id],
            ['CantidadSolicitada', sql.Decimal(18, 4), f => N(f.cantidad_solicitada) ?? 0],
        ], o.wms_solicitudes_items.filter(i => solIds.has(i.solicitud_id) && varIds.has(i.variante_id)),
            { reload: true });

        // 6 ── histórico crudo del sistema viejo (solo consulta): recarga completa
        const etiVar = {};
        o.Stock_Etiquetas.forEach(e => { etiVar[e.id] = e.variante_id; });
        await upsert(pool, 'Wms_HistoricoExterno', [
            ['GuidViejo', sql.UniqueIdentifier, f => f.id],
            ['NumeroSecuencial', sql.Int, f => f.numero_secuencial],
            ['EtiquetaId', sql.Int, f => f.etiqueta_id],
            ['VarianteId', sql.Int, f => etiVar[f.etiqueta_id] ?? null],
            ['Tipo', sql.NVarChar(100), f => f.tipo_movimiento],
            ['Cantidad', sql.Decimal(18, 4), f => N(f.cantidad_afectada)],
            ['MedidaSecundaria', sql.Decimal(10, 2), f => N(f.medida_secundaria_afectada)],
            ['DepOrigenId', sql.Int, f => f.deposito_origen_id],
            ['DepDestinoId', sql.Int, f => f.deposito_destino_id],
            ['RemitoId', sql.Int, f => f.remito_id],
            ['CompraGuid', sql.UniqueIdentifier, f => f.referencia_compra_id],
            ['Usuario', sql.VarChar(50), f => (f.usuario_id || '').substring(0, 50) || null],
            ['Fecha', sql.DateTime, f => D(f.fecha)],
        ], o.Stock_Movimientos, { reload: true });
    }

    // 7 ── PARIDAD: nuestro stock vs el origen, por depósito
    const nuestro = (await new sql.Request(pool).query(`
        SELECT DepId, COUNT(*) AS etiquetas, SUM(CantidadActual) AS unidades
        FROM dbo.Wms_Etiquetas WHERE Estado = 'activo' GROUP BY DepId
    `)).recordset;
    let ok = true;
    const deps = new Set([...Object.keys(paridadOrigen).map(Number), ...nuestro.map(r => r.DepId)]);
    console.log('\n=== PARIDAD (origen WMS vs Wms_* nuestro) ===');
    for (const d of [...deps].sort((a, b) => a - b)) {
        const org = paridadOrigen[d] || { etiquetas: 0, unidades: 0 };
        const nue = nuestro.find(r => r.DepId === d) || { etiquetas: 0, unidades: 0 };
        const match = org.etiquetas === nue.etiquetas && Math.abs(org.unidades - Number(nue.unidades)) < 0.01;
        if (!match) ok = false;
        console.log(`  dep ${d}: origen ${org.etiquetas} etiq / ${org.unidades} uds  →  nuestro ${nue.etiquetas} etiq / ${Number(nue.unidades)} uds  ${match ? 'OK' : '*** DIFERENCIA ***'}`);
    }
    console.log(ok ? '\n✅ PARIDAD PERFECTA — la copia es idéntica al origen.' : '\n❌ HAY DIFERENCIAS — revisar antes de seguir.');
    process.exit(ok ? 0 : 1);
}

main().catch(e => { logger.error('[WMS-IMPORT] FALLO: ' + e.message); console.error(e); process.exit(1); });
