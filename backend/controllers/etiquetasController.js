const { sql, getPool } = require('../config/db');

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
                    EtiquetaID,
                    OrdenID,
                    NumeroBulto,
                    TotalBultos,
                    CodigoQR,
                    FechaGeneracion,
                    CodigoEtiqueta
                FROM Etiquetas
                WHERE OrdenID = @OrdenID
                ORDER BY NumeroBulto ASC
            `);

        res.json(result.recordset);
    } catch (err) {
        console.error("Error en getEtiquetas:", err);
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
        console.error('Error eliminando etiqueta:', err);
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

    console.log(`[etiquetasController] Creando/Regenerando etiquetas para Orden: ${ordenId}`);

    try {
        const result = await LabelGenerationService.regenerateLabelsForOrder(ordenId, userId, userName);

        if (!result.success) {
            return res.status(400).json({ error: result.error });
        }

        res.json({ success: true, message: `Generadas ${result.totalBultos} etiquetas.`, details: result });

    } catch (err) {
        console.error("[etiquetasController] Error:", err);
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
                (SELECT COUNT(*) FROM Etiquetas E WHERE E.OrdenID = O.OrdenID) as CantidadEtiquetas
            FROM Ordenes O
            WHERE 
                O.Estado != 'CANCELADO'
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
        console.error("Error en getOrdersForLabels:", err);
        res.status(500).json({ error: 'Error al obtener órdenes para etiquetas' });
    }
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
                LB.Tipocontenido as TipoBulto
            FROM Etiquetas E
            JOIN Ordenes O ON E.OrdenID = O.OrdenID
            LEFT JOIN Logistica_Bultos LB ON E.CodigoEtiqueta = LB.CodigoEtiqueta
            WHERE E.OrdenID IN (${idsStr}) 
            ORDER BY E.OrdenID, E.NumeroBulto ASC
        `);

        if (result.recordset.length === 0) {
            return res.send('<h1>No hay etiquetas generadas para las órdenes seleccionadas</h1>');
        }

        const labels = result.recordset;

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <title>Imprimir Etiquetas</title>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
                <style>
                    /* ... (Keep existing styles) ... */
                    @page { size: 10cm 15cm; margin: 0; }
                    body { font-family: 'Arial', sans-serif; margin: 0; padding: 0; background: #fff; color: #000; }
                    .label-page { 
                        width: 10cm; height: 14.8cm;
                        position: relative; 
                        box-sizing: border-box; 
                        overflow: hidden;
                        page-break-after: always;
                        border: 1px dashed #eee; 
                        padding: 10px 10px 30px 10px; 
                        margin: 0 auto;
                        background: white;
                    }
                    
                    /* ESTILOS COMUNES */
                    .header { border-bottom: 2px solid #000; padding-bottom: 5px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: flex-start; }
                    .header-item { margin-bottom: 2px; }
                    .label-bold { font-weight: 800; font-size: 14px; text-transform: uppercase; }
                    .value-text { font-size: 16px; font-weight: 400; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 250px; }
                    .date-text { font-size: 12px; font-weight: bold; }

                    /* ESTILO FINAL (3 QRs) */
                    .layout-final { display: flex; flex-direction: column; height: 100%; }
                    .final-body { flex: 1; display: flex; flex-direction: column; padding-top: 5px; }
                    .final-top-section { display: flex; gap: 10px; margin-bottom: 10px; align-items: center; }
                    .final-qr-main { width: 120px; height: 120px; background: white; padding: 5px; } 
                    .final-info-right { flex: 1; text-align: right; display: flex; flex-direction: column; justify-content: center; }
                    .big-order-code { font-size: 32px; font-weight: 900; line-height: 1; margin-bottom: 5px; }
                    .final-footer-text { text-align: center; font-weight: 800; font-size: 16px; text-transform: uppercase; border-top: 2px solid #000; padding-top: 5px; margin-top: 15px; margin-bottom: 5px; }
                    
                    .final-bottom-qrs { display: flex; justify-content: space-between; margin-top: 10px; }
                    .qr-bottom-container { text-align: center; }
                    .qr-bottom { width: 90px; height: 90px; margin: 0 auto; }
                    .qr-caption { font-size: 10px; font-weight: bold; margin-top: 2px; }

                    /* ESTILO PROCESO */
                    .layout-process { display: flex; height: 100%; flex-direction: column; }
                    .process-body { display: flex; flex: 1; gap: 10px; }
                    .left-col { width: 55%; display: flex; flex-direction: column; align-items: center; justify-content: center; border-right: 2px solid #000; padding-right: 10px; }
                    .right-col { width: 45%; padding-left: 5px; }
                    .process-qr { width: 170px; height: 170px; margin-bottom: 10px; }
                    .process-big-text { font-size: 24px; font-weight: 900; text-align: center; line-height: 1.1; margin-bottom: 5px; }
                    .process-sub-text { font-size: 18px; font-weight: 700; text-align: center; }
                    .process-code { font-family: monospace; font-size: 14px; font-weight: bold; margin-top: 5px; background: #000; color: #fff; padding: 2px 6px; border-radius: 4px; }
                    .service-list { list-style: none; padding: 0; margin: 0; }
                    .service-item { display: flex; align-items: center; font-size: 14px; font-weight: bold; margin-bottom: 6px; }
                    .check-icon { margin-right: 8px; font-size: 16px; }

                    @media screen {
                        .label-page { border: 1px dashed #ccc; margin: 20px auto; width: 300px; height: 400px; }
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
                        <strong>Vista Previa</strong> (${labels.length} etiquetas)
                    </div>
                    <button onclick="window.print()" style="padding: 10px 25px; font-size: 16px; cursor: pointer; background: #4f46e5; color: white; border: none; border-radius: 6px; font-weight: bold;">
                        🖨️ IMPRIMIR
                    </button>
                </div>

                ${labels.map((label, index) => {
            // Lógica unificada para determinar si es FINAL o EN PROCESO
            const nextService = (label.ProximoServicio || '').trim().toUpperCase();

            // Prioridad 1: TipoBulto explícito en Logistica (seteado por LabelGenerationService)
            // Prioridad 2: Inferencia basada en texto de ProximoServicio (Legacy/Fallback)
            const isFinal = (label.TipoBulto === 'PROD_TERMINADO') ||
                (!label.TipoBulto && (!nextService || nextService.includes('DEPO') || nextService.includes('POSITO') || nextService.includes('LOGISTICA')));

            const formattedDate = new Date(label.FechaIngreso).toLocaleDateString('es-ES');
            const baseOrderCode = label.CodigoOrden ? label.CodigoOrden.split('(')[0].trim() : label.CodigoOrden;

            if (isFinal) {
                // --- DISEÑO FINAL (3 QRs - V3 String) ---
                return `
                        <div class="label-page">
                            <div class="header">
                                <div>
                                    <div class="label-bold">Nº Orden</div>
                                    <div class="value-text" style="font-size: 20px; font-weight: bold;">${label.CodigoOrden}</div>
                                </div>
                                <div style="text-align: right;">
                                    <div class="value-text" style="font-weight:bold;">${label.Cliente}</div>
                                    <div class="date-text">${formattedDate}</div>
                                </div>
                            </div>

                            <div class="layout-final">
                                <div class="final-body">
                                    <div class="final-top-section">
                                        <!-- QR 1: String V3 Completo (Para facturación/entrega) -->
                                        <div id="qr-final-1-${index}" class="final-qr-main"></div>
                                        
                                        <div class="final-info-right" style="min-width: 0; overflow: hidden;">
                                            <div class="label-bold" style="font-size: 12px; color: #555;">Trabajo:</div>
                                            <div class="value-text" style="font-size: 14px; margin-bottom: 15px; white-space: normal; line-height: 1.2;">
                                                ${label.DescripcionTrabajo || label.Material}
                                            </div>
                                            <div class="big-order-code" style="width: 100%;">${label.CodigoOrden}</div>
                                        </div>
                                    </div>

                                    <div class="final-footer-text">Enviar a Deposito</div>

                                    <div class="final-bottom-qrs">
                                        <!-- QR 2: Codigo Etiqueta (Tracking Interno) -->
                                        <div class="qr-bottom-container">
                                            <div id="qr-final-2-${index}" class="qr-bottom"></div>
                                            <div class="qr-caption">${label.CodigoEtiqueta}</div>
                                        </div>
                                        <!-- QR 3: Codigo Orden/Pedido SIMPLE -->
                                        <div class="qr-bottom-container">
                                            <div id="qr-final-3-${index}" class="qr-bottom"></div>
                                            <div class="qr-caption" style="font-size: 12px;">ORDEN ${baseOrderCode}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            
                            <script>
                                new QRCode(document.getElementById("qr-final-1-${index}"), {
                                    text: "${label.CodigoQR ? label.CodigoQR.replace(/"/g, '\\"') : 'N/A'}",
                                    width: 120, height: 120, correctLevel: QRCode.CorrectLevel.M
                                });
                                new QRCode(document.getElementById("qr-final-2-${index}"), {
                                    text: "${label.CodigoEtiqueta}",
                                    width: 90, height: 90, correctLevel: QRCode.CorrectLevel.L
                                });
                                new QRCode(document.getElementById("qr-final-3-${index}"), {
                                    text: "${baseOrderCode}",
                                    width: 90, height: 90, correctLevel: QRCode.CorrectLevel.L
                                });
                            </script>
                        </div>
                        `;
            } else {
                // --- DISEÑO PROCESO (Tracking Interno) ---
                return `
                        <div class="label-page">
                            <div class="header">
                                <div>
                                    <div class="label-bold">CLIENTE: <span style="color: #000;">${label.Cliente}</span></div>
                                    <div class="value-text" style="font-size: 14px;">TRABAJO: ${label.DescripcionTrabajo || label.Material}</div>
                                </div>
                                <div style="text-align: right;">
                                    <div class="label-bold">ÁREA: ${label.AreaOrigen || 'PROD'}</div>
                                    <div class="date-text">${formattedDate}</div>
                                </div>
                            </div>

                            <div class="layout-process">
                                <div class="process-body">
                                    <div class="left-col">
                                        <!-- QR En Proceso: Muestra CodigoEtiqueta para tracking logístico interno -->
                                        <div id="qr-process-${index}" class="process-qr"></div>
                                        <div class="process-big-text">ORDEN:<br>${label.CodigoOrden}</div>
                                        <div class="process-sub-text">BULTO (${label.NumeroBulto}/${label.TotalBultos})</div>
                                        <div class="process-code">${label.CodigoEtiqueta}</div>
                                        <div style="font-size: 12px; font-weight: bold; margin-top: 5px;">Destino: ${label.ProximoServicio || 'Siguiente'}</div>
                                    </div>
                                    <div class="right-col">
                                        <div class="label-bold" style="border-bottom: 2px solid #000; margin-bottom: 5px;">SERVICIOS</div>
                                        <ul class="service-list">
                                            <li class="service-item">
                                                <span class="check-icon">✔</span> ${label.AreaOrigen}
                                            </li>
                                             <li class="service-item" style="color: #666;">
                                                <span class="check-icon">➜</span> ${label.ProximoServicio || '...'}
                                            </li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                             <script>
                                new QRCode(document.getElementById("qr-process-${index}"), {
                                    text: "${label.CodigoEtiqueta}", 
                                    width: 160, height: 160, correctLevel: QRCode.CorrectLevel.Q
                                });
                            </script>
                        </div>
                        `;
            }
        }).join('')}
                
                <script>
                    function fitText(el, maxPt=60, minPt=10) {
                        let size = maxPt; 
                        el.style.fontSize = size + 'px';
                        el.style.whiteSpace = 'nowrap'; 
                        el.style.lineHeight = '1';
                        while (size > minPt && el.scrollWidth > el.clientWidth) { 
                            size--; 
                            el.style.fontSize = size + 'px'; 
                        }
                    }
                    window.onload = function() {
                        const orderCodes = document.querySelectorAll('.big-order-code');
                        orderCodes.forEach(el => fitText(el, 70, 20));
                    }
                </script>
            </body>
            </html>
        `;

        res.send(html);

    } catch (err) {
        console.error("Error printEtiquetas:", err);
        res.status(500).send("Error generando vista de impresión");
    }
};

module.exports = {
    getEtiquetas,
    deleteEtiqueta,
    createExtraLabel,
    printEtiquetas,
    getOrdersForLabels
};
