import React from 'react';
import Swal from 'sweetalert2';

export const generateTicketHTML = (retiro) => {
    const fecha = new Date().toLocaleDateString('es-UY', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false
    });
    const ordenes = retiro.orders || [];
    
    let simbolo = '$';
    if (retiro.moneda === 'USD' || retiro.moneda === 2 || retiro.moneda === 840 || (typeof retiro.moneda === 'string' && retiro.moneda.includes('US'))) {
        simbolo = 'U$S';
    }
    if (ordenes.length > 0 && ordenes[0].simbolo) {
        simbolo = ordenes[0].simbolo;
    }

    const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 38 60" height="36" style="display:block;overflow:visible;">
      <g>
        <path d="M37.32,43.66h-12.99v-3.57c-1.29,1.3-2.87,2.29-4.71,2.99-1.85.7-3.66,1.05-5.43,1.05-4.02,0-7.29-1.24-9.83-3.72-1.69-1.69-2.84-3.53-3.45-5.53-.61-1.99-.91-4.31-.91-6.95V0h13.31v26.15c0,2.19.57,3.74,1.72,4.64,1.15.9,2.36,1.35,3.62,1.35s2.48-.44,3.63-1.33c1.15-.89,1.72-2.44,1.72-4.66V0h13.31v43.66Z"/>
        <path d="M31.39,49.3H5.93c-2.16,0-3.91,1.87-3.91,4.18v.81c0,2.31,1.75,4.18,3.91,4.18h25.45c2.16,0,3.91-1.87,3.91-4.18v-.81c0-2.31-1.75-4.18-3.91-4.18Z"/>
      </g>
    </svg>`;

    const ordenesHTML = ordenes.length > 0
        ? ordenes.map((o, i) => {
            let costo = o.orderCosto || o.costoFinal || o.amount;
            let finalCosto = '-';
            if (costo !== undefined && costo !== null && costo !== '' && costo !== '-') {
                if (typeof costo === 'string' && costo.includes('$')) {
                    finalCosto = costo;
                } else {
                    const simb = o.simbolo || o.currency || '$';
                    finalCosto = `${simb} ${Number(costo).toFixed(2)}`;
                }
            }
            return `
            <tr style="background:#fff">
                <td style="padding:5px 8px;font-size:12px;border:none;vertical-align:middle;">
                    <div style="font-weight:700;">${o.orderNumber || o.codigoOrden || o.id || '-'}</div>
                </td>
                <td style="padding:5px 8px;font-size:11px;border:none;text-align:center;vertical-align:middle;font-weight:700;text-transform:uppercase;color:#111;">
                    ${o.articuloDescripcion || ''}
                </td>
                <td style="padding:5px 8px;font-size:12px;border:none;text-align:right;font-weight:700;vertical-align:middle;">${finalCosto}</td>
            </tr>`;
        }).join('')
        : `<tr><td colspan="3" style="padding:8px;font-size:12px;color:#888;text-align:center;border:none;">Sin detalle de órdenes</td></tr>`;

    let lugarRetiro = retiro.lugarRetiro || '';
    if (!lugarRetiro || lugarRetiro === '-' || lugarRetiro === 'Web' || lugarRetiro.toLowerCase() === 'desconocido') {
        const strId = (retiro.displayLabel || retiro.ordenDeRetiro || '');
        if (strId.toUpperCase().startsWith('RT-')) {
            lugarRetiro = 'Retiro en el Local';
        } else {
            lugarRetiro = 'Retiro Web';
        }
    }

    const isEncomienda = lugarRetiro.toLowerCase().includes('encomienda')
        || retiro.formaEnvioId === 2
        || retiro.LReIdLugarRetiro === 2;

    // Para encomiendas, mostrar "ENCOMIENDA (NombreAgencia)" en lugar del valor crudo de la BD
    if (isEncomienda) {
        lugarRetiro = retiro.agenciaNombre
            ? `ENCOMIENDA (${retiro.agenciaNombre})`
            : 'ENCOMIENDA';
    }

    const numPart = (retiro.ordenDeRetiro || '').replace(/^[A-Za-z]+-?/, '');
    const displayCodigo = isEncomienda ? `ENC-${numPart}` : (retiro.ordenDeRetiro || 'N/A');

    const copiaHTML = (label, showFirma = false, encomiendaData = null) => `
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;padding-bottom:10px;border-bottom:2px solid #000;">
        <div style="display:flex;align-items:flex-end;gap:10px;">
            ${LOGO_SVG}
            <div style="font-size:10px;font-weight:600;color:#555;letter-spacing:2px;text-transform:uppercase;">Comprobante de Retiro · ${label}</div>
        </div>
        <div style="text-align:right;">
            <div style="font-size:28px;font-weight:900;letter-spacing:2px;line-height:1;">${displayCodigo}</div>
            <div style="font-size:10px;color:#555;margin-top:2px;">${fecha}</div>
        </div>
    </div>
    ${!encomiendaData ? `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px;">
        <div style="border:2px solid #000;overflow:hidden;display:flex;flex-direction:column;">
            <div style="background:#fff;color:#000;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;padding:4px 8px;">Cliente</div>
            <div style="flex:1;padding:8px 10px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;">
                <div style="font-size:18px;font-weight:900;">${retiro.CliCodigoCliente || retiro.idcliente || '-'}</div>
                <div style="font-size:14px;font-weight:700;color:#222;margin-top:2px;">${retiro.CliNombre || retiro._raw?.NombreCliente || ''}</div>
            </div>
        </div>
        <div style="border:2px solid #000;overflow:hidden;display:flex;flex-direction:column;">
            <div style="background:#fff;color:#000;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1px;padding:4px 8px;">Forma de Envío</div>
            <div style="flex:1;padding:8px 10px;display:flex;align-items:center;justify-content:center;text-align:center;">
                <div style="font-size:13px;font-weight:800;text-transform:uppercase;">${lugarRetiro}</div>
            </div>
        </div>
    </div>

    <div style="border:2px solid #000;overflow:hidden;margin-bottom:10px;">
        <table style="width:100%;border-collapse:collapse;">
            <thead>
                <tr>
                    <th style="padding:6px 8px;font-size:10px;text-align:left;font-weight:700;letter-spacing:1px;text-transform:uppercase;background:#fff;border:none;">Pedido</th>
                    <th style="padding:6px 8px;font-size:10px;text-align:center;font-weight:700;letter-spacing:1px;text-transform:uppercase;background:#fff;border:none;"></th>
                    <th style="padding:6px 8px;font-size:10px;text-align:right;font-weight:700;letter-spacing:1px;text-transform:uppercase;background:#fff;border:none;">Importe</th>
                </tr>
            </thead>
            <tbody>${ordenesHTML}</tbody>
        </table>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:#fff;color:#000;border:2px solid #000;margin-bottom:10px;">
        <span style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;">Total</span>
        <span style="font-size:18px;font-weight:900;">${(() => { 
            let num = 0;
            if (ordenes && ordenes.length > 0) {
                ordenes.forEach(o => {
                    let c = o.orderCosto || o.costoFinal || o.amount;
                    if (c) {
                        let val = typeof c === 'string' ? parseFloat(c.replace(/[^\d.-]/g, '')) : Number(c);
                        if (!isNaN(val)) num += val;
                    }
                });
            }
            if (num === 0) {
                const t = retiro.totalCost || retiro.monto || retiro.Monto || '0';
                let val = typeof t === 'string' ? parseFloat(t.replace(/[^\d.-]/g, '')) : Number(t);
                if (!isNaN(val)) num = val;
            }
            return `${simbolo} ${num.toFixed(2)}`; 
        })()}</span>
    </div>

    ${showFirma ? `
    <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:4px;">
        <div style="display:flex;gap:20px;align-items:center;">
            <div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">
                Cliente <span style="display:inline-block;width:18px;height:18px;border:2px solid #000;"></span>
            </div>
            <div style="display:flex;align-items:center;gap:6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">
                Otro <span style="display:inline-block;width:18px;height:18px;border:2px solid #000;"></span>
            </div>
        </div>
        <div style="flex:1;display:flex;align-items:flex-end;gap:6px;margin-left:16px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;">
            <span style="white-space:nowrap;">Firma:</span>
            <span style="flex:1;border-bottom:1.5px solid #000;margin-bottom:2px;"></span>
        </div>
    </div>` : ''}
    ` : ''}

    ${encomiendaData ? `
    <div style="display:grid;grid-template-columns:3fr 1fr;gap:16px;flex:1;">
        <div style="display:flex;flex-direction:column;justify-content:space-between;">
            <div style="display:flex;flex-direction:column;gap:6px;">
                <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:#555;border-bottom:1px solid #000;padding-bottom:3px;margin-bottom:2px;">Destinatario</div>
                <div style="font-size:26px;font-weight:900;text-transform:uppercase;line-height:1.15;">${encomiendaData.nombre}</div>
                ${encomiendaData.idCliente ? `<div style="font-size:14px;font-weight:700;color:#444;margin-bottom:4px;">${encomiendaData.idCliente}</div>` : ''}
                ${encomiendaData.telefono ? `<div style="font-size:20px;font-weight:700;color:#222;">&#9742; ${encomiendaData.telefono}</div>` : ''}
                ${encomiendaData.depto ? `<div style="font-size:30px;font-weight:900;text-transform:uppercase;margin-top:4px;line-height:1;">${encomiendaData.depto}</div>` : ''}
                ${encomiendaData.localidad ? `<div style="font-size:30px;font-weight:800;text-transform:uppercase;color:#111;line-height:1;">${encomiendaData.localidad}</div>` : ''}
                ${encomiendaData.direccion ? `<div style="font-size:26px;font-weight:700;text-transform:uppercase;color:#222;line-height:1.1;">${encomiendaData.direccion}</div>` : ''}
                ${encomiendaData.agencia ? `<div style="margin-top:8px;font-size:16px;font-weight:900;background:#fff;border:2px solid #000;padding:6px 12px;text-transform:uppercase;display:inline-block;align-self:flex-start;">AGENCIA &#8226; ${encomiendaData.agencia}</div>` : ''}
            </div>
            <div style="display:flex;flex-direction:column;gap:4px;padding-top:12px;border-top:2px dashed #000;margin-top:auto;">
                <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:#555;border-bottom:1px solid #000;padding-bottom:3px;margin-bottom:2px;">Remitente</div>
                <div style="display:flex;align-items:center;gap:12px;">
                    <div>${LOGO_SVG}</div>
                    <div style="display:flex;flex-direction:column;gap:2px;">
                        <div style="font-size:13px;font-weight:700;color:#333;">Inca 2228</div>
                        <div style="font-size:11px;font-weight:600;color:#555;">Montevideo, Uruguay</div>
                        <div style="font-size:12px;font-weight:800;color:#333;">&#9742; 092284262</div>
                    </div>
                </div>
            </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;border-left:2px dashed #000;padding-left:16px;">
            <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:2px;color:#555;border-bottom:1px solid #000;padding-bottom:3px;margin-bottom:2px;">Órdenes</div>
            <div style="display:flex;flex-direction:column;gap:4px;">
                ${ordenes.map(o => `<div style="font-size:13px;font-weight:800;padding:2px 0;text-align:center;">${o.orderNumber || o.codigoOrden || o.id || '-'}</div>`).join('') || '<div style="font-size:11px;color:#777;">S/D</div>'}
            </div>
        </div>
    </div>` : ''}
    `;

    const encomiendaData = isEncomienda ? {
        // Unificado a ReceptorNombre (o fallbacks lógicos si viene nulo)
        nombre: retiro.ReceptorNombre || retiro.receptorNombre || retiro._raw?.ReceptorNombre || retiro.CliNombre || retiro.idcliente || '-',
        idCliente: retiro.CliCodigoCliente || retiro.CodCliente || retiro.idcliente || '',
        telefono: (retiro.CliTelefono || '').trim(),
        depto: retiro.departamentoEnvio || '',
        localidad: retiro.localidadEnvio || '',
        direccion: retiro.direccionEnvio || '',
        agencia: retiro.agenciaNombre || ''
    } : null;

    const topHalfHTML = copiaHTML('Copia Empresa', true);
    const bottomHalfHTML = isEncomienda ? copiaHTML('Etiqueta de Envío', false, encomiendaData) : copiaHTML('Copia Cliente', false);

    return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Impresión ${retiro.displayLabel || retiro.ordenDeRetiro}</title><style>
@page { margin: 0; size: A4 portrait; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 210mm; font-family: 'Arial', 'Helvetica', sans-serif; print-color-adjust: exact; -webkit-print-color-adjust: exact; background: #fff; }
.copy { width: 210mm; min-height: 147mm; padding: 8mm 14mm; display: flex; flex-direction: column; justify-content: flex-start; print-color-adjust: exact; -webkit-print-color-adjust: exact; break-inside: avoid; page-break-inside: avoid; }
.copy:first-child { border-bottom: 2px dashed #999; }
table { border-collapse: collapse; width: 100%; }
td, th { border: 1px solid #bbb; }
tr { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
</style></head><body>
<div class="copy">${topHalfHTML}</div>
<div class="copy">${bottomHalfHTML}</div>
</body></html>`;
};

export const printRetiroStation = (retiro) => {
    const fullHtml = generateTicketHTML(retiro);
    const win = window.open('', '_blank', 'width=800,height=1000');
    if (win) {
        win.document.write(fullHtml);
        win.document.close();
        win.onload = () => {
            win.focus();
            setTimeout(() => {
                win.print();
            }, 300);
        };
    } else {
        Swal.fire('Error', 'Debe permitir ventanas emergentes para imprimir.', 'error');
    }
};
