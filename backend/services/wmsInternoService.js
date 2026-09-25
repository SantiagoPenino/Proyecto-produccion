/**
 * wmsInternoService.js — el WMS PROPIO (reemplazo del externo de Johnson).
 * ─────────────────────────────────────────────────────────────────────────────
 * Única puerta de escritura sobre Wms_Etiquetas/Wms_Movimientos. Reglas de oro:
 *   1. CantidadActual NUNCA se updatea suelta: movimiento + update en la MISMA transacción.
 *   2. Todo egreso con referencia lleva IdempotencyKey — el retry no duplica (constraint UNIQUE).
 *   3. La operación NUNCA se traba por falta de stock (decisión d): el faltante queda
 *      registrado en Wms_Discrepancias hasta que alguien lo resuelva.
 *   4. Consumo FIFO repartido entre etiquetas (a diferencia del sistema viejo, que
 *      descontaba de UNA sola etiqueta aunque no alcanzara).
 * Tablas: docs/wms-data/DDL-wms-propio.sql · Migración: scripts/wmsImportSnapshot.js
 * Cutover por flag: WMS_INTERNO=true en .env (ver wmsStockService.descontarStockWmsExterno).
 */

const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

const DEP_LOCAL = () => parseInt(process.env.WMS_DEPOSITO_LOCAL_ID, 10) || 5;

/**
 * Egreso de venta: descuenta stock FIFO entre etiquetas activas del depósito.
 * items: [{ varId, cantidad }] · ref: { refTipo, refId } para trazabilidad + idempotencia.
 * Corre en su propia transacción, o dentro de la del caller si viene `transaction`.
 * Devuelve { ok, errores[] } — errores son avisos (faltantes), nunca bloqueos.
 */
async function egresarVenta({ items, refTipo = null, refId = null, tipo = 'egreso_venta_web', depId = null, usuarioId = null, transaction = null }) {
    const dep = depId || DEP_LOCAL();
    const pool = await getPool();
    const propia = !transaction;
    const tran = transaction || new sql.Transaction(pool);
    if (propia) await tran.begin();
    const errores = [];
    try {
        for (const item of items) {
            const varId = parseInt(item.varId, 10);
            const cantidad = parseFloat(item.cantidad);
            if (!varId || !(cantidad > 0)) continue;

            // Idempotencia por operación+variante: si el retry ya pasó por acá, no repetir.
            const idemKey = (refTipo && refId != null) ? `${refTipo}:${refId}:VAR:${varId}`.substring(0, 120) : null;
            if (idemKey) {
                const ya = await new sql.Request(tran)
                    .input('K', sql.VarChar(120), idemKey)
                    .query('SELECT TOP 1 MovId FROM dbo.Wms_Movimientos WHERE IdempotencyKey = @K');
                if (ya.recordset.length) {
                    logger.info(`[WMS-INT] Egreso ya aplicado (${idemKey}) — retry ignorado`);
                    continue;
                }
            }

            // Etiquetas activas del depósito, FIFO, bloqueadas hasta el commit.
            const etis = await new sql.Request(tran)
                .input('V', sql.Int, varId)
                .input('D', sql.Int, dep)
                .query(`
                    SELECT EtiId, CantidadActual FROM dbo.Wms_Etiquetas WITH (UPDLOCK, ROWLOCK)
                    WHERE VarId = @V AND DepId = @D AND Estado = 'activo' AND CantidadActual > 0
                    ORDER BY EtiId ASC
                `);

            let restante = cantidad;
            let primero = true;
            for (const e of etis.recordset) {
                if (restante <= 0) break;
                const toma = Math.min(restante, Number(e.CantidadActual));
                await new sql.Request(tran)
                    .input('Eti', sql.Int, e.EtiId)
                    .input('Tipo', sql.VarChar(50), tipo)
                    .input('Cant', sql.Decimal(18, 4), -toma)
                    .input('DepO', sql.Int, dep)
                    .input('RefT', sql.VarChar(30), refTipo)
                    .input('RefId', sql.Int, refId)
                    .input('Idem', sql.VarChar(120), primero ? idemKey : null)  // la clave va en el 1er mov de la variante
                    .input('Usr', sql.Int, usuarioId)
                    .query(`
                        INSERT INTO dbo.Wms_Movimientos (EtiId, Tipo, Cantidad, DepOrigenId, RefTipo, RefId, IdempotencyKey, UsuarioId)
                        VALUES (@Eti, @Tipo, @Cant, @DepO, @RefT, @RefId, @Idem, @Usr);

                        UPDATE dbo.Wms_Etiquetas
                        SET CantidadActual = CantidadActual - @ToMa,
                            Estado = CASE WHEN CantidadActual - @ToMa <= 0 THEN 'consumido' ELSE Estado END,
                            UltimaActualizacion = GETDATE()
                        WHERE EtiId = @Eti;
                    `.replace(/@ToMa/g, toma.toFixed(4)));
                restante -= toma;
                primero = false;
            }

            // Faltante → discrepancia visible (decisión d: registrar, nunca trabar)
            if (restante > 0.0001) {
                await new sql.Request(tran)
                    .input('V', sql.Int, varId).input('D', sql.Int, dep)
                    .input('F', sql.Decimal(18, 4), restante)
                    .input('RefT', sql.VarChar(30), refTipo).input('RefId', sql.Int, refId)
                    .query(`INSERT INTO dbo.Wms_Discrepancias (VarId, DepId, Faltante, RefTipo, RefId)
                            VALUES (@V, @D, @F, @RefT, @RefId)`);
                errores.push(`variante ${varId}: stock parcial (faltaron ${restante.toFixed(2)}, registrado como discrepancia)`);
                logger.warn(`[WMS-INT] Faltante variante ${varId}: ${restante.toFixed(2)} (dep ${dep}) — discrepancia registrada`);
            }
        }
        if (propia) await tran.commit();
        return { ok: true, errores };
    } catch (e) {
        if (propia) { try { await tran.rollback(); } catch (_) {} }
        // Choque del UNIQUE de idempotencia con un retry concurrente = ya lo hizo el otro
        if (/UX_WmsMov_Idem|duplicate/i.test(e.message)) {
            logger.info('[WMS-INT] Egreso concurrente ya aplicado (constraint de idempotencia)');
            return { ok: true, errores };
        }
        throw e;
    }
}

/** Ingreso de mercadería: crea la etiqueta física + su movimiento, devuelve EtiId. */
async function ingresarEtiqueta({ varId, depId = null, cantidad, medidaSecundaria = null, peso = null, costoUnitario = 0, codigoBarras = null, compraId = null, usuarioId = null }) {
    const dep = depId || DEP_LOCAL();
    const pool = await getPool();
    const tran = new sql.Transaction(pool);
    await tran.begin();
    try {
        const r = await new sql.Request(tran)
            .input('V', sql.Int, varId).input('D', sql.Int, dep)
            .input('C', sql.Decimal(18, 4), cantidad)
            .input('MS', sql.Decimal(10, 2), medidaSecundaria)
            .input('P', sql.Decimal(18, 3), peso)
            .input('Costo', sql.Decimal(18, 2), costoUnitario || 0)
            .input('CB', sql.VarChar(255), codigoBarras)
            .input('Comp', sql.Int, compraId)
            .input('Usr', sql.Int, usuarioId)
            .query(`
                DECLARE @Id INT = (SELECT ISNULL(MAX(EtiId), 0) + 1 FROM dbo.Wms_Etiquetas WITH (UPDLOCK, HOLDLOCK));
                INSERT INTO dbo.Wms_Etiquetas (EtiId, VarId, DepId, CantidadInicial, CantidadActual, MedidaSecundaria, Peso, CostoUnitarioReal, CodigoBarras, CompraId, Estado, UsuarioIngreso)
                VALUES (@Id, @V, @D, @C, @C, @MS, @P, @Costo, @CB, @Comp, 'activo', @Usr);
                INSERT INTO dbo.Wms_Movimientos (EtiId, Tipo, Cantidad, DepDestinoId, RefTipo, RefId, UsuarioId)
                VALUES (@Id, 'ingreso', @C, @D, ${compraId ? "'COMPRA', @Comp" : 'NULL, NULL'}, @Usr);
                SELECT @Id AS EtiId;
            `);
        await tran.commit();
        return { ok: true, etiId: r.recordset[0].EtiId };
    } catch (e) {
        try { await tran.rollback(); } catch (_) {}
        throw e;
    }
}

/** Ajuste por conteo físico: fija CantidadActual al valor contado y asienta la diferencia. */
async function ajustarConteo({ etiId, cantidadContada, usuarioId = null, nota = null }) {
    const pool = await getPool();
    const tran = new sql.Transaction(pool);
    await tran.begin();
    try {
        const cur = await new sql.Request(tran)
            .input('E', sql.Int, etiId)
            .query(`SELECT CantidadActual, DepId FROM dbo.Wms_Etiquetas WITH (UPDLOCK, ROWLOCK) WHERE EtiId = @E`);
        if (!cur.recordset.length) throw new Error(`Etiqueta ${etiId} no existe`);
        const dif = Number(cantidadContada) - Number(cur.recordset[0].CantidadActual);
        if (Math.abs(dif) > 0.0001) {
            await new sql.Request(tran)
                .input('E', sql.Int, etiId)
                .input('Dif', sql.Decimal(18, 4), dif)
                .input('Nueva', sql.Decimal(18, 4), Number(cantidadContada))
                .input('Dep', sql.Int, cur.recordset[0].DepId)
                .input('Usr', sql.Int, usuarioId)
                .query(`
                    INSERT INTO dbo.Wms_Movimientos (EtiId, Tipo, Cantidad, DepDestinoId, RefTipo, UsuarioId)
                    VALUES (@E, 'ajuste_conteo', @Dif, @Dep, 'CONTEO', @Usr);
                    UPDATE dbo.Wms_Etiquetas
                    SET CantidadActual = @Nueva,
                        Estado = CASE WHEN @Nueva <= 0 THEN 'consumido' ELSE 'activo' END,
                        UltimaActualizacion = GETDATE()
                    WHERE EtiId = @E;
                `);
        }
        await tran.commit();
        return { ok: true, diferencia: dif };
    } catch (e) {
        try { await tran.rollback(); } catch (_) {}
        throw e;
    }
}

/** Stock vivo por variante (para tienda/configurador): { varId: unidades }. */
async function getStockPorVariante(varIds = null, depId = null) {
    const dep = depId || DEP_LOCAL();
    const pool = await getPool();
    const filtro = Array.isArray(varIds) && varIds.length
        ? `AND VarId IN (${varIds.map(v => parseInt(v, 10)).filter(n => !isNaN(n)).join(',')})`
        : '';
    const r = await pool.request()
        .input('D', sql.Int, dep)
        .query(`
            SELECT VarId, SUM(CantidadActual) AS Stock
            FROM dbo.Wms_Etiquetas
            WHERE DepId = @D AND Estado = 'activo' AND CantidadActual > 0 ${filtro}
            GROUP BY VarId
        `);
    const map = {};
    r.recordset.forEach(row => { map[row.VarId] = Number(row.Stock); });
    return map;
}

/**
 * Catálogo de maestros y variantes para /admin/products-integration (vincular artículos del ERP con
 * el WMS e importar maestros). Devuelven LAS MISMAS formas de fila que el proxy del WMS externo
 * (`id`, `nombre`, `variante_id`, `nombre_variante`, `codigo_variante`, `producto_maestro_id`) para
 * que el controlador bifurque por WMS_INTERNO sin tocar a los que lo llaman. Los ids son los mismos
 * en los dos lados: la migración los conserva.
 */
async function getMaestros() {
    const pool = await getPool();
    const r = await pool.request().query(`
        SELECT PmaId AS id, Nombre AS nombre
        FROM dbo.Wms_ProductosMaestros
        ORDER BY Nombre`);
    return r.recordset;
}

async function getMaestro(pmaId) {
    const pool = await getPool();
    const r = await pool.request()
        .input('P', sql.Int, pmaId)
        .query(`SELECT PmaId AS id, Nombre AS nombre FROM dbo.Wms_ProductosMaestros WHERE PmaId = @P`);
    return r.recordset[0] || null;
}

async function getVariantesDeMaestro(pmaId) {
    const pool = await getPool();
    const r = await pool.request()
        .input('P', sql.Int, pmaId)
        .query(`
            SELECT VarId AS id, VarId AS variante_id, PmaId AS producto_maestro_id,
                   NombreVariante AS nombre_variante, CodigoVariante AS codigo_variante
            FROM dbo.Wms_Variantes
            WHERE PmaId = @P
            ORDER BY VarId`);
    return r.recordset;
}

// Catálogo entero para el "Sincronizar" de Pedidos WMS (wmsController.syncCatalog): misma forma de fila
// que su consulta al WMS externo (variante + maestro + categoría) y, como ella, sin filtrar activas.
async function getCatalogoSync() {
    const pool = await getPool();
    const r = await pool.request().query(`
        SELECT v.VarId AS variante_id, v.NombreVariante AS nombre_variante, v.CodigoVariante AS codigo_variante,
               v.PmaId AS producto_maestro_id, p.Nombre AS producto_nombre,
               p.CatId AS categoria_id, c.Nombre AS cat_nombre
        FROM dbo.Wms_Variantes v
        INNER JOIN dbo.Wms_ProductosMaestros p ON p.PmaId = v.PmaId
        LEFT JOIN dbo.Wms_Categorias c ON c.CatId = p.CatId
        ORDER BY p.Nombre, v.NombreVariante`);
    return r.recordset;
}

// Columnas de la ficha textil agregadas después del DDL original (22/09: Composicion). Se crean solas si
// faltan, con el mismo criterio que Articulos_Imagenes.color: prod no corre migraciones y una columna
// ausente tiraría 500 en el inventario. El SQL equivalente está en docs/wms-data/DDL-wms-compras.sql.
// Llamarla ANTES de abrir una transacción (es DDL).
let columnasTelaListas = null;
function asegurarColumnasTela(pool) {
    if (!columnasTelaListas) {
        columnasTelaListas = pool.request().query(`
            IF COL_LENGTH('dbo.Wms_Variantes', 'Composicion') IS NULL
                ALTER TABLE dbo.Wms_Variantes ADD Composicion NVARCHAR(200) NULL;
        `).catch((e) => { columnasTelaListas = null; throw e; });
    }
    return columnasTelaListas;
}

// Parte de un código a partir de un texto: sin tildes, mayúsculas, solo letras y números.
const tramoSku = (txt, largo) => String(txt || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, largo);

/**
 * Alta de un producto de stock NUEVO: el maestro y sus variantes, dentro de la transacción del caller.
 * SOLO después del cutover (lo exige el controlador): PmaId y VarId NO son identity, se conservan los
 * del WMS externo, que sigue numerando mientras esté vivo. Crear acá antes chocaría con el próximo
 * import, y su borrado de ausentes lo eliminaría. El número sale de MAX+1 con UPDLOCK/HOLDLOCK: dos
 * altas simultáneas no pueden tomar el mismo.
 * Códigos: si no vienen se arman como los del sistema viejo, FAM-NOMBR-n para el maestro (TEL-SATEN-1)
 * y <código del maestro>-VAR para cada variante (TEL-SATEN-1-SAT). No hay restricción de unicidad: son
 * informativos, la etiqueta física se lee por su propio código.
 * maestro: { nombre, catId, unidadBase, tipoGestion, llevaPeso, sku? }
 * variantes: [{ nombre, codigo?, talle?, color?, costo, moneda, gramajeGsm?, anchoMetros?, composicion? }]
 */
async function crearMaestroConVariantes({ maestro, variantes, transaction }) {
    const req = () => new sql.Request(transaction);

    const fam = (await req().input('C', sql.Int, maestro.catId)
        .query(`SELECT Nombre FROM dbo.Wms_Categorias WHERE CatId = @C`)).recordset[0];
    if (!fam) throw new Error('La familia elegida no existe en el WMS.');

    const pmaId = (await req().query(`
        SELECT ISNULL(MAX(PmaId), 0) + 1 AS id FROM dbo.Wms_ProductosMaestros WITH (UPDLOCK, HOLDLOCK)`)).recordset[0].id;

    let sku = String(maestro.sku || '').trim();
    if (!sku) {
        const base = `${tramoSku(fam.Nombre, 3) || 'GEN'}-${tramoSku(maestro.nombre, 5) || 'PROD'}`;
        const previos = (await req().input('B', sql.NVarChar(110), base + '-%')
            .query(`SELECT COUNT(*) AS n FROM dbo.Wms_ProductosMaestros WHERE Sku LIKE @B`)).recordset[0].n;
        sku = `${base}-${previos + 1}`;
    }

    await req()
        .input('P', sql.Int, pmaId)
        .input('N', sql.NVarChar(255), maestro.nombre)
        .input('S', sql.NVarChar(100), sku)
        .input('C', sql.Int, maestro.catId)
        .input('U', sql.NVarChar(50), maestro.unidadBase)
        .input('T', sql.VarChar(50), maestro.tipoGestion)
        .input('L', sql.Bit, maestro.llevaPeso ? 1 : 0)
        .query(`INSERT INTO dbo.Wms_ProductosMaestros (PmaId, Nombre, Sku, CatId, UnidadBase, TipoGestion, LlevaPeso)
                VALUES (@P, @N, @S, @C, @U, @T, @L)`);

    let varId = (await req().query(`
        SELECT ISNULL(MAX(VarId), 0) AS id FROM dbo.Wms_Variantes WITH (UPDLOCK, HOLDLOCK)`)).recordset[0].id;
    const usados = new Set();
    const creadas = [];
    for (const v of variantes) {
        varId += 1;
        let codigo = String(v.codigo || '').trim();
        if (!codigo) {
            const base = `${sku}-${tramoSku(v.nombre, 3) || 'VAR'}`;
            codigo = base;
            for (let i = 2; usados.has(codigo); i++) codigo = `${base}-${i}`;
        }
        usados.add(codigo);
        await req()
            .input('V', sql.Int, varId)
            .input('P', sql.Int, pmaId)
            .input('N', sql.NVarChar(255), v.nombre)
            .input('Cod', sql.NVarChar(150), codigo)
            .input('Ta', sql.NVarChar(50), v.talle || null)
            .input('Co', sql.NVarChar(50), v.color || null)
            .input('Cos', sql.Decimal(18, 2), v.costo || 0)
            .input('M', sql.VarChar(20), v.moneda)
            .input('G', sql.Decimal(8, 2), v.gramajeGsm ?? null)
            .input('A', sql.Decimal(6, 3), v.anchoMetros ?? null)
            .input('Comp', sql.NVarChar(200), v.composicion || null)
            .query(`INSERT INTO dbo.Wms_Variantes
                        (VarId, PmaId, NombreVariante, CodigoVariante, Talle, Color, Costo, Moneda, GramajeGsm, AnchoMetros, Composicion)
                    VALUES (@V, @P, @N, @Cod, @Ta, @Co, @Cos, @M, @G, @A, @Comp)`);
        creadas.push({ varId, nombre: v.nombre, codigo, talle: v.talle || null, color: v.color || null });
    }
    return { pmaId, sku, variantes: creadas };
}

/**
 * Compatibilidad con wmsStockService.descontarStockWmsExterno: misma entrada
 * ([{ wms_variante_id, Cantidad }]) y misma salida ({ wmsDisponible, wmsErrors }).
 * Es el punto al que salta el flag WMS_INTERNO=true en el cutover (F2).
 */
async function egresarVentaCompat(items, ref = {}) {
    const mapeados = (items || []).map(i => ({ varId: i.wms_variante_id, cantidad: i.Cantidad }));
    const { errores } = await egresarVenta({ items: mapeados, refTipo: ref.refTipo || null, refId: ref.refId || null });
    return { wmsDisponible: true, wmsErrors: errores };
}

/**
 * Remito interno: crear = DESCONTAR el origen (traslado_salida, FIFO) y dejarlo EN_TRANSITO.
 * Se envía lo que hay: si una variante no llega a la cantidad pedida, viaja lo disponible
 * (CantidadEnviada = lo real) y la diferencia NO genera discrepancia (no es faltante:
 * simplemente se pidió más de lo que había — el front lo muestra).
 */
async function crearRemito({ depOrigenId, depDestinoId, items, obs = null, usuarioId = null, solId = null }) {
    if (!depOrigenId || !depDestinoId || depOrigenId === depDestinoId) throw new Error('Depósitos de origen y destino inválidos');
    if (!Array.isArray(items) || !items.length) throw new Error('El remito no tiene items');
    const pool = await getPool();
    const tran = new sql.Transaction(pool);
    await tran.begin();
    try {
        // [24/09] Despacho de un pedido de insumos: el pedido queda ATENDIDO en la misma
        // transacción que el remito. Va primero: si dos personas despachan el mismo pedido,
        // la segunda espera el bloqueo de la fila y ya lo encuentra atendido.
        if (solId) {
            const rSol = await new sql.Request(tran).input('S', sql.Int, solId)
                .query(`UPDATE dbo.Wms_Solicitudes SET Estado = 'ATENDIDA' WHERE SolId = @S AND Estado = 'PENDIENTE';
                        SELECT @@ROWCOUNT AS n;`);
            if (!rSol.recordset[0].n) throw new Error('El pedido ya no está pendiente: lo atendió o lo canceló otra persona');
        }
        const rRem = await new sql.Request(tran)
            .input('O', sql.Int, depOrigenId).input('D', sql.Int, depDestinoId)
            .input('Obs', sql.NVarChar(sql.MAX), obs).input('Usr', sql.Int, usuarioId)
            .query(`
                INSERT INTO dbo.Wms_RemitosInternos (Numeracion, DepOrigenId, DepDestinoId, Estado, Observaciones, CreadoPor)
                OUTPUT INSERTED.RemId
                VALUES ('', @O, @D, 'EN_TRANSITO', @Obs, @Usr);
            `);
        const remId = rRem.recordset[0].RemId;
        await new sql.Request(tran).input('R', sql.Int, remId)
            .query(`UPDATE dbo.Wms_RemitosInternos SET Numeracion = 'RI-' + CAST(@R AS VARCHAR) WHERE RemId = @R`);

        const enviados = [];
        for (const item of items) {
            const varId = parseInt(item.varId, 10);
            const pedida = parseFloat(item.cantidad);
            if (!varId || !(pedida > 0)) continue;
            // FIFO del origen, igual que el egreso de venta pero tipo traslado_salida
            const etis = await new sql.Request(tran)
                .input('V', sql.Int, varId).input('D', sql.Int, depOrigenId)
                .query(`SELECT EtiId, CantidadActual FROM dbo.Wms_Etiquetas WITH (UPDLOCK, ROWLOCK)
                        WHERE VarId = @V AND DepId = @D AND Estado = 'activo' AND CantidadActual > 0
                        ORDER BY EtiId ASC`);
            let restante = pedida;
            for (const e of etis.recordset) {
                if (restante <= 0) break;
                const toma = Math.min(restante, Number(e.CantidadActual));
                await new sql.Request(tran)
                    .input('Eti', sql.Int, e.EtiId).input('Cant', sql.Decimal(18, 4), -toma)
                    .input('O', sql.Int, depOrigenId).input('Dd', sql.Int, depDestinoId)
                    .input('R', sql.Int, remId).input('Usr', sql.Int, usuarioId)
                    .query(`
                        INSERT INTO dbo.Wms_Movimientos (EtiId, Tipo, Cantidad, DepOrigenId, DepDestinoId, RefTipo, RefId, UsuarioId)
                        VALUES (@Eti, 'traslado_salida', @Cant, @O, @Dd, 'REMITO', @R, @Usr);
                        UPDATE dbo.Wms_Etiquetas
                        SET CantidadActual = CantidadActual - ${toma.toFixed(4)},
                            Estado = CASE WHEN CantidadActual - ${toma.toFixed(4)} <= 0 THEN 'consumido' ELSE Estado END,
                            UltimaActualizacion = GETDATE()
                        WHERE EtiId = @Eti;
                    `);
                restante -= toma;
            }
            const enviada = pedida - Math.max(0, restante);
            if (enviada > 0.0001) {
                await new sql.Request(tran)
                    .input('R', sql.Int, remId).input('V', sql.Int, varId)
                    .input('C', sql.Decimal(18, 4), enviada)
                    .query(`INSERT INTO dbo.Wms_RemitosInternosItems (RemId, VarId, CantidadEnviada, Estado)
                            VALUES (@R, @V, @C, 'PENDIENTE')`);
                enviados.push({ varId, pedida, enviada });
            }
        }
        if (!enviados.length) throw new Error('Ninguna variante tenía stock disponible en el origen — remito vacío');
        await tran.commit();
        return { ok: true, remId, numeracion: 'RI-' + remId, items: enviados };
    } catch (e) {
        try { await tran.rollback(); } catch (_) {}
        throw e;
    }
}

/**
 * Cancelación de un remito EN TRÁNSITO: la mercadería nunca llegó, así que
 * VUELVE al origen. Solo se devuelve lo que sigue PENDIENTE — si alguien ya
 * recibió parte, esa parte se queda donde está (ya es stock del destino).
 * La devolución abre una etiqueta nueva en el origen: la original pudo haberse
 * consumido al salir, y reabrirla mentiría sobre su historia.
 */
async function cancelarRemito({ remId, motivo = null, usuarioId = null }) {
    const pool = await getPool();
    const tran = new sql.Transaction(pool);
    await tran.begin();
    try {
        const rRem = await new sql.Request(tran).input('R', sql.Int, remId)
            .query(`SELECT RemId, Estado, DepOrigenId, DepDestinoId
                    FROM dbo.Wms_RemitosInternos WITH (UPDLOCK, ROWLOCK) WHERE RemId = @R`);
        if (!rRem.recordset.length) throw new Error(`El remito ${remId} no existe`);
        const rem = rRem.recordset[0];
        if (rem.Estado === 'CANCELADO') { await tran.rollback(); return { ok: true, yaCancelado: true, devueltos: [] }; }
        if (rem.Estado !== 'EN_TRANSITO') throw new Error(`Solo se puede cancelar un remito en tránsito (está ${rem.Estado})`);

        const rIts = await new sql.Request(tran).input('R', sql.Int, remId)
            .query(`SELECT RemItId, VarId, CantidadEnviada, ISNULL(CantidadRecibida, 0) AS CantidadRecibida
                    FROM dbo.Wms_RemitosInternosItems WITH (UPDLOCK, ROWLOCK)
                    WHERE RemId = @R AND Estado = 'PENDIENTE'`);

        const devueltos = [];
        for (const it of rIts.recordset) {
            const vuelve = Number(it.CantidadEnviada) - Number(it.CantidadRecibida);
            if (!(vuelve > 0.0001)) continue;
            const rEti = await new sql.Request(tran)
                .input('V', sql.Int, it.VarId).input('D', sql.Int, rem.DepOrigenId)
                .input('C', sql.Decimal(18, 4), vuelve)
                .input('R', sql.Int, remId).input('Usr', sql.Int, usuarioId)
                .query(`
                    DECLARE @Id INT = (SELECT ISNULL(MAX(EtiId), 0) + 1 FROM dbo.Wms_Etiquetas WITH (UPDLOCK, HOLDLOCK));
                    INSERT INTO dbo.Wms_Etiquetas (EtiId, VarId, DepId, CantidadInicial, CantidadActual, Estado, UsuarioIngreso)
                    VALUES (@Id, @V, @D, @C, @C, 'activo', @Usr);
                    INSERT INTO dbo.Wms_Movimientos (EtiId, Tipo, Cantidad, DepDestinoId, RefTipo, RefId, UsuarioId)
                    VALUES (@Id, 'traslado_cancelado', @C, @D, 'REMITO', @R, @Usr);
                    SELECT @Id AS EtiId;
                `);
            await new sql.Request(tran).input('I', sql.Int, it.RemItId)
                .query(`UPDATE dbo.Wms_RemitosInternosItems SET Estado = 'CANCELADO' WHERE RemItId = @I`);
            devueltos.push({ remItId: it.RemItId, varId: it.VarId, cantidad: vuelve, etiId: rEti.recordset[0].EtiId });
        }

        await new sql.Request(tran)
            .input('R', sql.Int, remId)
            .input('M', sql.NVarChar(500), (motivo || '').trim().substring(0, 500) || null)
            .input('Usr', sql.Int, usuarioId)
            .query(`UPDATE dbo.Wms_RemitosInternos
                    SET Estado = 'CANCELADO', MotivoCancelacion = @M, CanceladoPor = @Usr, FechaCancelacion = GETDATE()
                    WHERE RemId = @R`);

        await tran.commit();
        return { ok: true, remId, devueltos };
    } catch (e) {
        try { await tran.rollback(); } catch (_) {}
        throw e;
    }
}

/**
 * Recepción de UN item del remito: crea la etiqueta en el destino (traslado_entrada) y,
 * si era el último pendiente, CIERRA el remito solo (lección del remito zombi de logística:
 * jamás depender de un click final aparte). Diferencia enviado-vs-recibido → discrepancia.
 */
async function recibirRemitoItem({ remItId, cantidadRecibida = null, usuarioId = null }) {
    const pool = await getPool();
    const tran = new sql.Transaction(pool);
    await tran.begin();
    try {
        const rIt = await new sql.Request(tran)
            .input('I', sql.Int, remItId)
            .query(`
                SELECT i.RemItId, i.RemId, i.VarId, i.CantidadEnviada, i.Estado AS EstadoItem,
                       r.DepOrigenId, r.DepDestinoId, r.Estado AS EstadoRemito
                FROM dbo.Wms_RemitosInternosItems i WITH (UPDLOCK, ROWLOCK)
                JOIN dbo.Wms_RemitosInternos r WITH (UPDLOCK, ROWLOCK) ON r.RemId = i.RemId
                WHERE i.RemItId = @I
            `);
        if (!rIt.recordset.length) throw new Error(`Item ${remItId} no existe`);
        const it = rIt.recordset[0];
        if (it.EstadoItem !== 'PENDIENTE') {
            await tran.commit();
            return { ok: true, yaRecibido: true }; // martillar el botón no duplica
        }
        const recibida = cantidadRecibida != null ? parseFloat(cantidadRecibida) : Number(it.CantidadEnviada);
        if (!(recibida >= 0)) throw new Error('Cantidad recibida inválida');

        let etiId = null;
        if (recibida > 0) {
            const rEti = await new sql.Request(tran)
                .input('V', sql.Int, it.VarId).input('D', sql.Int, it.DepDestinoId)
                .input('C', sql.Decimal(18, 4), recibida)
                .input('R', sql.Int, it.RemId).input('Usr', sql.Int, usuarioId)
                .query(`
                    DECLARE @Id INT = (SELECT ISNULL(MAX(EtiId), 0) + 1 FROM dbo.Wms_Etiquetas WITH (UPDLOCK, HOLDLOCK));
                    INSERT INTO dbo.Wms_Etiquetas (EtiId, VarId, DepId, CantidadInicial, CantidadActual, Estado, UsuarioIngreso)
                    VALUES (@Id, @V, @D, @C, @C, 'activo', @Usr);
                    INSERT INTO dbo.Wms_Movimientos (EtiId, Tipo, Cantidad, DepOrigenId, DepDestinoId, RefTipo, RefId, UsuarioId)
                    VALUES (@Id, 'traslado_entrada', @C, ${it.DepOrigenId}, @D, 'REMITO', @R, @Usr);
                    SELECT @Id AS EtiId;
                `);
            etiId = rEti.recordset[0].EtiId;
        }

        const perdida = Number(it.CantidadEnviada) - recibida;
        if (perdida > 0.0001) {
            await new sql.Request(tran)
                .input('V', sql.Int, it.VarId).input('D', sql.Int, it.DepDestinoId)
                .input('F', sql.Decimal(18, 4), perdida)
                .input('R', sql.Int, it.RemId)
                .query(`INSERT INTO dbo.Wms_Discrepancias (VarId, DepId, Faltante, RefTipo, RefId)
                        VALUES (@V, @D, @F, 'REMITO', @R)`);
        }

        await new sql.Request(tran)
            .input('I', sql.Int, remItId).input('C', sql.Decimal(18, 4), recibida)
            .input('E', sql.Int, etiId)
            .query(`UPDATE dbo.Wms_RemitosInternosItems
                    SET Estado = 'RECIBIDO', CantidadRecibida = @C, EtiGeneradaId = @E
                    WHERE RemItId = @I`);

        // Auto-cierre: el último item recibido cierra el remito, sin paso extra
        await new sql.Request(tran)
            .input('R', sql.Int, it.RemId)
            .query(`UPDATE dbo.Wms_RemitosInternos SET Estado = 'RECIBIDO'
                    WHERE RemId = @R
                      AND NOT EXISTS (SELECT 1 FROM dbo.Wms_RemitosInternosItems WHERE RemId = @R AND Estado = 'PENDIENTE')`);

        await tran.commit();
        return { ok: true, etiId, perdida: perdida > 0.0001 ? perdida : 0 };
    } catch (e) {
        try { await tran.rollback(); } catch (_) {}
        throw e;
    }
}

/**
 * Recepción de una compra: por cada línea con cantidad a recibir crea la etiqueta en el
 * depósito elegido (con el costo puesto local como costo unitario) y suma a CantidadRecibida.
 * Requiere AutorizadoRecepcion = 1 (mismo gate que el sistema anterior).
 * Idempotente por línea: nunca se recibe más de lo pedido; recibir de nuevo lo ya recibido
 * no hace nada. Devuelve las etiquetas creadas (para imprimirlas).
 * lineas: [{ cDetId, cantidad }]
 */
async function recibirCompra({ compId, depId, lineas, usuarioId = null }) {
    const pool = await getPool();
    const tran = new sql.Transaction(pool);
    await tran.begin();
    try {
        const rC = await new sql.Request(tran)
            .input('C', sql.Int, compId)
            .query(`SELECT CompId, AutorizadoRecepcion, Estado, DepRecepcionId FROM dbo.Wms_Compras WITH (UPDLOCK, ROWLOCK) WHERE CompId = @C`);
        if (!rC.recordset.length) throw new Error(`Compra ${compId} no existe`);
        if (!rC.recordset[0].AutorizadoRecepcion) throw new Error('La compra no está autorizada para recepción');
        const dep = parseInt(depId, 10) || rC.recordset[0].DepRecepcionId;
        if (!dep) throw new Error('Falta el depósito de recepción');

        const creadas = [];
        for (const l of lineas || []) {
            const cDetId = parseInt(l.cDetId, 10);
            const pedida = parseFloat(l.cantidad);
            if (!cDetId || !(pedida > 0)) continue;

            const rD = await new sql.Request(tran)
                .input('D', sql.Int, cDetId).input('C', sql.Int, compId)
                .query(`SELECT CDetId, VarId, Cantidad, CantidadRecibida, PrecioUnitario, CostoPuestoLocal, Bultos
                        FROM dbo.Wms_ComprasDetalle WITH (UPDLOCK, ROWLOCK)
                        WHERE CDetId = @D AND CompId = @C`);
            if (!rD.recordset.length) continue;
            const d = rD.recordset[0];
            const pendiente = Number(d.Cantidad) - Number(d.CantidadRecibida);
            const recibir = Math.min(pedida, pendiente);       // nunca más de lo pedido
            if (!(recibir > 0.0001)) continue;

            // 0 no es un costo válido (compras migradas sin prorrateo): cae al precio de la línea
            const costo = Number(d.CostoPuestoLocal) > 0 ? Number(d.CostoPuestoLocal) : Number(d.PrecioUnitario || 0);
            // Una etiqueta por bulto físico: lo que se recibe se reparte en partes iguales.
            // El que recibe puede pisar los bultos declarados en la compra (llegó fraccionado).
            const bultos = Math.max(1, Math.min(200, parseInt(l.bultos, 10) || parseInt(d.Bultos, 10) || 1));
            const porBulto = Math.round((recibir / bultos) * 10000) / 10000;
            const etiquetas = [];
            for (let b = 0; b < bultos; b++) {
                // El último absorbe el resto del redondeo para que la suma cierre exacta
                const cant = b === bultos - 1
                    ? Math.round((recibir - porBulto * (bultos - 1)) * 10000) / 10000
                    : porBulto;
                if (!(cant > 0)) continue;
                const rEti = await new sql.Request(tran)
                    .input('V', sql.Int, d.VarId).input('Dep', sql.Int, dep)
                    .input('C', sql.Decimal(18, 4), cant)
                    .input('Costo', sql.Decimal(18, 2), costo)
                    .input('Comp', sql.Int, compId).input('Usr', sql.Int, usuarioId)
                    .query(`
                        DECLARE @Id INT = (SELECT ISNULL(MAX(EtiId), 0) + 1 FROM dbo.Wms_Etiquetas WITH (UPDLOCK, HOLDLOCK));
                        INSERT INTO dbo.Wms_Etiquetas (EtiId, VarId, DepId, CantidadInicial, CantidadActual, CostoUnitarioReal, CompraId, Estado, UsuarioIngreso)
                        VALUES (@Id, @V, @Dep, @C, @C, @Costo, @Comp, 'activo', @Usr);
                        INSERT INTO dbo.Wms_Movimientos (EtiId, Tipo, Cantidad, DepDestinoId, RefTipo, RefId, UsuarioId)
                        VALUES (@Id, 'ingreso_compra', @C, @Dep, 'COMPRA', @Comp, @Usr);
                        SELECT @Id AS EtiId;
                    `);
                etiquetas.push({ etiId: rEti.recordset[0].EtiId, cantidad: cant });
            }
            const etiId = etiquetas[0]?.etiId || null;

            await new sql.Request(tran)
                .input('D', sql.Int, cDetId).input('C', sql.Decimal(18, 4), recibir)
                .query(`UPDATE dbo.Wms_ComprasDetalle SET CantidadRecibida = CantidadRecibida + @C WHERE CDetId = @D`);

            creadas.push({ cDetId, varId: d.VarId, cantidad: recibir, etiId, etiquetas });
        }

        // Compra totalmente recibida → progreso 'recibido' y estado completada
        await new sql.Request(tran)
            .input('C', sql.Int, compId)
            .query(`
                UPDATE dbo.Wms_Compras
                SET Progreso = 'recibido', Estado = 'completada'
                WHERE CompId = @C
                  AND NOT EXISTS (SELECT 1 FROM dbo.Wms_ComprasDetalle
                                  WHERE CompId = @C AND CantidadRecibida < Cantidad - 0.0001)
            `);

        await tran.commit();
        return { ok: true, etiquetas: creadas };
    } catch (e) {
        try { await tran.rollback(); } catch (_) {}
        throw e;
    }
}

/**
 * Baja manual de una etiqueta: consumo interno, merma, rotura o venta libre.
 * Es un egreso puntual sobre UNA etiqueta (no FIFO): el operario elige el lote que sale.
 */
async function bajaManual({ etiId, cantidad, motivo = 'baja_consumo', nota = null, usuarioId = null }) {
    const pool = await getPool();
    const tran = new sql.Transaction(pool);
    await tran.begin();
    try {
        const r = await new sql.Request(tran).input('E', sql.Int, etiId)
            .query(`SELECT EtiId, DepId, CantidadActual FROM dbo.Wms_Etiquetas WITH (UPDLOCK, ROWLOCK) WHERE EtiId = @E`);
        if (!r.recordset.length) throw new Error(`Etiqueta ${etiId} no existe`);
        const disp = Number(r.recordset[0].CantidadActual);
        const sale = Math.min(parseFloat(cantidad), disp);   // nunca más de lo que hay
        if (!(sale > 0)) throw new Error('Esa etiqueta no tiene stock disponible');
        await new sql.Request(tran)
            .input('E', sql.Int, etiId)
            .input('T', sql.VarChar(50), motivo)
            .input('C', sql.Decimal(18, 4), -sale)
            .input('D', sql.Int, r.recordset[0].DepId)
            .input('U', sql.Int, usuarioId)
            .query(`
                INSERT INTO dbo.Wms_Movimientos (EtiId, Tipo, Cantidad, DepOrigenId, RefTipo, UsuarioId)
                VALUES (@E, @T, @C, @D, 'BAJA', @U);
                UPDATE dbo.Wms_Etiquetas
                SET CantidadActual = CantidadActual - ${sale.toFixed(4)},
                    Estado = CASE WHEN CantidadActual - ${sale.toFixed(4)} <= 0 THEN 'consumido' ELSE Estado END,
                    UltimaActualizacion = GETDATE()
                WHERE EtiId = @E;
            `);
        await tran.commit();
        return { ok: true, salio: sale, parcial: sale < parseFloat(cantidad) };
    } catch (e) {
        try { await tran.rollback(); } catch (_) {}
        throw e;
    }
}

module.exports = {
    egresarVenta, egresarVentaCompat, ingresarEtiqueta, ajustarConteo, getStockPorVariante,
    crearRemito, cancelarRemito, recibirRemitoItem, recibirCompra, bajaManual,
    getMaestros, getMaestro, getVariantesDeMaestro, getCatalogoSync, crearMaestroConVariantes, asegurarColumnasTela,
};
