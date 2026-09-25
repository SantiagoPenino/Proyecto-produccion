const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

// Separador del QR
const SEP = '$*';

/**
 * Reconstruye el QR_String a partir de los campos individuales
 */
function buildQrString(qr) {
    return [qr.QR_Pedido, qr.QR_Cliente, qr.QR_Trabajo, qr.QR_Urgencia, qr.QR_Producto, qr.QR_Cantidad, qr.QR_Importe].join(SEP);
}

/**
 * GET /api/quotation/list?q=XXXX
 * Lista PedidosCobranza para mostrar en la grilla de QuotationView.
 */
exports.listQuotations = async (req, res) => {
    const { q, areaId } = req.query;
    try {
        const pool = await getPool();
        let whereClause = 'WHERE 1=1';
        const request = pool.request();
        if (q) {
            // El código de orden (DTF-20944) NO está en PedidosCobranza: ahí el pedido es
            // '20944'. Se resuelve ANTES, con una igualdad contra Ordenes (barata, usa
            // índice). Hacerlo con un EXISTS + LIKE correlacionado dentro de la lista
            // tarda más de 2 minutos contra la base real — probado.
            let docPorCodigo = null;
            try {
                const ordRes = await pool.request()
                    .input('Cod', sql.NVarChar, String(q).trim())
                    .query(`SELECT TOP 1 LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR(100)))) AS NoDoc
                            FROM dbo.Ordenes WITH(NOLOCK)
                            WHERE LTRIM(RTRIM(CodigoOrden)) = LTRIM(RTRIM(@Cod))`);
                docPorCodigo = ordRes.recordset[0]?.NoDoc || null;
            } catch { docPorCodigo = null; }

            request.input('q', sql.NVarChar, `%${q}%`);
            request.input('docCod', sql.NVarChar, docPorCodigo);
            whereClause += ` AND (LTRIM(RTRIM(PC.NoDocERP)) LIKE @q OR PC.QR_Trabajo LIKE @q
                               OR CL.Nombre LIKE @q
                               OR (@docCod IS NOT NULL AND LTRIM(RTRIM(CAST(PC.NoDocERP AS VARCHAR(100)))) = @docCod))`;
        }
        
        let joinClause = '';
        if (areaId && areaId.toUpperCase() !== 'TODOS' && areaId.toUpperCase() === 'PRO') {
            // [PRENDAS] "Editar Cotización" desde el toolbar de PRO: acá "área PRO" significa
            // "pedidos que PRO tiene que gestionar" (tiene una orden madre PRO real), NO
            // "pedidos con una línea facturable tagueada AreaID='PRO'". Desde que solo se
            // insertan líneas facturables (sección 36 de specs/39), un pedido en modo "Por
            // área" NUNCA tiene línea propia de PRO (la orden PRO cotiza $0 a propósito, cada
            // componente cobra la suya) — con el filtro viejo, ESE pedido desaparecía de esta
            // lista aunque tuviera una línea real y facturable en otra área. Pasó en vivo con
            // el pedido 20938.
            joinClause = `
                INNER JOIN (
                    SELECT DISTINCT LTRIM(RTRIM(NoDocERP)) AS NoDocERP
                    FROM Ordenes
                    WHERE AreaID = 'PRO' AND ComboItemID IS NULL
                      AND ISNULL(EstadoDependencia, '') <> 'VENTA_DIRECTA'
                ) FILTER ON FILTER.NoDocERP = LTRIM(RTRIM(PC.NoDocERP))
            `;
        } else if (areaId && areaId.toUpperCase() !== 'TODOS') {
            request.input('areaId', sql.NVarChar, areaId);
            joinClause = `
                INNER JOIN (
                    SELECT DISTINCT PCD.PedidoCobranzaID
                    FROM PedidosCobranzaDetalle PCD
                    LEFT JOIN Ordenes O ON PCD.OrdenID = O.OrdenID
                    WHERE ISNULL(LTRIM(RTRIM(O.AreaID)), '') = LTRIM(RTRIM(@areaId))
                ) FILTER ON FILTER.PedidoCobranzaID = PC.ID
            `;
        }

        const result = await request.query(`
            SELECT TOP 100 PC.ID, PC.NoDocERP, PC.ClienteID, PC.MontoTotal, PC.Moneda,
                   PC.QR_Pedido, PC.QR_Trabajo, PC.QR_String, PC.FechaGeneracion, PC.EstadoCobro,
                   LTRIM(RTRIM(ISNULL(CL.Nombre, ''))) AS Cliente
            FROM PedidosCobranza PC
            LEFT JOIN Clientes CL ON CL.CliIdCliente = PC.ClienteID
            ${joinClause}
            ${whereClause}
            ORDER BY PC.FechaGeneracion DESC
        `);

        // Áreas de cada pedido (para saber de quién es la cotización sin abrirla). Va en una
        // segunda consulta por los NoDocERP que ya salieron, no como subconsulta por fila.
        const filas = result.recordset;
        const docs = [...new Set(filas.map(r2 => String(r2.NoDocERP || '').trim()).filter(Boolean))];
        if (docs.length) {
            try {
                const reqAreas = pool.request();
                const ph = docs.map((d, i) => { reqAreas.input('d' + i, sql.NVarChar, d); return '@d' + i; }).join(',');
                const areasRes = await reqAreas.query(`
                    SELECT LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR(100)))) AS NoDoc, LTRIM(RTRIM(AreaID)) AS Area
                    FROM dbo.Ordenes WITH(NOLOCK)
                    WHERE LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR(100)))) IN (${ph})
                      AND ISNULL(LTRIM(RTRIM(AreaID)), '') <> ''
                    GROUP BY LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR(100)))), LTRIM(RTRIM(AreaID))`);
                const porDoc = {};
                for (const a of areasRes.recordset) (porDoc[a.NoDoc] = porDoc[a.NoDoc] || []).push(a.Area);
                for (const fila of filas) fila.Areas = porDoc[String(fila.NoDocERP || '').trim()] || [];
            } catch (areasErr) {
                logger.warn('[Quotation] No se pudieron resolver las áreas de la lista: ' + areasErr.message);
            }
        }

        res.json(filas);
    } catch (err) {
        logger.error('[Quotation] Error al listar cotizaciones:', err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * GET /api/quotation/:noDocERP
 * Carga PedidosCobranza + detalle con área de cada línea.
 */
exports.getQuotation = async (req, res) => {
    const { noDocERP } = req.params;
    try {
        const pool = await getPool();

        // Búsqueda directa por NoDocERP
        let cabRes = await pool.request()
            .input('Doc', sql.NVarChar, noDocERP)
            .query(`SELECT * FROM PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@Doc))`);

        // Fallback 1: strip 3-letter prefix (portal orders saved as plain number e.g. '194')
        if (cabRes.recordset.length === 0) {
            const stripped = noDocERP.replace(/^[a-zA-Z]{3}-/i, '').trim();
            if (stripped && stripped !== noDocERP.trim()) {
                cabRes = await pool.request()
                    .input('Doc2', sql.NVarChar, stripped)
                    .query(`SELECT * FROM PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@Doc2))`);
            }
        }

        // Fallback 2: look up via Ordenes.CodigoOrden → NoDocERP → PedidosCobranza
        if (cabRes.recordset.length === 0) {
            const ordRes = await pool.request()
                .input('Cod', sql.NVarChar, noDocERP)
                .query(`SELECT TOP 1 NoDocERP FROM Ordenes WITH(NOLOCK)
                        WHERE LTRIM(RTRIM(CodigoOrden)) = LTRIM(RTRIM(@Cod))
                           OR LTRIM(RTRIM(CodigoOrden)) LIKE LTRIM(RTRIM(@Cod)) + ' %'`);
            if (ordRes.recordset.length > 0 && ordRes.recordset[0].NoDocERP) {
                const realDoc = ordRes.recordset[0].NoDocERP.trim();
                cabRes = await pool.request()
                    .input('Doc3', sql.NVarChar, realDoc)
                    .query(`SELECT * FROM PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@Doc3))`);
            }
        }

        if (cabRes.recordset.length === 0) {
            return res.status(404).json({ error: `No se encontró cotización para ${noDocERP}` });
        }
        const cabecera = cabRes.recordset[0];

        // [PRENDAS] Modo de facturación del pedido: vive como marcador de texto en la Nota
        // de la orden madre PRO (sin ComboItemID — ver erpSyncService.js). Se expone acá
        // para poder mostrarlo/editarlo; si el pedido no tiene madre PRO, queda null (no
        // aplica — un pedido normal no tiene "modo", cotiza orden por orden).
        const proMadreRes = await pool.request()
            .input('Doc', sql.NVarChar, cabecera.NoDocERP)
            .query(`SELECT TOP 1 OrdenID, Nota FROM Ordenes WITH(NOLOCK)
                    WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@Doc)) AND AreaID = 'PRO' AND ComboItemID IS NULL`);
        const proMadre = proMadreRes.recordset[0] || null;
        let modoFacturacion = null;
        let precioEstablecidoMonto = null, precioEstablecidoMoneda = null;
        if (proMadre) {
            const nota = String(proMadre.Nota || '');
            const mEst = nota.match(/\[PRECIO ESTABLECIDO:\s*([\d]+(?:[.,]\d+)?)\s*(UYU|USD)?\]/i);
            if (mEst) {
                modoFacturacion = 'PRECIO_ESTABLECIDO';
                precioEstablecidoMonto = parseFloat(mEst[1].replace(',', '.'));
                precioEstablecidoMoneda = (mEst[2] || 'UYU').toUpperCase();
            } else if (/\[FACTURA POR AREA\]/i.test(nota)) {
                modoFacturacion = 'POR_AREA';
            } else {
                modoFacturacion = 'CONSOLIDADO';
            }
        }

        // Detalle con área de cada línea (via Ordenes.AreaID y ConfigMapeoERP.AreaID_Interno)
        const detRes = await pool.request()
            .input('PID', sql.Int, cabecera.ID)
            .query(`
                SELECT
                    PCD.ID,
                    PCD.OrdenID,
                    A.CodArticulo as CodArticulo,
                    PCD.Cantidad,
                    PCD.DatoTecnico,
                    PCD.PrecioUnitario,
                    PCD.Subtotal,
                    PCD.LogPrecioAplicado,
                    PCD.Moneda,
                    PCD.PerfilAplicado,
                    PCD.PricingTrace,
                    PCD.MonedaOriginal,
                    PCD.PrecioUnitarioOriginal,
                    PCD.SubtotalOriginal,
                    PCD.ProIdProducto,
                    PCD.EsHermanaConsolidada,
                    ISNULL(PCD.EsFacturable, 1) AS EsFacturable,
                    -- Desglose congelado (lista / descuento / recargo): la pantalla lo muestra y
                    -- lo devuelve tal cual al guardar; sin estas columnas guardaba NULL y lo borraba.
                    PCD.PrecioLista, PCD.DescuentoTipo, PCD.DescuentoPct, PCD.DescuentoImporte, PCD.DescuentoOrigen,
                    PCD.DescuentoPerfilId, PCD.DescuentoReglaId, PCD.RecargoPct, PCD.RecargoImporte, PCD.RecargoOrigen,
                    PCD.DesgloseJSON,
                    O.CodigoOrden,
                    O.DescripcionTrabajo,
                    O.AreaID,
                    O.Prioridad,
                    ISNULL(CME.AreaID_Interno, O.AreaID) as AreaIDInterna,
                    ISNULL(A.Descripcion, A.CodArticulo) as NombreArticulo,
                    -- [COMBOS] Distingue la PRO "de precio" (NULL) de las PRO "de retiro" por
                    -- componente (con ComboItemID) — ver QuotationEditModal.jsx, que antes
                    -- tomaba "la primera línea de área PRO" sin saber que puede haber varias.
                    O.ComboItemID,
                    -- [PRENDAS] El material de esta línea ya llegó a depósito (existe fila en
                    -- OrdenesDeposito para su orden) → cambiar el PRODUCTO ahora mentiría sobre
                    -- qué es lo que físicamente está ahí. Cantidad/precio/moneda siguen editables
                    -- (son términos comerciales, no descripción del material).
                    CASE WHEN EXISTS (
                        SELECT 1 FROM dbo.OrdenesDeposito OD WITH(NOLOCK)
                        WHERE OD.OrdCodigoOrden = O.CodigoOrden
                    ) THEN 1 ELSE 0 END AS EnDeposito
                FROM PedidosCobranzaDetalle PCD
                LEFT JOIN Ordenes O WITH(NOLOCK) ON PCD.OrdenID = O.OrdenID
                LEFT JOIN Articulos A WITH(NOLOCK) ON A.ProIdProducto = PCD.ProIdProducto
                LEFT JOIN ConfigMapeoERP CME WITH(NOLOCK) ON LTRIM(RTRIM(CME.AreaID_Interno)) = LTRIM(RTRIM(O.AreaID))
                WHERE PCD.PedidoCobranzaID = @PID
                ORDER BY PCD.ID ASC
            `);

        res.json({
            cabecera, detalle: detRes.recordset,
            modoFacturacion, precioEstablecidoMonto, precioEstablecidoMoneda,
            tieneOrdenMadrePro: !!proMadre,
        });
    } catch (err) {
        logger.error('[Quotation] Error al cargar cotización:', err);
        res.status(500).json({ error: err.message });
    }
};

// ─── Desglose de una línea que vuelve de la pantalla de cotización ───────────
// La pantalla devuelve las columnas del desglose tal cual salieron de la base o del
// motor (/prices/calculate → desglose). Si el usuario tipeó el precio a mano, la LISTA se
// conserva y la diferencia queda como descuento o recargo MANUAL, así la línea sigue
// cumpliendo lista − descuento + recargo = PrecioUnitario (a 2 decimales).
const r4q = n => Math.round((Number(n || 0) + Number.EPSILON) * 10000) / 10000;
const numOrNull = v => (v == null || v === '' || isNaN(Number(v))) ? null : r4q(v);
function normalizarDesgloseLinea(linea, pu) {
    const esManual = /Edici[oó]n manual|Agregado manualmente/i.test(String(linea.PricingTrace || ''));
    let dg = null;
    if (linea.DesgloseJSON) {
        try { dg = typeof linea.DesgloseJSON === 'string' ? JSON.parse(linea.DesgloseJSON) : linea.DesgloseJSON; } catch { dg = null; }
    }
    let lista = numOrNull(linea.PrecioLista);
    if (lista == null && dg && dg.precioLista != null) lista = r4q(dg.precioLista);
    const out = {
        PrecioLista: lista,
        DescuentoTipo: linea.DescuentoTipo || null,
        DescuentoPct: numOrNull(linea.DescuentoPct),
        DescuentoImporte: numOrNull(linea.DescuentoImporte),
        DescuentoOrigen: linea.DescuentoOrigen ? String(linea.DescuentoOrigen).substring(0, 150) : null,
        DescuentoPerfilId: linea.DescuentoPerfilId != null && linea.DescuentoPerfilId !== '' ? (parseInt(linea.DescuentoPerfilId, 10) || null) : null,
        DescuentoReglaId: linea.DescuentoReglaId != null && linea.DescuentoReglaId !== '' ? (parseInt(linea.DescuentoReglaId, 10) || null) : null,
        RecargoPct: numOrNull(linea.RecargoPct),
        RecargoImporte: numOrNull(linea.RecargoImporte),
        RecargoOrigen: linea.RecargoOrigen ? String(linea.RecargoOrigen).substring(0, 200) : null,
        DesgloseJSON: dg ? JSON.stringify(dg) : null
    };
    if (!['PCT', 'IMPORTE', 'FIJO', 'MANUAL'].includes(out.DescuentoTipo)) out.DescuentoTipo = null;
    if (lista == null && !esManual) return out;   // pedido anterior al desglose: lo completa el backfill
    const pu2 = Math.round((Number(pu || 0) + Number.EPSILON) * 100) / 100;
    // "lista manual": la lista ES el precio tipeado (línea sin catálogo). Marcada en el JSON
    // para que retipear el precio mueva la lista y no genere descuento ni recargo fantasma.
    const listaManual = !!(dg && dg.listaManual);
    if (!(lista > 0) || (listaManual && esManual)) {
        // Sin lista real (línea sin catálogo, base 0): no hay desglose que mantener. Un precio
        // tipeado es su propia lista, sin descuento ni recargo (antes quedaba lista 0 + recargo
        // manual por el total, y al retipear el precio aparecía un "descuento" fantasma).
        return { ...out, PrecioLista: pu2 > 0 ? r4q(pu2) : null, DescuentoTipo: null, DescuentoPct: null, DescuentoImporte: null, DescuentoOrigen: null,
                 DescuentoPerfilId: null, DescuentoReglaId: null, RecargoPct: null, RecargoImporte: null, RecargoOrigen: null,
                 DesgloseJSON: pu2 > 0 ? JSON.stringify({ listaManual: true }) : null };
    }
    const rec = out.RecargoImporte || 0;
    const diff = r4q(lista + rec - pu2);
    if (esManual) {
        if (Math.abs(diff) < 0.00005) {
            out.DescuentoTipo = null; out.DescuentoPct = null; out.DescuentoImporte = null; out.DescuentoOrigen = null;
            out.DescuentoPerfilId = null; out.DescuentoReglaId = null;
        } else if (diff > 0) {
            out.DescuentoTipo = 'MANUAL'; out.DescuentoPct = null; out.DescuentoImporte = diff;
            out.DescuentoOrigen = 'Ajuste manual en la cotización'; out.DescuentoPerfilId = null; out.DescuentoReglaId = null;
        } else {
            out.DescuentoTipo = null; out.DescuentoPct = null; out.DescuentoImporte = null; out.DescuentoOrigen = null;
            out.DescuentoPerfilId = null; out.DescuentoReglaId = null;
            out.RecargoImporte = r4q(rec - diff); out.RecargoPct = null; out.RecargoOrigen = 'Ajuste manual en la cotización';
        }
    } else if (out.DescuentoTipo && diff >= 0) {
        out.DescuentoImporte = diff;   // el importe del descuento absorbe el redondeo
    }
    return out;
}

// ─── Detecta si alguna de las órdenes ya avanzó de estado (entregada/facturada/
// cobrada), para pedir confirmación antes de tocar su cotización sin avisar.
async function detectarEstadosSensibles(pool, ordenIds) {
    const advertencias = [];
    if (!ordenIds.length) return advertencias;

    const request = pool.request();
    const placeholders = ordenIds.map((id, i) => { request.input(`id${i}`, sql.Int, id); return `@id${i}`; }).join(',');
    const result = await request.query(`
        SELECT o.OrdenID, o.CodigoOrden,
               od.OrdEstadoActual,
               CASE WHEN od.PagIdPago IS NOT NULL THEN 1 ELSE 0 END AS Pagada,
               (SELECT TOP 1 CASE WHEN mc.DocIdDocumento IS NOT NULL THEN 1 ELSE 0 END
                FROM dbo.MovimientosCuenta mc WITH(NOLOCK)
                WHERE mc.OrdIdOrden = od.OrdIdOrden AND mc.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
                  AND (mc.MovAnulado IS NULL OR mc.MovAnulado = 0)
                ORDER BY mc.MovIdMovimiento DESC) AS Facturada,
               (SELECT TOP 1 dd.DDeEstado FROM dbo.DeudaDocumento dd WITH(NOLOCK)
                WHERE dd.OrdIdOrden = od.OrdIdOrden ORDER BY dd.DDeIdDeuda DESC) AS EstadoDeuda
        FROM dbo.Ordenes o WITH(NOLOCK)
        LEFT JOIN dbo.OrdenesDeposito od WITH(NOLOCK) ON od.OrdCodigoOrden = o.CodigoOrden
        WHERE o.OrdenID IN (${placeholders})
    `);

    for (const row of result.recordset) {
        const codigo = row.CodigoOrden || `Orden ${row.OrdenID}`;
        if (row.OrdEstadoActual === 9) {
            advertencias.push({ ordenID: row.OrdenID, codigo, tipo: 'ENTREGADA', mensaje: `${codigo} ya fue entregada en depósito.` });
        }
        if (row.Facturada === 1) {
            advertencias.push({ ordenID: row.OrdenID, codigo, tipo: 'FACTURADA', mensaje: `${codigo} ya fue facturada/enviada a DGI.` });
        }
        if (row.EstadoDeuda === 'COBRADO' || row.Pagada === 1) {
            advertencias.push({ ordenID: row.OrdenID, codigo, tipo: 'COBRADA', mensaje: `${codigo} ya fue cobrada.` });
        }
    }
    return advertencias;
}

// ─── Propaga el nuevo total de cotización a OrdenesDeposito y, si corresponde,
// a MovimientosCuenta/CuentasCliente/DeudaDocumento/CiclosCredito/OrdenesRetiro —
// mismo patrón que editarCostoOrden en ordenesRetiroController.js. Sólo actúa
// sobre órdenes que YA tienen fila en OrdenesDeposito (las que no, se resuelven
// solas cuando lleguen a depósito) y que TODAVÍA NO ESTÁN FACTURADAS (una vez
// facturada, el precio que vale es el del documento: no se toca).
// Devuelve { actualizadas, salteadas, detalle } para poder contarlo en la respuesta.
async function propagarCotizacionADeposito(pool, { pedidoId, monedaFinal, cotizacion }) {
    const nuevaMonedaId = monedaFinal === 'USD' ? 2 : 1;
    const resumen = { actualizadas: 0, salteadas: 0, detalle: [] };

    const detRes = await pool.request()
        .input('PID', sql.Int, pedidoId)
        .input('MFinal', sql.VarChar(10), monedaFinal)
        .input('Cotiz', sql.Decimal(18, 4), parseFloat(cotizacion) || 40)
        .query(`
            SELECT OrdenID,
                   SUM(CASE
                        WHEN @MFinal = 'USD' AND Moneda = 'UYU' THEN Subtotal / @Cotiz
                        WHEN @MFinal = 'UYU' AND Moneda = 'USD' THEN Subtotal * @Cotiz
                        ELSE Subtotal
                   END) AS TotalOrden,
                   SUM(Cantidad) AS CantidadOrden
            FROM dbo.PedidosCobranzaDetalle
            WHERE PedidoCobranzaID = @PID AND OrdenID IS NOT NULL
            GROUP BY OrdenID
        `);

    for (const fila of detRes.recordset) {
        const ordenIdErp = fila.OrdenID;
        const nuevoCosto = parseFloat(fila.TotalOrden) || 0;
        const nuevaCantidad = parseFloat(fila.CantidadOrden) || 0;

        const transaction = new sql.Transaction(pool);
        try {
            await transaction.begin();

            const codRes = await new sql.Request(transaction)
                .input('OID', sql.Int, ordenIdErp)
                .query(`SELECT CodigoOrden FROM dbo.Ordenes WHERE OrdenID = @OID`);
            const codigoOrden = codRes.recordset[0]?.CodigoOrden;
            if (!codigoOrden) { await transaction.rollback(); continue; }

            const depRes = await new sql.Request(transaction)
                .input('Cod', sql.NVarChar, codigoOrden)
                .query(`SELECT OrdIdOrden, OrdCostoFinal, OReIdOrdenRetiro, OrdEstadoActual, PagIdPago FROM dbo.OrdenesDeposito WHERE OrdCodigoOrden = @Cod`);
            if (!depRes.recordset.length) { // aún no llegó a depósito
                await transaction.rollback();
                resumen.salteadas++;
                resumen.detalle.push({ codigoOrden, motivo: 'SIN_DEPOSITO' });
                continue;
            }

            const dep = depRes.recordset[0];
            const orderId = dep.OrdIdOrden;

            // ── FACTURADA = no se toca ────────────────────────────────────────────
            // El movimiento de la orden atado a un documento (DocIdDocumento IS NOT NULL)
            // es el mismo criterio de "ya fue facturada" que usa el resto del sistema
            // (detectarEstadosSensibles acá arriba, contabilidadController). Con factura
            // emitida el precio bueno es el del CFE: cambiar el de depósito dejaría a
            // caja cobrando una cosa y a la DGI declarada otra. Fix 14-sep-2026: buscar por
            // los dos IDs (misma dualidad de MovimientosCuenta.OrdIdOrden que el resto de
            // esta función) — antes podía no encontrar la factura real y dejar pasar el
            // cambio de precio sobre una orden YA facturada.
            const factRes = await new sql.Request(transaction)
                .input('OrdId', sql.Int, orderId).input('OrdIdErp', sql.Int, ordenIdErp)
                .query(`
                    SELECT TOP 1 DocIdDocumento FROM dbo.MovimientosCuenta
                    WHERE OrdIdOrden IN (@OrdId, @OrdIdErp) AND MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
                      AND (MovAnulado IS NULL OR MovAnulado=0) AND DocIdDocumento IS NOT NULL
                `);
            if (factRes.recordset.length) {
                await transaction.rollback();
                resumen.salteadas++;
                resumen.detalle.push({ codigoOrden, motivo: 'FACTURADA' });
                logger.info(`[Quotation] ${codigoOrden}: ya facturada (documento ${factRes.recordset[0].DocIdDocumento}) — no se toca el precio en depósito.`);
                continue;
            }

            // ── ENTREGADA o COBRADA = tampoco se toca ─────────────────────────────
            // [PRENDAS] Fix 14-sep-2026: mismo criterio que detectarEstadosSensibles (acá
            // arriba) — pero ESE solo protegía si el caller pedía propagarADeposito=true
            // (la pantalla vieja de Administración de Órdenes); esta función corre SIEMPRE
            // al guardar cualquier cotización y no tenía ningún freno para una orden que el
            // cliente ya retiró o ya pagó. Cambiar el precio de algo que la persona ya tiene
            // en la mano, sin avisar, no tiene sentido — se salta, igual que "facturada".
            if (dep.OrdEstadoActual === 9) {
                await transaction.rollback();
                resumen.salteadas++;
                resumen.detalle.push({ codigoOrden, motivo: 'ENTREGADA' });
                logger.info(`[Quotation] ${codigoOrden}: ya fue entregada — no se toca el precio.`);
                continue;
            }
            if (dep.PagIdPago) {
                await transaction.rollback();
                resumen.salteadas++;
                resumen.detalle.push({ codigoOrden, motivo: 'COBRADA' });
                logger.info(`[Quotation] ${codigoOrden}: ya fue cobrada (pago #${dep.PagIdPago}) — no se toca el precio.`);
                continue;
            }

            const costoAnterior = parseFloat(dep.OrdCostoFinal) || 0;
            const delta = nuevoCosto - costoAnterior;

            await new sql.Request(transaction)
                .input('OrderId', sql.Int, orderId)
                .input('Costo', sql.Decimal(18, 2), nuevoCosto)
                .input('Cantidad', sql.Decimal(18, 4), nuevaCantidad || 1)
                .input('Moneda', sql.Int, nuevaMonedaId)
                .query(`UPDATE dbo.OrdenesDeposito SET OrdCostoFinal=@Costo, OrdCantidad=@Cantidad, MonIdMoneda=@Moneda WHERE OrdIdOrden=@OrderId`);

            // BILLETERA (F3): si la orden ya fue descontada de una cuenta de la billetera,
            // el helper re-cuadra el consumo (la diferencia vuelve o sale de la cuenta y el
            // resto sigue el camino normal). En ese caso el ajuste legacy de abajo NO corre.
            const resyncBilletera = await require('../services/contabilidadService').resincronizarConsumosBilletera(
                { OrdIdOrden: orderId, UsuarioAlta: 70, motivo: 'nueva cotización del pedido' }, transaction);
            if (resyncBilletera?.mensaje) logger.info(`[Quotation] ${codigoOrden}: ${resyncBilletera.mensaje}`);

            // [PRENDAS] Fix 14-sep-2026: MovimientosCuenta.OrdIdOrden puede apuntar a
            // OrdenesDeposito.OrdIdOrden (orderId) O a Ordenes.OrdenID (ordenIdErp) según
            // quién haya creado el movimiento — receiveDispatch (la recepción normal de un
            // remito) lo crea con el ID de Ordenes, no el de OrdenesDeposito. Buscar solo por
            // orderId dejaba este bloque sin encontrar NUNCA el movimiento real de una orden
            // recién recibida — el ajuste de cuenta/deuda no corría, en silencio, mientras
            // OrdenesDeposito sí quedaba actualizado (bug real, visto en vivo con el 20938).
            // Mismo criterio que ya usa resincronizarConsumosBilletera (conIds) y el checkout
            // del portal (webOrdersController.cubrirConBilletera).
            const movRes = resyncBilletera ? { recordset: [] } : await new sql.Request(transaction)
                .input('OrdId', sql.Int, orderId)
                .input('OrdIdErp', sql.Int, ordenIdErp)
                .query(`
                    SELECT TOP 1 m.MovIdMovimiento, m.CueIdCuenta, m.CicIdCiclo, cc.MonIdMoneda AS CuentaMonId, cc.CliIdCliente
                    FROM dbo.MovimientosCuenta m
                    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
                    WHERE m.OrdIdOrden IN (@OrdId, @OrdIdErp) AND m.MovTipo='ORDEN' AND (m.MovAnulado IS NULL OR m.MovAnulado=0) AND m.DocIdDocumento IS NULL
                `);
            if (movRes.recordset.length) {
                const mov = movRes.recordset[0];
                const monedaCuentaActual = Number(mov.CuentaMonId) === 2 ? 2 : 1;
                const contabilidadSvc = require('../services/contabilidadService');

                if (monedaCuentaActual !== nuevaMonedaId) {
                    // [PRENDAS] Fix 14-sep-2026: la cotización cambió de moneda (ej. Por área en
                    // pesos → Consolidado en dólares) — el número de `nuevoCosto` YA está en la
                    // moneda nueva, así que pisarlo tal cual en la cuenta VIEJA (que sigue en la
                    // otra moneda) deja un valor mentiroso ahí (ej. "1.68" en una cuenta de pesos,
                    // cuando en realidad son 1.68 DÓLARES) — cualquiera que después convierta ESE
                    // número lo hace mal (pasó en vivo: se intentó cubrir con una billetera y
                    // dividió por la cotización de nuevo, un cargo de USD 1.68 se cubrió con
                    // apenas USD 0.04). "Borrón y cuenta nueva": se anula el movimiento en la
                    // cuenta vieja (revierte su saldo solo) y se recrea entero en la cuenta de la
                    // moneda correcta — no se deja un resto convertido a mano en la vieja.
                    await contabilidadSvc.anularMovimiento(
                        mov.MovIdMovimiento,
                        `Cotización cambió de moneda (${monedaCuentaActual === 2 ? 'USD' : 'UYU'} → ${nuevaMonedaId === 2 ? 'USD' : 'UYU'}) — se recrea en la cuenta correcta`,
                        transaction
                    );
                    const cueTipoNueva = nuevaMonedaId === 2 ? 'DINERO_USD' : 'DINERO_UYU';
                    const nuevaCueId = await contabilidadSvc.obtenerOCrearCuenta(
                        mov.CliIdCliente, cueTipoNueva, { MonIdMoneda: nuevaMonedaId, CPaIdCondicion: 1, UsuarioAlta: 70 }, transaction
                    );
                    const nuevoMov = await contabilidadSvc.registrarMovimiento({
                        CueIdCuenta: nuevaCueId, MovTipo: 'ORDEN',
                        MovConcepto: `${codigoOrden} — recreado por cambio de moneda de la cotización`,
                        MovImporte: -nuevoCosto, MovUsuarioAlta: 70,
                        OrdIdOrden: ordenIdErp,
                    }, transaction);

                    // Mismo cuidado que crearDeudaDocumento: si ya hubo pagos parciales contra
                    // la deuda vieja, no se pisa a ciegas — se deja para revisión manual.
                    const deudaViejaRes = await new sql.Request(transaction)
                        .input('OrdId', sql.Int, orderId).input('OrdIdErp', sql.Int, ordenIdErp)
                        .query(`
                            SELECT TOP 1 DDeIdDocumento, DDeImporteOriginal, DDeImportePendiente FROM dbo.DeudaDocumento
                            WHERE OrdIdOrden IN (@OrdId, @OrdIdErp) AND DDeEstado NOT IN ('CANCELADA','COBRADO')
                        `);
                    const deudaVieja = deudaViejaRes.recordset[0];
                    const tuvoPagos = deudaVieja && Number(deudaVieja.DDeImportePendiente) < Number(deudaVieja.DDeImporteOriginal) - 0.01;
                    if (deudaVieja && !tuvoPagos) {
                        await new sql.Request(transaction)
                            .input('DDeId', sql.Int, deudaVieja.DDeIdDocumento)
                            .input('CueNueva', sql.Int, nuevaCueId)
                            .input('Pend', sql.Decimal(18, 4), Math.max(0, nuevoCosto))
                            .query(`
                                UPDATE dbo.DeudaDocumento
                                SET CueIdCuenta = @CueNueva, DDeImporteOriginal = @Pend, DDeImportePendiente = @Pend
                                WHERE DDeIdDocumento = @DDeId
                            `);
                    } else if (deudaVieja && tuvoPagos) {
                        logger.warn(`[Quotation] ${codigoOrden}: la deuda #${deudaVieja.DDeIdDocumento} ya tenía pagos parciales — no se movió a la cuenta nueva, revisar a mano.`);
                    } else if (nuevoCosto > 0.01) {
                        await contabilidadSvc.crearDeudaDocumento(
                            { CueIdCuenta: nuevaCueId, OrdIdOrden: ordenIdErp, Importe: nuevoCosto, ImportePendiente: nuevoCosto }, transaction
                        );
                    }
                    logger.info(`[Quotation] ${codigoOrden}: movimiento recreado en cuenta ${nuevaCueId} (${cueTipoNueva}) por cambio de moneda — MovId ${mov.MovIdMovimiento} anulado, MovId ${nuevoMov.MovIdGenerado} nuevo.`);
                } else {
                    await new sql.Request(transaction)
                        .input('MovId', sql.Int, mov.MovIdMovimiento).input('Imp', sql.Decimal(18, 4), -nuevoCosto)
                        .query(`UPDATE dbo.MovimientosCuenta SET MovImporte=@Imp WHERE MovIdMovimiento=@MovId`);
                    // [PRENDAS] Fix 14-sep-2026: ORDEN/ORDEN_ANTICIPO NO mueven CueSaldoActual
                    // (mismo criterio que SP_RegistrarMovimiento, 05-09-2026 — "se cobran al
                    // facturar; si se restan acá Y otra vez al facturar, la deuda se cuenta dos
                    // veces"). Ajustarlo acá dejaba un crédito fantasma en la cuenta cada vez
                    // que se editaba el precio, sin que el cliente pagara nada (visto en vivo).
                    // Misma dualidad de ID que MovimientosCuenta — DeudaDocumento.OrdIdOrden
                    // también puede estar en cualquiera de los dos.
                    await new sql.Request(transaction)
                        .input('OrdId', sql.Int, orderId).input('OrdIdErp', sql.Int, ordenIdErp).input('Delta', sql.Decimal(18, 4), delta)
                        .query(`
                            UPDATE dbo.DeudaDocumento
                            SET DDeImportePendiente = CASE WHEN DDeImportePendiente+@Delta<=0 THEN 0 ELSE DDeImportePendiente+@Delta END,
                                DDeEstado = CASE WHEN DDeImportePendiente+@Delta<=0 THEN 'COBRADO' ELSE DDeEstado END
                            WHERE OrdIdOrden IN (@OrdId, @OrdIdErp) AND DDeEstado NOT IN ('CANCELADA','COBRADO')
                        `);
                    if (mov.CicIdCiclo) {
                        await new sql.Request(transaction).input('CicId', sql.Int, mov.CicIdCiclo).query(`
                            UPDATE c SET c.CicTotalOrdenes = ISNULL((
                                SELECT SUM(ABS(MovImporte)) FROM dbo.MovimientosCuenta
                                WHERE CicIdCiclo=c.CicIdCiclo AND MovTipo IN ('ORDEN','ENTREGA','ORDEN_ANTICIPO') AND (MovAnulado IS NULL OR MovAnulado=0)
                            ), 0)
                            FROM dbo.CiclosCredito c WHERE c.CicIdCiclo=@CicId
                        `);
                    }
                }
            }

            if (dep.OReIdOrdenRetiro) {
                await new sql.Request(transaction).input('RetiroId', sql.Int, dep.OReIdOrdenRetiro).query(`
                    UPDATE dbo.OrdenesRetiro
                    SET OReCostoTotalOrden = (SELECT SUM(OrdCostoFinal) FROM dbo.OrdenesDeposito WHERE OReIdOrdenRetiro=@RetiroId)
                    WHERE OReIdOrdenRetiro=@RetiroId
                `);
            }

            await transaction.commit();
            resumen.actualizadas++;
            resumen.detalle.push({ codigoOrden, motivo: 'ACTUALIZADA', costoAnterior, nuevoCosto });
            logger.info(`[Quotation] Propagado a depósito: orden ${codigoOrden} costo ${costoAnterior} -> ${nuevoCosto}`);
        } catch (e) {
            try { await transaction.rollback(); } catch {}
            resumen.salteadas++;
            resumen.detalle.push({ codigoOrden: null, motivo: 'ERROR', error: e.message });
            logger.warn(`[Quotation] No se pudo propagar a depósito para OrdenID=${ordenIdErp}: ${e.message}`);
        }
    }
    return resumen;
}

/**
 * PUT /api/quotation/:noDocERP
 * Guarda las líneas editadas y recalcula QR_String, MontoTotal.
 * Body: { lineas: [{OrdenID, CodArticulo, Cantidad, PrecioUnitario, NombreArticulo?}], confirmado?: boolean }
 * Si alguna orden ya fue entregada/facturada/cobrada, responde 409 con
 * { requiereConfirmacion: true, advertencias } salvo que venga confirmado=true.
 */
// Spec 39: reutilizado por el "parcial aceptado por el cliente" (solicitudesInsumoController)
exports.propagarCotizacionADeposito = propagarCotizacionADeposito;

exports.saveQuotation = async (req, res) => {
    const { noDocERP } = req.params;
    const { lineas, cotizacion = 40, confirmado = false, propagarADeposito = false, modoFacturacion = null, precioEstablecidoMonto = null, precioEstablecidoMoneda = null } = req.body;
    const userArea = req.user?.AreaID || null;
    const isAdmin = !userArea || req.user?.rol === 'ADMIN' || req.user?.esAdmin;

    if (!lineas || !Array.isArray(lineas)) {
        return res.status(400).json({ error: 'Se requiere el campo "lineas" como array.' });
    }

    // [PRENDAS] Freno (14-sep-2026): esta pantalla borra y reinserta TODAS las líneas del
    // pedido en cada guardado — sin este chequeo, borrar todas las líneas (o dejarlas todas
    // no facturables) y guardar dejaba el pedido con una cotización vacía (MontoTotal=0) sin
    // ningún aviso — pasó en real con el pedido 20938. Mismo cálculo que decide qué se
    // inserta más abajo (ver esFacturableLinea), replicado acá para cortar ANTES de tocar
    // la base. Para vaciar un pedido de verdad existe otro camino (cancelarlo), no guardar
    // una cotización sin nada facturable.
    const algunaLineaFacturable = lineas.some(l => {
        const cantLinea = parseFloat(l.Cantidad) || 0;
        const puLinea = parseFloat(l.PrecioUnitario) || 0;
        const subtotalChk = cantLinea > 0 ? cantLinea * puLinea : puLinea;
        return l.EsFacturable != null ? !!l.EsFacturable : (!l.EsHermanaConsolidada && subtotalChk !== 0);
    });
    if (!algunaLineaFacturable) {
        return res.status(400).json({ error: 'La cotización tiene que tener al menos una línea facturable — no se puede guardar vacía. Si el pedido no va más, cancelalo en vez de vaciar la cotización.' });
    }

    const pool = await getPool();

    // ── Chequeo de estados sensibles ANTES de tocar nada ────────────────────────
    // Corta el guardado y pide confirmación (409) cuando la orden ya fue entregada,
    // facturada o cobrada. Sólo lo pide la vista de Administración de Órdenes
    // (propagarADeposito); el resto de las pantallas que reusan este editor guardan
    // sin preguntar. OJO: esto es la CONFIRMACIÓN, no la propagación — el precio de
    // depósito se propaga siempre que la orden esté en depósito y sin facturar
    // (ver propagarCotizacionADeposito al final de esta función).
    if (propagarADeposito && !confirmado) {
        const ordenIds = [...new Set(lineas.map(l => parseInt(l.OrdenID)).filter(Boolean))];
        const advertencias = await detectarEstadosSensibles(pool, ordenIds);
        if (advertencias.length > 0) {
            return res.status(409).json({
                requiereConfirmacion: true,
                advertencias,
                error: 'Esta orden ya avanzó de estado. Confirmá para modificar la cotización igual.'
            });
        }
    }

    const transaction = new sql.Transaction(pool);

    try {
        await transaction.begin();

        // Verificar existencia de la cabecera con el mismo fallback multi-paso que el GET
        let cabRes = await new sql.Request(transaction)
            .input('Doc', sql.NVarChar, noDocERP)
            .query(`SELECT * FROM PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@Doc))`);

        // Fallback 1: strip 3-letter prefix (portal orders saved as plain number e.g. '194')
        // Debe ir ANTES del bloque de creación para no duplicar una cabecera ya existente
        // guardada sin prefijo (p.ej. GET encuentra "4785" pero save recibe "SUB-4785").
        if (cabRes.recordset.length === 0) {
            const stripped = noDocERP.replace(/^[a-zA-Z]{3}-/i, '').trim();
            if (stripped && stripped !== noDocERP.trim()) {
                cabRes = await new sql.Request(transaction)
                    .input('DocStrip', sql.NVarChar, stripped)
                    .query(`SELECT * FROM PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@DocStrip))`);
            }
        }

        // Fallback 2: buscar via CodigoOrden en Ordenes → NoDocERP real en PedidosCobranza
        if (cabRes.recordset.length === 0) {
            const ordDocRes = await new sql.Request(transaction)
                .input('Cod', sql.NVarChar, noDocERP)
                .query(`SELECT TOP 1 NoDocERP FROM Ordenes WITH(NOLOCK)
                        WHERE LTRIM(RTRIM(CodigoOrden)) = LTRIM(RTRIM(@Cod))
                           OR LTRIM(RTRIM(CodigoOrden)) LIKE LTRIM(RTRIM(@Cod)) + ' %'`);
            if (ordDocRes.recordset.length > 0 && ordDocRes.recordset[0].NoDocERP) {
                const realDoc = ordDocRes.recordset[0].NoDocERP.trim();
                cabRes = await new sql.Request(transaction)
                    .input('Doc2', sql.NVarChar, realDoc)
                    .query(`SELECT * FROM PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@Doc2))`);
            }
        }

        if (cabRes.recordset.length === 0) {
            // No existe en ningún formato — crearla resolviendo el CliIdCliente
            let clienteId = null;

            // Intento 1: por NoDocERP en Ordenes
            const ordCabRes = await new sql.Request(transaction)
                .input('Doc', sql.NVarChar, noDocERP)
                .query(`SELECT TOP 1 CliIdCliente FROM Ordenes WITH(NOLOCK)
                        WHERE LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR))) = LTRIM(RTRIM(@Doc))`);
            clienteId = ordCabRes.recordset[0]?.CliIdCliente || null;

            // Intento 2: por CodigoOrden en Ordenes
            if (!clienteId) {
                const cliByOrdRes = await new sql.Request(transaction)
                    .input('Cod', sql.NVarChar, noDocERP)
                    .query(`SELECT TOP 1 CliIdCliente FROM Ordenes WITH(NOLOCK)
                            WHERE LTRIM(RTRIM(CodigoOrden)) = LTRIM(RTRIM(@Cod))
                               OR LTRIM(RTRIM(CodigoOrden)) LIKE LTRIM(RTRIM(@Cod)) + ' %'`);
                clienteId = cliByOrdRes.recordset[0]?.CliIdCliente || null;
            }

            // Intento 3: por OrdenID de la primera línea
            if (!clienteId && lineas.length > 0) {
                const firstOrdenID = parseInt(lineas[0].OrdenID) || 0;
                if (firstOrdenID > 0) {
                    const cliByOIDRes = await new sql.Request(transaction)
                        .input('OID', sql.Int, firstOrdenID)
                        .query(`SELECT TOP 1 CliIdCliente FROM Ordenes WITH(NOLOCK) WHERE OrdenID = @OID`);
                    clienteId = cliByOIDRes.recordset[0]?.CliIdCliente || null;
                }
            }

            if (!clienteId) {
                throw new Error(`No se pudo determinar el cliente para el pedido ${noDocERP}.`);
            }

            const initialMoneda = lineas.some(l => (l.Moneda || '').toUpperCase() === 'USD') ? 'USD' : 'UYU';
            await new sql.Request(transaction)
                .input('Doc', sql.NVarChar, noDocERP)
                .input('Cli', sql.Int, clienteId)
                .input('Mon', sql.VarChar(10), initialMoneda)
                .query(`INSERT INTO PedidosCobranza (NoDocERP, ClienteID, MontoTotal, Moneda, FechaGeneracion, EstadoCobro) VALUES (LTRIM(RTRIM(@Doc)), @Cli, 0, @Mon, GETDATE(), 'PENDIENTE')`);
            cabRes = await new sql.Request(transaction)
                .input('Doc', sql.NVarChar, noDocERP)
                .query(`SELECT * FROM PedidosCobranza WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@Doc))`);
        }
        const cabecera = cabRes.recordset[0];
        const pedidoId = cabecera.ID;
        // NoDocERP real de la cabecera hallada (puede diferir del recibido si venía con prefijo,
        // p.ej. recibido "SUB-4785" pero almacenado como "4785"). Usar este para los lookups por NoDocERP.
        const realNoDocERP = (cabecera.NoDocERP != null ? cabecera.NoDocERP.toString().trim() : noDocERP);

        // Descubrir OrdenID desde Ordenes usando NoDocERP (para líneas que lleguen sin OrdenID)
        const ordIdRes = await new sql.Request(transaction)
            .input('Doc', sql.NVarChar, realNoDocERP)
            .query(`SELECT TOP 1 OrdenID FROM Ordenes WITH(NOLOCK) WHERE LTRIM(RTRIM(CAST(NoDocERP AS VARCHAR))) = LTRIM(RTRIM(@Doc))`);
        const discoveredOrdenID = ordIdRes.recordset[0]?.OrdenID || null;
        const moneda = cabecera.Moneda || 'UYU';

        // OrdenID de la madre PRO (si el pedido tiene una) — se necesita SIEMPRE, no solo
        // cuando cambia el modo: es la línea que "Reconstruir líneas"/el switch de modo
        // necesitan encontrar siempre, aunque esté en $0 (ver esProMadreLinea más abajo).
        const proMadreIdRes = await new sql.Request(transaction)
            .input('Doc', sql.NVarChar, realNoDocERP)
            .query(`SELECT TOP 1 OrdenID, Nota FROM Ordenes WITH(NOLOCK)
                    WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@Doc)) AND AreaID = 'PRO' AND ComboItemID IS NULL`);
        const proMadreOrdenID = proMadreIdRes.recordset[0]?.OrdenID || null;

        // [PRENDAS] Modo de facturación: si vino en el body, se escribe como marcador en la
        // Nota de la orden madre PRO (misma sintaxis que ya lee erpSyncService.js) —
        // reemplaza cualquier marcador de modo previo, preserva el resto del texto de la
        // Nota (ej. "[PRENDA PERSONALIZADA]"). Solo aplica si el pedido tiene madre PRO;
        // si no, no hay nada que marcar (pedido normal, sin "modo").
        if (modoFacturacion) {
            const proMadre = proMadreIdRes.recordset[0];
            if (proMadre) {
                let nota = String(proMadre.Nota || '')
                    .replace(/\[FACTURA POR AREA\]/gi, '')
                    .replace(/\[PRECIO ESTABLECIDO:\s*[\d.,]+\s*(UYU|USD)?\]/gi, '')
                    .replace(/\s{2,}/g, ' ')
                    .trim();
                if (modoFacturacion === 'POR_AREA') {
                    nota = `${nota} [FACTURA POR AREA]`.trim();
                } else if (modoFacturacion === 'PRECIO_ESTABLECIDO' && precioEstablecidoMonto > 0) {
                    const mon = (precioEstablecidoMoneda || 'UYU').toUpperCase();
                    nota = `${nota} [PRECIO ESTABLECIDO: ${precioEstablecidoMonto} ${mon}]`.trim();
                }
                // CONSOLIDADO: no agrega marcador — es el default sin ninguno de los dos.
                await new sql.Request(transaction)
                    .input('OID', sql.Int, proMadre.OrdenID)
                    .input('Nota', sql.NVarChar(sql.MAX), nota)
                    .query(`UPDATE Ordenes SET Nota = @Nota WHERE OrdenID = @OID`);
            }
        }

        // Si el usuario NO es admin, solo puede eliminar/agregar líneas de SU área.
        // Las líneas de otras áreas deben preservarse tal cual.
        let lineasAPreservar = [];
        if (!isAdmin) {
            // Cargar las líneas actuales de otras áreas para preservarlas
            const otrasAreasRes = await new sql.Request(transaction)
                .input('PID', sql.Int, pedidoId)
                .input('Area', sql.NVarChar, userArea)
                .query(`
                    SELECT PCD.*
                    FROM PedidosCobranzaDetalle PCD
                    LEFT JOIN Ordenes O ON PCD.OrdenID = O.OrdenID
                    WHERE PCD.PedidoCobranzaID = @PID
                      AND ISNULL(LTRIM(RTRIM(O.AreaID)), '') <> LTRIM(RTRIM(@Area))
                `);
            lineasAPreservar = otrasAreasRes.recordset;
        }

        // Eliminar líneas del área actual (o todas si admin)
        if (isAdmin) {
            await new sql.Request(transaction)
                .input('PID', sql.Int, pedidoId)
                .query(`DELETE FROM PedidosCobranzaDetalle WHERE PedidoCobranzaID = @PID`);
        } else {
            await new sql.Request(transaction)
                .input('PID', sql.Int, pedidoId)
                .input('Area', sql.NVarChar, userArea)
                .query(`
                    DELETE PCD
                    FROM PedidosCobranzaDetalle PCD
                    LEFT JOIN Ordenes O ON PCD.OrdenID = O.OrdenID
                    WHERE PCD.PedidoCobranzaID = @PID
                      AND ISNULL(LTRIM(RTRIM(O.AreaID)), '') = LTRIM(RTRIM(@Area))
                `);
        }

        // Insertar las líneas nuevas/editadas
        for (const linea of lineas) {
            const cantLinea = parseFloat(linea.Cantidad) || 0;
            const puLinea = parseFloat(linea.PrecioUnitario) || 0;
            // [PRENDAS] Líneas con precio "por puntadas"/"por bajadas" (erpSyncService.js,
            // bloque OVERRIDE): la Cantidad de la orden (prendas) no es la que fija el
            // precio — PrecioUnitario YA es el total de esa línea, y queda con Cantidad=0
            // a propósito (ver DESGLOSE DE PRECIOS: "108: 0 x 1.125 = 1.125"). Multiplicar
            // siempre por Cantidad borraba esas líneas a $0 en CADA guardado de esta
            // pantalla, aunque nadie tocara nada — bug real, detectado 11-sep probando el
            // pedido 20936 (Bordado 1.13 → 0 al guardar sin cambiar nada).
            const subtotal = cantLinea > 0 ? cantLinea * puLinea : puLinea;

            // [PRENDAS] Decisión del usuario (14-sep-2026): PedidosCobranzaDetalle solo
            // guarda lo que realmente se va a facturar — ni hermanas consolidadas ni
            // reposiciones/retiros en $0 "por las dudas". Respeta un EsFacturable explícito
            // (tildado/destildado a mano en la pantalla) en cualquier sentido; si no vino
            // explícito, usa el mismo cálculo de siempre. Si más adelante hace falta
            // facturar algo que se guardó afuera, se agrega a mano con "Agregar línea" desde
            // la cotización del pedido completo (vista PRO/TODOS).
            const esFacturableLinea = linea.EsFacturable != null
                ? !!linea.EsFacturable
                : (!linea.EsHermanaConsolidada && subtotal !== 0);
            // EXCEPCIÓN: la línea de la orden madre PRO SIEMPRE se guarda aunque esté en $0
            // (modo "Por área" — cada componente cobra la suya, PRO cotiza $0 a propósito).
            // Es el pilar del pedido y el único lugar donde "Precio establecido" puede pisar
            // el monto pactado — sin esta excepción, guardar en "Por área" y después volver
            // a "Precio establecido" no tenía ninguna línea PRO para pisarle el precio (bug
            // real visto en vivo, 14-sep-2026, mismo motivo que la excepción en erpSyncService.js).
            const esProMadreLinea = proMadreOrdenID != null && parseInt(linea.OrdenID) === proMadreOrdenID;
            // (25-sep-2026) Línea cubierta 100% por plan de metros (Prepago / Rollo): está en
            // $0 y no facturable A PROPÓSITO, pero es la que le da la CANTIDAD a la orden para
            // la etiqueta y el ingreso a depósito (que rebaja el rollo). Esta pantalla borra y
            // re-inserta todas las líneas: sin esta excepción, guardar cualquier cosa del
            // pedido la hacía desaparecer (misma causa que en erpSyncService.js).
            let cubiertaPorPlan = /prepago/i.test(String(linea.PerfilAplicado || ''))
                || /cubierto.*por plan/i.test(String(linea.LogPrecioAplicado || ''));
            if (!cubiertaPorPlan && linea.DesgloseJSON) {
                try {
                    const dj = typeof linea.DesgloseJSON === 'string' ? JSON.parse(linea.DesgloseJSON) : linea.DesgloseJSON;
                    cubiertaPorPlan = !!(dj && dj.cobertura && dj.cobertura.tipo === 'PLAN');
                } catch { /* sin desglose legible: se decide por perfil/log */ }
            }
            if (!esFacturableLinea && !esProMadreLinea && !cubiertaPorPlan) continue;

            const dz = normalizarDesgloseLinea(linea, puLinea);
            const lineaMon = linea.Moneda || moneda;
            const lineaMonOrig = linea.MonedaOriginal || lineaMon;
            const lineaSubOrig = parseFloat(linea.SubtotalOriginal) || ((parseFloat(linea.Cantidad) || 0) * (parseFloat(linea.PrecioUnitarioOriginal) || parseFloat(linea.PrecioUnitario) || 0));

            await new sql.Request(transaction)
                .input('PID', sql.Int, pedidoId)
                .input('OID', sql.Int, linea.OrdenID || discoveredOrdenID || null)
                .input('Cod', sql.NVarChar, linea.CodArticulo || '')
                .input('ProId', sql.Int, linea.ProIdProducto || null)
                .input('Cant', sql.Decimal(18, 2), parseFloat(linea.Cantidad) || 0)
                .input('DT', sql.Decimal(18, 2), parseFloat(linea.DatoTecnico) || null)
                .input('PU', sql.Decimal(18, 2), parseFloat(linea.PrecioUnitario) || 0)
                .input('ST', sql.Decimal(18, 2), subtotal)
                .input('MonOrig', sql.VarChar(10), lineaMonOrig)
                .input('PUOrig', sql.Decimal(18, 4), parseFloat(linea.PrecioUnitarioOriginal) || parseFloat(linea.PrecioUnitario) || 0)
                .input('STOrig', sql.Decimal(18, 4), lineaSubOrig)
                .input('Log', sql.NVarChar, linea.LogPrecioAplicado || 'Manual')
                .input('Mon', sql.VarChar, lineaMon)
                .input('Perfil', sql.NVarChar(sql.MAX), linea.PerfilAplicado || 'Manual')
                .input('Trace', sql.NVarChar(sql.MAX), linea.PricingTrace || 'Edición manual')
                // "Comprar y personalizar": esta pantalla borra y re-inserta TODAS las líneas
                // del pedido en cada guardado — si no se preserva el flag acá, cualquier
                // guardado "aplana" las líneas hermanas (EMB/DF/TPU/EST) a facturables y
                // duplica el total. El frontend las manda de vuelta tal cual (son de solo
                // lectura ahí) para que sobrevivan al guardado.
                .input('EsHnaCons', sql.Bit, linea.EsHermanaConsolidada ? 1 : 0)
                // [PRENDAS] Facturable: por defecto sigue el cálculo automático de siempre
                // (!EsHermanaConsolidada && Subtotal != 0, ver erpSyncService.js) salvo que
                // el usuario la haya tildado/destildado a mano en esta pantalla — en ese caso
                // linea.EsFacturable ya viene explícito (true/false) desde el frontend.
                .input('EsFact', sql.Bit, linea.EsFacturable != null ? (linea.EsFacturable ? 1 : 0) : ((!linea.EsHermanaConsolidada && subtotal !== 0) ? 1 : 0))
                // Desglose lista / descuento / recargos (ver normalizarDesgloseLinea): se reinserta
                // con la línea; sin él, cada guardado dejaría la línea "sin desglose".
                .input('PLista', sql.Decimal(18, 4), dz.PrecioLista)
                .input('DTipo', sql.VarChar(12), dz.DescuentoTipo)
                .input('DPct', sql.Decimal(9, 4), dz.DescuentoPct)
                .input('DImp', sql.Decimal(18, 4), dz.DescuentoImporte)
                .input('DOrig', sql.NVarChar(150), dz.DescuentoOrigen)
                .input('DPerfil', sql.Int, dz.DescuentoPerfilId)
                .input('DRegla', sql.Int, dz.DescuentoReglaId)
                .input('RPct', sql.Decimal(9, 4), dz.RecargoPct)
                .input('RImp', sql.Decimal(18, 4), dz.RecargoImporte)
                .input('ROrig', sql.NVarChar(200), dz.RecargoOrigen)
                .input('DJson', sql.NVarChar(sql.MAX), dz.DesgloseJSON)
                .query(`INSERT INTO PedidosCobranzaDetalle
                    (PedidoCobranzaID, OrdenID, CodArticulo, ProIdProducto, Cantidad, DatoTecnico, PrecioUnitario, Subtotal,
                     LogPrecioAplicado, Moneda, PerfilAplicado, PricingTrace, MonedaOriginal, PrecioUnitarioOriginal, SubtotalOriginal, EsHermanaConsolidada, EsFacturable,
                     PrecioLista, DescuentoTipo, DescuentoPct, DescuentoImporte, DescuentoOrigen, DescuentoPerfilId, DescuentoReglaId, RecargoPct, RecargoImporte, RecargoOrigen, DesgloseJSON)
                    VALUES (@PID, @OID, @Cod, @ProId, @Cant, @DT, @PU, @ST, @Log, @Mon, @Perfil, @Trace, @MonOrig, @PUOrig, @STOrig, @EsHnaCons, @EsFact,
                            @PLista, @DTipo, @DPct, @DImp, @DOrig, @DPerfil, @DRegla, @RPct, @RImp, @ROrig, @DJson)`);
        }

        // Determinar moneda final: USD si alguna línea FACTURABLE es USD. Las hermanas
        // "Incluido en PRO" y las líneas destildadas no se cobran, así que no deciden la
        // moneda (prendas en pesos con sublimación en dólares → pedido en pesos).
        const curRes = await new sql.Request(transaction)
            .input('PID2', sql.Int, pedidoId)
            .query(`
                SELECT CASE WHEN EXISTS (
                    SELECT 1 FROM PedidosCobranzaDetalle
                    WHERE PedidoCobranzaID = @PID2 AND Moneda = 'USD'
                      AND ISNULL(EsHermanaConsolidada, 0) = 0 AND ISNULL(EsFacturable, 1) = 1
                ) THEN 'USD' ELSE 'UYU' END as MonedaFinal
            `);
        const monedaFinal = curRes.recordset[0].MonedaFinal;

        // Recalcular MontoTotal sumando las líneas FACTURABLES, transformando a la moneda final.
        // "Comprar y personalizar": excluir las líneas hermanas (EMB/DF/TPU/EST) — ya están
        // incluidas dentro del subtotal de la línea de PRO, sumarlas de nuevo duplica el total.
        // Una línea destildada como no facturable tampoco suma (no se le cobra al cliente);
        // la cantidad del QR sigue contando todas las líneas no hermanas.
        const totRes = await new sql.Request(transaction)
            .input('PID', sql.Int, pedidoId)
            .input('Cotiz', sql.Decimal(18, 4), parseFloat(cotizacion) || 40)
            .input('MFinal', sql.VarChar(10), monedaFinal)
            .query(`
                SELECT
                    ISNULL(SUM(
                        CASE
                            WHEN ISNULL(EsFacturable, 1) = 0 THEN 0
                            WHEN @MFinal = 'USD' AND Moneda = 'UYU' THEN Subtotal / @Cotiz
                            WHEN @MFinal = 'UYU' AND Moneda = 'USD' THEN Subtotal * @Cotiz
                            ELSE Subtotal
                        END
                    ), 0) as Total,
                    ISNULL(SUM(Cantidad), 0) as TotalCant
                FROM PedidosCobranzaDetalle
                WHERE PedidoCobranzaID = @PID AND ISNULL(EsHermanaConsolidada, 0) = 0
            `);

        const nuevoTotal = parseFloat(totRes.recordset[0].Total) || 0;
        const nuevaCantidad = parseFloat(totRes.recordset[0].TotalCant) || 0;

        // Actualizar QR_Importe, QR_Cantidad y QR_String con los nuevos totales
        const nuevoQrImporte = nuevoTotal.toFixed(2);
        const nuevoQrCantidad = nuevaCantidad.toString();

        // Reconstruir QR_String
        const nuevoQrString = [
            cabecera.QR_Pedido,
            cabecera.QR_Cliente,
            cabecera.QR_Trabajo,
            cabecera.QR_Urgencia,
            cabecera.QR_Producto,
            nuevoQrCantidad,
            nuevoQrImporte
        ].join(SEP);

        await new sql.Request(transaction)
            .input('ID', sql.Int, pedidoId)
            .input('Total', sql.Decimal(18, 2), nuevoTotal)
            .input('Cant', sql.NVarChar, nuevoQrCantidad)
            .input('Imp', sql.NVarChar, nuevoQrImporte)
            .input('QRS', sql.NVarChar(sql.MAX), nuevoQrString)
            .input('MFinalDB', sql.VarChar(10), monedaFinal)
            .query(`UPDATE PedidosCobranza SET 
                Moneda = @MFinalDB,
                MontoTotal = @Total,
                QR_Cantidad = @Cant,
                QR_Importe = @Imp,
                QR_String = @QRS,
                FechaGeneracion = GETDATE()
                WHERE ID = @ID`);

        await transaction.commit();

        // Sincronizar MovImporte con el nuevo total para órdenes ya contabilizadas
        try {
            await pool.request()
                .input('NoDoc', sql.NVarChar, realNoDocERP)
                .input('NewTotal', sql.Decimal(18, 2), nuevoTotal)
                .input('MFinal', sql.VarChar(10), monedaFinal)
                .query(`
                    UPDATE mc
                    SET mc.MovImporte = -@NewTotal
                    FROM dbo.MovimientosCuenta mc
                    INNER JOIN dbo.Ordenes o ON mc.OrdIdOrden = o.OrdenID
                    INNER JOIN dbo.CuentasCliente cc ON mc.CueIdCuenta = cc.CueIdCuenta
                    WHERE LTRIM(RTRIM(CAST(o.NoDocERP AS VARCHAR))) = LTRIM(RTRIM(@NoDoc))
                      AND mc.MovTipo IN ('ORDEN', 'ORDEN_ANTICIPO')
                      AND mc.DocIdDocumento IS NULL
                      AND (
                          (cc.MonIdMoneda = 1 AND @MFinal = 'UYU')
                          OR (cc.MonIdMoneda = 2 AND @MFinal = 'USD')
                      )
                `);
            await pool.request()
                .input('NoDoc', sql.NVarChar, realNoDocERP)
                .input('NewTotal', sql.Decimal(18, 2), nuevoTotal)
                .query(`
                    UPDATE dbo.PedidosCobranza
                    SET MontoContabilizado = @NewTotal
                    WHERE LTRIM(RTRIM(NoDocERP)) = LTRIM(RTRIM(@NoDoc))
                      AND MontoContabilizado IS NOT NULL
                      AND MontoContabilizado > 0
                `);
        } catch (syncErr) {
            logger.warn(`[Quotation] No se pudo sincronizar movimiento contable para ${noDocERP}: ${syncErr.message}`);
        }

        // Propagar a OrdenesDeposito/OrdenesRetiro. Corre SIEMPRE, no sólo con
        // propagarADeposito: la propia función decide orden por orden y sólo toca las que
        // YA están en depósito y TODAVÍA NO están facturadas. Antes corría únicamente
        // desde Administración de Órdenes, así que editar la cotización desde un área o
        // desde Logística dejaba a depósito/caja cobrando el precio viejo mientras
        // contabilidad ya tenía el nuevo (el bloque de MovimientosCuenta de acá arriba
        // nunca estuvo detrás del flag). El flag sigue mandando en lo otro que hace:
        // pedir confirmación cuando la orden ya avanzó de estado (409 de más arriba).
        let resumenDeposito = null;
        try {
            resumenDeposito = await propagarCotizacionADeposito(pool, { pedidoId, monedaFinal, cotizacion });
        } catch (propErr) {
            logger.warn(`[Quotation] No se pudo propagar a depósito para ${noDocERP}: ${propErr.message}`);
        }

        logger.info(`[Quotation] ✅ Cotización guardada para ${noDocERP} | Total: ${nuevoTotal} | QR: ${nuevoQrString}`);

        res.json({
            success: true,
            noDocERP,
            montoTotal: nuevoTotal,
            qrString: nuevoQrString,
            deposito: resumenDeposito
        });

    } catch (err) {
        try {
            await transaction.rollback();
        } catch (rollbackErr) {
            logger.error('[Quotation] Error on rollback:', rollbackErr);
        }
        logger.error('[Quotation] Error al guardar cotización:', err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * GET /api/quotation/search-products?q=XXX
 * Buscador de productos para agregar nuevas líneas.
 */
exports.searchProducts = async (req, res) => {
    const { q } = req.query;
    try {
        const pool = await getPool();
        const request = pool.request();
        let whereClause = 'WHERE A.Mostrar = 1';
        if (q && q.length >= 2) {
            request.input('q', sql.NVarChar, `%${q}%`);
            whereClause = `WHERE A.Mostrar = 1 AND (A.Descripcion LIKE @q OR A.CodArticulo LIKE @q)`;
        }
        const result = await request.query(`
            SELECT TOP 1000
                LTRIM(RTRIM(A.CodArticulo)) as CodArticulo,
                LTRIM(RTRIM(A.Descripcion)) as Descripcion,
                A.ProIdProducto,
                LTRIM(RTRIM(CME.AreaID_Interno)) as AreaID,
                -- Los productos/insumos del Grupo '2.1' ("PRENDAS" — ver
                -- ConfigurarProductosPage.jsx GRUPO_PRENDAS) no son de ningún área de
                -- producción puntual (combos armados o insumos cruzados entre áreas), por
                -- eso no tienen fila en ConfigMapeoERP. Sin un nombre acá, la columna Área
                -- de la cotización quedaba en blanco para ellos — no es un bug de datos, es
                -- que de verdad no pertenecen a un área; se les pone una etiqueta neutra
                -- (NO un AreaID real — no se debe tratar como una encadenada más).
                ISNULL(CME.NombreReferencia, CASE WHEN LTRIM(RTRIM(A.Grupo)) = '2.1' THEN 'Producto/Insumo' ELSE NULL END) as AreaNombre,
                PB.Precio as PrecioBase,
                CASE 
                    WHEN PB.MonIdMoneda IS NOT NULL THEN (CASE WHEN PB.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END)
                    WHEN A.MonIdMoneda = 2 THEN 'USD' 
                    ELSE 'UYU' 
                END as Moneda
            FROM Articulos A WITH(NOLOCK)
            LEFT JOIN ConfigMapeoERP CME WITH(NOLOCK) ON CME.CodigoERP = A.Grupo COLLATE Database_Default
            LEFT JOIN PreciosBase PB WITH(NOLOCK) ON A.ProIdProducto = PB.ProIdProducto
            ${whereClause}
            ORDER BY CME.AreaID_Interno, A.Descripcion
        `);
        res.json(result.recordset);
    } catch (err) {
        logger.error('[Quotation] Error buscando productos:', err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * POST /api/quotation/:noDocERP/reconstruir
 * [PRENDAS] "Reconstruir líneas" (14-sep-2026, a pedido del usuario tras decidir que
 * PedidosCobranzaDetalle solo guarda lo facturable — sección 36 de specs/39): vuelve a
 * armar TODAS las líneas del pedido desde el origen real — la Magnitud/puntadas/bajadas de
 * cada orden y el motor de precios (PricingService, vía ERPSyncService.syncFinalOrderIntegration,
 * el MISMO camino que corre solo al despachar/recibir un bulto) — en vez de que el usuario
 * tenga que ir agregando línea por línea a mano y adivinando la cantidad. Respeta el modo de
 * facturación GUARDADO (el marcador de la Nota de la orden madre PRO) — si el usuario cambió
 * el modo en la pantalla pero no lo guardó todavía, hay que guardar primero. skipDeposito:
 * true porque esto se dispara desde Producción, no desde un ingreso real a Depósito.
 */
exports.reconstruirLineas = async (req, res) => {
    const { noDocERP } = req.params;
    try {
        const ERPSyncService = require('../services/erpSyncService');
        await ERPSyncService.syncFinalOrderIntegration(noDocERP, req.user?.id || 1, req.user?.usuario || req.user?.nombre || 'Sistema', null, { skipDeposito: true });
        // Reusar la misma lectura que ya arma la respuesta completa (cabecera + detalle +
        // modo) para que el frontend recargue la pantalla con una sola llamada.
        req.params.noDocERP = noDocERP;
        return exports.getQuotation(req, res);
    } catch (err) {
        logger.error('[Quotation] Error reconstruyendo líneas:', err);
        res.status(500).json({ error: err.message });
    }
};
