import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import QRCode from 'qrcode';

// Configuración visual compartida
const COLOR_PRIMARY = [30, 58, 138]; // blue-900
const COLOR_SECONDARY = [100, 116, 139]; // slate-500
const COLOR_BORDER = [226, 232, 240]; // slate-200

// ─── Importe en letras (es-UY) ─────────────────────────────────────────────
const UNIDADES = ['','UNO','DOS','TRES','CUATRO','CINCO','SEIS','SIETE','OCHO','NUEVE',
    'DIEZ','ONCE','DOCE','TRECE','CATORCE','QUINCE','DIECISEIS','DIECISIETE','DIECIOCHO','DIECINUEVE'];
const DECENAS = ['','DIEZ','VEINTE','TREINTA','CUARENTA','CINCUENTA','SESENTA','SETENTA','OCHENTA','NOVENTA'];
const CENTENAS = ['','CIEN','DOSCIENTOS','TRESCIENTOS','CUATROCIENTOS','QUINIENTOS','SEISCIENTOS','SETECIENTOS','OCHOCIENTOS','NOVECIENTOS'];

function _centenas(n) {
    if (n === 0) return '';
    if (n < 20) return UNIDADES[n];
    if (n === 100) return 'CIEN';
    const c = Math.floor(n / 100);
    const resto = n % 100;
    const cStr = c > 0 ? CENTENAS[c] : '';
    if (resto === 0) return cStr;
    if (n < 100) {
        const d = Math.floor(n / 10), u = n % 10;
        return (u === 0 ? DECENAS[d] : `${DECENAS[d]} Y ${UNIDADES[u]}`);
    }
    return `${cStr} ${_centenas(resto)}`.trim();
}

function _miles(n) {
    if (n < 1000) return _centenas(n);
    const miles = Math.floor(n / 1000);
    const resto = n % 1000;
    const mStr = miles === 1 ? 'MIL' : `${_centenas(miles)} MIL`;
    return `${mStr}${resto > 0 ? ' ' + _centenas(resto) : ''}`.trim();
}

function numeroALetras(monto) {
    if (monto == null || isNaN(monto)) return '';
    const abs = Math.abs(Number(monto));
    const entero = Math.floor(abs);
    const centavos = Math.round((abs - entero) * 100);
    const letras = entero === 0 ? 'CERO' : _miles(entero);
    return `${letras} CON ${String(centavos).padStart(2, '0')}/100`;
}
// ───────────────────────────────────────────────────────────────────────────

export const generarPdfFacturaDGI = async (doc, detalles) => {
    // Parse SISNET DGI fields from our DB fields if they exist
    if (doc.CfeUrlImpresion && doc.CfeUrlImpresion.includes('?')) {
        try {
            const qrParts = doc.CfeUrlImpresion.split('?')[1].split(',');
            if (qrParts.length >= 7) {
                doc.DocSerie = qrParts[2];
                doc.DocNumero = qrParts[3];
                doc.DocCodSeguridad = decodeURIComponent(qrParts[6]).substring(0, 6);
            }
        } catch(e) {}
    }
    
    if (doc.CfeNumeroOficial && doc.CfeNumeroOficial.includes('CAE')) {
        const matches = doc.CfeNumeroOficial.match(/CAE\s*(\d+)/i);
        if (matches && matches[1]) doc.DocCaeNumero = matches[1];
        
        const rangoMatches = doc.CfeNumeroOficial.match(/Serie.*$/i);
        if (rangoMatches) {
            const parts = rangoMatches[0].split('/');
            if (parts.length === 2) {
                doc.SecRangoDesde = parts[0].replace(/\D/g, '');
                doc.SecRangoHasta = parts[1].replace(/\D/g, '');
            }
        }
    }

    if (!doc.SecFechaVencimientoCAE && doc.CfeCAE) {
        const vtoMatch = doc.CfeCAE.match(/(\d{2}\/\d{2}\/\d{4})/);
        if (vtoMatch) {
            // Convert DD/MM/YYYY to MM/DD/YYYY for Date parsing
            const parts = vtoMatch[1].split('/');
            if (parts.length === 3) {
                doc.SecFechaVencimientoCAE = `${parts[1]}/${parts[0]}/${parts[2]}`;
            }
        }
    }
    const pdf = new jsPDF({ format: 'a4' });
    const esUYU = doc.MonIdMoneda === 1;
    const monedaStr = esUYU ? 'Peso Uruguayo' : 'Dólar estadounidense';
    const fmtNum = (n) => new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

    // Fuente y estilos base
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(0, 0, 0);

    // ==========================================
    // LOGO Y DATOS EMPRESA (IZQUIERDA)
    // ==========================================
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(48);
    pdf.text("user", 15, 30);

    // Cuadritos CMYK abajo de 'user'
    pdf.setFillColor(0, 174, 239); // Cyan
    pdf.rect(15, 35, 12, 4, 'F');
    pdf.setFillColor(236, 0, 140); // Magenta
    pdf.rect(29, 35, 12, 4, 'F');
    pdf.setFillColor(255, 242, 0); // Yellow
    pdf.rect(43, 35, 12, 4, 'F');
    pdf.setFillColor(0, 0, 0); // Black
    pdf.rect(57, 35, 12, 4, 'F');

    pdf.setFontSize(14);
    pdf.text("Centro de Impresión Digital", 15, 45);

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text("LALINDE MORALES HECTOR ARTIGAS,", 15, 50);
    pdf.text("LALINDE FALERO FELIPE Y OTROS", 15, 54);

    pdf.setFontSize(10);
    pdf.text("VILARDEBO 2031", 15, 60);
    pdf.text("MONTEVIDEO", 15, 64);
    pdf.text("TEL:", 15, 68);

    // ==========================================
    // CAJAS SUPERIORES (DERECHA)
    // ==========================================
    const rightX = 100;
    const boxW = 95;
    pdf.setLineWidth(0.4);

    // Caja 1: RUC | TIPO
    pdf.rect(rightX, 15, boxW, 10);
    pdf.line(rightX, 20, rightX + boxW, 20); // Horizontal mid
    pdf.line(rightX + boxW / 2, 15, rightX + boxW / 2, 25); // Vertical split
    pdf.setFontSize(8);
    pdf.text("RUC", rightX + boxW / 4, 19, { align: 'center' });
    pdf.text("TIPO DE DOCUMENTO", rightX + boxW * 0.75, 19, { align: 'center' });
    pdf.setFontSize(10);
    pdf.text("218973270018", rightX + boxW / 4, 24, { align: 'center' });
    const DOC_TIPO_LABEL_PDF = {
      '07': 'E-Ticket Contado', '08': 'E-Ticket Crédito', '10': 'N.Crédito E-Ticket',
      '01': 'E-Factura Contado', '02': 'E-Factura Crédito', '04': 'N.Crédito E-Factura',
      '107': 'E-Ticket Contado', '108': 'E-Ticket Crédito', '101': 'E-Factura Contado', '102': 'E-Factura Crédito',
      'PedidoCaja': 'Pedido Caja', 'PC': 'Pedido Caja',
    };
    const docTipoDisplay = doc.DocTipo ? (DOC_TIPO_LABEL_PDF[doc.DocTipo.trim()] || doc.DocTipo.trim()) : 'e-Factura';
    pdf.text(docTipoDisplay, rightX + boxW * 0.75, 24, { align: 'center' });

    // Caja 2: SERIE | NUMERO | FORMA
    pdf.rect(rightX, 28, boxW, 10);
    pdf.line(rightX, 33, rightX + boxW, 33);
    pdf.line(rightX + boxW / 3, 28, rightX + boxW / 3, 38);
    pdf.line(rightX + boxW * 0.66, 28, rightX + boxW * 0.66, 38);
    pdf.setFontSize(8);
    pdf.text("SERIE", rightX + boxW / 6, 32, { align: 'center' });
    pdf.text("NUMERO", rightX + boxW / 2, 32, { align: 'center' });
    pdf.text("FORMA DE PAGO", rightX + boxW * 0.83, 32, { align: 'center' });
    pdf.setFontSize(10);
    pdf.text(doc.DocSerie || "A", rightX + boxW / 6, 37, { align: 'center' });
    pdf.text(doc.DocNumero ? String(doc.DocNumero) : "BORRADOR", rightX + boxW / 2, 37, { align: 'center' });
    pdf.text(doc.DocPagado ? "Contado" : "Crédito", rightX + boxW * 0.83, 37, { align: 'center' });

    // Caja 3: RUC COMPRADOR
    // Los e-Tickets son siempre B2C → CONSUMIDOR FINAL (nunca mostrar RUT/CI del comprador)
    // Solo las e-Facturas (B2B) deben mostrar el RUT real del comprador
    const esETicketDoc = (() => {
        const tipo = String(doc.DocTipo || '').toUpperCase();
        // Detectar por tipo interno (07, 08, 10, 11) o por descripción que contenga TICKET
        return tipo.includes('TICKET') ||
               tipo === '07' || tipo === '08' || tipo === '10' || tipo === '11' ||
               tipo === '101' || tipo === '102' || tipo === '103';
    })();

    let rucComprador = "CONSUMIDOR FINAL";
    if (!esETicketDoc) {
        // e-Factura: mostrar RUT real del comprador
        rucComprador = doc.DocCliDocumento
            ? String(doc.DocCliDocumento)
            : (doc.CliRUT ? String(doc.CliRUT) : (doc.StringIDCliente ? String(doc.StringIDCliente).trim() : "CONSUMIDOR FINAL"));
    }
    // Para e-Ticket: siempre "CONSUMIDOR FINAL" sin importar si hay un documento cargado


    pdf.rect(rightX, 41, boxW, 12);
    pdf.setFontSize(8);
    pdf.text("RUC COMPRADOR", rightX + boxW / 2, 45, { align: 'center' });
    pdf.setFontSize(14);
    pdf.setFont('helvetica', 'bold');
    pdf.text(rucComprador, rightX + boxW / 2, 51, { align: 'center' });
    pdf.setFont('helvetica', 'normal');

    // ==========================================
    // CAJAS MEDIAS
    // ==========================================
    const midY = 75;

    // Caja 4: FECHA | MONEDA (Izquierda)
    pdf.rect(15, midY, 80, 10);
    pdf.line(15, midY + 5, 95, midY + 5);
    pdf.line(55, midY, 55, midY + 10);
    pdf.setFontSize(8);
    pdf.text("FECHA", 35, midY + 4, { align: 'center' });
    pdf.text("MONEDA", 75, midY + 4, { align: 'center' });
    pdf.setFontSize(9);
    const fechaEmision = doc.DocFechaEmision ? new Date(doc.DocFechaEmision).toLocaleDateString('es-UY') : new Date().toLocaleDateString('es-UY');
    pdf.text(fechaEmision, 35, midY + 9, { align: 'center' });
    pdf.text(monedaStr, 75, midY + 9, { align: 'center' });

    // Caja 5: DATOS DEL CLIENTE (Derecha)
    pdf.rect(rightX, 56, boxW, 30);
    pdf.line(rightX, 61, rightX + boxW, 61);
    pdf.setFontSize(8);
    pdf.text("DATOS DEL CLIENTE", rightX + boxW / 2, 60, { align: 'center' });
    pdf.setFontSize(9);

    const nombreCli = doc.DocCliNombre || doc.CliNombreFantasia || doc.CliRazonSocial || 'CONSUMIDOR FINAL';
    const nfantasia = doc.StringIDCliente ? String(doc.StringIDCliente).trim() : '';
    const direccion = doc.DocCliDireccion || doc.CliDireccion || '';
    const ciudad = doc.DocCliCiudad || '';
    pdf.text(`CLIENTE: ${nombreCli}`, rightX + 2, 65);
    pdf.text(`NOMBRE FANTASÍA: ${nfantasia}`, rightX + 2, 70);
    pdf.text(`DIRECCIÓN: ${direccion}`, rightX + 2, 75);
    pdf.text(`CIUDAD: ${ciudad}`, rightX + 2, 80);

    // ==========================================
    // TABLA DE DETALLES
    // ==========================================
    const startY = 95;

    // Format data for table
    let tableBody = [];
    if (detalles && detalles.length > 0) {
        tableBody = detalles.map((d, index) => {
            const isHeader = d.isHeader || (d.DcdCantidad == null && d.DcdSubtotal == null && d.DcdNomItem && d.DcdNomItem.startsWith('Orden:'));
            const isSubtotal = d.isSubtotal || (d.DcdNomItem && d.DcdNomItem.startsWith('SUBTOTAL ORDEN'));

            if (isHeader) {
                return [
                    '',
                    { content: d.DcdNomItem, colSpan: 7, styles: { fontStyle: 'bold', fillColor: [245, 245, 245], textColor: [79, 70, 229] } }
                ];
            }

            if (isSubtotal) {
                return [
                    '',
                    { content: d.DcdNomItem, styles: { fontStyle: 'bold', halign: 'right' } },
                    '',
                    '',
                    '',
                    '',
                    '',
                    { content: fmtNum(d.DcdSubtotal), styles: { fontStyle: 'bold' } }
                ];
            }

            // Safe parsing of inputs with fallback to 0
            const rawSubtotal = d.DcdSubtotal != null && !isNaN(Number(d.DcdSubtotal)) ? Number(d.DcdSubtotal) : 0;
            const rawImpuestos = d.DcdImpuestos != null && !isNaN(Number(d.DcdImpuestos)) ? Number(d.DcdImpuestos) : null;
            const rawTotal = d.DcdTotal != null && !isNaN(Number(d.DcdTotal)) ? Number(d.DcdTotal) : null;

            let lineTotal, lineNeto, lineIva, lineRate;

            if (rawTotal != null) {
                // Database record with all columns populated
                lineTotal = rawTotal;
                lineNeto = rawSubtotal;
                lineIva = rawImpuestos != null ? rawImpuestos : (lineTotal - lineNeto);
                lineRate = (lineNeto > 0) ? Math.round((lineIva / lineNeto) * 100) : 22;
            } else if (rawImpuestos != null) {
                // Subtotal and Impuestos populated, but Total is null
                lineNeto = rawSubtotal;
                lineIva = rawImpuestos;
                lineTotal = lineNeto + lineIva;
                lineRate = (lineNeto > 0) ? Math.round((lineIva / lineNeto) * 100) : 22;
            } else {
                // UI preview / draft: DcdSubtotal holds the gross total of the line, or we don't have DcdTotal/DcdImpuestos.
                // We assume a 22% IVA rate to compute net and taxes.
                lineTotal = rawSubtotal;
                lineNeto = lineTotal / 1.22;
                lineIva = lineTotal - lineNeto;
                lineRate = 22;
            }

            const lineCantidad = Number(d.DcdCantidad) || 1;
            const pUnitario = lineCantidad > 0 ? (lineTotal / lineCantidad) : 0;
            const descBruto = Number(d.DcdTotalDescuentos || 0);
            const originalSub = pUnitario * lineCantidad;

            let descuentoStr = d.DcdDescuentoStr || '';
            if (!descuentoStr && descBruto > 0.01) {
                const pct = (descBruto / originalSub) * 100;
                descuentoStr = `${fmtNum(descBruto)} (${fmtNum(pct)}%)`;
            }

            const puNeto = pUnitario - (descBruto / lineCantidad);
            
            const currencySymbol = doc.MonIdMoneda === 2 ? 'U$S' : '$';
            const descText = d.DcdNomItem + (d.DcdDscItem ? `\n${d.DcdDscItem}` : '') + ` (Neto: ${currencySymbol} ${fmtNum(lineNeto)})`;

            return [
                index + 1,
                descText,
                `${lineRate}%`,
                fmtNum(pUnitario),        // P. Unitario (bruto con IVA)
                fmtNum(lineCantidad),     // Cantidad exacta
                descuentoStr,             // Descuentos
                fmtNum(puNeto),           // P.U. Neto (bruto - descuento)
                fmtNum(lineTotal)         // Importe = total línea con IVA incluido
            ];
        });
    } else {
        const servSub = doc.DocTotal || doc.DocSubtotal;
        tableBody = [['1', 'Servicios', '22%', fmtNum(servSub), '1', '', fmtNum(servSub), fmtNum(servSub)]];
    }

    autoTable(pdf, {
        startY: startY,
        head: [['Código', 'Descripción', 'IVA', 'P. Unitario', 'Cantidad', 'Descuentos', 'P.U. Neto', 'Importe']],
        body: tableBody,
        theme: 'grid',
        headStyles: {
            fillColor: [255, 255, 255],
            textColor: [0, 0, 0],
            lineColor: [0, 0, 0],
            lineWidth: 0.4,
            fontStyle: 'normal',
            halign: 'center',
            fontSize: 8,
            cellPadding: 1.5
        },
        styles: {
            font: 'helvetica',
            fontSize: 8,
            textColor: [0, 0, 0],
            lineColor: [0, 0, 0],
            lineWidth: 0.4,
            cellPadding: 1.5,
            valign: 'middle'
        },
        columnStyles: {
            0: { cellWidth: 20, halign: 'left' },
            1: { cellWidth: 'auto', halign: 'left' },
            2: { cellWidth: 12, halign: 'right' },
            3: { cellWidth: 20, halign: 'right' },
            4: { cellWidth: 18, halign: 'right' },
            5: { cellWidth: 20, halign: 'right' },
            6: { cellWidth: 20, halign: 'right' },
            7: { cellWidth: 22, halign: 'right' }
        },
        margin: { left: 15, right: 15 }
    });

    // ==========================================
    // TOTALES (FOOTER)
    // ==========================================
    const finalY = pdf.lastAutoTable.finalY + 10;

    pdf.setFontSize(9);
    pdf.text("Gravado 22%", 150, finalY);
    pdf.text(fmtNum(doc.DocSubtotal), 195, finalY, { align: 'right' });

    pdf.text("IVA 22%", 150, finalY + 5);
    pdf.text(fmtNum(doc.DocImpuestos), 195, finalY + 5, { align: 'right' });

    pdf.text("Total", 150, finalY + 10);
    pdf.text(fmtNum(doc.DocTotal), 195, finalY + 10, { align: 'right' });

    pdf.setFontSize(12);
    pdf.setFont('helvetica', 'bold');
    pdf.text("TOTAL:", 150, finalY + 18);
    pdf.text(fmtNum(doc.DocTotal), 195, finalY + 18, { align: 'right' });

    // Observaciones
    if (doc.DocObservaciones) {
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'bold');
        pdf.text("Observaciones:", 15, finalY);
        pdf.setFont('helvetica', 'normal');

        // Multi-line text for observations to fit within width 120
        const obsLines = pdf.splitTextToSize(doc.DocObservaciones, 120);
        pdf.text(obsLines, 15, finalY + 5);
    }

    // ==========================================
    // FOOTER CFE / DGI
    // ==========================================
    // El footer CFE arranca después del bloque de totales.
    // finalY + 18 es donde termina el TOTAL en negrita; sumamos margen de 15.
    const footerY = finalY + 30;

    // Línea separadora
    pdf.setLineWidth(0.3);
    pdf.setDrawColor(180, 180, 180);
    pdf.line(15, footerY, 195, footerY);

    // --- Bloque izquierdo: QR (placeholder hasta integración DGI) ---
    const qrY = footerY + 4;
    if (doc.CfeUrlImpresion) {
        try {
            const qrDataUrl = await QRCode.toDataURL(doc.CfeUrlImpresion, { errorCorrectionLevel: 'M', margin: 0 });
            pdf.addImage(qrDataUrl, 'PNG', 15, qrY, 28, 28);
        } catch(e) {
            console.error("Error generating QR", e);
        }
    } else if (doc.DocCaeNumero) {
        // Cuando haya CAE real pero no URL (fallback)
        pdf.setFillColor(240, 240, 240);
        pdf.rect(15, qrY, 28, 28, 'F');
        pdf.setFontSize(5);
        pdf.setTextColor(100, 100, 100);
        pdf.text('QR', 29, qrY + 14, { align: 'center' });
    } else {
        pdf.setFillColor(245, 245, 245);
        pdf.rect(15, qrY, 28, 28, 'F');
        pdf.setFontSize(5);
        pdf.setTextColor(150, 150, 150);
        pdf.text('PENDIENTE DGI', 29, qrY + 14, { align: 'center' });
    }

    // --- Bloque central: datos DGI ---
    const dgiX = 47;
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(180, 0, 0); // rojo DGI

    let dgiY = qrY + 4;

    const resNro = doc.SecNroResolucion || '06/08/2023';
    pdf.text(`Res. Nro.  ${resNro}`, dgiX, dgiY);
    dgiY += 5;

    const urlVerif = doc.CfeUrlVerificacion || 'https://www.efactura.dgi.gub.uy/principal/verificacioncfe';
    pdf.text(`Puede verificar el comprobante en  ${urlVerif}`, dgiX, dgiY);
    dgiY += 5;

    const ivaDia = doc.CfeTextoIvaDia || 'Iva al día';
    pdf.text(ivaDia, dgiX, dgiY);
    dgiY += 5;

    if (doc.DocCaeNumero) {
        pdf.text(`Nro. CAE:  ${doc.DocCaeNumero}`, dgiX, dgiY);
        dgiY += 5;
    } else {
        pdf.setTextColor(200, 100, 0);
        pdf.text('Nro. CAE:  PENDIENTE - No enviado a DGI', dgiX, dgiY);
        dgiY += 5;
    }

    pdf.setTextColor(180, 0, 0);
    if (doc.SecRangoDesde && doc.SecRangoHasta) {
        pdf.text(`Rango:  Serie ${doc.DocSerie || 'A'} del N° ${doc.SecRangoDesde} al ${doc.SecRangoHasta}`, dgiX, dgiY);
        dgiY += 5;
    }

    // --- Bloque derecho: Fecha Vencimiento CAE ---
    if (doc.SecFechaVencimientoCAE) {
        let fmtFechaVenc = doc.SecFechaVencimientoCAE;
        try {
            const parsed = new Date(doc.SecFechaVencimientoCAE);
            if (!isNaN(parsed.getTime())) {
                fmtFechaVenc = parsed.toLocaleDateString('es-UY', { timeZone: 'UTC' });
            }
        } catch(e) {}
        pdf.setDrawColor(0, 0, 0);
        pdf.setLineWidth(0.3);
        pdf.rect(148, qrY, 47, 10);
        pdf.setFontSize(8);
        pdf.setTextColor(0, 0, 0);
        pdf.text(`Fecha de Vencimiento: ${fmtFechaVenc}`, 171, qrY + 6, { align: 'center' });
    }

    // Código de seguridad y página
    pdf.setFontSize(7);
    pdf.setTextColor(60, 60, 60);
    const codSeg = doc.DocCodSeguridad ? `Código de Seguridad: ${doc.DocCodSeguridad}` : '';
    if (codSeg) pdf.text(codSeg, 15, qrY + 33);
    pdf.text('Página 1 de 1', 195, qrY + 33, { align: 'right' });

    // ==========================================
    // ADENDA
    // ==========================================
    const adendaY = qrY + 38;
    pdf.setFillColor(230, 230, 230);
    pdf.rect(15, adendaY, 180, 6, 'F');
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(0, 0, 0);
    pdf.text('Adenda', 105, adendaY + 4, { align: 'center' });

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    let adY = adendaY + 9;

    // Tipo + número documento
    const tipoNum = `${doc.DocTipo || ''} Nº ${doc.DocNumero || ''}`.trim();
    if (tipoNum.length > 3) {
        pdf.setFont('helvetica', 'bold');
        pdf.text(tipoNum, 15, adY);
        pdf.setFont('helvetica', 'normal');
        adY += 5;
    }

    // Importe en letras
    const importeLetras = numeroALetras(doc.DocTotal || 0);
    if (importeLetras) {
        pdf.setTextColor(180, 0, 0);
        pdf.text(`Importe:${importeLetras}`, 15, adY);
        pdf.setTextColor(0, 0, 0);
        adY += 5;
    }

    // Cliente + teléfono + familia
    const cliId  = (doc.StringIDCliente || doc.CliIdCliente || '').toString().trim();
    const cliNom = (doc.DocCliNombre || doc.CliNombreFantasia || '').toString().trim();
    const cliTel = doc.CliTelefono ? ` Tel:${doc.CliTelefono.toString().trim()}` : '';
    const cliFam = doc.CliFamilia   ? `  Familia: ${doc.CliFamilia}` : '';
    if (cliId || cliNom) {
        pdf.text(`Cliente:        ${cliId} (${cliNom})${cliTel}${cliFam}`, 15, adY);
        adY += 5;
    }

    // Plan de financiación (crédito)
    if (!doc.DocPagado && doc.DocDiasVencimiento) {
        pdf.text(`Plan de Financiacion:${doc.DocDiasVencimiento} Dias x ${fmtNum(doc.DocTotal)}`, 15, adY);
        adY += 5;
    }

    pdf.setDrawColor(180, 180, 180);
    pdf.line(15, adY, 105, adY);
    adY += 4;

    // Vendedor
    if (doc.VendedorNombre || doc.VendedorId) {
        pdf.text(`Vendedor: ${doc.VendedorId || ''} ${doc.VendedorNombre || ''}`.trim(), 15, adY);
        adY += 5;
    }

    // Unidades totales
    if (doc.DocTotalUnidades != null) {
        pdf.text(`Unidades:        ${fmtNum(doc.DocTotalUnidades)}`, 15, adY);
    }

    // Marca de agua si no está aceptado por DGI
    if (doc.CfeEstado !== 'ACEPTADO_DGI') {
        pdf.saveGraphicsState();
        pdf.setGState(new pdf.GState({opacity: 0.15}));
        pdf.setTextColor(100, 100, 100);
        pdf.setFontSize(70);
        pdf.setFont('helvetica', 'bold');
        pdf.text("BORRADOR", 105, 160, { align: 'center', angle: 45 });
        pdf.restoreGraphicsState();
        // Reset defaults just in case
        pdf.setTextColor(0, 0, 0);
        pdf.setFontSize(8);
        pdf.setFont('helvetica', 'normal');
    }

    // Visualizar en nueva pestaña
    const safeNum = doc.DocNumero || 'Borrador';
    pdf.setProperties({
        title: `Factura_${doc.DocSerie || 'A'}_${safeNum}`
    });
    const blob = pdf.output('blob');
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
};

export const generarPdfEstadoCuenta = (cliente, cuentas, secciones, planes, desde, hasta) => {
    const pdf = new jsPDF({ format: 'a4' });
    const fmtNum = (n) => new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    const fmtFecha = (dateString) => new Date(dateString).toLocaleDateString('es-UY', { timeZone: 'UTC' });

    // Fuente y estilos base
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(18);
    pdf.setTextColor(...COLOR_PRIMARY);

    // Título
    pdf.text("ESTADO DE CUENTA", 14, 20);

    // Fechas del filtro si existen
    if (desde && hasta) {
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'bold');
        pdf.setTextColor(...COLOR_SECONDARY);
        const fmtFiltroFecha = (str) => {
            if (!str) return '—';
            const parts = str.split('-');
            if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
            return str;
        };
        pdf.text(`Período: ${fmtFiltroFecha(desde)} al ${fmtFiltroFecha(hasta)}`, 14, 25);
    }

    // Datos Cliente
    pdf.setFontSize(14);
    pdf.setTextColor(...COLOR_PRIMARY);
    pdf.text(cliente.Nombre || 'Cliente Consumidor', 14, 34);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(...COLOR_SECONDARY);
    let nameOffset = 39;
    if (cliente.NombreFantasia) {
        pdf.text(cliente.NombreFantasia, 14, nameOffset);
        nameOffset += 5;
    }
    pdf.text(`ID: ${cliente.CliIdCliente} | RUT/CI: ${cliente.CodCliente || '-'}`, 14, nameOffset);
    pdf.text(`Generado: ${new Date().toLocaleDateString('es-UY')} ${new Date().toLocaleTimeString('es-UY')}`, 14, nameOffset + 5);

    let currentY = nameOffset + 15;

    // Iterar todas las cuentas y generar tabla por cada una
    const TIPOS_MONETARIOS = ['USD', 'UYU', 'ARS', 'EUR', 'PYG', 'BRL', 'CORRIENTE', 'CREDITO', 'DEBITO', 'CAJA', 'DINERO_USD', 'DINERO_UYU'];

    cuentas.forEach(c => {
        // Control de salto de página antes de imprimir la cabecera de la nueva cuenta
        if (currentY > 250) {
            pdf.addPage();
            currentY = 20;
        }

        const sec = secciones[c.CueIdCuenta];
        const rawMovs = sec?.movs || [];
        const movs = rawMovs.filter(m => m.visualIsVisible !== false);
        const arrastre = Number(sec?.saldoArrastre ?? 0);
        const saldo = Number(c.CueSaldoActual || 0);

        const esRecurso = c.ProIdProducto != null || !TIPOS_MONETARIOS.includes(c.CueTipo?.toUpperCase());
        const unidadLabel = c.UniSimbolo || c.UnidadLabel || c.CueTipo;
        const saldoStr = esRecurso
            ? `${fmtNum(saldo)} ${unidadLabel}`
            : `${c.MonSimbolo || '$'} ${fmtNum(saldo)}`;

        // Header de la cuenta
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(12);
        pdf.setTextColor(0, 0, 0);
        const suffix = saldo > 0 ? ' (Saldo a favor)' : (saldo < 0 ? ' (Deuda)' : '');
        const cuentaLabel = c.NombreArticulo
            ? `${c.UnidadLabel || c.CueTipo} — ${c.NombreArticulo}`
            : (c.UnidadLabel || c.CueTipo);
        pdf.text(`Cuenta: ${cuentaLabel} - Saldo Actual: ${saldoStr}${suffix}`, 14, currentY);
        currentY += 6;

        // (Se eliminó el subtitulo Pendiente de facturar de la cabecera)

        const ordenesPendientes = rawMovs.filter(m => 
          (m.MovTipo === 'ORDEN' || m.MovTipo === 'ORDEN_ANTICIPO') && 
          !m.MovAnulado && 
          !m.DocIdDocumento &&
          !(m.MovObservaciones && m.MovObservaciones.startsWith('CUBIERTO'))
        );

        if (movs.length === 0) {
            pdf.setFont('helvetica', 'italic');
            pdf.setFontSize(10);
            pdf.setTextColor(...COLOR_SECONDARY);
            pdf.text("Sin movimientos en el período seleccionado.", 14, currentY);
            currentY += 15;
            // No hacemos return porque igual puede haber órdenes pendientes de facturar abajo
        } else {


        // Si hay arrastre, mostramos una fila de saldo inicial del período
        if (arrastre !== 0) {
            pdf.setFont('helvetica', 'italic');
            pdf.setFontSize(8);
            pdf.setTextColor(...COLOR_SECONDARY);
            const arrastreStr = esRecurso
                ? `${fmtNum(arrastre)} ${unidadLabel}`
                : `${c.MonSimbolo || '$'} ${fmtNum(arrastre)}`;
            pdf.text(`Saldo arrastrado al inicio del período: ${arrastreStr}`, 14, currentY);
            currentY += 5;
        }

        // Body de la tabla — calculamos saldos inicial/final acumulando desde el arrastre
        const movsAsc = [...movs].reverse();
        let runningSaldo = arrastre;

        const tableBody = movsAsc.map(m => {
            const importe = m.visualImporte !== undefined ? Number(m.visualImporte) : Number(m.MovImporte);

            // Debe (debits / charges) are negative importes
            const debeVal = importe < 0 ? Math.abs(importe) : 0;
            // Haber (credits / payments) are positive importes
            const haberVal = importe > 0 ? importe : 0;

            const saldoAntesNum = runningSaldo;
            runningSaldo += importe;
            const saldoDespuesNum = runningSaldo;

            const DOC_TIPO_LABEL_PDF2 = {
              '07': 'E-TICKET', '08': 'E-TICKET CRED.', '10': 'N.CRÉDITO ET',
              '01': 'E-FACTURA', '02': 'E-FACTURA CRED.', '04': 'N.CRÉDITO EF',
              '107': 'E-TICKET', '101': 'E-FACTURA', 'PedidoCaja': 'PEDIDO CAJA',
            };
            const dTipoLabel2 = m.DocTipo ? (DOC_TIPO_LABEL_PDF2[m.DocTipo.trim()] || m.DocTipo.trim()) : null;
            const docFull = dTipoLabel2
                ? `${dTipoLabel2} ${m.DocSerie || ''}-${m.DocNumero || ''}`
                : (m.CodigoOrdenStr 
                    ? m.CodigoOrdenStr 
                    : (m.OReIdOrdenRetiro 
                        ? `RET: ${m.OReIdOrdenRetiro}` 
                        : (m.OrdCodigoOrden ? m.OrdCodigoOrden : '—')));

            const saldoIniStr = esRecurso
                ? `${fmtNum(saldoAntesNum)} ${unidadLabel}`
                : `${fmtNum(saldoAntesNum)}`;

            const debeStr = debeVal > 0
                ? (esRecurso ? `${fmtNum(debeVal)} ${unidadLabel}` : `${fmtNum(debeVal)}`)
                : '—';

            const haberStr = haberVal > 0
                ? (esRecurso ? `${fmtNum(haberVal)} ${unidadLabel}` : `${fmtNum(haberVal)}`)
                : '—';

            const saldoFinStr = esRecurso
                ? `${fmtNum(saldoDespuesNum)} ${unidadLabel}`
                : `${fmtNum(saldoDespuesNum)}`;

            return [
                fmtFecha(m.MovFecha),
                m.MovTipo,
                docFull,
                m.MovConcepto || '—',
                saldoIniStr,
                debeStr,
                haberStr,
                saldoFinStr
            ];
        });

        autoTable(pdf, {
            startY: currentY,
            head: [['Fecha', 'Tipo', 'Documento', 'Concepto', 'Saldo Inicial', 'Debe', 'Haber', 'Saldo Final']],
            body: tableBody,
            theme: 'grid',
            headStyles: {
                fillColor: COLOR_PRIMARY,
                textColor: [255, 255, 255],
                fontStyle: 'bold'
            },
            styles: {
                font: 'helvetica',
                fontSize: 8,
                cellPadding: 3
            },
            columnStyles: {
                0: { cellWidth: 16 },
                1: { cellWidth: 18 },
                2: { cellWidth: 32 },
                3: { cellWidth: 'auto' },
                4: { cellWidth: 22, halign: 'right' },
                5: { cellWidth: 20, halign: 'right' },
                6: { cellWidth: 20, halign: 'right' },
                7: { cellWidth: 22, halign: 'right' }
            }
            });

            currentY = pdf.lastAutoTable.finalY + 15;
        }

        // --- Detalle de Órdenes pendientes de facturar ---
        if (ordenesPendientes.length > 0 && !esRecurso) {
            if (currentY > 250) {
                pdf.addPage();
                currentY = 20;
            }

            pdf.setFont('helvetica', 'bold');
            pdf.setFontSize(10);
            pdf.setTextColor(217, 119, 6); // amber-600
            pdf.text(`Detalle de Órdenes Pendientes de Facturar (${ordenesPendientes.length})`, 14, currentY);
            currentY += 4;

            const opBody = ordenesPendientes.map(o => {
                const docFull = o.OrdCodigoOrden || o.MovConcepto || `Mov #${o.MovIdMovimiento}`;
                const importeStr = `${c.MonSimbolo || '$'} ${fmtNum(Math.abs(Number(o.MovImporte)))}`;
                return [
                    fmtFecha(o.MovFecha),
                    docFull,
                    o.OrdNombreTrabajo || '—',
                    importeStr
                ];
            });

            const totalPendiente = ordenesPendientes.reduce((acc, o) => acc + Math.abs(Number(o.MovImporte)), 0);
            opBody.push([
                { content: 'TOTAL PENDIENTE A FACTURAR', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold', fillColor: [253, 246, 227], textColor: [217, 119, 6] } },
                { content: `${c.MonSimbolo || '$'} ${fmtNum(totalPendiente)}`, styles: { halign: 'right', fontStyle: 'bold', fillColor: [253, 246, 227], textColor: [217, 119, 6] } }
            ]);

            autoTable(pdf, {
                startY: currentY,
                head: [['Fecha', 'Orden', 'Trabajo / Descripción', 'Importe']],
                body: opBody,
                theme: 'grid',
                headStyles: {
                    fillColor: [245, 158, 11], // amber-500
                    textColor: [255, 255, 255],
                    fontStyle: 'bold'
                },
                styles: {
                    font: 'helvetica',
                    fontSize: 8,
                    cellPadding: 3
                },
                columnStyles: {
                    0: { cellWidth: 25 },
                    1: { cellWidth: 40 },
                    2: { cellWidth: 'auto' },
                    3: { cellWidth: 30, halign: 'right' }
                }
            });

            currentY = pdf.lastAutoTable.finalY + 15;
            pdf.setTextColor(0, 0, 0); // reset
        }
    });

    // Footer
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(...COLOR_SECONDARY);
    pdf.text("Documento generado por USER Sistema", 105, 280, { align: 'center' });

    const filename = `Estado_Cuenta_${cliente.Nombre.replace(/\s+/g, '_')}`;
    pdf.setProperties({
        title: filename
    });
    const blob = pdf.output('blob');
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
};

export const generarPdfPrefactura = (ciclo, movs, excluidos, cuenta, cliente, esFinal = false) => {
    const pdf = new jsPDF({ format: 'a4' });
    const fmtNum = (n) => new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
    const fmtFecha = (dateString) => new Date(dateString).toLocaleDateString('es-UY', { timeZone: 'UTC' });
    const monedaStr = cuenta?.MonSimbolo || '$';

    // Fuente y estilos base
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(16);
    pdf.setTextColor(...COLOR_PRIMARY);

    // Cabecera Empresa
    pdf.text("USER S.A.", 14, 20);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(...COLOR_SECONDARY);
    pdf.text("RUT: 211111110015", 14, 26);
    pdf.text("Bulevar Artigas 1234, Montevideo", 14, 31);

    // Tipo Documento y Número
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.setTextColor(...COLOR_PRIMARY);
    pdf.text(esFinal ? "FACTURA DE SERVICIOS" : "PRE-FACTURA (BORRADOR)", 120, 20);

    pdf.setFontSize(11);
    pdf.setTextColor(0, 0, 0);
    pdf.text(`CICLO: ${ciclo.CicIdCiclo}`, 120, 28);

    // Fechas y datos
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    const fechaEmision = new Date().toLocaleString('es-UY', { dateStyle: 'short', timeStyle: 'short' });
    pdf.text(`Emitido: ${fechaEmision}`, 120, 34);
    pdf.text(`Desde: ${fmtFecha(ciclo.CicFechaInicio)}  Hasta: ${fmtFecha(ciclo.CicFechaCierre)}`, 120, 40);

    // Línea separadora
    pdf.setDrawColor(...COLOR_BORDER);
    pdf.line(14, 45, 196, 45);

    // Datos Cliente
    pdf.setFont('helvetica', 'bold');
    pdf.text("CLIENTE:", 14, 52);
    pdf.setFont('helvetica', 'normal');

    const nombreCli = cliente.NombreFantasia || cliente.Nombre || 'CONSUMIDOR FINAL';
    const idCli = cliente.CodCliente || cliente.CliIdCliente;
    pdf.text(`${nombreCli} [${idCli}]`, 35, 52);

    if (cliente.CioRuc) {
        pdf.text(`RUT/CI: ${cliente.CioRuc}`, 14, 58);
    }
    const cuentaLabelPF = cuenta.NombreArticulo
        ? `${cuenta.UnidadLabel || cuenta.CueTipo} — ${cuenta.NombreArticulo}`
        : (cuenta.UnidadLabel || cuenta.CueTipo);
    pdf.text(`Cuenta: ${cuentaLabelPF}`, 120, 52);

    // Tabla de Detalles
    const movsIncluidos = movs.filter(m => !excluidos.has(m.MovIdMovimiento));
    let totalOrdenes = 0;
    let totalPagos = 0;

    const tableBody = movsIncluidos.flatMap(m => {
        const importe = Number(m.MovImporte);
        const esOrden = m.MovTipo === 'ORDEN';

        if (importe < 0) totalOrdenes += Math.abs(importe);
        if (importe > 0) totalPagos += Math.abs(importe);

        if (esOrden) {
            const descPct = Number(m.OrdDescuentoAplicado || 0);

            if (m.DetallesJSON) {
                try {
                    const detalles = JSON.parse(m.DetallesJSON);
                    return detalles.map(d => {
                        const cant = Number(d.Cantidad || 1);
                        const precioTotal = Number(d.Subtotal || 0);
                        const precioUnitario = Number(d.PrecioUnitario || 0);

                        // Linea 1: Codigo de Articulo y Descripcion
                        const artDesc = d.Descripcion || d.LogPrecioAplicado || 'Servicio/Material';
                        const linea1 = `[${d.CodArticulo || 'S/C'}] - ${artDesc}`;

                        // Sublinea: Orden y Trabajo y Subfamilia
                        const subFamilia = m.ProSubFamilia ? `[${m.ProCodStock} - ${m.ProSubFamilia}] ` : '';
                        const linea2 = `Orden: ${m.OrdCodigoOrden || 'S/N'} | ${m.OrdNombreTrabajo || 'Sin trabajo'} | ${subFamilia}`.trim();

                        const desc = linea2 ? `${linea1}\n${linea2}` : linea1;

                        return [
                            desc,
                            fmtNum(cant),
                            fmtNum(precioUnitario),
                            descPct.toString(),
                            'IVA Ventas (22%)',
                            `${monedaStr} ${fmtNum(precioTotal)}`
                        ];
                    });
                } catch (e) {
                    console.error("Error parsing DetallesJSON", e);
                }
            }

            // Fallback si no hay detalles guardados
            const linea1 = `${m.OrdCodigoOrden || 'S/N'} - ${m.OrdNombreTrabajo || 'Sin trabajo'}`;
            const subFamilia = m.ProSubFamilia ? `[${m.ProCodStock} - ${m.ProSubFamilia}] ` : '';
            const linea2 = `${subFamilia}${m.OrdMaterialPlanilla || ''}`.trim();
            const desc = linea2 ? `${linea1}\n${linea2}` : linea1;

            const cant = Number(m.OrdCantidad || 1);
            const precioTotal = Math.abs(importe);
            const precioUnitario = precioTotal / cant;

            return [[
                desc,
                fmtNum(cant),
                fmtNum(precioUnitario),
                descPct.toString(),
                'IVA Ventas (22%)',
                `${monedaStr} ${fmtNum(precioTotal)}`
            ]];
        } else {
            // No mostrar pagos ni abonos en el cuerpo de la factura
            if (importe >= 0) return [];

            // Para otros cargos que no son ORDEN (ej: VTA_CAJA, Ajustes de débito)
            return [[
                m.MovConcepto || m.MovTipo,
                '1',
                fmtNum(Math.abs(importe)),
                '-',
                'IVA Ventas (22%)',
                `${monedaStr} ${fmtNum(Math.abs(importe))}`
            ]];
        }
    });

    if (tableBody.length === 0) {
        tableBody.push(['Sin movimientos', '-', '-', '-', '-', `${monedaStr} 0,00`]);
    }

    const totalAFacturar = totalOrdenes - totalPagos;

    autoTable(pdf, {
        startY: 65,
        head: [['DESCRIPCIÓN', 'CANTIDAD', 'PRECIO UNITARIO', 'DESC.%', 'IMPUESTOS', 'PRECIO TOTAL']],
        body: tableBody,
        theme: 'plain',
        headStyles: {
            fillColor: [248, 250, 252], // slate-50
            textColor: [15, 23, 42], // slate-900
            fontStyle: 'bold',
            lineColor: COLOR_BORDER,
            lineWidth: { bottom: 0.5 }
        },
        styles: {
            font: 'helvetica',
            fontSize: 9,
            cellPadding: 5,
            textColor: [51, 65, 85] // slate-700
        },
        columnStyles: {
            0: { cellWidth: 'auto' },
            1: { cellWidth: 20, halign: 'center' },
            2: { cellWidth: 30, halign: 'right' },
            3: { cellWidth: 15, halign: 'center' },
            4: { cellWidth: 35, halign: 'center' },
            5: { cellWidth: 30, halign: 'right' }
        },
        didParseCell: function (data) {
            if (data.row.section === 'body' && data.column.index === 0) {
                data.cell.styles.fontStyle = 'normal';
            }
        }
    });

    // Totales
    const finalY = pdf.lastAutoTable.finalY + 10;
    const saldoPendiente = totalOrdenes - totalPagos;

    // Línea separadora antes de totales
    pdf.setDrawColor(...COLOR_BORDER);
    pdf.line(120, finalY - 3, 196, finalY - 3);

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.setTextColor(...COLOR_PRIMARY);
    pdf.text("TOTAL FACTURA:", 120, finalY);
    pdf.text(`${monedaStr} ${fmtNum(totalOrdenes)}`, 196, finalY, { align: 'right' });

    // Footer
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(...COLOR_SECONDARY);
    pdf.text("Documento generado por USER Sistema", 105, 280, { align: 'center' });

    if (!esFinal) {
        pdf.setTextColor(220, 38, 38); // red-600
        pdf.text("DOCUMENTO BORRADOR - NO VÁLIDO COMO FACTURA", 105, 285, { align: 'center' });
    }

    // Visualizar en nueva pestaña
    const prefix = esFinal ? "Factura" : "Prefactura";
    const filename = `${prefix}_Ciclo_${cliente.Nombre.replace(/\s+/g, '_')}`;
    pdf.setProperties({
        title: filename
    });
    const blob = pdf.output('blob');
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
};

