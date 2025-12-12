const { getPool, sql } = require('../config/db');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp'); 
const { PDFDocument } = require('pdf-lib');

// Conversión: 1 pulgada = 2.54 cm
const pointsToCm = (points) => (points / 72) * 2.54;
const pixelsToCm = (pixels, dpi) => (pixels / dpi) * 2.54;
const cmToM = (cm) => cm / 100; // Nuevo: Convertir de CM a M

// 1. OBTENER LISTA (Se mantiene igual, solo el SELECT SQL sigue devolviendo Ancho/Alto)
exports.getOrdersToMeasure = async (req, res) => {
    // ... (Tu lógica getOrdersToMeasure) ...
    // La consulta SQL se mantiene igual.
    // La conversión de cm a m se hará en el frontend o en measureFiles.
    // ...
    const { area } = req.query;
    try {
        const pool = await getPool();
        
        const result = await pool.request()
            .input('AreaID', sql.VarChar(20), area)
            .query(`
                SELECT 
                    o.OrdenID, o.CodigoOrden, o.Cliente, o.DescripcionTrabajo, o.FechaIngreso,
                    a.ArchivoID, a.NombreArchivo, a.RutaAlmacenamiento, a.TipoArchivo, 
                    a.Copias, a.Ancho, a.Alto, a.MedidaConfirmada, a.Metros -- Incluimos Metros
                FROM dbo.Ordenes o
                INNER JOIN dbo.ArchivosOrden a ON o.OrdenID = a.OrdenID
                WHERE o.AreaID = @AreaID 
                AND o.Estado NOT IN ('Entregado', 'Cancelado', 'Finalizado')
                ORDER BY o.Prioridad DESC, o.FechaIngreso ASC
            `);

        const ordersMap = {};
        result.recordset.forEach(row => {
            if (!ordersMap[row.OrdenID]) {
                ordersMap[row.OrdenID] = {
                    id: row.OrdenID,
                    code: row.CodigoOrden,
                    client: row.Cliente,
                    desc: row.DescripcionTrabajo,
                    date: row.FechaIngreso,
                    files: []
                };
            }
            
            const driveUrl = row.RutaAlmacenamiento; 
            
            ordersMap[row.OrdenID].files.push({
                id: row.ArchivoID,
                name: row.NombreArchivo,
                storagePath: driveUrl,
                url: driveUrl,
                path: row.RutaAlmacenamiento,
                type: row.TipoArchivo,
                copies: row.Copias || 1,
                autoWidth: row.Ancho || 0,
                autoHeight: row.Alto || 0,
                // Usamos el campo 'Metros' para la confirmación
                confirmed: row.Metros || 0, 
                // Medida confirmada anteriormente (si existe)
                // Usamos MedidaConfirmada de la BD para determinar si ya fue medido (true/false)
                isMeasured: row.Metros > 0 || row.MedidaConfirmada > 0
            });
        });

        // Filtrar archivos ya medidos si queremos que se vayan de la pantalla
        const finalOrders = Object.values(ordersMap).map(order => ({
            ...order,
            // Si el archivo ya tiene Metros o MedidaConfirmada, lo consideramos 'medido' y lo ocultamos
            files: order.files.filter(f => f.isMeasured === false)
        })).filter(order => order.files.length > 0); // Ocultar órdenes sin archivos pendientes
        
        res.json(finalOrders);

    } catch (err) {
        console.error("Error obteniendo mediciones:", err);
        res.status(500).json({ error: err.message });
    }
};


// 2. MEDIR ARCHIVOS (REAL - CORREGIDO: Devuelve en Metros M x M)
exports.measureFiles = async (req, res) => {
    const { fileIds } = req.body; 
    const results = [];

    try {
        const pool = await getPool();
        const filesQuery = await pool.request().query(`
            SELECT ArchivoID, RutaAlmacenamiento, TipoArchivo 
            FROM dbo.ArchivosOrden 
            WHERE ArchivoID IN (${fileIds.join(',')})
        `);

        for (const file of filesQuery.recordset) {
            // ... (Lógica de sharp/pdf-lib para obtener widthCm y heightCm) ...
            
            const filePath = file.RutaAlmacenamiento; 
            if (!filePath || !fs.existsSync(filePath)) {
                results.push({ id: file.ArchivoID, width: 0, height: 0, area: 0, error: 'No encontrado' });
                continue;
            }

            const fileBuffer = fs.readFileSync(filePath);
            let widthCm = 0;
            let heightCm = 0;

            if (filePath.toLowerCase().endsWith('.pdf') || file.TipoArchivo === 'pdf') {
                try {
                    const pdfDoc = await PDFDocument.load(fileBuffer, { updateMetadata: false });
                    const pages = pdfDoc.getPages();
                    if (pages.length > 0) {
                        const { width, height } = pages[0].getSize();
                        widthCm = pointsToCm(width);
                        heightCm = pointsToCm(height);
                    }
                } catch (e) { console.error(e); }
            } else {
                try {
                    const metadata = await sharp(fileBuffer).metadata();
                    const density = metadata.density || 72; 
                    widthCm = pixelsToCm(metadata.width, density);
                    heightCm = pixelsToCm(metadata.height, density);
                } catch (e) { console.error(e); }
            }

            // CORRECCIÓN CLAVE: Devolvemos Ancho y Alto en Metros (M)
            const widthM = cmToM(widthCm);
            const heightM = cmToM(heightCm);
            
            // Nota: El áreaM2 solo es informativo, lo devolvemos igual
            const areaM2 = widthM * heightM;

            results.push({
                id: file.ArchivoID,
                width: parseFloat(widthM.toFixed(2)),
                height: parseFloat(heightM.toFixed(2)),
                area: parseFloat(areaM2.toFixed(4))
            });
        }
        res.json({ success: true, results });
    } catch (err) {
        res.status(500).json({ error: "Error interno medidor." });
    }
};

// 3. GUARDAR RESULTADOS (CORREGIDO: Actualiza la columna METROS)
exports.saveMeasurements = async (req, res) => {
    const { measurements } = req.body; // Array [{id, confirmed, width, height}]
    
    try {
        const pool = await getPool();
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        for (const m of measurements) {
            await new sql.Request(transaction)
                .input('ID', sql.Int, m.id)
                .input('MetrosVal', sql.Decimal(10,2), m.confirmed) // Valor Confirmado -> Metros
                .input('W', sql.Decimal(10,2), m.width || 0)     // Ancho (M)
                .input('H', sql.Decimal(10,2), m.height || 0)    // Alto (M)
                // Opcional: Marcar como Medido si tu tabla tiene esa columna (usaremos Metros > 0)
                .query(`
                    UPDATE dbo.ArchivosOrden 
                    SET 
                        Metros = @MetrosVal,          -- ACTUALIZA EL CAMPO CLAVE (INVENTARIO)
                        Ancho = @W,                   -- Guarda Ancho M
                        Alto = @H,                    -- Guarda Alto M
                        MedidaConfirmada = 1          -- Marcador para indicar que se hizo la revisión
                    WHERE ArchivoID = @ID
                `);
        }

        await transaction.commit();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};