const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');

/**
 * Obtiene las etiquetas generadas para una orden específica.
 */
const getEtiquetas = async (req, res) => {
    try {
        const { ordenId } = req.params;
        const pool = await getPool();

        const result = await pool.request()
            .input('OrdenID', sql.Int, ordenId)
            .query(`
                SELECT 
                    E.EtiquetaID,
                    E.OrdenID,
                    E.NumeroBulto,
                    E.TotalBultos,
                    E.CodigoQR,
                    E.FechaGeneracion,
                    E.CodigoEtiqueta,
                    ISNULL(E.PerfilesPrecio, O.PerfilesPrecio) as PerfilesPrecio,
                    E.DetalleCostos
                FROM Etiquetas E
                LEFT JOIN Ordenes O ON E.OrdenID = O.OrdenID
                WHERE E.OrdenID = @OrdenID
                ORDER BY NumeroBulto ASC
            `);

        const labels = result.recordset;

        // Fallback para DetalleCostos si está vacío
        if (labels.length > 0 && !labels[0].DetalleCostos) {
            const cobRes = await pool.request()
                .input('OID', sql.Int, ordenId)
                .query(`
                    SELECT PCD.* 
                    FROM PedidosCobranzaDetalle PCD
                    JOIN PedidosCobranza PC ON PCD.PedidoCobranzaID = PC.ID
                    WHERE PCD.OrdenID = @OID OR PC.NoDocERP = (SELECT TOP 1 NoDocERP FROM Ordenes WHERE OrdenID = @OID)
                `);

            if (cobRes.recordset.length > 0) {
                const fallbackText = cobRes.recordset.map(d => `- ${d.CodArticulo}: ${d.Cantidad} x ${d.PrecioUnitario} = ${d.Subtotal} (${d.LogPrecioAplicado})`).join('\n');
                labels.forEach(l => l.DetalleCostos = fallbackText);
            }
        }

        res.json(labels);
    } catch (err) {
        logger.error("Error en getEtiquetas:", err);
        res.status(500).json({ error: 'Error al obtener etiquetas', message: err.message });
    }
};

/**
 * DELETE /api/etiqueta/:id
 * Elimina la etiqueta indicadat.
 */
const deleteEtiqueta = async (req, res) => {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'EtiquetaID requerido' });

    try {
        const pool = await getPool();

        // 1. Verificar existencia y obtener OrdenID
        const check = await pool.request()
            .input('EtiquetaID', sql.Int, id)
            .query('SELECT OrdenID FROM Etiquetas WHERE EtiquetaID = @EtiquetaID');

        if (check.recordset.length === 0) {
            return res.status(404).json({ error: 'Etiqueta no encontrada' });
        }

        const ordenId = check.recordset[0].OrdenID;

        // 2. Borrar etiqueta
        await pool.request()
            .input('EtiquetaID', sql.Int, id)
            .query('DELETE FROM Etiquetas WHERE EtiquetaID = @EtiquetaID');

        // 3. Actualizar TotalBultos en el resto de etiquetas de la orden
        await pool.request()
            .input('OrdenID', sql.Int, ordenId)
            .query(`
                UPDATE Etiquetas
                SET TotalBultos = (SELECT COUNT(*) FROM Etiquetas WHERE OrdenID = @OrdenID)
                WHERE OrdenID = @OrdenID
            `);

        res.json({ success: true, message: 'Etiqueta eliminada correctamente' });

    } catch (err) {
        logger.error('Error eliminando etiqueta:', err);
        res.status(500).json({ error: err.message });
    }
};

const PricingService = require('../services/pricingService');

const LabelGenerationService = require('../services/LabelGenerationService');

const createExtraLabel = async (req, res) => {
    const { ordenId } = req.body;
    const userId = req.user?.id || 1;
    const userName = req.user?.usuario || 'Sistema';

    if (!ordenId) return res.status(400).json({ error: 'ID de orden requerido' });

    logger.info(`[etiquetasController] Creando/Regenerando etiquetas para Orden: ${ordenId}`);

    try {
        const result = await LabelGenerationService.regenerateLabelsForOrder(ordenId, userId, userName);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({ success: true, message: `Generadas ${result.totalBultos} etiquetas.`, details: result });

    } catch (err) {
        logger.error("[etiquetasController] Error:", err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * Obtiene órdenes para el panel de generación de etiquetas.
 * Filtra órdenes canceladas pero INCLUYE las completadas (Pronto).
 */
const getOrdersForLabels = async (req, res) => {
    try {
        const { search, area } = req.query;
        const pool = await getPool();

        const searchTerm = (search && search.trim() !== '') ? `%${search.trim()}%` : null;
        // Limpiar area
        const cleanArea = (!area || area === 'undefined' || area === 'null') ? '' : area;

        const query = `
            SELECT 
                O.OrdenID, 
                O.AreaID,
                O.CodigoOrden, 
                O.Cliente AS Cliente, 
                O.Material, 
                O.Estado, 
                O.ProximoServicio,
                O.DescripcionTrabajo AS Descripcion,
                O.Magnitud,
                O.ValidacionOBS,
                O.RolloID,
                O.CostoTotal,
                R.Nombre as NombreRollo,
                (SELECT COUNT(*) FROM Etiquetas E WITH (NOLOCK) WHERE E.OrdenID = O.OrdenID) as CantidadEtiquetas,
                (SELECT TOP 1 PC.Moneda FROM PedidosCobranzaDetalle PCD WITH (NOLOCK)
                    JOIN PedidosCobranza PC WITH (NOLOCK) ON PCD.PedidoCobranzaID = PC.ID
                    WHERE PCD.OrdenID = O.OrdenID ORDER BY PC.ID DESC) AS MonedaCotizacion,
                (SELECT TOP 1 PC2.MontoTotal FROM PedidosCobranzaDetalle PCD2 WITH (NOLOCK)
                    JOIN PedidosCobranza PC2 WITH (NOLOCK) ON PCD2.PedidoCobranzaID = PC2.ID
                    WHERE PCD2.OrdenID = O.OrdenID ORDER BY PC2.ID DESC) AS ImporteCotizacion
            FROM Ordenes O WITH (NOLOCK)
            LEFT JOIN Rollos R ON O.RolloID = R.RolloID
            WHERE 
                O.Estado NOT IN ('CANCELADO', 'FINALIZADO', 'ENTREGADO')
                AND (@Area = '' OR O.AreaID = @Area)
                AND (
                    @Search IS NULL 
                    OR O.NoDocERP LIKE @Search 
                    OR O.Cliente LIKE @Search 
                    OR O.CodigoOrden LIKE @Search
                )
            ORDER BY O.FechaIngreso DESC
        `;

        const result = await pool.request()
            .input('Search', sql.NVarChar, searchTerm)
            .input('Area', sql.NVarChar, cleanArea)
            .query(query);

        res.json(result.recordset);
    } catch (err) {
        logger.error("Error en getOrdersForLabels:", err);
        res.status(500).json({ error: 'Error al obtener órdenes para etiquetas' });
    }
};

const AREA_NAMES = {
    'SB': 'Sublimación',
    'TWC': 'Corte Laser',
    'TWT': 'Costura',
    'DF': 'DTF',
    'ECOUV': 'Eco UV',
    'DIRECTA': 'Impresión Directa',
    'EMB': 'Bordado',
    'TPU': 'TPU',
    'EST': 'Estampado',
    'DEPOSITO': 'Depósito',
    'PROD': 'Producción'
};

const printEtiquetas = async (req, res) => {
    try {
        const { ordenId } = req.params;
        // Soporte para impresión masiva: si ordenId es 'batch', leemos los IDs del query param ?ids=1,2,3
        const ids = ordenId === 'batch'
            ? (req.query.ids || '').split(',').map(Number).filter(n => !isNaN(n))
            : [parseInt(ordenId)];

        if (ids.length === 0) return res.send('No IDs provided');

        const pool = await getPool();

        // Construir query dinámica para IN clause
        const request = pool.request();
        // Parametrizar dinámicamente es complejo con mssql sencillo sin TVP, 
        // pero como son IDs internos int, validamos antes y construimos string seguro.
        const idsStr = ids.join(',');

        const result = await request.query(`
            SELECT 
                E.*,
                O.CodigoOrden,
                O.Cliente,
                O.DescripcionTrabajo,
                O.FechaIngreso,
                O.ProximoServicio,
                O.AreaID AS AreaOrigen,
                O.Material,
                O.Prioridad,
                LB.Tipocontenido as TipoBulto,
                ISNULL(NULLIF(LTRIM(RTRIM(C.IDCliente)), ''), O.Cliente) AS IDClienteMacrosoft,
                ISNULL(NULLIF(LTRIM(RTRIM(C.Nombre)), ''), O.Cliente) AS NombreClienteReal
            FROM Etiquetas E
            JOIN Ordenes O ON E.OrdenID = O.OrdenID
            LEFT JOIN Clientes C ON O.CodCliente = C.CodCliente
            LEFT JOIN Logistica_Bultos LB ON E.CodigoEtiqueta = LB.CodigoEtiqueta
            WHERE E.OrdenID IN (${idsStr}) 
            ORDER BY E.OrdenID, E.NumeroBulto ASC
        `);

        if (result.recordset.length === 0) {
            return res.send('<h1>No hay etiquetas generadas para las órdenes seleccionadas</h1>');
        }

        // Fetch all routing services for the selected orders based on NoDocERP
        const routingResult = await request.query(`
            SELECT o2.OrdenID as BaseOrdenID, o.AreaID as AreaDestino, o.Estado
            FROM Ordenes o
            JOIN Ordenes o2 ON o.NoDocERP = o2.NoDocERP AND o2.NoDocERP IS NOT NULL
            WHERE o2.OrdenID IN (${idsStr})
            ORDER BY o.OrdenID ASC
        `);
        const serviciosPorOrden = {};
        routingResult.recordset.forEach(s => {
            if (!serviciosPorOrden[s.BaseOrdenID]) serviciosPorOrden[s.BaseOrdenID] = [];
            // Solo agregar si es de un area distinta al anterior para evitar duplicados en la lista (ej. 2 SB)
            const arr = serviciosPorOrden[s.BaseOrdenID];
            if (arr.length === 0 || arr[arr.length - 1].AreaDestino !== s.AreaDestino) {
                arr.push(s);
            }
        });

        const labels = result.recordset;

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Imprimir Etiquetas</title>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
                <style>
                    @page { size: 10cm 15cm; margin: 0; }
                    body { font-family: 'Arial', sans-serif; margin: 0; padding: 0; background: #fff; color: #000; }
                    .label-page { 
                        width: 10cm; height: 14.8cm;
                        position: relative; 
                        box-sizing: border-box; 
                        overflow: hidden;
                        page-break-after: always;
                        border: 1px dashed #eee; 
                        padding: 15px; 
                        margin: 0 auto;
                        background: white;
                        display: flex;
                        flex-direction: column;
                    }
                    
                    /* HEADER TRADICIONAL */
                    .header { border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-start; }
                    .header-left { flex: 1; min-width: 0; }
                    .header-right { text-align: right; min-width: 120px; }
                    .label-bold { font-weight: 800; font-size: 13px; text-transform: uppercase; color: #444; }
                    .value-text { font-size: 16px; font-weight: 800; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
                    .date-text { font-size: 13px; font-weight: bold; }

                    /* CUERPO DE DOS COLUMNAS */
                    .layout-main { display: flex; flex: 1; gap: 10px; }
                    
                    /* COLUMNA IZQUIERDA: LOS DOS CODIGOS */
                    .left-col { 
                        width: 60%; 
                        display: flex; 
                        flex-direction: column; 
                        align-items: center; 
                        justify-content: flex-start; 
                        border-right: 2px solid #000; 
                        padding-right: 15px;
                        gap: 15px;
                    }
                    .qr-container { display: flex; flex-direction: column; align-items: center; margin-bottom: 20px; }
                    .qr-box { width: 150px; height: 150px; }
                    .qr-caption { font-family: monospace; font-size: 16px; font-weight: 900; margin-top: 8px; text-align: center; letter-spacing: 1px; }
                    
                    .order-info-block { text-align: center; margin-top: auto; }
                    .big-order-text { font-size: 20px; font-weight: 900; line-height: 1.1; margin-bottom: 5px; color: #000; }
                    .bulto-count-text { font-size: 18px; font-weight: 700; background: #000; color: #fff; padding: 2px 10px; border-radius: 4px; }

                    /* COLUMNA DERECHA: SERVICIOS */
                    .right-col { width: 40%; padding-left: 5px; }
                    .services-title { 
                        border-bottom: 2px solid #000; 
                        margin-bottom: 10px; 
                        font-weight: 900; 
                        font-size: 14px; 
                        text-align: center; 
                        padding-bottom: 4px;
                    }
                    .service-list { list-style: none; padding: 0; margin: 0; }
                    .service-item { display: flex; align-items: center; font-size: 14px; font-weight: bold; margin-bottom: 15px; }
                    .check-box { 
                        width: 18px; height: 18px; 
                        border: 2px solid #000; 
                        margin-right: 8px; 
                        display: flex; 
                        align-items: center; 
                        justify-content: center; 
                        font-size: 14px;
                    }
                    .destination-block {
                        margin-top: auto;
                        border-top: 2px solid #000;
                        padding-top: 10px;
                        font-weight: 900;
                        font-size: 14px;
                        text-align: center;
                    }

                    @media screen {
                        .label-page { border: 1px dashed #ccc; margin: 20px auto; width: 380px; height: 560px; }
                        body { background: #f0f0f0; padding-bottom: 50px; }
                    }
                    @media print {
                        .no-print { display: none !important; }
                        body { background: #fff; }
                        .label-page { margin: 0; border: none; width: 100%; height: 100vh; }
                    }
                </style>
            </head>
            <body>
                <div class="no-print" style="position: sticky; top: 0; z-index: 100; padding: 15px; text-align: center; background: #333; color: white; display: flex; justify-content: center; align-items: center; gap: 20px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <div>
                        <strong>Vista Previa Etiquetas de Producción</strong> (${labels.length} total)
                    </div>
                    <button onclick="window.print()" style="padding: 10px 25px; font-size: 16px; cursor: pointer; background: #4f46e5; color: white; border: none; border-radius: 6px; font-weight: bold;">
                        🖨️ IMPRIMIR
                    </button>
                </div>

                ${labels.map((label, index) => {
            const formattedDate = new Date(label.FechaIngreso).toLocaleDateString('es-ES');
            
            let nextService = (label.ProximoServicio || 'DEPOSITO').trim().toUpperCase();
            nextService = AREA_NAMES[nextService] || nextService;

            let areaOrigenName = (label.AreaOrigen || 'PROD').trim().toUpperCase();
            areaOrigenName = AREA_NAMES[areaOrigenName] || areaOrigenName;

            let flippedCode = label.CodigoEtiqueta;
            if (flippedCode && flippedCode.includes('-')) {
                const parts = flippedCode.split('-');
                if (parts.length >= 2 && parts[0].startsWith('B')) {
                    const bultoPart = parts.shift();
                    flippedCode = parts.join('-') + '/' + bultoPart;
                }
            }

            const isUrgente = (label.Prioridad || '').toUpperCase() === 'URGENTE';

            return `
                <div class="label-page">
                    <div class="header">
                        <div class="header-left">
                            <div class="label-bold">CLIENTE</div>
                            <div class="value-text" style="font-size: 18px;">${label.IDClienteMacrosoft}</div>
                            <div class="value-text" style="font-size: 14px; white-space: normal;">${label.NombreClienteReal}</div>
                            <div class="label-bold" style="margin-top: 5px;">TRABAJO</div>
                            <div class="value-text" style="font-size: 14px; white-space: normal;">${label.DescripcionTrabajo || '-'}</div>
                            <div class="value-text" style="font-size: 14px; white-space: normal; margin-top: 2px;">${label.Material || '-'}</div>
                            <div class="value-text" style="font-size: 16px; font-weight: 900; color: ${isUrgente ? 'red' : 'black'}; margin-top: 2px;">${label.Prioridad || 'NORMAL'}</div>
                        </div>
                        <div class="header-right">
                            <div class="label-bold">ÁREA ORIGEN</div>
                            <div class="value-text">${areaOrigenName}</div>
                            <div class="date-text" style="margin-top: 8px;">${formattedDate}</div>
                        </div>
                    </div>

                    <div class="layout-main">
                        <div class="left-col">
                            <!-- QR 1: Bulto (Tracking Interno) -->
                            <div class="qr-container">
                                <div id="qr-bulto-${index}" class="qr-box"></div>
                                <div class="qr-caption">${flippedCode}</div>
                            </div>

                            <div class="order-info-block">
                                <div class="big-order-text">${label.CodigoOrden}</div>
                                <div class="bulto-count-text">BULTO ${label.NumeroBulto} / ${label.TotalBultos}</div>
                            </div>
                        </div>

                        <div class="right-col">
                            <div class="services-title">SERVICIOS</div>
                            <ul class="service-list">
                                ${(() => {
                                    const srvs = serviciosPorOrden[label.OrdenID] || [];
                                    let listHtml = '';
                                    srvs.forEach(srv => {
                                        // Solo marcar si el estado es PRONTO
                                        const isCompleted = (srv.Estado || '').toUpperCase() === 'PRONTO';
                                        const checkMark = isCompleted ? '✔' : '';
                                        const colorStyle = isCompleted ? 'color: #000;' : 'color: #666;';
                                        
                                        let rawAreaName = srv.AreaDestino.trim().toUpperCase();
                                        let areaName = AREA_NAMES[rawAreaName] || rawAreaName;
                                        
                                        // Si no está en el mapa, intentar limpiar sufijos/prefijos
                                        if (areaName === rawAreaName) {
                                            const areaNameMatch = srv.AreaDestino.match(/^([A-Z]{2,3})/);
                                            const matchAcronym = areaNameMatch ? areaNameMatch[1].toUpperCase() : null;
                                            if (matchAcronym && AREA_NAMES[matchAcronym]) {
                                                areaName = AREA_NAMES[matchAcronym];
                                            } else {
                                                areaName = areaNameMatch ? areaNameMatch[1] : srv.AreaDestino.substring(0, 15);
                                            }
                                        }
                                        
                                        listHtml += `
                                            <li class="service-item">
                                                <div class="check-box">${checkMark}</div>
                                                <span style="${colorStyle}">${areaName}</span>
                                            </li>
                                        `;
                                    });
                                    // Siempre agregar DEPOSITO al final
                                    listHtml += `
                                        <li class="service-item">
                                            <div class="check-box"></div>
                                            <span style="color: #666;">DEPOSITO</span>
                                        </li>
                                    `;
                                    return listHtml;
                                })()}
                            </ul>

                            <div class="destination-block">
                                <div class="label-bold">DESTINO</div>
                                <div style="font-size: 18px; color: #000;">${nextService}</div>
                            </div>
                        </div>
                    </div>

                    <script>
                        new QRCode(document.getElementById("qr-bulto-${index}"), {
                            text: "${label.CodigoEtiqueta}",
                            width: 150, height: 150, correctLevel: QRCode.CorrectLevel.M
                        });
                    </script>
                </div>
            `;
        }).join('')}
            </body>
            </html>
        `;

        res.send(html);

    } catch (err) {
        logger.error("Error printEtiquetas:", err);
        res.status(500).send("Error generando vista de impresión");
    }
};

const getPendingServices = async (req, res) => {
    try {
        const { id } = req.params;
        const pool = await getPool();
        const result = await pool.request()
            .input('ID', sql.Int, id)
            .query(`
                SELECT ServicioID as id, Descripcion as nombre, CodArt 
                FROM ServiciosExtraOrden 
                WHERE OrdenID = @ID AND ISNULL(Estado, 'PENDIENTE') = 'PENDIENTE'
            `);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const updateOrderNextService = async (req, res) => {
    try {
        const { id } = req.params;
        const { nextService } = req.body;
        const pool = await getPool();

        await pool.request()
            .input('ID', sql.Int, id)
            .input('Next', sql.NVarChar, nextService)
            .query("UPDATE Ordenes SET ProximoServicio = @Next WHERE OrdenID = @ID");

        res.json({ success: true, message: `Próximo servicio actualizado a: ${nextService}` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    getEtiquetas,
    deleteEtiqueta,
    createExtraLabel,
    printEtiquetas,
    getOrdersForLabels,
    getPendingServices,
    updateOrderNextService
};
