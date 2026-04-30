const fs = require('fs');
const path = require('path');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
require('dotenv').config();
const { getPool } = require('./config/db');

// --- Helper para encontrar imágenes del logo / sello ---
const findImage = (filename) => {
    const paths = [
        path.join(__dirname, '..', 'public', 'assets', 'images', filename),
        path.join(__dirname, '..', 'src', 'assets', 'images', filename),
        path.join(__dirname, 'public', 'assets', 'images', filename),
        path.join(__dirname, 'src', 'assets', 'images', filename),
        path.join(process.cwd(), 'public', 'assets', 'images', filename),
        path.join(process.cwd(), 'src', 'assets', 'images', filename),
    ];
    return paths.find(p => fs.existsSync(p)) || null;
};

// --- Motor de Generación PDF idéntico a Producción ---
async function buildPdfBuffer(transactionId, paidAt, ordenRetiro, codCliente, paymentMethod, orders, currencySymbol, totalAmount, currencyVal) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([595.28, 841.89]); // A4
    const { width } = page.getSize();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);

    const drawCentered = (text, y, size, f) => {
        const tw = f.widthOfTextAtSize(text, size);
        page.drawText(text, { x: (width - tw) / 2, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
    };
    const drawLeft = (text, x, y, size, f, color) => {
        page.drawText(text, { x, y, size, font: f, color: color || rgb(0.1, 0.1, 0.1) });
    };
    const drawRight = (text, x, y, size, f, color) => {
        const tw = f.widthOfTextAtSize(text, size);
        page.drawText(text, { x: x - tw, y, size, font: f, color: color || rgb(0.1, 0.1, 0.1) });
    };

    let y = 780;

    try {
        const logoPath = findImage('logo.png');
        if (logoPath) {
            const logoBytes = fs.readFileSync(logoPath);
            const logoImage = await doc.embedPng(logoBytes);
            const logoHeight = 40;
            const logoWidth = logoHeight * (logoImage.width / logoImage.height);
            page.drawImage(logoImage, { x: 50, y: y - 12, width: logoWidth, height: logoHeight });
        }
    } catch (e) { }

    drawCentered('COMPROBANTE DE PAGO', y, 18, fontBold);
    y -= 30;

    drawRight(transactionId || '', width - 50, y, 9, font, rgb(0.55, 0.55, 0.55));
    y -= 10;
    page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 0.5, color: rgb(0.78, 0.78, 0.78) });
    y -= 25;

    const fechaStr = paidAt ? new Date(paidAt).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : new Date().toLocaleDateString('es-UY');
    drawRight(fechaStr, width - 50, y, 9, font, rgb(0.47, 0.47, 0.47));

    const rawId = String(ordenRetiro || '').replace(/^[A-Za-z]+-0*/i, '');
    const retiroCode = rawId ? `RW-${rawId}` : '-';

    drawLeft('CÓDIGO DE RETIRO', 50, y, 9, fontBold);
    y -= 16;
    drawLeft(retiroCode, 50, y, 14, fontBold);
    y -= 22;

    drawLeft('CÓDIGO DE CLIENTE', 50, y, 9, fontBold);
    y -= 16;
    drawLeft(String(codCliente || '-'), 50, y, 14, fontBold);
    y -= 28;

    drawLeft('MEDIO DE PAGO', 50, y, 9, font, rgb(0.47, 0.47, 0.47));
    drawRight(String(paymentMethod || 'HANDY').toUpperCase(), width - 50, y, 10, fontBold);
    y -= 25;

    if (orders && orders.length > 0) {
        page.drawRectangle({ x: 50, y: y - 5, width: width - 100, height: 18, color: rgb(0.1, 0.1, 0.1) });
        drawLeft('PEDIDO', 54, y, 8, fontBold, rgb(1, 1, 1));
        drawRight('IMPORTE', width - 54, y, 8, fontBold, rgb(1, 1, 1));
        y -= 22;

        orders.forEach((o, i) => {
            page.drawRectangle({ x: 50, y: y - 5, width: width - 100, height: 18, color: i % 2 === 0 ? rgb(0.96, 0.96, 0.96) : rgb(0.83, 0.83, 0.85) });
            drawLeft(String(o.id || o.desc || ''), 54, y, 10, font);
            drawRight(`${currencySymbol || '$'} ${Number(o.amount || 0).toFixed(2)}`, width - 54, y, 10, fontBold);
            y -= 18;
        });
        y -= 10;
    }

    page.drawLine({ start: { x: 50, y }, end: { x: width - 50, y }, thickness: 0.5, color: rgb(0.78, 0.78, 0.78) });
    y -= 20;
    drawRight('TOTAL:', width - 130, y, 12, fontBold);
    drawRight(`${currencySymbol || '$'} ${Number(totalAmount).toFixed(2)}`, width - 50, y, 12, fontBold, rgb(0.02, 0.59, 0.41));
    y -= 14;
    drawRight(currencyVal === 840 ? 'USD' : 'UYU', width - 50, y, 10, font);

    let stampDrawn = false;
    try {
        const stampPath = findImage('pagado-stamp.png');
        if (stampPath) {
            const stampBytes = fs.readFileSync(stampPath);
            const stampImage = await doc.embedPng(stampBytes);
            const stampWidth = 120;
            const stampHeight = stampWidth * (stampImage.height / stampImage.width);
            page.drawImage(stampImage, { x: 50, y: y - stampHeight + 10, width: stampWidth, height: stampHeight, opacity: 0.7 });
            stampDrawn = true;
        }
    } catch (e) { }

    if (!stampDrawn) drawLeft('PAGADO', 50, y, 18, fontBold, rgb(0.02, 0.59, 0.41));
    drawCentered('ESTE COMPROBANTE FUE GENERADO AUTOMATICAMENTE.', 40, 8, font);

    return doc.save();
}

async function runRecovery() {
    console.log('=== INICIANDO RESCATE MÁGICO DE COMPROBANTES HANDY ===');
    console.log('Ambiente:', process.env.DB_SERVER, process.env.DB_DATABASE);

    let pool;
    try {
        pool = await getPool();

        const txRes = await pool.request().query(`
            SELECT 
                h.Id as internalId, 
                h.TransactionId,
                h.CodCliente,
                h.PaidAt,
                h.Currency,
                h.TotalAmount,
                h.OrdersJson
            FROM HandyTransactions h
            WHERE h.Status = 'Pagado' AND h.OrdersJson IS NOT NULL
        `);

        console.log(`🔎 Escaneadas ${txRes.recordset.length} transacciones pagadas por Handy.`);

        let successCount = 0;
        let failCount = 0;
        let missingOrphans = 0;

        const baseDir = process.env.COMPROBANTES_PATH || path.join(__dirname, 'comprobantesPagos');
        if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

        for (const row of txRes.recordset) {
            let json = null;
            try { json = JSON.parse(row.OrdersJson); } catch (e) { }
            if (!json || !json.ordenRetiro || !json.orders) continue;

            let retiro = json.ordenRetiro;
            let rawId = String(retiro).replace(/^[A-Za-z]+-0*/i, '');

            const pagQuery = await pool.request().query(`SELECT PagIdPago FROM OrdenesRetiro WHERE OReIdOrdenRetiro = '${rawId}'`);
            if (pagQuery.recordset.length === 0 || !pagQuery.recordset[0].PagIdPago) {
                missingOrphans++;
                continue;
            }

            const pagoId = pagQuery.recordset[0].PagIdPago;
            const dbPago = await pool.request().query(`SELECT PagRutaComprobante FROM Pagos WHERE PagIdPago = ${pagoId}`);

            if (dbPago.recordset.length > 0) {
                const currentPath = dbPago.recordset[0].PagRutaComprobante;
                // Actuar si:
                // 1. No tiene comprobante asignado
                // 2. Quedó con el nombre corrupto Comprobante--.pdf
                // 3. Quedó con el UUID de transacción en vez del código RW- (bug anterior)
                const hasUuidName = currentPath && /Comprobante-[0-9a-f]{8}-[0-9a-f]{4}-/.test(currentPath);
                if (!currentPath || currentPath.includes('Comprobante--.pdf') || hasUuidName) {

                    const currencyObj = json.moneda || (row.Currency === 840 ? 'USD' : 'UYU');
                    const currencySymbol = currencyObj === 'USD' ? 'U$S' : '$';

                    const pdfBytes = await buildPdfBuffer(
                        row.TransactionId,
                        row.PaidAt,
                        retiro,
                        row.CodCliente,
                        'HANDY',
                        json.orders,
                        currencySymbol,
                        row.TotalAmount,
                        row.Currency
                    );

                    const retiroCode = rawId ? `RW-${rawId}` : '-';

                    // --- ARREGLO DE NOMBRE A PRUEBA DE COLISIONES ---
                    const safeCode = (retiroCode !== '-') ? retiroCode : row.TransactionId;
                    const fileName = `Comprobante-${safeCode}.pdf`;
                    const filePath = path.join(baseDir, fileName);
                    fs.writeFileSync(filePath, pdfBytes);

                    const dbPath = `/comprobantesPagos/${fileName}`;
                    await pool.request().query(`UPDATE Pagos SET PagRutaComprobante = '${dbPath}' WHERE PagIdPago = ${pagoId}`);

                    successCount++;
                    console.log(`✅ [${successCount}] Recuperado y subido: ${dbPath}`);
                }
            }
        } // <- Añadiendo la llave que cerraba el bucle for

        console.log('\n=== REPORTE FINAL ===');
        console.log(`✅ Comprobantes re-generados y guardados: ${successCount}`);
        console.log(`⚠️  Transacciones sin ID de pago vinculado: ${missingOrphans}`);
        console.log(`=====================================`);
    } catch (e) {
        console.error('Error Crítico:', e);
    } finally {
        process.exit();
    }
}

runRecovery();
