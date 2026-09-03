import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import './PresupuestosPage.css';
import hotToast, { Toaster as HotToaster } from 'react-hot-toast';
import api from '../../../services/apiClient';
import { useAuth } from '../../../context/AuthContext';
import { Plus, Trash2, Search, X, Printer, Save, RotateCcw, FolderOpen, Copy, BookUser } from 'lucide-react';

// Los avisos de esta pantalla usan react-hot-toast, abajo a la derecha. El
// <Toaster> de sonner y el de react-toastify (globales, en MainAppContent)
// siguen intactos para el resto del sistema; acá se monta uno propio (ver el
// final del render).
const POS = { position: 'bottom-right' };
const toast = {
    success: (m) => hotToast.success(m, POS),
    error:   (m) => hotToast.error(m, POS),
    // react-hot-toast no tiene .info(): el neutro es la llamada pelada
    info:    (m) => hotToast(m, POS),
};

/* ════════════════════════════════════════════════════════════════════════
   PRESUPUESTOS Y HOJAS MEMBRETADAS (/ventas/presupuestos)
   Port del diseño de CD (la app HTML del escritorio) al sistema:
   - Numeración GLOBAL en la base (la asigna el backend al guardar)
   - Totales SIEMPRE calculados (en la app vieja se tipeaban a mano)
   - Fecha automática, vendedor = usuario logueado
   - Ítems: texto libre o desde el catálogo de precios, editables igual
   - Historial compartido: cada vendedor ve los suyos (rol 1 ve todo)
   La impresión sale por ventana propia con HTML autocontenido (patrón
   labelPrinter): así no depende del CSS de impresión del resto de la app.
   ════════════════════════════════════════════════════════════════════════ */

const CONDICIONES_DEFAULT = [
    'Producción: 20 días hábiles aprox., a partir de la seña.',
    'Pago: seña del 50% al confirmar el pedido; saldo al retirar.',
    'Talles: incluye del S al XL sin diferencia de precio. Talles especiales (mayores a XL) a consultar.',
    'Validez del presupuesto: 30 días corridos desde la emisión.',
];

const docVacio = () => ({
    id: null, numero: null,
    moneda: 'UYU', validez: '30 días corridos',
    clienteNombre: '', clienteContacto: '', clienteRut: '', clienteTel: '',
    items: [{ descripcion: '', detalle: '', cantidad: 1, precio: '' }],
    // Cada condición se tilda: solo las marcadas se guardan e imprimen
    condiciones: CONDICIONES_DEFAULT.map(t => ({ texto: t, on: true })),
    // membrete
    asunto: '', cuerpo: '', destinatario: '', empresa: '', firmaCargo: '',
    // Editable: arranca con el nombre del logueado, pero un admin puede emitir
    // a nombre de un vendedor (y "admin" no es un nombre para el pie).
    vendedorNombre: '',
    fechaEmision: null, estado: 'EMITIDO',
});

const condicionesActivas = (doc) => (doc.condiciones || [])
    .filter(c => c.on && String(c.texto || '').trim())
    .map(c => c.texto.trim());

// Foto del contenido para detectar cambios sin guardar: solo lo que el usuario
// edita (comparar el doc entero daría falsos positivos por id/numero/fecha).
const fotoDoc = (d) => JSON.stringify({
    moneda: d.moneda, validez: d.validez,
    cli: [d.clienteNombre, d.clienteContacto, d.clienteRut, d.clienteTel],
    items: (d.items || []).map(it => [it.descripcion, it.detalle, it.cantidad, it.precio]),
    condiciones: condicionesActivas(d),
    memb: [d.asunto, d.cuerpo, d.destinatario, d.empresa, d.firmaCargo],
    vendedor: d.vendedorNombre,
});

// ¿Hay algo que se pierda al limpiar la hoja? (para avisar antes de "Nuevo").
// Las condiciones no cuentan: vienen tildadas de fábrica y no son trabajo del usuario.
const hayContenido = (d) => Boolean(
    ['clienteNombre', 'clienteContacto', 'clienteRut', 'clienteTel',
     'asunto', 'cuerpo', 'destinatario', 'empresa'].some(k => String(d[k] || '').trim())
    || (d.items || []).some(it => String(it.descripcion || '').trim()
        || String(it.detalle || '').trim()
        || parseFloat(it.precio) > 0)
);

const sym = (m) => (m === 'USD' ? 'US$' : '$');
const fmt = (n) => (Number(n) || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const hoy = (f) => {
    const d = f ? new Date(f) : new Date();
    return `${String(d.getDate()).padStart(2, '0')} / ${String(d.getMonth() + 1).padStart(2, '0')} / ${d.getFullYear()}`;
};
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre'];
const fechaLarga = (f) => {
    const d = f ? new Date(f) : new Date();
    return `Montevideo, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
};
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* ─── HTML autocontenido para imprimir (mismo diseño, sin app alrededor) ─── */
const PRINT_CSS = `
@page{size:A4;margin:12mm 16mm 14mm}
html,body{margin:0;padding:0;font-family:'Inter','Helvetica Neue',Arial,sans-serif;color:#0a0a0a;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sheet{width:100%;box-sizing:border-box;display:block}
table.pg{width:100%;border-collapse:collapse}.pgc{padding:0;vertical-align:top}
table.pg thead{display:table-header-group}table.pg tfoot{display:table-footer-group}
.hdr{display:grid;grid-template-columns:1fr auto;align-items:flex-end;gap:12mm;padding-bottom:3mm}
.logo{width:32mm;height:auto;display:block}
.docref{text-align:right;font:500 8.5pt/1.4 'Roboto Mono',monospace;letter-spacing:.06em;color:#606060}
.docref b{display:block;color:#0a0a0a;font-weight:700;letter-spacing:.18em;text-transform:uppercase;margin-bottom:1mm}
.cmyk{height:1mm;margin-top:3mm;overflow:hidden}.cmyk .inner{display:flex;height:100%;width:calc(100% + 10mm);margin-left:-5mm}
.cmyk .inner>div{flex:1;transform:skewX(-22.5deg)}.cmyk .c{background:#00AEEF}.cmyk .m{background:#FF0099}.cmyk .y{background:#FFFF00}.cmyk .k{background:#000}
.title{margin-top:4mm;display:grid;grid-template-columns:1fr auto;gap:10mm;align-items:flex-start}
.title h1{margin:0 0 3mm;font:900 32pt/.92 'Inter',sans-serif;letter-spacing:-.025em;text-transform:uppercase}
.title .sub{margin:0;font:500 9pt/1.3 'Roboto Mono',monospace;letter-spacing:.14em;text-transform:uppercase;color:#606060}
.fields{border:.3mm solid #c8c8c8;padding:4mm 5mm;width:76mm;box-sizing:border-box}
.fields .f{display:grid;grid-template-columns:22mm 1fr;gap:3mm;align-items:baseline;padding:1.5mm 0}
.fields .f+.f{border-top:.2mm solid #eceae3}
.fields .lbl{font:600 7.5pt/1 'Roboto Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:#8a8a8a}
.fields .val{font:500 9pt/1.15 'Roboto Mono',monospace;white-space:nowrap}
.client{break-inside:avoid;margin-top:8mm;padding:4mm 6mm 4mm 4mm;background:#F7F7F4;border-left:1mm solid #000;display:grid;grid-template-columns:1fr 1fr;gap:4mm}
.client .lbl{font:600 7.5pt/1 'Roboto Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:#606060;display:block;margin-bottom:1mm}
.client .val{font:500 10pt/1.35 'Inter',sans-serif}.client .tenue{color:#606060}
.items{margin-top:8mm;width:100%;border-collapse:collapse;font:400 9.5pt/1.4 'Inter',sans-serif}
.items thead th{text-align:left;font:600 7.5pt/1 'Roboto Mono',monospace;letter-spacing:.18em;text-transform:uppercase;color:#606060;padding:2mm;border-bottom:.4mm solid #000}
.items thead th.num{text-align:right}.items tbody tr{break-inside:avoid}
.items tbody td{padding:2mm;border-bottom:.2mm solid #eceae3;vertical-align:top}
.items tbody td.num{text-align:right;font:500 10pt/1 'Roboto Mono',monospace}
.items .desc{display:block;font-weight:500}
.items .meta{display:block;margin-top:.6mm;font:500 7.5pt/1.25 'Roboto Mono',monospace;color:#8a8a8a}
.items col.c-qty{width:18mm}.items col.c-pu{width:30mm}.items col.c-sub{width:30mm}
.totals{break-inside:avoid;margin-top:5mm;display:flex;justify-content:flex-end}
.totals .box{min-width:80mm;border:.4mm solid #000}
.totals .row{display:grid;grid-template-columns:1fr auto;gap:4mm;padding:2.5mm 5mm;align-items:baseline}
.totals .row+.row{border-top:.2mm solid #eceae3}
.totals .lbl{font:600 8pt/1 'Roboto Mono',monospace;letter-spacing:.16em;text-transform:uppercase;color:#606060}
.totals .val{font:500 10pt/1 'Roboto Mono',monospace;text-align:right;min-width:24mm;white-space:nowrap}
.totals .row.grand{background:#0a0a0a;color:#fff;padding:3mm 5mm}
.totals .row.grand .lbl{color:rgba(255,255,255,.65)}
.totals .row.grand .val{font:800 13pt/1 'Inter',sans-serif;color:#fff}
.cond{break-inside:avoid;margin-top:5mm;padding:3mm 0;border-top:.3mm solid #c8c8c8;border-bottom:.3mm solid #c8c8c8}
.cond h3{margin:0 0 1mm;font:700 8pt/1 'Roboto Mono',monospace;letter-spacing:.18em;text-transform:uppercase}
.cond ul{margin:1mm 0 0;padding:0 0 0 3mm;font:400 7.5pt/1.3 'Inter',sans-serif;color:#1a1a1a;columns:2;column-gap:6mm}
.cond ul li{margin:.5mm 0;break-inside:avoid}
.mbody{margin-top:14mm}
.mbody .recipient{margin-bottom:10mm;font:500 10pt/1.35 'Inter',sans-serif}
.mbody .recipient .place{color:#606060;font-style:italic}
.mbody .recipient .date{margin-top:4mm;font:500 9pt/1 'Roboto Mono',monospace;color:#606060;text-transform:lowercase}
.mbody h1{margin:0 0 8mm;font:700 16pt/1.2 'Inter',sans-serif}
.mbody .salutation{font:500 italic 10pt/1.4 'Inter',sans-serif;margin-bottom:4mm}
.mbody p{margin:0 0 5mm;font:400 10pt/1.55 'Inter',sans-serif;color:#1a1a1a;white-space:pre-wrap}
.mbody .signature{margin-top:20mm}
.mbody .signature .name{font:600 10pt/1.2 'Inter',sans-serif}
.mbody .signature .role{font:500 8.5pt/1.4 'Roboto Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:#606060}
.foot{margin-top:8mm;padding:5mm;background:#F7F7F4;break-inside:avoid}
.foot .foot-title{font:700 7.5pt/1 'Roboto Mono',monospace;letter-spacing:.18em;text-transform:uppercase;color:#606060;padding-bottom:2mm;margin-bottom:3mm;border-bottom:.3mm solid #c8c8c8}
.foot .seller{display:flex;align-items:baseline;gap:3mm;padding-bottom:3mm;margin-bottom:3mm;border-bottom:.2mm solid #eceae3}
.foot .seller .lbl{font:600 7pt/1 'Roboto Mono',monospace;letter-spacing:.18em;text-transform:uppercase;color:#8a8a8a}
.foot .seller .val{font:500 8pt/1.3 'Roboto Mono',monospace}
.foot .row{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4mm 6mm}
.foot .col .lbl{font:600 7pt/1.25 'Roboto Mono',monospace;letter-spacing:.18em;text-transform:uppercase;color:#8a8a8a;white-space:nowrap;display:block;margin-bottom:1mm}
.foot .col .val{font:500 9pt/1.3 'Inter',sans-serif;white-space:nowrap}
.foot .col .val b{font-weight:700}
`;

const FOOT_HTML = (vendedor) => `
  <footer class="foot"><div class="foot-title">Contacto</div>
    ${vendedor ? `<div class="seller"><span class="lbl">Te atendió:</span><span class="val">${esc(vendedor)}</span></div>` : ''}
    <div class="row">
      <div class="col"><span class="lbl">Atención al Cliente</span><span class="val"><b>+598 99 503 501</b></span></div>
      <div class="col"><span class="lbl">Email</span><span class="val">info@user.uy</span></div>
      <div class="col"><span class="lbl">Web</span><span class="val"><b>user.com.uy</b></span></div>
      <div class="col"><span class="lbl">Showroom y retiro de pedidos</span><span class="val">Inca 2228, Montevideo</span></div>
    </div>
  </footer>`;

function buildPrintHtml(tab, doc, vendedor, totales) {
    const logo = `<img class="logo" src="${window.location.origin}/assets/images/logo/logo_new.svg" alt="user">`;
    const cmyk = `<div class="cmyk"><div class="inner"><div class="c"></div><div class="m"></div><div class="y"></div><div class="k"></div></div></div>`;
    let cuerpo;
    if (tab === 'memb') {
        cuerpo = `
          <div class="mbody">
            <div class="recipient">
              <span>${esc(doc.destinatario || '')}</span><br>
              <span class="place">${esc(doc.empresa || '')}</span>
              <div class="date">${esc(fechaLarga(doc.fechaEmision))}</div>
            </div>
            <h1>${esc(doc.asunto || '')}</h1>
            <div class="salutation">Estimado/a,</div>
            <p>${esc(doc.cuerpo || '')}</p>
            <div class="signature">
              <div class="name">${esc(vendedor || '')}</div>
              <div class="role">${esc(doc.firmaCargo || '')}</div>
            </div>
          </div>`;
    } else {
        const filas = doc.items
            .filter(it => String(it.descripcion || '').trim())
            .map(it => {
                const sub = (parseFloat(it.cantidad) || 0) * (parseFloat(it.precio) || 0);
                return `<tr><td><span class="desc">${esc(it.descripcion)}</span>${it.detalle ? `<span class="meta">${esc(it.detalle)}</span>` : ''}</td>
                  <td class="num">${esc(it.cantidad)}</td>
                  <td class="num">${sym(doc.moneda)} ${fmt(it.precio)}</td>
                  <td class="num">${sym(doc.moneda)} ${fmt(sub)}</td></tr>`;
            }).join('');
        const conds = condicionesActivas(doc).map(c => `<li>${esc(c)}</li>`).join('');
        cuerpo = `
          <section class="title">
            <div><h1>Presupuesto</h1><p class="sub">Cotización oficial · sujeta a condiciones comerciales</p></div>
            <div class="fields">
              <div class="f"><span class="lbl">N°</span><span class="val">${esc(doc.numero || '')}</span></div>
              <div class="f"><span class="lbl">Fecha</span><span class="val">${esc(hoy(doc.fechaEmision))}</span></div>
              <div class="f"><span class="lbl">Validez</span><span class="val">${esc(doc.validez || '')}</span></div>
              <div class="f"><span class="lbl">Moneda</span><span class="val">${doc.moneda === 'USD' ? 'US$ · IVA incl.' : '$ UYU · IVA incl.'}</span></div>
            </div>
          </section>
          <section class="client">
            <div><span class="lbl">Cliente</span><div class="val">${esc(doc.clienteNombre || '')}<br><span class="tenue">${esc(doc.clienteContacto || '')}</span></div></div>
            <div><span class="lbl">Datos</span><div class="val">${esc(doc.clienteRut || '')}<br><span class="tenue">${esc(doc.clienteTel || '')}</span></div></div>
          </section>
          <table class="items">
            <colgroup><col><col class="c-qty"><col class="c-pu"><col class="c-sub"></colgroup>
            <thead><tr><th>Descripción</th><th class="num">Cantidad</th><th class="num">Precio unit.</th><th class="num">Subtotal</th></tr></thead>
            <tbody>${filas}</tbody>
          </table>
          <section class="totals"><div class="box">
            <div class="row grand"><span class="lbl">Total · IVA incluido</span><span class="val">${sym(doc.moneda)} ${fmt(totales.total)}</span></div>
          </div></section>
          ${conds ? `<section class="cond"><h3>Condiciones comerciales</h3><ul>${conds}</ul></section>` : ''}`;
    }
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
      <title>${esc(doc.numero || (tab === 'memb' ? 'membrete_user' : 'presupuesto_user'))}</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Roboto+Mono:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>${PRINT_CSS}</style></head>
      <body><div class="sheet">
        <table class="pg"><thead><tr><td class="pgc">
          <header class="hdr">${logo}
            <div class="docref"><b>${tab === 'memb' ? 'Comunicación' : 'Documento comercial'}</b><span>${esc(doc.numero || '')}</span></div>
          </header>${cmyk}
        </td></tr></thead>
        <tbody><tr><td class="pgc">${cuerpo}</td></tr></tbody>
        <tfoot><tr><td class="pgc">${FOOT_HTML(vendedor)}</td></tr></tfoot></table>
      </div></body></html>`;
}

function imprimirHtml(html) {
    const w = window.open('', '_blank');
    if (!w) { toast.error('El navegador bloqueó la ventana de impresión.'); return; }
    w.document.write(html);
    w.document.close();
    // Darle un respiro a las fuentes antes de abrir el diálogo
    setTimeout(() => { w.focus(); w.print(); }, 400);
}

/* Capital Case: "GORRO BORDADO" / "gorro bordado" → "Gorro Bordado". Se aplica
   al tipear y al traer datos del catálogo/clientes (que vienen en mayúsculas). */
const capital = (s) => String(s || '').toLowerCase().replace(/\p{L}+/gu, w => w[0].toUpperCase() + w.slice(1));

/* Campo de una línea que ENVUELVE al siguiente renglón en vez de cortarse: un
   textarea que crece con el contenido (la descripción de un ítem puede ser larga
   y en la hoja impresa también baja de renglón). Enter no hace salto de línea —
   el impreso lo colapsaría y la pantalla mostraría algo distinto al papel. */
function AutoTextarea({ value, onChange, ...rest }) {
    const ref = useRef(null);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${el.scrollHeight}px`;
    }, [value]);
    return (
        <textarea ref={ref} rows={1} value={value} onChange={onChange}
            onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
            {...rest} />
    );
}

/* ─── Selector de producto del catálogo ─────────────────────────────────── */
function PickerCatalogo({ catalogo, onPick, onClose }) {
    const [q, setQ] = useState('');
    const inputRef = useRef(null);
    useEffect(() => { inputRef.current?.focus(); }, []);
    const filtrado = useMemo(() => {
        const t = q.trim().toLowerCase();
        const rows = t
            ? catalogo.filter(p => `${p.Familia} ${p.Producto} ${p.Descripcion || ''}`.toLowerCase().includes(t))
            : catalogo;
        const porFam = {};
        rows.forEach(p => { (porFam[p.Familia] = porFam[p.Familia] || []).push(p); });
        return porFam;
    }, [catalogo, q]);
    return (
        <div className="pp-picker" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="card">
                <div className="head">
                    <Search size={16} color="#888" />
                    <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
                        placeholder="Buscar producto en la lista de precios..." />
                    <button className="cerrar" onClick={onClose}><X size={18} /></button>
                </div>
                <div className="list">
                    {Object.keys(filtrado).length === 0 && <div className="vacio">Sin resultados</div>}
                    {Object.entries(filtrado).map(([fam, prods]) => (
                        <div key={fam}>
                            <div className="fam">{fam}</div>
                            {prods.map(p => (
                                <div key={p.Id} className="it" onClick={() => onPick(p)}>
                                    <div><span className="n">{p.Producto}</span>{p.Descripcion ? <>{' '}<span className="d">{p.Descripcion}</span></> : null}</div>
                                    <span className="p">{p.Moneda === 'DOLAR' || p.Moneda === 'USD' ? 'US$' : '$'} {fmt(p.Precio)}</span>
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

/* ─── Selector de cliente existente ─────────────────────────────────────── */
function PickerCliente({ onPick, onClose }) {
    const [q, setQ] = useState('');
    const [rows, setRows] = useState([]);
    const [buscando, setBuscando] = useState(false);
    const inputRef = useRef(null);
    useEffect(() => { inputRef.current?.focus(); }, []);
    // Búsqueda en vivo con debounce contra /clients/search (TOP 10 del backend)
    useEffect(() => {
        const t = q.trim();
        if (!t) { setRows([]); return; }
        setBuscando(true);
        const timer = setTimeout(() => {
            api.get('/clients/search', { params: { q: t } })
                .then(r => setRows(r.data || []))
                .catch(() => setRows([]))
                .finally(() => setBuscando(false));
        }, 300);
        return () => clearTimeout(timer);
    }, [q]);
    const trim = (v) => String(v || '').trim();
    return (
        <div className="pp-picker" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="card">
                <div className="head">
                    <BookUser size={16} color="#888" />
                    <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)}
                        placeholder="Buscar cliente por nombre, fantasía o ID..." />
                    <button className="cerrar" onClick={onClose}><X size={18} /></button>
                </div>
                <div className="list">
                    {!q.trim() && <div className="vacio">Escribí para buscar en los clientes del sistema</div>}
                    {q.trim() && !buscando && rows.length === 0 && <div className="vacio">Sin resultados</div>}
                    {rows.map(c => {
                        const nombre = trim(c.Nombre) || trim(c.NombreFantasia);
                        const fant = trim(c.NombreFantasia);
                        return (
                            <div key={c.CliIdCliente} className="it" onClick={() => onPick(c)}>
                                <div>
                                    <span className="n">{nombre}</span>
                                    {fant && fant !== nombre ? <>{' '}<span className="d">{fant}</span></> : null}
                                    {trim(c.IDCliente) ? <>{' '}<span className="d">· {trim(c.IDCliente).toLowerCase()}</span></> : null}
                                </div>
                                <span className="p">{trim(c.CioRuc) || trim(c.TelefonoTrabajo) || ''}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

/* ─── Página ────────────────────────────────────────────────────────────── */
export default function PresupuestosPage() {
    const { user } = useAuth();
    const nombreLogueado = user?.nombre || user?.usuario || '';
    // Solo un admin puede emitir a nombre de otro; el vendedor firma como él mismo
    const esAdmin = parseInt(user?.idRol, 10) === 1 || user?.rol === 'ADMIN';

    const [tab, setTab] = useState('presu');            // presu | memb | hist
    const [doc, setDoc] = useState(docVacio);
    const [catalogo, setCatalogo] = useState([]);
    const [cotizacion, setCotizacion] = useState(null); // CotDolar del día (tabla Cotizaciones)
    const [picker, setPicker] = useState(false);
    const [pickerCli, setPickerCli] = useState(false);
    const [confirmNuevo, setConfirmNuevo] = useState(false);
    // Foto de cómo quedó el documento al guardarlo o al abrirlo del historial
    const [snapshot, setSnapshot] = useState(() => fotoDoc(docVacio()));
    const [guardando, setGuardando] = useState(false);
    const [hist, setHist] = useState([]);
    const [histQ, setHistQ] = useState('');
    const [histLoading, setHistLoading] = useState(false);

    const set = (campo) => (e) => setDoc(d => ({ ...d, [campo]: e.target.value }));
    // Variante que fuerza Capital Case (cliente, contacto)
    const setCap = (campo) => (e) => setDoc(d => ({ ...d, [campo]: capital(e.target.value) }));
    const setItem = (i, campo) => (e) => {
        const valor = (campo === 'descripcion' || campo === 'detalle') ? capital(e.target.value) : e.target.value;
        setDoc(d => ({
            ...d, items: d.items.map((it, ix) => ix === i ? { ...it, [campo]: valor } : it),
        }));
    };
    const addItem = (pre) => setDoc(d => ({
        ...d,
        items: [...d.items, pre || { descripcion: '', detalle: '', cantidad: 1, precio: '' }],
    }));
    // Si se borra el único ítem, queda una fila en blanco (la tabla nunca queda vacía)
    const delItem = (i) => setDoc(d => {
        const items = d.items.filter((_, ix) => ix !== i);
        if (!items.length) items.push({ descripcion: '', detalle: '', cantidad: 1, precio: '' });
        return { ...d, items };
    });

    // El nombre que sale en el pie/firma: lo tipeado, o el del logueado
    const vendedorEfectivo = doc.vendedorNombre || nombreLogueado;

    // Totales SIEMPRE derivados de los ítems — jamás tipeados
    const totales = useMemo(() => {
        const total = doc.items.reduce((s, it) => s + (parseFloat(it.cantidad) || 0) * (parseFloat(it.precio) || 0), 0);
        return { total: Math.round(total * 100) / 100 };
    }, [doc.items]);

    useEffect(() => {
        api.get('/presupuestos/catalogo').then(r => setCatalogo(r.data || [])).catch(() => {});
        api.get('/presupuestos/cotizacion').then(r => setCotizacion(r.data?.dolar || null)).catch(() => {});
    }, []);

    // Cambiar la moneda CONVIERTE los precios al tipo de cambio del día (antes
    // solo cambiaba el símbolo y un ítem de US$ 22 pasaba a valer $ 22).
    const cambiarMoneda = (nueva) => {
        if (nueva === doc.moneda) return;
        const hayPrecios = doc.items.some(it => parseFloat(it.precio) > 0);
        if (!hayPrecios) { setDoc(d => ({ ...d, moneda: nueva })); return; }
        if (!cotizacion) { toast.error('No hay cotización del día cargada — no puedo convertir los precios.'); return; }
        setDoc(d => ({
            ...d,
            moneda: nueva,
            items: d.items.map(it => {
                const p = parseFloat(it.precio);
                if (!(p > 0)) return it;
                const conv = nueva === 'USD' ? p / cotizacion : p * cotizacion;
                return { ...it, precio: Math.round(conv * 100) / 100 };
            }),
        }));
        toast.info(`Precios convertidos a ${nueva === 'USD' ? 'dólares' : 'pesos'} (TC ${fmt(cotizacion)})`);
    };

    const cargarHist = useCallback(async () => {
        setHistLoading(true);
        try {
            const r = await api.get('/presupuestos', { params: histQ.trim() ? { q: histQ.trim() } : {} });
            setHist(r.data || []);
        } catch { toast.error('No se pudo cargar el historial'); }
        finally { setHistLoading(false); }
    }, [histQ]);
    useEffect(() => { if (tab === 'hist') cargarHist(); }, [tab, cargarHist]);

    const payload = (tipo) => ({
        tipo,
        moneda: doc.moneda, validez: doc.validez,
        clienteNombre: tipo === 'MEMBRETE' ? doc.destinatario : doc.clienteNombre,
        clienteContacto: tipo === 'MEMBRETE' ? doc.empresa : doc.clienteContacto,
        clienteRut: doc.clienteRut, clienteTel: doc.clienteTel,
        items: tipo === 'MEMBRETE' ? [] : doc.items,
        condiciones: condicionesActivas(doc),
        asunto: doc.asunto, cuerpo: doc.cuerpo, firmaCargo: doc.firmaCargo,
        vendedorNombre: vendedorEfectivo,
    });

    // Guarda (alta o edición) y devuelve el doc con número asignado
    const guardar = async (tipo) => {
        if (tipo === 'PRESUPUESTO') {
            if (!doc.clienteNombre.trim()) { toast.error('Falta el nombre del cliente.'); return null; }
            const conItems = doc.items.filter(it => String(it.descripcion || '').trim());
            if (!conItems.length) { toast.error('El presupuesto necesita al menos un ítem.'); return null; }
            const sinPrecio = conItems.some(it => !(parseFloat(it.precio) > 0));
            if (sinPrecio) { toast.error('Hay ítems sin precio.'); return null; }
        } else {
            if (!doc.asunto.trim() && !doc.cuerpo.trim()) { toast.error('La nota está vacía.'); return null; }
        }
        setGuardando(true);
        try {
            if (doc.id) {
                await api.put(`/presupuestos/${doc.id}`, payload(tipo));
                setSnapshot(fotoDoc(doc));
                toast.success(`${doc.numero} actualizado`);
                return doc;
            }
            const r = await api.post('/presupuestos', payload(tipo));
            const nuevo = { ...doc, id: r.data.PreId, numero: r.data.PreNumero, fechaEmision: r.data.FechaEmision };
            setDoc(nuevo);
            setSnapshot(fotoDoc(nuevo));
            toast.success(`Guardado como ${r.data.PreNumero}`);
            return nuevo;
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudo guardar');
            return null;
        } finally { setGuardando(false); }
    };

    // Imprimir SIEMPRE guarda primero: lo impreso y lo registrado nunca difieren
    const imprimir = async () => {
        const tipo = tab === 'memb' ? 'MEMBRETE' : 'PRESUPUESTO';
        const guardado = await guardar(tipo);
        if (!guardado) return;
        imprimirHtml(buildPrintHtml(tab, guardado, vendedorEfectivo, totales));
    };

    // "Nuevo" limpia la hoja: si hay algo cargado, se avisa antes (con la opción
    // de guardarlo primero). Con la hoja en blanco no molesta y limpia directo.
    const limpiar = () => {
        const vacio = docVacio();
        setDoc(vacio); setSnapshot(fotoDoc(vacio)); setConfirmNuevo(false);
        toast.info('Documento nuevo');
    };
    const hayCambios = snapshot !== fotoDoc(doc);
    const nuevo = () => {
        if (!hayContenido(doc)) return;              // hoja en blanco: el botón está deshabilitado
        if (doc.id && !hayCambios) { limpiar(); return; }  // guardado y sin tocar: no hay nada que avisar
        setConfirmNuevo(true);
    };
    const guardarYNuevo = async () => {
        const guardado = await guardar(tab === 'memb' ? 'MEMBRETE' : 'PRESUPUESTO');
        if (guardado) limpiar();   // si falló (o faltan datos), la hoja queda intacta
    };

    const abrirDeHistorial = async (fila, duplicar = false) => {
        try {
            const r = await api.get(`/presupuestos/${fila.PreId}`);
            const d = r.data;
            // Las guardadas vuelven tildadas; las default que no estén, destildadas
            const conds = (() => {
                let guardadas = [];
                try { guardadas = JSON.parse(d.Condiciones || '[]'); } catch { /* noop */ }
                if (!Array.isArray(guardadas)) guardadas = [];
                const lista = guardadas.map(t => ({ texto: t, on: true }));
                CONDICIONES_DEFAULT.forEach(t => { if (!guardadas.includes(t)) lista.push({ texto: t, on: false }); });
                return lista.length ? lista : CONDICIONES_DEFAULT.map(t => ({ texto: t, on: true }));
            })();
            const cargado = {
                id: duplicar ? null : d.PreId,
                numero: duplicar ? null : d.PreNumero,
                moneda: d.Moneda || 'UYU',
                validez: d.Validez || '30 días corridos',
                clienteNombre: d.PreTipo === 'MEMBRETE' ? '' : (d.ClienteNombre || ''),
                clienteContacto: d.PreTipo === 'MEMBRETE' ? '' : (d.ClienteContacto || ''),
                clienteRut: d.ClienteRut || '', clienteTel: d.ClienteTel || '',
                items: (d.items || []).length
                    ? d.items.map(it => ({ descripcion: it.Descripcion, detalle: it.Detalle || '', cantidad: it.Cantidad, precio: it.PrecioUnitario }))
                    : [{ descripcion: '', detalle: '', cantidad: 1, precio: '' }],
                condiciones: conds,
                asunto: d.Asunto || '', cuerpo: d.Cuerpo || '',
                destinatario: d.PreTipo === 'MEMBRETE' ? (d.ClienteNombre || '') : '',
                empresa: d.PreTipo === 'MEMBRETE' ? (d.ClienteContacto || '') : '',
                firmaCargo: d.FirmaCargo || '',
                vendedorNombre: d.VendedorNombre || '',
                fechaEmision: duplicar ? null : d.FechaEmision,
                estado: d.Estado,
            };
            setDoc(cargado);
            // Recién abierto = sin cambios (el duplicado tampoco: es idéntico hasta que lo toquen)
            setSnapshot(fotoDoc(cargado));
            setTab(d.PreTipo === 'MEMBRETE' ? 'memb' : 'presu');
            if (duplicar) toast.info('Duplicado: se guardará con número nuevo');
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudo abrir');
        }
    };

    const cambiarEstado = async (fila, estado) => {
        try {
            await api.put(`/presupuestos/${fila.PreId}/estado`, { estado });
            setHist(h => h.map(x => x.PreId === fila.PreId ? { ...x, Estado: estado } : x));
        } catch (e) { toast.error(e.response?.data?.error || 'No se pudo cambiar el estado'); }
    };

    const pickProducto = (p) => {
        const esUsd = /DOLAR|USD/i.test(String(p.Moneda || ''));
        const monedaProd = esUsd ? 'USD' : 'UYU';
        setDoc(d => {
            const items = [...d.items];
            const ultimo = items[items.length - 1];
            const esPrimerItem = items.length === 1 && ultimo && !String(ultimo.descripcion || '').trim();

            // Si es el PRIMER ítem, el documento adopta la moneda del producto.
            // Si no, el precio del catálogo se CONVIERTE a la moneda del documento
            // (antes se mezclaban: US$ 22 entraba como $ 22 en un presupuesto en pesos).
            let precio = Number(p.Precio) || 0;
            let moneda = d.moneda;
            if (esPrimerItem) {
                moneda = monedaProd;
            } else if (monedaProd !== d.moneda) {
                if (!cotizacion) {
                    toast.error('El producto está en otra moneda y no hay cotización del día para convertirlo.');
                    return d;
                }
                precio = Math.round((d.moneda === 'USD' ? precio / cotizacion : precio * cotizacion) * 100) / 100;
                toast.info(`Precio convertido de ${monedaProd === 'USD' ? 'US$' : '$'} ${fmt(p.Precio)} a ${sym(d.moneda)} ${fmt(precio)} (TC ${fmt(cotizacion)})`);
            }

            const item = { descripcion: capital(p.Producto), detalle: capital(p.Descripcion || ''), cantidad: 1, precio };
            if (ultimo && !String(ultimo.descripcion || '').trim()) items[items.length - 1] = item;
            else items.push(item);
            return { ...d, items, moneda };
        });
        setPicker(false);
    };

    // Traer un cliente existente del sistema (columnas CHAR → trim obligatorio)
    const pickCliente = (c) => {
        const t = (v) => String(v || '').trim();
        setDoc(d => ({
            ...d,
            clienteNombre: capital(t(c.Nombre) || t(c.NombreFantasia)),
            clienteRut: t(c.CioRuc) || d.clienteRut,
            clienteTel: t(c.TelefonoTrabajo) || d.clienteTel,
        }));
        setPickerCli(false);
    };

    const ESTADOS = { EMITIDO: '#606060', APROBADO: '#0a6e3c', RECHAZADO: '#a01d1d', VENCIDO: '#b45309' };

    return (
        <div className="pp-root">
            {/* Barra */}
            <div className="pp-bar">
                <button className={`pp-tab ${tab === 'presu' ? 'on' : ''}`} onClick={() => setTab('presu')}>Presupuesto</button>
                <button className={`pp-tab ${tab === 'memb' ? 'on' : ''}`} onClick={() => setTab('memb')}>Hoja membretada</button>
                <button className={`pp-tab ${tab === 'hist' ? 'on' : ''}`} onClick={() => setTab('hist')}>Historial</button>
                <span className="sep" />
                <small>Sesión: {nombreLogueado}</small>
                {tab !== 'hist' && <>
                    <button className="pp-act" onClick={nuevo} disabled={!hayContenido(doc)}
                        title={hayContenido(doc) ? 'Empezar un documento nuevo' : 'La hoja ya está en blanco'}>
                        <RotateCcw size={11} style={{ verticalAlign: '-1px' }} /> Nuevo
                    </button>
                    <button className="pp-act" disabled={guardando} onClick={() => guardar(tab === 'memb' ? 'MEMBRETE' : 'PRESUPUESTO')}>
                        <Save size={11} style={{ verticalAlign: '-1px' }} /> {guardando ? 'Guardando…' : 'Guardar'}
                    </button>
                    <button className="pp-act print" disabled={guardando} onClick={imprimir}>
                        <Printer size={11} style={{ verticalAlign: '-1px' }} /> Imprimir / PDF
                    </button>
                </>}
            </div>

            {/* ── PRESUPUESTO ── */}
            {tab === 'presu' && (
                <div className="pp-stage">
                    <div className="pp-sheet">
                        <header className="pp-hdr">
                            <img className="pp-logo" src="/assets/images/logo/logo_new.svg" alt="user" />
                            <div className="pp-docref"><b>Documento comercial</b><span>{doc.numero || 'N° al guardar'}</span></div>
                        </header>
                        <div className="pp-cmyk"><div className="inner"><div className="c" /><div className="m" /><div className="y" /><div className="k" /></div></div>

                        <section className="pp-title">
                            <div><h1>Presupuesto</h1><p className="sub">Cotización oficial · sujeta a condiciones comerciales</p></div>
                            <div className="pp-fields">
                                <div className="f"><span className="lbl">N°</span><span className="val">{doc.numero || 'se asigna al guardar'}</span></div>
                                <div className="f"><span className="lbl">Fecha</span><span className="val">{hoy(doc.fechaEmision)}</span></div>
                                <div className="f"><span className="lbl">Validez</span><span className="val"><input value={doc.validez} onChange={set('validez')} /></span></div>
                                <div className="f"><span className="lbl">Moneda</span><span className="val">
                                    <select value={doc.moneda} onChange={e => cambiarMoneda(e.target.value)}>
                                        <option value="UYU">$ UYU · IVA incl.</option>
                                        <option value="USD">US$ · IVA incl.</option>
                                    </select></span></div>
                            </div>
                        </section>

                        <section className="pp-client">
                            <button className="pp-cli-pick" title="Elegir un cliente existente" onClick={() => setPickerCli(true)}>
                                <BookUser size={13} /> Elegir cliente
                            </button>
                            <div><span className="lbl">Cliente</span>
                                <input value={doc.clienteNombre} onChange={setCap('clienteNombre')} placeholder="Nombre o razón social" />
                                <input className="tenue" value={doc.clienteContacto} onChange={setCap('clienteContacto')} placeholder="Persona de contacto" />
                            </div>
                            <div><span className="lbl">Datos</span>
                                <input value={doc.clienteRut} onChange={set('clienteRut')} placeholder="RUT / CI" />
                                <input className="tenue" value={doc.clienteTel} onChange={set('clienteTel')} placeholder="Teléfono" />
                            </div>
                        </section>

                        <table className="pp-items">
                            <colgroup><col /><col className="c-qty" /><col className="c-pu" /><col className="c-sub" /></colgroup>
                            <thead><tr><th>Descripción</th><th className="num">Cantidad</th><th className="num">Precio unit.</th><th className="num">Subtotal</th></tr></thead>
                            <tbody>
                                {doc.items.map((it, i) => {
                                    const sub = (parseFloat(it.cantidad) || 0) * (parseFloat(it.precio) || 0);
                                    return (
                                        <tr key={i}>
                                            <td className="desc">
                                                <AutoTextarea value={it.descripcion} onChange={setItem(i, 'descripcion')} placeholder="Descripción del ítem" />
                                                <div className="meta"><AutoTextarea value={it.detalle} onChange={setItem(i, 'detalle')} placeholder="detalle (opcional)" /></div>
                                            </td>
                                            <td className="num"><input type="number" min="0" step="1" value={it.cantidad} onChange={setItem(i, 'cantidad')} /></td>
                                            <td className="num"><input type="number" min="0" step="0.01" value={it.precio} onChange={setItem(i, 'precio')} placeholder="0" /></td>
                                            <td className="num">
                                                {sym(doc.moneda)} {fmt(sub)}
                                                <button className="pp-item-del" title="Quitar ítem" onClick={() => delItem(i)}><Trash2 size={13} /></button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                        <div className="pp-additem">
                            <button className="pp-btn-mini" onClick={() => addItem()}><Plus size={11} style={{ verticalAlign: '-1px' }} /> Ítem libre</button>
                            <button className="pp-btn-mini sec" onClick={() => setPicker(true)}><Search size={11} style={{ verticalAlign: '-1px' }} /> Desde catálogo</button>
                        </div>

                        <section className="pp-totals"><div className="box">
                            <div className="row grand"><span className="lbl">Total · IVA incluido</span><span className="val">{sym(doc.moneda)} {fmt(totales.total)}</span></div>
                        </div></section>

                        <section className="pp-cond">
                            <h3>Condiciones comerciales</h3>
                            {/* Cada condición se tilda: al papel van SOLO las marcadas */}
                            {doc.condiciones.map((c, i) => (
                                <div key={i} className={`pp-cond-row ${c.on ? '' : 'off'}`}>
                                    <input type="checkbox" checked={c.on}
                                        onChange={e => setDoc(d => ({ ...d, condiciones: d.condiciones.map((x, ix) => ix === i ? { ...x, on: e.target.checked } : x) }))} />
                                    <input className="txt" value={c.texto}
                                        onChange={e => setDoc(d => ({ ...d, condiciones: d.condiciones.map((x, ix) => ix === i ? { ...x, texto: e.target.value } : x) }))} />
                                    <button className="pp-cond-del" title="Quitar condición"
                                        onClick={() => setDoc(d => ({ ...d, condiciones: d.condiciones.filter((_, ix) => ix !== i) }))}>
                                        <X size={11} />
                                    </button>
                                </div>
                            ))}
                            <button className="pp-btn-mini sec" style={{ marginTop: '2mm' }}
                                onClick={() => setDoc(d => ({ ...d, condiciones: [...d.condiciones, { texto: '', on: true }] }))}>
                                <Plus size={11} style={{ verticalAlign: '-1px' }} /> Condición
                            </button>
                        </section>

                        <footer className="pp-foot">
                            <div className="foot-title">Contacto</div>
                            <div className="seller"><span className="lbl">Te atendió:</span>
                                <input className="val" style={{ width: 'auto', minWidth: '60mm' }} value={vendedorEfectivo}
                                    readOnly={!esAdmin} title={esAdmin ? 'Editable (sos admin)' : 'Tu nombre de usuario'}
                                    onChange={e => esAdmin && setDoc(d => ({ ...d, vendedorNombre: e.target.value }))}
                                    placeholder="Nombre del vendedor" />
                            </div>
                            <div className="row">
                                <div className="col"><span className="lbl">Atención al Cliente</span><span className="val"><b>+598 99 503 501</b></span></div>
                                <div className="col"><span className="lbl">Email</span><span className="val">info@user.uy</span></div>
                                <div className="col"><span className="lbl">Web</span><span className="val"><b>user.com.uy</b></span></div>
                                <div className="col"><span className="lbl">Showroom y retiro</span><span className="val">Inca 2228, Montevideo</span></div>
                            </div>
                        </footer>
                    </div>
                </div>
            )}

            {/* ── MEMBRETE ── */}
            {tab === 'memb' && (
                <div className="pp-stage">
                    <div className="pp-sheet">
                        <header className="pp-hdr">
                            <img className="pp-logo" src="/assets/images/logo/logo_new.svg" alt="user" />
                            <div className="pp-docref"><b>Comunicación</b><span>{doc.numero || 'N° al guardar'}</span></div>
                        </header>
                        <div className="pp-cmyk"><div className="inner"><div className="c" /><div className="m" /><div className="y" /><div className="k" /></div></div>

                        <div className="pp-memb-body">
                            <div className="recipient">
                                <input value={doc.destinatario} onChange={set('destinatario')} placeholder="Nombre del destinatario" />
                                <input className="place" value={doc.empresa} onChange={set('empresa')} placeholder="Empresa / Cargo" />
                                <div className="date">{fechaLarga(doc.fechaEmision)}</div>
                            </div>
                            <input className="asunto" value={doc.asunto} onChange={set('asunto')} placeholder="Asunto de la nota o comunicado" />
                            <div className="salutation">Estimado/a,</div>
                            <textarea className="cuerpo" value={doc.cuerpo} onChange={set('cuerpo')}
                                placeholder="Cuerpo de la nota. Sirve para comunicados, cartas formales y cualquier comunicación institucional con la papelería oficial." />
                            <div className="signature">
                                <input className="name" value={vendedorEfectivo}
                                    readOnly={!esAdmin}
                                    onChange={e => esAdmin && setDoc(d => ({ ...d, vendedorNombre: e.target.value }))}
                                    placeholder="Nombre de quien firma" />
                                <input className="role" value={doc.firmaCargo} onChange={set('firmaCargo')} placeholder="Cargo · área" />
                            </div>
                        </div>

                        <footer className="pp-foot">
                            <div className="foot-title">Contacto</div>
                            <div className="row">
                                <div className="col"><span className="lbl">Atención al Cliente</span><span className="val"><b>+598 99 503 501</b></span></div>
                                <div className="col"><span className="lbl">Email</span><span className="val">info@user.uy</span></div>
                                <div className="col"><span className="lbl">Web</span><span className="val"><b>user.com.uy</b></span></div>
                                <div className="col"><span className="lbl">Showroom y retiro</span><span className="val">Inca 2228, Montevideo</span></div>
                            </div>
                        </footer>
                    </div>
                </div>
            )}

            {/* ── HISTORIAL ── */}
            {tab === 'hist' && (
                <div className="pp-stage">
                    <div className="pp-hist">
                        <h2>Historial</h2>
                        <div className="filtros">
                            <input value={histQ} onChange={e => setHistQ(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && cargarHist()}
                                placeholder="Buscar por número, cliente o vendedor…" />
                            <button className="pp-btn-mini" onClick={cargarHist}>Buscar</button>
                        </div>
                        {histLoading ? <div className="vacio">Cargando…</div> : (
                            hist.length === 0 ? <div className="vacio">Todavía no hay documentos guardados.</div> : (
                                <table>
                                    <thead><tr>
                                        <th>N°</th><th>Fecha</th><th>Cliente / Asunto</th><th>Vendedor</th>
                                        <th style={{ textAlign: 'right' }}>Total</th><th>Estado</th><th />
                                    </tr></thead>
                                    <tbody>
                                        {hist.map(f => (
                                            <tr key={f.PreId}>
                                                <td className="num">{f.PreNumero}</td>
                                                <td>{new Date(f.FechaEmision).toLocaleDateString('es-UY')}</td>
                                                <td>{f.PreTipo === 'MEMBRETE' ? (f.Asunto || f.ClienteNombre || '—') : (f.ClienteNombre || '—')}</td>
                                                <td>{f.VendedorNombre || '—'}</td>
                                                <td style={{ textAlign: 'right', fontFamily: 'Roboto Mono, monospace' }}>
                                                    {f.PreTipo === 'MEMBRETE' ? '—' : `${sym(f.Moneda)} ${fmt(f.Total)}`}
                                                </td>
                                                <td>
                                                    {f.PreTipo === 'MEMBRETE' ? <span style={{ color: '#888', fontSize: 11 }}>NOTA</span> : (
                                                        <select className="est" style={{ color: ESTADOS[f.Estado] || '#606060', borderColor: ESTADOS[f.Estado] || '#ccc' }}
                                                            value={f.Estado} onChange={e => cambiarEstado(f, e.target.value)}>
                                                            {Object.keys(ESTADOS).map(s => <option key={s} value={s}>{s}</option>)}
                                                        </select>
                                                    )}
                                                </td>
                                                <td>
                                                    <div className="acciones">
                                                        <button className="mini" title="Abrir" onClick={() => abrirDeHistorial(f)}><FolderOpen size={13} /></button>
                                                        <button className="mini" title="Duplicar con número nuevo" onClick={() => abrirDeHistorial(f, true)}><Copy size={13} /></button>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )
                        )}
                    </div>
                </div>
            )}

            {picker && <PickerCatalogo catalogo={catalogo} onPick={pickProducto} onClose={() => setPicker(false)} />}
            {pickerCli && <PickerCliente onPick={pickCliente} onClose={() => setPickerCli(false)} />}

            {/* react-hot-toast no tiene contenedor global en la app (sonner y
                react-toastify sí, en MainAppContent): esta pantalla monta el suyo. */}
            <HotToaster position="bottom-right" />


            {confirmNuevo && (
                <div className="pp-confirm" onClick={e => e.target === e.currentTarget && setConfirmNuevo(false)}>
                    <div className="card">
                        <h3>¿Empezar un documento nuevo?</h3>
                        <p>
                            {doc.id
                                ? `${doc.numero} ya está guardado, pero los cambios que hiciste después se van a perder.`
                                : 'Lo que está cargado en la hoja se pierde: todavía no fue guardado.'}
                        </p>
                        <div className="acciones">
                            <button className="cancelar" onClick={() => setConfirmNuevo(false)} disabled={guardando}>Cancelar</button>
                            <button className="descartar" onClick={limpiar} disabled={guardando}>Descartar cambios</button>
                            <button className="guardar" onClick={guardarYNuevo} disabled={guardando}>
                                {guardando ? 'Guardando…' : 'Guardar y continuar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
