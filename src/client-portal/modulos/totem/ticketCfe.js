// e-Ticket en 80 mm para la impresora térmica del tótem (INF-SIS-2026-18). Dibuja el mismo
// objeto que el PDF de 80 mm de las descargas (armarTicketCfe en utils/pdfGenerator), así el
// papel del tótem y el que baja la Bandeja dicen lo mismo.
import { armarTicketCfe, extrasLineaTicket, fmtCantidadPorLista, fmtNumUY } from '../../../utils/pdfGenerator';

const LOGO_USER = '/assets/images/logo.png';

const esc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const par = (izq, der, clase = '') =>
    `<div class="par ${clase}"><span>${esc(izq)}</span><span class="der">${esc(der)}</span></div>`;

export const htmlTicketCfe = (t) => {
    const f = t.fiscal, a = t.adenda;
    const filas = t.filas.map(x => {
        if (x.tipo === 'encabezado') return `<div class="b">${esc(x.texto)}</div>`;
        if (x.tipo === 'subtotal') return par(x.texto, x.importe, 'b');
        return `<div class="linea">
            <div class="b">${esc(`${x.n}. ${x.nomItem}`)}</div>
            ${x.dscCorta ? `<div class="chico">${esc(x.dscCorta)}</div>` : ''}
            ${x.origenes ? `<div class="chico">${esc(x.origenes)}</div>` : ''}
            ${par(fmtCantidadPorLista(x), fmtNumUY(x.lineTotal))}
            <div class="mini">${esc(extrasLineaTicket(x))}</div>
        </div>`;
    }).join('');

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
    @page { margin: 0; size: 80mm auto; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; width: 80mm; padding: 3mm 4mm; font-size: 11px; color: #000; }
    .c { text-align: center; }
    .b { font-weight: bold; }
    .chico { font-size: 10px; }
    .mini { font-size: 9px; }
    .sep { border-top: 1px dashed #000; margin: 5px 0; }
    .par { display: flex; justify-content: space-between; gap: 6px; }
    .par .der { white-space: nowrap; text-align: right; }
    .linea { margin-bottom: 4px; }
    .tipo { font-size: 15px; font-weight: bold; }
    .num { font-size: 13px; font-weight: bold; }
    .total { font-size: 15px; font-weight: bold; }
    .logo { display: block; margin: 0 auto 3px; max-width: 60mm; max-height: 14mm; }
    .qr { display: block; margin: 4px auto; width: 34mm; height: 34mm; }
    .aviso { font-weight: bold; text-align: center; border: 1px solid #000; padding: 2px; margin-bottom: 4px; }
</style></head><body>
    ${t.aceptado ? '' : '<div class="aviso">SIN VALIDEZ FISCAL · PENDIENTE DE DGI</div>'}
    <img class="logo" src="${esc(t.emisor.logoUrl || LOGO_USER)}" alt="">
    <div class="c b" style="font-size:13px">${esc(t.emisor.fantasia)}</div>
    <div class="c chico">${esc(t.emisor.razon)}</div>
    <div class="c chico">${esc(t.emisor.dir)}</div>
    <div class="c chico">${esc(t.emisor.ciudad)}</div>
    ${t.emisor.tel ? `<div class="c chico">TEL: ${esc(t.emisor.tel)}</div>` : ''}
    <div class="c b">RUC ${esc(t.emisor.ruc)}</div>
    <div class="sep"></div>

    <div class="c tipo">${esc(t.tipoDoc)}</div>
    <div class="c num">Serie ${esc(t.serie)} &nbsp; Nº ${esc(t.numero)}</div>
    ${par('Fecha', t.fecha)}
    ${par('Moneda', t.moneda)}
    ${par('Forma de pago', t.formaPago)}
    ${par('RUC comprador', t.rucComprador, 'b')}
    <div class="sep"></div>

    <div class="chico">Cliente: ${esc(t.cliente.nombre)}</div>
    ${t.cliente.fantasia ? `<div class="chico">Nombre fantasía: ${esc(t.cliente.fantasia)}</div>` : ''}
    ${t.cliente.direccion ? `<div class="chico">Dirección: ${esc(t.cliente.direccion)}</div>` : ''}
    ${t.cliente.ciudad ? `<div class="chico">Ciudad: ${esc(t.cliente.ciudad)}</div>` : ''}
    <div class="sep"></div>

    ${filas}
    <div class="sep"></div>

    ${par(`Gravado ${t.ivaTasa}%`, t.totales.gravado)}
    ${par(`IVA ${t.ivaTasa}%`, t.totales.iva)}
    ${par('TOTAL', `${t.totales.simbolo} ${t.totales.total}`, 'total')}
    ${t.observaciones ? `<div class="chico">Observaciones: ${esc(t.observaciones)}</div>` : ''}
    <div class="sep"></div>

    ${t.qrDataUrl ? `<img class="qr" src="${t.qrDataUrl}" alt="">` : '<div class="c chico">QR: PENDIENTE DGI</div>'}
    <div class="c chico">Res. Nro. ${esc(f.resNro)}</div>
    <div class="c chico">Puede verificar el comprobante en ${esc(f.urlVerif)}</div>
    <div class="c chico">${esc(f.ivaDia)}</div>
    <div class="c b">${f.cae ? `Nro. CAE: ${esc(f.cae)}` : 'Nro. CAE: PENDIENTE - No enviado a DGI'}</div>
    ${f.rango ? `<div class="c chico">Rango: ${esc(f.rango)}</div>` : ''}
    ${f.vencimiento ? `<div class="c chico">Fecha de Vencimiento: ${esc(f.vencimiento)}</div>` : ''}
    ${f.codSeg ? `<div class="c b">Código de Seguridad: ${esc(f.codSeg)}</div>` : ''}
    <div class="sep"></div>

    <div class="c b">Adenda</div>
    ${a.tipoNum ? `<div class="b chico">${esc(a.tipoNum)}</div>` : ''}
    ${a.importeLetras ? `<div class="chico">Importe: ${esc(a.importeLetras)}</div>` : ''}
    ${a.cliente ? `<div class="chico">Cliente: ${esc(a.cliente)}</div>` : ''}
    ${a.planFinanciacion ? `<div class="chico">Plan de Financiación: ${esc(a.planFinanciacion)}</div>` : ''}
    ${a.vendedor ? `<div class="chico">Vendedor: ${esc(a.vendedor)}</div>` : ''}
    ${a.unidades ? `<div class="chico">Unidades: ${esc(a.unidades)}</div>` : ''}
</body></html>`;
};

/**
 * Imprime el e-Ticket en la impresora del tótem. Mismo método que el ticket de retiro (iframe oculto),
 * y como él nunca en el camino del flujo: quien llama lo hace diferido y con try/catch (incidente 03/07).
 * Espera a que carguen el logo y el QR (hasta 3 s) para que no salgan en blanco.
 */
export const imprimirTicketCfe = async (doc, detalles) => {
    const html = htmlTicketCfe(await armarTicketCfe(doc, detalles));
    const iframe = document.createElement('iframe');
    Object.assign(iframe.style, { position: 'fixed', top: '-9999px', left: '-9999px', width: '0', height: '0', border: 'none' });
    document.body.appendChild(iframe);
    const d = iframe.contentDocument || iframe.contentWindow.document;
    d.open();
    d.write(html);
    d.close();
    await Promise.race([
        Promise.all([...d.images].map(img => (img.complete ? null : new Promise(r => { img.onload = r; img.onerror = r; })))),
        new Promise(r => setTimeout(r, 3000)),
    ]);
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => iframe.remove(), 3000);
};
