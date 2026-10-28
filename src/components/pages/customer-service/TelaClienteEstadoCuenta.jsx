import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
    Search, Loader2, FileText, ArrowDownCircle, ArrowUpCircle,
    MinusCircle, SlidersHorizontal, X, Download, RefreshCw,
    ChevronDown, ChevronRight, CheckCircle2, Scissors, Printer,
    Scroll, UserSearch, AlertTriangle, CalendarDays
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import api from '../../../services/apiClient';
import Selector from '../../ui/Selector';
import SelectorFecha from '../../ui/SelectorFecha';

// Estética nueva (27/10/2026): encabezado, buscador y filtros en una tarjeta blanca (Selector/SelectorFecha), bobinas
// como en el Inventario de tela (barra y chip del color del estado), movimientos en tabla clara y, en el celular,
// en tarjetas. Ingreso en verde, consumo en magenta, ajustes en ámbar. La lógica y el PDF que se exporta no cambiaron.
const CARD = 'bg-white rounded-2xl border border-zinc-200';
const BTN_PRINCIPAL = 'inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-brand-cyan text-white text-sm font-bold hover:bg-brand-cyan/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed';
const BTN_SECUNDARIO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-200 bg-white text-sm font-bold text-zinc-700 hover:bg-zinc-50 transition-colors disabled:opacity-50';
const BTN_ACTIVO = 'inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-zinc-900 bg-zinc-900 text-sm font-bold text-white transition-colors';
const BTN_ICONO = 'shrink-0 p-2 rounded-xl border border-zinc-200 bg-white text-zinc-400 hover:text-brand-cyan hover:border-brand-cyan/30 hover:bg-brand-cyan/5 transition-colors';
const CAJA_BUSQUEDA = 'flex items-center gap-2 rounded-xl border bg-white px-3 py-2.5 transition-colors focus-within:border-brand-cyan focus-within:ring-2 focus-within:ring-brand-cyan/15';
const ETIQUETA = 'block text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1.5';
const TH = 'px-4 py-2.5 text-[10px] font-black uppercase tracking-wide text-zinc-400 whitespace-nowrap';
const CHIP = 'inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wide whitespace-nowrap';
const CHIP_ESTADO = 'text-[11px] font-bold px-2.5 py-0.5 rounded-full border whitespace-nowrap';
const METRICA = 'text-[10px] font-black text-zinc-400 uppercase tracking-widest';

// En el celular, los movimientos de la bobina van en tarjetas en vez de la tabla de 6 columnas (se dibuja una sola vista)
const MQ_TABLA = '(min-width: 768px)';
function useConTabla() {
    const [conTabla, setConTabla] = useState(() => window.matchMedia(MQ_TABLA).matches);
    useEffect(() => {
        const mq = window.matchMedia(MQ_TABLA);
        const cambio = () => setConTabla(mq.matches);
        mq.addEventListener('change', cambio);
        return () => mq.removeEventListener('change', cambio);
    }, []);
    return conTabla;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
const fmtN  = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDt = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('es-UY', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
};
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-UY') : '—';
// En pantalla, dd/mm/aaaa con ceros; fmtDate queda como estaba porque es la del PDF
const fmtFecha = (d) => d ? new Date(d).toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';

const TIPO_CONFIG = {
    INGRESO:             { label: 'Ingreso',        icon: ArrowDownCircle, color: 'text-emerald-700 bg-emerald-50 border-emerald-200',                   sign: '+', textColor: 'text-emerald-600' },
    CONSUMO_PRODUCCION:  { label: 'Consumo',         icon: ArrowUpCircle,   color: 'text-brand-magenta bg-brand-magenta/10 border-brand-magenta/20',      sign: '-', textColor: 'text-brand-magenta' },
    CONSUMO_ORDEN:       { label: 'Consumo Orden',   icon: ArrowUpCircle,   color: 'text-brand-magenta bg-brand-magenta/10 border-brand-magenta/20',      sign: '-', textColor: 'text-brand-magenta' },
    DEVOLUCION_CANCELACION: { label: 'Devolución',   icon: ArrowDownCircle, color: 'text-emerald-700 bg-emerald-50 border-emerald-200',                   sign: '+', textColor: 'text-emerald-600' },
    AJUSTE_DESECHO:      { label: 'Merma',           icon: MinusCircle,     color: 'text-amber-700 bg-amber-50 border-amber-200',                         sign: '±', textColor: 'text-amber-600'   },
    AJUSTE_MANUAL:       { label: 'Ajuste Manual',   icon: MinusCircle,     color: 'text-amber-700 bg-amber-50 border-amber-200',                         sign: '±', textColor: 'text-amber-600'   },
    // La cantidad es la diferencia contra lo declarado (antes llevaba un tilde; sin símbolos en la interfaz)
    CONFIRMACION_MEDIDA: { label: 'Confirm. Medida', icon: CheckCircle2,    color: 'text-brand-cyan bg-brand-cyan/10 border-brand-cyan/20',               sign: '±', textColor: 'text-brand-cyan'  },
    RESERVA_ORDEN:       { label: 'Reserva',         icon: ArrowUpCircle,   color: 'text-brand-cyan bg-brand-cyan/10 border-brand-cyan/20',               sign: '→', textColor: 'text-brand-cyan'  },
    LIBERACION_RESERVA:  { label: 'Lib. Reserva',    icon: ArrowDownCircle, color: 'text-emerald-700 bg-emerald-50 border-emerald-200',                   sign: '←', textColor: 'text-emerald-600' },
    MERMA_REIMPRESION:   { label: 'Merma Reimp.',    icon: MinusCircle,     color: 'text-amber-700 bg-amber-50 border-amber-200',                         sign: '-', textColor: 'text-amber-600'   },
};
const getTipo = (t) => TIPO_CONFIG[t] || { label: t, icon: MinusCircle, color: 'text-zinc-500 bg-zinc-50 border-zinc-200', sign: '?', textColor: 'text-zinc-500' };

// Colores como en el Inventario de tela: pendiente ámbar, disponible verde, agotada/cerrada gris.
// `dot` pinta la barra del costado de la tarjeta.
const ESTADO_CONFIG = {
    'Pendiente':  { label: 'Pendiente',  color: 'bg-amber-50 text-amber-700 border-amber-200',       dot: 'bg-amber-400',   closed: false },
    'En Uso':     { label: 'En Uso',     color: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', closed: false },
    'Consumida':  { label: 'Consumida',  color: 'bg-zinc-100 text-zinc-500 border-zinc-200',         dot: 'bg-zinc-300',    closed: true  },
    'Confirmado': { label: 'Confirmado', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', closed: false },
    'Cerrada':    { label: 'Cerrada',    color: 'bg-zinc-100 text-zinc-500 border-zinc-200',         dot: 'bg-zinc-300',    closed: true  },
    // Estados reales de InventarioBobinas que faltaban: sin ellos el badge caía
    // al fallback gris y las bobinas Agotadas contaban como "Activas" en el filtro
    'Disponible': { label: 'Disponible', color: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500', closed: false },
    'Agotado':    { label: 'Agotado',    color: 'bg-zinc-100 text-zinc-500 border-zinc-200',         dot: 'bg-zinc-300',    closed: true  },
    'Cerrado':    { label: 'Cerrado',    color: 'bg-zinc-100 text-zinc-500 border-zinc-200',         dot: 'bg-zinc-300',    closed: true  },
};
const getEstado = (e) => ESTADO_CONFIG[e] || { label: e || '—', color: 'bg-zinc-100 text-zinc-500 border-zinc-200', dot: 'bg-zinc-200', closed: false };

// Cantidad de bobinas por pestaña (Todas / Activas / Cerradas): la usan las pastillas y el Selector del celular
const contarPorEstado = (lista, op) => op === 'Todas' ? lista.length
    : op === 'Activas' ? lista.filter(b => !getEstado(b.estado).closed).length
    : lista.filter(b => getEstado(b.estado).closed).length;

// ─────────────────────────────────────────────────────────────────────
// Generar PDF para un arreglo de bobinas
// ─────────────────────────────────────────────────────────────────────
function generarPDFBobinas(bobinas, clienteNombre, clienteId) {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const W = 210, ML = 14, MR = 196, CW = MR - ML;
    const DARK=[30,41,59],MID=[71,85,105],LIGHT=[148,163,184],BG=[248,250,252];
    const GREEN=[22,163,74],RED=[220,38,38],INDIGO=[79,70,229],AMBER=[217,119,6],WHITE=[255,255,255];
    const sf=(c)=>doc.setFillColor(...c);
    const sc=(c)=>doc.setTextColor(...c);
    const sd=(c)=>doc.setDrawColor(...c);
    const B=(s=9)=>{doc.setFont('helvetica','bold');doc.setFontSize(s);};
    const N=(s=8)=>{doc.setFont('helvetica','normal');doc.setFontSize(s);};
    let y=0,pageN=0;
    const hLine=(yy,lw=0.2,col=LIGHT)=>{sd(col);doc.setLineWidth(lw);doc.line(ML,yy,MR,yy);};
    const drawPageHeader=()=>{
        pageN++;
        if(pageN>1)doc.addPage();
        sf(DARK);doc.rect(0,0,W,22,'F');
        sc(WHITE);B(15);doc.text('USER',ML,10);
        N(8);sc([148,163,184]);doc.text('GESTION DE PRODUCCION',ML,16);
        sc(WHITE);B(10);doc.text('ESTADO DE CUENTA - TELA DE CLIENTE',MR,10,{align:'right'});
        N(7);sc([148,163,184]);doc.text('Emitido: '+new Date().toLocaleString('es-UY'),MR,16,{align:'right'});
        var bandH = clienteId ? 15 : 11;
        sf([241,245,249]);doc.rect(0,22,W,bandH,'F');
        sc(MID);N(7.5);doc.text('CLIENTE:',ML,29);
        sc(DARK);B(9);doc.text(clienteNombre,ML+18,29);
        if(clienteId){N(7.5);sc([79,70,229]);doc.text(clienteId, MR, 29, {align:'right'});doc.text('ID:', MR-doc.getTextWidth(clienteId)-2, 29);}
        return clienteId ? 40 : 37;
    };
    const checkPage=(need=10)=>{if(y+need>275){y=drawPageHeader();}};
    y=drawPageHeader();
    const totIng=bobinas.reduce((s,b)=>s+b.movimientos.filter(m=>m.TipoMovimiento==='INGRESO').reduce((a,m)=>a+Math.abs(parseFloat(m.Cantidad||0)),0),0);
    const totCons=bobinas.reduce((s,b)=>s+b.movimientos.filter(m=>!['INGRESO','CONFIRMACION_MEDIDA','LIBERACION_RESERVA'].includes(m.TipoMovimiento)&&parseFloat(m.Cantidad)<0).reduce((a,m)=>a+Math.abs(parseFloat(m.Cantidad||0)),0),0);
    const totSaldo=bobinas.reduce((s,b)=>s+parseFloat(b.saldoBulto||0),0);
    sf(INDIGO);doc.roundedRect(ML,y,CW,16,2,2,'F');
    [['+'+fmtN(totIng)+' m','TOTAL INGRESADO',GREEN],['-'+fmtN(totCons)+' m','CONSUMIDO',RED],[fmtN(totSaldo)+' m','SALDO DISPONIBLE',[99,230,190]]].forEach(function(item,i){
        var kx=ML+6+i*(CW/3);
        N(6.5);sc([199,210,254]);doc.text(item[1],kx,y+6);
        B(11);sc(item[2]);doc.text(item[0],kx,y+13);
    });
    y+=22;
    bobinas.forEach(function(b,bi){
        var totalIng=b.movimientos.filter(function(m){return m.TipoMovimiento==='INGRESO';}).reduce(function(s,m){return s+Math.abs(parseFloat(m.Cantidad||0));},0);
        var EXCL=['INGRESO','CONFIRMACION_MEDIDA','LIBERACION_RESERVA'];
        var totalCons=b.movimientos.filter(function(m){return !EXCL.includes(m.TipoMovimiento)&&parseFloat(m.Cantidad)<0;}).reduce(function(s,m){return s+Math.abs(parseFloat(m.Cantidad||0));},0);
        var saldo=parseFloat(b.saldoBulto||0);
        checkPage(38);
        // Calcular altura del header de bobina: titulo+subtitulo = 14mm, + dim si existe = +6mm
        var dim=[b.metrosIniciales?'L:'+fmtN(b.metrosIniciales)+'m':'',b.ancho?'A:'+fmtN(b.ancho)+'m':'',b.peso?'P:'+fmtN(b.peso)+'kg':''].filter(Boolean).join('  ');
        var dimH = dim ? 6 : 0;
        var hH = 14 + dimH;
        sf(BG);doc.rect(ML,y,CW,hH,'F');
        sd(INDIGO);doc.setLineWidth(0.5);doc.line(ML,y,ML,y+hH);
        sd(LIGHT);doc.setLineWidth(0.2);doc.rect(ML,y,CW,hH);
        sc(DARK);B(10);doc.text(b.tela||'---',ML+4,y+6);
        N(7.5);sc(MID);doc.text((b.referencia||b.bulto)+' | '+b.bulto+' | '+(b.estado||'---'),ML+4,y+11);
        // Dimensiones en tercera linea (dentro del rect agrandado)
        if(dim){N(6.5);sc(LIGHT);doc.text(dim,ML+4,y+16);}
        // Metricas derecha: 3 columnas en zona exclusiva (la mitad derecha del header)
        var metW=19; var metStart=MR-3*metW;
        [['+'+fmtN(totalIng)+' m','ING',GREEN],['-'+fmtN(totalCons)+' m','CONS',RED],[fmtN(saldo)+' m','SALDO',INDIGO]].forEach(function(item,i){
            var mx=metStart+i*metW+metW/2;
            N(6);sc(LIGHT);doc.text(item[1],mx,y+7,{align:'center'});
            B(8);sc(item[2]);doc.text(item[0],mx,y+12,{align:'center'});
        });
        y += hH + 2;
        if(b.movimientos.length===0){N(8);sc(LIGHT);doc.text('Sin movimientos',ML+4,y+5);y+=10;}
        else{
            // Layout de columnas — posiciones absolutas desde izquierda de pagina:
            // FECHA: 14-38 (24mm) | TIPO: 38-72 (34mm) | CANT: 72-96 right (24mm) | SALDO: 96-122 right (26mm) | DETALLE: 122-196 left (74mm)
            // ORDEN: si existe, se muestra pequeño debajo del TIPO
            var fX=ML+1, tX=ML+25, cX=ML+82, sX=ML+110, dX=ML+116;
            sf([241,245,249]);doc.rect(ML,y,CW,5.5,'F');
            B(6);sc(MID);
            doc.text('FECHA', fX, y+4);
            doc.text('TIPO',  tX, y+4);
            doc.text('CANT.', cX, y+4, {align:'right'});
            doc.text('SALDO', sX, y+4, {align:'right'});
            doc.text('DETALLE / ORDEN', dX+2, y+4);
            y+=6;
            b.movimientos.forEach(function(m,mi){
                // Preparar texto del detalle PRIMERO para saber cuantas lineas ocupa
                var raw=(m.Referencia||'').replace(/Ajuste\s+BOB-[\w-]+:\s*/gi,'');
                // Limpiar caracteres unicode que Helvetica no renderiza bien
                var rawClean = raw
                    .replace(/\u2192/g,'->')   // flecha derecha → ->
                    .replace(/\u2190/g,'<-')   // flecha izquierda
                    .replace(/[^\x00-\xFF]/g,'?'); // cualquier otro no-latin
                var hasPipe=rawClean.includes(' | ');
                var ord=hasPipe?rawClean.split(' | ')[0].trim():'';
                var det=hasPipe?rawClean.split(' | ').slice(1).join(' | ').trim():rawClean;
                var detText = ord ? '['+ord+'] '+det : det;
                // Calcular lineas que necesita el detalle (ancho disponible = MR - dX - 4 = ~64mm)
                var detMaxW = MR - dX - 6;
                N(6.5);
                var detLines = doc.splitTextToSize(detText, detMaxW);
                if(detLines.length > 2) detLines = detLines.slice(0,2); // max 2 lineas
                var rowH = detLines.length > 1 ? 9 : 6;

                checkPage(rowH+1);
                var cant=parseFloat(m.Cantidad)||0;
                var cfg=getTipo(m.TipoMovimiento);
                if(mi%2===0){sf([252,252,254]);doc.rect(ML,y-0.5,CW,rowH+0.5,'F');}
                // FECHA
                N(7);sc(MID);doc.text(fmtDate(m.FechaMovimiento),fX,y+3.5);
                // TIPO (centrado verticalmente en el rowH)
                var tCol=m.TipoMovimiento==='INGRESO'?GREEN:m.TipoMovimiento==='CONFIRMACION_MEDIDA'?[37,99,235]:cant<0?RED:AMBER;
                B(6.5);sc(tCol);doc.text(cfg.label.substring(0,13),tX,y+3.5);
                // CANT right-aligned
                B(7.5);sc(cant>=0?GREEN:RED);
                doc.text((cant>=0?'+':'')+fmtN(cant)+' m', cX, y+3.5, {align:'right'});
                // SALDO right-aligned
                B(7.5);sc(DARK);
                doc.text(fmtN(m.SaldoAcumulado||0)+' m', sX, y+3.5, {align:'right'});
                // DETALLE multilinea
                N(6.5);sc(MID);
                detLines.forEach(function(line,li){
                    doc.text(line, dX+2, y+3.5+(li*3.8));
                });
                y += rowH;
            });

            sf([239,246,255]);doc.rect(ML,y,CW,5.5,'F');
            B(7);sc(INDIGO);doc.text('Saldo: '+fmtN(saldo)+' m',MR-2,y+4,{align:'right'});
            sc(GREEN);doc.text('Ingresado: +'+fmtN(totalIng)+' m',MR-30,y+4,{align:'right'});
            y+=7;
        }
        if(bi<bobinas.length-1){hLine(y,0.4,[203,213,225]);y+=5;}
    });
    var total=doc.getNumberOfPages();
    for(var p=1;p<=total;p++){
        doc.setPage(p);sf(DARK);doc.rect(0,285,W,12,'F');
        N(7);sc(LIGHT);
        doc.text('USER ERP - Tela de Cliente - Documento confidencial',ML,292);
        doc.text('Pagina '+p+' de '+total,MR,292,{align:'right'});
    }
    doc.save('estado-tela-'+(clienteId||clienteNombre.replace(/\s+/g,'_'))+'.pdf');
}

// ─────────────────────────────────────────────────────────────────────
// BobinaCard con checkbox y botón exportar individual
// ─────────────────────────────────────────────────────────────────────
function BobinaCard({ data, checked, onCheck, clienteNombre, clienteId, conTabla }) {
    const { bobinaId, bulto, tela, estado, saldoBulto, referencia, movimientos,
            fechaIngreso, metrosIniciales, ancho, peso } = data;
    const [open, setOpen] = useState(false);
    const estadoCfg = getEstado(estado);

    const totalIng  = movimientos.filter(m => m.TipoMovimiento === 'INGRESO').reduce((s,m) => s + Math.abs(parseFloat(m.Cantidad||0)), 0);
    const EXCLUIR_CONS = ['INGRESO', 'CONFIRMACION_MEDIDA', 'LIBERACION_RESERVA'];
    const totalCons = movimientos
        .filter(m => !EXCLUIR_CONS.includes(m.TipoMovimiento) && parseFloat(m.Cantidad) < 0)
        .reduce((s, m) => s + Math.abs(parseFloat(m.Cantidad || 0)), 0);
    const saldo     = parseFloat(saldoBulto || 0);

    return (
        <div className={`${CARD} overflow-hidden flex items-stretch transition-colors ${checked ? 'border-brand-cyan ring-2 ring-brand-cyan/15' : estadoCfg.closed ? 'opacity-75 hover:border-zinc-300' : 'hover:border-zinc-300'}`}>
            {/* Barra lateral con el color del estado (como en el Inventario de tela) */}
            <div className={`w-1.5 shrink-0 ${estadoCfg.dot}`} />

            <div className="flex-1 min-w-0">
                {/* Header: en el celular los números bajan a un recuadro de tres columnas */}
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-3 px-4 py-3.5">
                    {/* Checkbox */}
                    <label className="flex items-center cursor-pointer shrink-0" onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={checked} onChange={() => onCheck(bobinaId)}
                            aria-label="Seleccionar bobina"
                            className="w-4 h-4 accent-[#006E97] cursor-pointer" />
                    </label>

                    {/* Expand toggle */}
                    <button type="button" onClick={() => setOpen(p => !p)} aria-expanded={open}
                        aria-label={open ? 'Ocultar movimientos' : 'Ver movimientos'}
                        className="shrink-0 p-1 -m-1 rounded-lg text-zinc-400 hover:text-brand-cyan transition-colors">
                        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>

                    {/* Info principal */}
                    <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setOpen(p => !p)}>
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-black text-zinc-800 text-sm leading-tight">{tela || '—'}</span>
                            <span className={`${CHIP_ESTADO} ${estadoCfg.color}`}>{estadoCfg.label}</span>
                        </div>
                        <div className="flex items-center gap-x-3 gap-y-1 mt-1.5 flex-wrap text-[11px]">
                            <span className="font-mono font-black text-zinc-800 bg-zinc-100 border border-zinc-200 px-1.5 rounded-md">{referencia || bulto}</span>
                            <span className="inline-flex items-center gap-1 text-zinc-500 tabular-nums">
                                <CalendarDays size={12} className="text-brand-cyan" /> {fmtFecha(fechaIngreso)}
                            </span>
                            {metrosIniciales && (
                                <span className="text-zinc-500 tabular-nums">
                                    Largo {fmtN(metrosIniciales)} m
                                    {ancho ? ` · Ancho ${fmtN(ancho)} m` : ''}
                                    {peso  ? ` · Peso ${fmtN(peso)} kg`  : ''}
                                </span>
                            )}
                            <span className="text-zinc-400 font-mono">{bulto}</span>
                        </div>
                    </div>

                    {/* Métricas */}
                    <div className="order-last sm:order-none w-full sm:w-auto shrink-0 grid grid-cols-3 gap-2 sm:flex sm:items-center sm:gap-5 rounded-xl bg-zinc-50 sm:bg-transparent px-3 py-2 sm:p-0">
                        <div className="text-center">
                            <p className={METRICA}>Ingreso</p>
                            <p className="text-sm font-black tabular-nums whitespace-nowrap text-emerald-600">+{fmtN(totalIng)}<span className="text-[10px] font-bold ml-0.5 opacity-70">m</span></p>
                        </div>
                        <div className="text-center">
                            <p className={METRICA}>Consumo</p>
                            <p className={`text-sm font-black tabular-nums whitespace-nowrap ${totalCons > 0 ? 'text-brand-magenta' : 'text-zinc-400'}`}>{totalCons > 0 ? '-' : ''}{fmtN(totalCons)}<span className="text-[10px] font-bold ml-0.5 opacity-70">m</span></p>
                        </div>
                        <div className="text-center">
                            <p className={METRICA}>Saldo</p>
                            <p className={`text-sm font-black tabular-nums whitespace-nowrap ${saldo > 0 ? 'text-brand-cyan' : 'text-zinc-400'}`}>{fmtN(saldo)}<span className="text-[10px] font-bold ml-0.5 opacity-70">m</span></p>
                        </div>
                    </div>
                    <div className="text-[11px] text-zinc-400 font-bold whitespace-nowrap tabular-nums hidden md:block">
                        {movimientos.length} mov.
                    </div>
                    {/* Exportar esta bobina */}
                    <button
                        type="button"
                        onClick={() => generarPDFBobinas([data], clienteNombre, clienteId)}
                        title="Exportar PDF esta bobina"
                        aria-label="Exportar PDF esta bobina"
                        className={BTN_ICONO}>
                        <Printer size={15} />
                    </button>
                </div>

                {/* Detalle movimientos */}
                {open && (
                    <div className="border-t border-zinc-100">
                        {movimientos.length === 0 ? (
                            <p className="text-center text-xs text-zinc-400 py-5">Sin movimientos</p>
                        ) : conTabla ? (
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead className="bg-zinc-50 border-b border-zinc-200">
                                        <tr>
                                            {/* Cantidad y Saldo van alineados a la derecha como sus celdas — con todo
                                                a la izquierda los títulos quedaban "corridos" respecto de los números */}
                                            {['Fecha', 'Tipo', 'Cantidad', 'Saldo Acum.', 'Referencia', 'Operario'].map(h => (
                                                <th key={h} className={`${TH} ${h === 'Cantidad' || h === 'Saldo Acum.' ? 'text-right' : 'text-left'}`}>{h}</th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-zinc-100">
                                        {movimientos.map((m, i) => {
                                            const cfg = getTipo(m.TipoMovimiento);
                                            const Icon = cfg.icon;
                                            const isIngreso = m.TipoMovimiento === 'INGRESO';
                                            return (
                                                <tr key={m.MovimientoID || i} className="hover:bg-zinc-50 transition-colors">
                                                    <td className="px-4 py-2.5 text-[11px] text-zinc-500 tabular-nums whitespace-nowrap">{fmtDt(m.FechaMovimiento)}</td>
                                                    <td className="px-4 py-2.5">
                                                        <span className={`${CHIP} ${cfg.color}`}><Icon size={11} />{cfg.label}</span>
                                                    </td>
                                                    <td className={`px-4 py-2.5 font-black tabular-nums text-right whitespace-nowrap ${isIngreso ? 'text-emerald-600' : cfg.textColor}`}>
                                                        {cfg.sign} {fmtN(Math.abs(m.Cantidad))} m
                                                    </td>
                                                    <td className="px-4 py-2.5 font-bold tabular-nums text-right text-zinc-800 whitespace-nowrap">
                                                        {fmtN(m.SaldoAcumulado || 0)} m
                                                    </td>
                                                    <td className="px-4 py-2.5 text-[11px] text-zinc-500 max-w-[280px] truncate" title={m.Referencia || ''}>
                                                        {m.Referencia || m.CodigoRecepcion || '—'}
                                                    </td>
                                                    <td className="px-4 py-2.5 text-[11px] text-zinc-500 whitespace-nowrap">{m.Operario || '—'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-zinc-50 border-t border-zinc-200">
                                            <td colSpan={2} className="px-4 py-2.5 text-[10px] font-black text-zinc-400 uppercase tracking-widest">Resumen bobina</td>
                                            <td className="px-4 py-2.5 font-black tabular-nums text-right text-emerald-600 text-xs whitespace-nowrap">+{fmtN(totalIng)} m</td>
                                            <td className="px-4 py-2.5 font-black tabular-nums text-right text-brand-cyan text-xs whitespace-nowrap">{fmtN(saldo)} m</td>
                                            <td colSpan={2} />
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        ) : (
                            <div className="divide-y divide-zinc-100">
                                {movimientos.map((m, i) => {
                                    const cfg = getTipo(m.TipoMovimiento);
                                    const Icon = cfg.icon;
                                    const isIngreso = m.TipoMovimiento === 'INGRESO';
                                    return (
                                        <div key={m.MovimientoID || i} className="px-4 py-3 flex flex-col gap-1.5">
                                            <div className="flex items-center justify-between gap-2">
                                                <span className={`${CHIP} ${cfg.color}`}><Icon size={11} />{cfg.label}</span>
                                                <span className={`text-sm font-black tabular-nums whitespace-nowrap ${isIngreso ? 'text-emerald-600' : cfg.textColor}`}>
                                                    {cfg.sign} {fmtN(Math.abs(m.Cantidad))} m
                                                </span>
                                            </div>
                                            <div className="text-xs text-zinc-500 break-words">{m.Referencia || m.CodigoRecepcion || '—'}</div>
                                            <div className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                                                <span className="min-w-0 truncate tabular-nums">{fmtDt(m.FechaMovimiento)} · {m.Operario || '—'}</span>
                                                <span className="shrink-0 whitespace-nowrap">Saldo <b className="font-bold text-zinc-800 tabular-nums">{fmtN(m.SaldoAcumulado || 0)} m</b></span>
                                            </div>
                                        </div>
                                    );
                                })}
                                <div className="px-4 py-2.5 bg-zinc-50 flex items-center justify-between gap-2">
                                    <span className="text-[10px] font-black text-zinc-400 uppercase tracking-widest">Resumen bobina</span>
                                    <span className="flex items-center gap-3 text-xs font-black tabular-nums whitespace-nowrap">
                                        <span className="text-emerald-600"><span className="text-[10px] font-bold text-zinc-400 mr-1">ING.</span>+{fmtN(totalIng)} m</span>
                                        <span className="text-brand-cyan"><span className="text-[10px] font-bold text-zinc-400 mr-1">SALDO</span>{fmtN(saldo)} m</span>
                                    </span>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────
// Página principal
// ─────────────────────────────────────────────────────────────────────
export default function TelaClienteEstadoCuenta() {
    const [query,       setQuery]       = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [clienteSel,  setClienteSel]  = useState(null);
    const [searching,   setSearching]   = useState(false);

    const [movimientos, setMovimientos] = useState([]);
    const [saldos,      setSaldos]      = useState([]);
    const [loading,     setLoading]     = useState(false);
    const [error,       setError]       = useState(null);

    const [showFiltros,  setShowFiltros]  = useState(false);
    const [filtros,      setFiltros]      = useState({ desde: '', hasta: '', tela: '' });
    const [filtroEstado, setFiltroEstado] = useState('Todas');
    const [checkedIds,   setCheckedIds]   = useState(new Set());
    const conTabla = useConTabla(); // en el celular, los movimientos de cada bobina van en tarjetas

    // Búsqueda clientes
    const searchClients = useCallback(async (q) => {
        if (!q || q.length < 2) { setSuggestions([]); return; }
        setSearching(true);
        try {
            const res = await api.get(`/clients/search?q=${encodeURIComponent(q)}&limit=8`);
            const list = res.data?.data || res.data || [];
            setSuggestions(list.slice(0, 8));
        } catch { setSuggestions([]); }
        finally { setSearching(false); }
    }, []);

    useEffect(() => {
        const t = setTimeout(() => searchClients(query), 300);
        return () => clearTimeout(t);
    }, [query, searchClients]);

    const selectCliente = (c) => {
        setClienteSel(c);
        setQuery(c.NombreFantasia || c.Nombre || c.IDCliente || '');
        setSuggestions([]);
        setCheckedIds(new Set());
    };

    // Cargar datos
    const loadData = useCallback(async () => {
        if (!clienteSel) return;
        setLoading(true); setError(null);
        try {
            const id = clienteSel.CliIdCliente || clienteSel.ClienteID || clienteSel.Nombre || clienteSel;
            const params = new URLSearchParams();
            if (filtros.desde) params.set('desde', filtros.desde);
            if (filtros.hasta) params.set('hasta', filtros.hasta);
            if (filtros.tela)  params.set('tela',  filtros.tela);

            const [resMov, resSaldo] = await Promise.all([
                api.get(`/tela-cliente/${encodeURIComponent(id)}/estado-cuenta?${params}`),
                api.get(`/tela-cliente/${encodeURIComponent(id)}/saldo`),
            ]);
            if (resMov.data.success)   setMovimientos(resMov.data.data   || []);
            if (resSaldo.data.success) setSaldos(resSaldo.data.data || []);
            setCheckedIds(new Set());
        } catch (err) { setError(err.message || 'Error cargando datos'); }
        finally { setLoading(false); }
    }, [clienteSel, filtros]);

    useEffect(() => { loadData(); }, [loadData]);

    // Agrupar por bobina
    const bobinas = useMemo(() => {
        if (!movimientos.length) return [];
        const map = {};
        movimientos.forEach(m => {
            const key = m.BobinaID;
            if (!map[key]) {
                map[key] = {
                    bobinaId:        m.BobinaID,
                    bulto:           m.Bulto,
                    tela:            m.TipoTela,
                    estado:          m.EstadoBulto,
                    saldoBulto:      m.SaldoBulto,
                    metrosIniciales: m.MetrosIniciales,
                    ancho:           m.Ancho,
                    peso:            m.Peso,
                    referencia:      m.ReferenciaOrden || m.CodigoRecepcion || '',
                    fechaIngreso:    null,
                    movimientos:     [],
                };
            }
            map[key].movimientos.push(m);
            if (m.TipoMovimiento === 'INGRESO' && !map[key].fechaIngreso) {
                map[key].fechaIngreso = m.FechaMovimiento;
            }
        });
        return Object.values(map).sort((a, b) => {
            const activo = (e) => !getEstado(e).closed;
            return (activo(b.estado) ? 1 : 0) - (activo(a.estado) ? 1 : 0)
                || (new Date(b.fechaIngreso || 0) - new Date(a.fechaIngreso || 0));
        });
    }, [movimientos]);

    // Lista de telas únicas para el filtro
    const telasUnicas = useMemo(() => [...new Set(bobinas.map(b => b.tela).filter(Boolean))], [bobinas]);

    // Filtrar por estado
    const bobinasFiltradas = useMemo(() => {
        if (filtroEstado === 'Activas')  return bobinas.filter(b => !getEstado(b.estado).closed);
        if (filtroEstado === 'Cerradas') return bobinas.filter(b => getEstado(b.estado).closed);
        return bobinas;
    }, [bobinas, filtroEstado]);

    // Checkboxes
    const toggleCheck = (id) => {
        setCheckedIds(prev => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    };
    const toggleAll = () => {
        if (checkedIds.size === bobinasFiltradas.length) setCheckedIds(new Set());
        else setCheckedIds(new Set(bobinasFiltradas.map(b => b.bobinaId)));
    };
    const selectedBobinas = bobinasFiltradas.filter(b => checkedIds.has(b.bobinaId));

    // Totales globales
    const totalIngresado  = movimientos.filter(m => m.TipoMovimiento === 'INGRESO').reduce((s,m) => s + Math.abs(parseFloat(m.Cantidad||0)), 0);
    // Mismo criterio que la card por bobina: consumo bruto = todo movimiento negativo que no
    // sea ingreso/confirmación/liberación (la lista por tipo dejaba afuera CONSUMO_ORDEN).
    const totalConsumido  = movimientos.filter(m => !['INGRESO','CONFIRMACION_MEDIDA','LIBERACION_RESERVA'].includes(m.TipoMovimiento) && parseFloat(m.Cantidad) < 0).reduce((s,m) => s + Math.abs(parseFloat(m.Cantidad||0)), 0);
    const totalDisponible = saldos.reduce((s, x) => s + parseFloat(x.MetrosLibres||0), 0);
    const totalEnProceso  = saldos.reduce((s, x) => s + parseFloat(x.MetrosEnProceso||0), 0);

    const clienteNombre = clienteSel ? (clienteSel.NombreFantasia || clienteSel.Nombre || '') : '';

    return (
        <div className="px-3 sm:px-6 py-5 min-h-full text-zinc-700 flex flex-col gap-4">

            {/* ── Cabecera ── */}
            <div className="flex flex-wrap items-center gap-3">
                <Scroll size={30} className="text-brand-cyan shrink-0" />
                <div className="min-w-[220px] flex-1">
                    <h1 className="text-xl sm:text-2xl font-black uppercase tracking-tight text-zinc-900 leading-none">Estado de cuenta — Tela de cliente</h1>
                    <p className="text-sm text-zinc-500 mt-1">Vista por bobina · ingresos, consumos y saldo disponible</p>
                </div>
            </div>

            {/* ── Buscador, barra de herramientas y filtros ── */}
            <div className={`${CARD} p-3 md:p-4 flex flex-col gap-3`}>
                <div className="relative">
                    <div className={`${CAJA_BUSQUEDA} ${clienteSel ? 'border-brand-cyan' : 'border-zinc-200'}`}>
                        {searching
                            ? <Loader2 size={16} className="animate-spin text-brand-cyan shrink-0" />
                            : <Search size={16} className="text-zinc-400 shrink-0" />}
                        <input value={query}
                            onChange={e => { setQuery(e.target.value); if (!e.target.value) { setClienteSel(null); setMovimientos([]); setSaldos([]); } }}
                            placeholder="Buscar cliente por nombre..."
                            aria-label="Buscar cliente"
                            autoComplete="off"
                            className="flex-1 min-w-0 bg-transparent text-sm text-zinc-800 placeholder:text-zinc-400 outline-none" />
                        {clienteSel && (
                            <button type="button" aria-label="Quitar cliente" className="p-0.5 rounded-full text-zinc-400 hover:text-zinc-700 transition-colors"
                                onClick={() => { setClienteSel(null); setQuery(''); setMovimientos([]); setSaldos([]); }}>
                                <X size={15} />
                            </button>
                        )}
                    </div>
                    {suggestions.length > 0 && (
                        <div className="absolute top-full left-0 right-0 z-50 mt-1.5 bg-white border border-zinc-200 rounded-xl shadow-xl shadow-zinc-900/10 overflow-hidden">
                            <div className="px-3 py-2 bg-zinc-50 text-[10px] font-black text-zinc-400 uppercase tracking-wide border-b border-zinc-100 flex justify-between">
                                <span>Clientes encontrados</span>
                                <span className="tabular-nums">{suggestions.length} resultado{suggestions.length !== 1 ? 's' : ''}</span>
                            </div>
                            {suggestions.map((c, i) => (
                                <button key={i} type="button" onClick={() => selectCliente(c)}
                                    className="w-full text-left px-3 py-2.5 hover:bg-zinc-50 border-b border-zinc-100 last:border-0 flex items-center gap-3 transition-colors">
                                    <span className="w-8 h-8 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-700 font-black text-sm shrink-0">
                                        {String(c.NombreFantasia || c.Nombre || 'C').charAt(0).toUpperCase()}
                                    </span>
                                    <span className="flex-1 min-w-0">
                                        <span className="block text-sm font-bold text-zinc-800 truncate">{c.NombreFantasia || c.Nombre}</span>
                                        <span className="block text-[10px] text-zinc-400 font-mono truncate">{c.IDCliente || c.CliIdCliente || ''}</span>
                                    </span>
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                {/* ── Barra de herramientas ── */}
                {clienteSel && (
                    <div className="flex flex-col md:flex-row md:items-center gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                            {/* Filtro estado bobina: pastillas en escritorio, Selector en el celular */}
                            <div className="hidden md:inline-flex rounded-xl border border-zinc-200 bg-white p-1 gap-1">
                                {['Todas', 'Activas', 'Cerradas'].map(op => {
                                    const cnt = contarPorEstado(bobinas, op);
                                    return (
                                        <button key={op} type="button" onClick={() => setFiltroEstado(op)}
                                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${filtroEstado === op ? 'bg-zinc-900 text-white' : 'text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100'}`}>
                                            {op}
                                            {cnt > 0 && <span className={`rounded-full px-1.5 text-[10px] font-black tabular-nums ${filtroEstado === op ? 'bg-white/20 text-white' : 'bg-zinc-100 text-zinc-500'}`}>{cnt}</span>}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="md:hidden w-full">
                                <Selector filtro className="w-full" aria-label="Estado de las bobinas" value={filtroEstado} onChange={e => setFiltroEstado(e.target.value)}>
                                    {['Todas', 'Activas', 'Cerradas'].map(op => (
                                        <option key={op} value={op}>{op} ({contarPorEstado(bobinas, op)})</option>
                                    ))}
                                </Selector>
                            </div>

                            <button type="button" onClick={() => setShowFiltros(p => !p)} aria-pressed={showFiltros}
                                className={`${showFiltros ? BTN_ACTIVO : BTN_SECUNDARIO} flex-1 md:flex-none`}>
                                <SlidersHorizontal size={15} className={showFiltros ? '' : 'text-brand-cyan'} /> Filtros
                            </button>
                            <button type="button" onClick={loadData} className={`${BTN_SECUNDARIO} flex-1 md:flex-none`}>
                                <RefreshCw size={15} className={`text-brand-cyan ${loading ? 'animate-spin' : ''}`} /> Actualizar
                            </button>
                        </div>

                        {/* Acciones de exportar */}
                        <div className="flex items-center gap-2 md:ml-auto empty:hidden">
                            {selectedBobinas.length > 0 && (
                                <button type="button" onClick={() => generarPDFBobinas(selectedBobinas, clienteNombre, clienteSel?.IDCliente || clienteSel?.CliIdCliente)}
                                    className={`${BTN_PRINCIPAL} w-full md:w-auto`}>
                                    <Download size={15} /> Exportar {selectedBobinas.length} seleccionada{selectedBobinas.length !== 1 ? 's' : ''}
                                </button>
                            )}
                            {bobinasFiltradas.length > 0 && selectedBobinas.length === 0 && (
                                <button type="button" onClick={() => generarPDFBobinas(bobinasFiltradas, clienteNombre, clienteSel?.IDCliente || clienteSel?.CliIdCliente)}
                                    className={`${BTN_PRINCIPAL} w-full md:w-auto`}>
                                    <Download size={15} /> Exportar todas
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* ── Panel de filtros ── */}
                {showFiltros && (
                    <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-end pt-3 border-t border-zinc-100">
                        {[{ key: 'desde', label: 'Desde' }, { key: 'hasta', label: 'Hasta' }].map(({ key, label }) => (
                            <div key={key} className="min-w-0 md:w-44">
                                <span className={ETIQUETA}>{label}</span>
                                <SelectorFecha filtro vaciable className="w-full" value={filtros[key]} placeholder={label} aria-label={`Fecha ${label.toLowerCase()}`}
                                    onChange={e => setFiltros(p => ({ ...p, [key]: e.target.value }))} />
                            </div>
                        ))}
                        <div className="min-w-0 col-span-2 md:col-span-1 md:w-60">
                            <span className={ETIQUETA}>Tipo de tela</span>
                            <Selector filtro className="w-full" aria-label="Tipo de tela" value={filtros.tela}
                                onChange={e => setFiltros(p => ({ ...p, tela: e.target.value }))}>
                                <option value="">Todas las telas</option>
                                {telasUnicas.map(t => <option key={t} value={t}>{t}</option>)}
                            </Selector>
                        </div>
                        <button type="button" onClick={() => setFiltros({ desde: '', hasta: '', tela: '' })}
                            className={`${BTN_SECUNDARIO} col-span-2 md:col-span-1`}>
                            <X size={15} /> Limpiar
                        </button>
                    </div>
                )}
            </div>

            {/* ── Cliente elegido ── */}
            {clienteSel && (
                <div className={`${CARD} p-4 flex items-center gap-4`}>
                    <div className="w-12 h-12 rounded-full bg-zinc-100 flex items-center justify-center text-zinc-700 font-black text-xl shrink-0">
                        {String(clienteNombre || 'C').charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Cliente</p>
                        <p className="font-black text-zinc-800 text-base leading-tight truncate">{clienteNombre}</p>
                        {(clienteSel.IDCliente || clienteSel.CliIdCliente) && (
                            <span className="inline-block mt-1 text-[11px] font-mono bg-zinc-100 text-zinc-600 px-2 py-0.5 rounded-full border border-zinc-200 font-bold">
                                ID CLIENTE: {clienteSel.IDCliente || clienteSel.CliIdCliente}
                            </span>
                        )}
                    </div>
                    {!loading && (
                        <div className="text-right shrink-0">
                            <p className="text-2xl font-black text-zinc-800 tabular-nums leading-none">{bobinas.length}</p>
                            <p className="text-xs text-zinc-400 mt-1">bobina{bobinas.length !== 1 ? 's' : ''}</p>
                        </div>
                    )}
                </div>
            )}

            {/* ── Estado vacío / cargando ── */}
            {!clienteSel && !loading && (
                <div className={`${CARD} flex flex-col items-center justify-center py-16 px-4 text-center`}>
                    <UserSearch size={40} className="mb-3 text-brand-cyan" />
                    <p className="text-sm font-bold text-zinc-700">Seleccioná un cliente para ver sus bobinas</p>
                    <p className="text-xs text-zinc-400 mt-1">Buscalo por nombre arriba: se muestran sus bobinas con ingresos, consumos y saldo disponible.</p>
                </div>
            )}
            {error && (
                <div className="flex items-center gap-2 p-4 rounded-2xl bg-brand-magenta/10 border border-brand-magenta/20 text-brand-magenta text-sm font-bold">
                    <AlertTriangle size={16} className="shrink-0" /> {error}
                </div>
            )}
            {loading && (
                <div className={`${CARD} flex flex-col items-center justify-center py-16 gap-3`}>
                    <Loader2 size={30} className="animate-spin text-brand-cyan" />
                    <p className="text-sm text-zinc-400">Cargando movimientos...</p>
                </div>
            )}

            {/* ── Seleccionar todas ── */}
            {!loading && bobinasFiltradas.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 px-1 -mb-1">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-zinc-500 hover:text-zinc-800 transition-colors">
                        <input type="checkbox"
                            checked={checkedIds.size === bobinasFiltradas.length && bobinasFiltradas.length > 0}
                            onChange={toggleAll}
                            className="w-4 h-4 accent-[#006E97] cursor-pointer" />
                        {checkedIds.size === bobinasFiltradas.length ? 'Desmarcar todas' : 'Seleccionar todas'}
                    </label>
                    {checkedIds.size > 0 && (
                        <span className={`${CHIP_ESTADO} bg-brand-cyan/10 text-brand-cyan border-brand-cyan/20 tabular-nums`}>{checkedIds.size} seleccionada{checkedIds.size !== 1 ? 's' : ''}</span>
                    )}
                </div>
            )}

            {/* ── Lista de bobinas ── */}
            {!loading && bobinasFiltradas.length > 0 && (
                <div className="flex flex-col gap-3">
                    {bobinasFiltradas.map(b => (
                        <BobinaCard key={b.bobinaId} data={b}
                            checked={checkedIds.has(b.bobinaId)}
                            onCheck={toggleCheck}
                            clienteNombre={clienteNombre}
                            clienteId={clienteSel?.IDCliente || clienteSel?.CliIdCliente}
                            conTabla={conTabla}
                        />
                    ))}
                </div>
            )}

            {!loading && clienteSel && bobinas.length > 0 && bobinasFiltradas.length === 0 && (
                <div className={`${CARD} flex flex-col items-center justify-center py-12 px-4 text-center`}>
                    <Scissors size={40} className="mb-3 text-brand-cyan" />
                    <p className="text-sm font-bold text-zinc-700">No hay bobinas {filtroEstado === 'Activas' ? 'activas' : 'cerradas'} para este cliente</p>
                </div>
            )}

            {!loading && clienteSel && movimientos.length === 0 && !error && (
                <div className={`${CARD} flex flex-col items-center justify-center py-16 px-4 text-center`}>
                    <FileText size={40} className="mb-3 text-brand-cyan" />
                    <p className="text-sm font-bold text-zinc-700">Sin movimientos registrados</p>
                    <p className="text-xs text-zinc-400 mt-1">Aún no hay ingresos de tela o no coincide con los filtros</p>
                </div>
            )}

            {/* Footer */}
            {!loading && bobinasFiltradas.length > 0 && (
                <div className="px-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-400 font-bold">
                    <span className="tabular-nums">{bobinasFiltradas.length} bobina{bobinasFiltradas.length !== 1 ? 's' : ''} · {movimientos.length} movimiento{movimientos.length !== 1 ? 's' : ''}</span>
                    <span className="flex items-center gap-3">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Ingresos</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-brand-magenta inline-block" /> Consumos</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Ajustes</span>
                    </span>
                </div>
            )}
        </div>
    );
}
