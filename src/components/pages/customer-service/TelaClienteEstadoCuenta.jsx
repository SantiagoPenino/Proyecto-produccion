import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
    Search, Loader2, FileText, ArrowDownCircle, ArrowUpCircle,
    MinusCircle, SlidersHorizontal, X, Download, RefreshCw,
    Package, ChevronDown, ChevronRight, CheckCircle2, Scissors, Printer
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import api from '../../../services/apiClient';

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────
const fmtN  = (n) => Number(n || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDt = (d) => {
    if (!d) return '—';
    return new Date(d).toLocaleString('es-UY', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
};
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-UY') : '—';

const TIPO_CONFIG = {
    INGRESO:             { label: 'Ingreso',        icon: ArrowDownCircle, color: 'text-emerald-700 bg-emerald-50 border-emerald-200', sign: '+', textColor: 'text-emerald-600' },
    CONSUMO_PRODUCCION:  { label: 'Consumo',         icon: ArrowUpCircle,   color: 'text-rose-700 bg-rose-50 border-rose-200',         sign: '-', textColor: 'text-rose-600'     },
    AJUSTE_DESECHO:      { label: 'Merma',           icon: MinusCircle,     color: 'text-amber-700 bg-amber-50 border-amber-200',       sign: '±', textColor: 'text-amber-600'    },
    AJUSTE_MANUAL:       { label: 'Ajuste Manual',   icon: MinusCircle,     color: 'text-amber-700 bg-amber-50 border-amber-200',       sign: '±', textColor: 'text-amber-600'    },
    CONFIRMACION_MEDIDA: { label: 'Confirm. Medida', icon: CheckCircle2,    color: 'text-sky-700 bg-sky-50 border-sky-200',             sign: '✓', textColor: 'text-sky-600'      },
    RESERVA_ORDEN:       { label: 'Reserva',         icon: ArrowUpCircle,   color: 'text-indigo-700 bg-indigo-50 border-indigo-200',    sign: '→', textColor: 'text-indigo-600'   },
    LIBERACION_RESERVA:  { label: 'Lib. Reserva',    icon: ArrowDownCircle, color: 'text-teal-700 bg-teal-50 border-teal-200',          sign: '←', textColor: 'text-teal-600'     },
    MERMA_REIMPRESION:   { label: 'Merma Reimp.',    icon: MinusCircle,     color: 'text-orange-700 bg-orange-50 border-orange-200',    sign: '-', textColor: 'text-orange-600'   },
};
const getTipo = (t) => TIPO_CONFIG[t] || { label: t, icon: MinusCircle, color: 'text-slate-500 bg-slate-50 border-slate-200', sign: '?', textColor: 'text-slate-500' };

const ESTADO_CONFIG = {
    'Pendiente':  { label: 'Pendiente',  color: 'bg-amber-100 text-amber-800 border-amber-300',       dot: 'bg-amber-400',   closed: false },
    'En Uso':     { label: 'En Uso',     color: 'bg-sky-100 text-sky-800 border-sky-300',              dot: 'bg-sky-400',     closed: false },
    'Consumida':  { label: 'Consumida',  color: 'bg-slate-100 text-slate-500 border-slate-300',       dot: 'bg-slate-400',   closed: true  },
    'Confirmado': { label: 'Confirmado', color: 'bg-emerald-100 text-emerald-800 border-emerald-300',  dot: 'bg-emerald-400', closed: false },
    'Cerrada':    { label: 'Cerrada',    color: 'bg-rose-100 text-rose-700 border-rose-300',           dot: 'bg-rose-400',    closed: true  },
    // Estados reales de InventarioBobinas que faltaban: sin ellos el badge caía
    // al fallback gris y las bobinas Agotadas contaban como "Activas" en el filtro
    'Disponible': { label: 'Disponible', color: 'bg-emerald-100 text-emerald-800 border-emerald-300',  dot: 'bg-emerald-400', closed: false },
    'Agotado':    { label: 'Agotado',    color: 'bg-slate-100 text-slate-500 border-slate-300',        dot: 'bg-slate-400',   closed: true  },
    'Cerrado':    { label: 'Cerrado',    color: 'bg-rose-100 text-rose-700 border-rose-300',           dot: 'bg-rose-400',    closed: true  },
};
const getEstado = (e) => ESTADO_CONFIG[e] || { label: e || '—', color: 'bg-slate-100 text-slate-500 border-slate-300', dot: 'bg-slate-300', closed: false };

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
function BobinaCard({ data, checked, onCheck, clienteNombre, clienteId }) {
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
        <div className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-all ${checked ? 'border-indigo-400 ring-1 ring-indigo-300' : estadoCfg.closed ? 'border-slate-200 opacity-75' : 'border-slate-200 hover:border-indigo-200'}`}>

            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3.5">
                {/* Checkbox */}
                <label className="flex items-center cursor-pointer shrink-0" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={checked} onChange={() => onCheck(bobinaId)}
                        className="w-4 h-4 rounded border-slate-300 text-indigo-600 accent-indigo-600 cursor-pointer" />
                </label>

                {/* Expand toggle */}
                <button onClick={() => setOpen(p => !p)} className="shrink-0 text-slate-400 hover:text-indigo-500 transition-colors">
                    {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                </button>

                {/* Icono */}
                <div className={`p-1.5 rounded-lg shrink-0`} style={{background: 'rgba(99,102,241,0.08)'}}>
                    <Package size={14} className="text-indigo-500" />
                </div>

                {/* Info principal */}
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setOpen(p => !p)}>
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-black text-slate-800 text-sm">{tela || '—'}</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-black uppercase ${estadoCfg.color}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${estadoCfg.dot} inline-block`}/>
                            {estadoCfg.label}
                        </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                        <span className="text-[10px] font-mono font-bold text-indigo-600">{referencia || bulto}</span>
                        <span className="text-[10px] text-slate-400">{fmtDate(fechaIngreso)}</span>
                        {metrosIniciales && (
                            <span className="text-[10px] text-slate-400 font-mono">
                                L:{fmtN(metrosIniciales)}m
                                {ancho ? ` · A:${fmtN(ancho)}m` : ''}
                                {peso  ? ` · P:${fmtN(peso)}kg`  : ''}
                            </span>
                        )}
                        <span className="text-[10px] text-slate-300 font-mono">{bulto}</span>
                    </div>
                </div>

                {/* Métricas + export individual */}
                <div className="flex items-center gap-4 shrink-0">
                    <div className="text-center hidden sm:block">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Ingreso</p>
                        <p className="text-sm font-black font-mono text-emerald-600">+{fmtN(totalIng)}<span className="text-[9px] ml-0.5 opacity-70">m</span></p>
                    </div>
                    <div className="text-center hidden sm:block">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Consumo</p>
                        <p className="text-sm font-black font-mono text-rose-500">{totalCons > 0 ? '-' : ''}{fmtN(totalCons)}<span className="text-[9px] ml-0.5 opacity-70">m</span></p>
                    </div>
                    <div className="text-center">
                        <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Saldo</p>
                        <p className={`text-sm font-black font-mono ${saldo > 0 ? 'text-indigo-700' : 'text-slate-400'}`}>{fmtN(saldo)}<span className="text-[9px] ml-0.5 opacity-70">m</span></p>
                    </div>
                    <div className="text-[10px] text-slate-400 font-bold hidden md:block">
                        {movimientos.length} mov.
                    </div>
                    {/* Exportar esta bobina */}
                    <button
                        onClick={() => generarPDFBobinas([data], clienteNombre, clienteId)}
                        title="Exportar PDF esta bobina"
                        className="p-1.5 rounded-lg border border-slate-200 text-slate-400 hover:text-indigo-600 hover:border-indigo-300 transition-all shrink-0">
                        <Printer size={13} />
                    </button>
                </div>
            </div>

            {/* Detalle movimientos */}
            {open && (
                <div className="border-t border-slate-100">
                    {movimientos.length === 0 ? (
                        <p className="text-center text-xs text-slate-400 py-5">Sin movimientos</p>
                    ) : (
                        <table className="w-full text-xs">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    {['Fecha', 'Tipo', 'Cantidad', 'Saldo Acum.', 'Referencia', 'Operario'].map(h => (
                                        <th key={h} className="px-4 py-2 text-left text-[9px] font-black uppercase tracking-widest text-slate-500">{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {movimientos.map((m, i) => {
                                    const cfg = getTipo(m.TipoMovimiento);
                                    const Icon = cfg.icon;
                                    const isIngreso = m.TipoMovimiento === 'INGRESO';
                                    return (
                                        <tr key={m.MovimientoID || i} className={`border-b border-slate-50 hover:bg-slate-50/60 ${i % 2 === 0 ? 'bg-white' : 'bg-slate-50/30'}`}>
                                            <td className="px-4 py-2.5 font-mono text-[10px] text-slate-500 whitespace-nowrap">{fmtDt(m.FechaMovimiento)}</td>
                                            <td className="px-4 py-2.5">
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-black uppercase ${cfg.color}`}>
                                                    <Icon size={9} />{cfg.label}
                                                </span>
                                            </td>
                                            <td className={`px-4 py-2.5 font-black font-mono text-right whitespace-nowrap ${isIngreso ? 'text-emerald-600' : cfg.textColor}`}>
                                                {cfg.sign} {fmtN(Math.abs(m.Cantidad))} m
                                            </td>
                                            <td className="px-4 py-2.5 font-black font-mono text-right text-indigo-700 whitespace-nowrap">
                                                {fmtN(m.SaldoAcumulado || 0)} m
                                            </td>
                                            <td className="px-4 py-2.5 text-[10px] text-slate-400 max-w-[200px] truncate" title={m.Referencia || ''}>
                                                {m.Referencia || m.CodigoRecepcion || '—'}
                                            </td>
                                            <td className="px-4 py-2.5 text-[10px] text-slate-400">{m.Operario || '—'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                            <tfoot>
                                <tr className="bg-indigo-50 border-t border-indigo-100">
                                    <td colSpan={2} className="px-4 py-2 text-[10px] font-black text-indigo-700 uppercase tracking-widest">Resumen bobina</td>
                                    <td className="px-4 py-2 font-black font-mono text-right text-emerald-600 text-xs">+{fmtN(totalIng)} m</td>
                                    <td className="px-4 py-2 font-black font-mono text-right text-indigo-700 text-xs">{fmtN(saldo)} m</td>
                                    <td colSpan={2} />
                                </tr>
                            </tfoot>
                        </table>
                    )}
                </div>
            )}
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
    const totalConsumido  = movimientos.filter(m => ['CONSUMO_PRODUCCION','MERMA_REIMPRESION','AJUSTE_DESECHO'].includes(m.TipoMovimiento)).reduce((s,m) => s + Math.abs(parseFloat(m.Cantidad||0)), 0);
    const totalDisponible = saldos.reduce((s, x) => s + parseFloat(x.MetrosLibres||0), 0);
    const totalEnProceso  = saldos.reduce((s, x) => s + parseFloat(x.MetrosEnProceso||0), 0);

    const clienteNombre = clienteSel ? (clienteSel.NombreFantasia || clienteSel.Nombre || '') : '';

    return (
        <div className="min-h-screen bg-slate-50 p-4 md:p-6">

            {/* ── Cabecera ── */}
            <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-indigo-100">
                        <Package size={22} className="text-indigo-600" />
                    </div>
                    <div>
                        <h1 className="text-xl font-black text-slate-800">Estado de Cuenta — Tela de Cliente</h1>
                        <p className="text-xs text-slate-400 font-medium">Vista por bobina · ingresos, consumos y saldo disponible</p>
                    </div>
                </div>
                {clienteSel && (
                    <div className="text-right">
                        <p className="text-xs font-black text-slate-500 uppercase tracking-widest">Cliente</p>
                        <p className="text-base font-black text-slate-800">{clienteNombre}</p>
                        <p className="text-[10px] text-slate-400 font-mono">{clienteSel.IDCliente || clienteSel.CliIdCliente}</p>
                    </div>
                )}
            </div>

            {/* ── Buscador ── */}
            <div className="relative mb-5 max-w-lg">
                <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-2xl px-4 py-2.5 shadow-sm focus-within:ring-2 focus-within:ring-indigo-400 focus-within:border-indigo-400 transition-all">
                    <Search size={16} className="text-slate-400 shrink-0" />
                    <input value={query}
                        onChange={e => { setQuery(e.target.value); if (!e.target.value) { setClienteSel(null); setMovimientos([]); setSaldos([]); } }}
                        placeholder="Buscar cliente por nombre..."
                        className="flex-1 bg-transparent text-sm font-medium text-slate-700 placeholder-slate-300 outline-none" />
                    {searching && <Loader2 size={14} className="animate-spin text-indigo-400 shrink-0" />}
                    {clienteSel && (
                        <button onClick={() => { setClienteSel(null); setQuery(''); setMovimientos([]); setSaldos([]); }}>
                            <X size={14} className="text-slate-400 hover:text-slate-700" />
                        </button>
                    )}
                </div>
                {suggestions.length > 0 && (
                    <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
                        {suggestions.map((c, i) => (
                            <button key={i} onClick={() => selectCliente(c)}
                                className="w-full text-left px-4 py-2.5 hover:bg-indigo-50 transition-colors border-b border-slate-100 last:border-0">
                                <p className="text-sm font-bold text-slate-700">{c.NombreFantasia || c.Nombre}</p>
                                <p className="text-[10px] text-slate-400">{c.IDCliente || c.CliIdCliente || ''}</p>
                            </button>
                        ))}
                    </div>
                )}
            </div>



            {/* ── Barra de herramientas ── */}
            {clienteSel && (
                <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Filtro estado bobina */}
                        <div className="flex items-center rounded-xl overflow-hidden border border-slate-200 text-xs font-bold shadow-sm">
                            {['Todas', 'Activas', 'Cerradas'].map(op => {
                                const cnt = op === 'Todas' ? bobinas.length
                                    : op === 'Activas'  ? bobinas.filter(b => !getEstado(b.estado).closed).length
                                    : bobinas.filter(b => getEstado(b.estado).closed).length;
                                return (
                                    <button key={op} onClick={() => setFiltroEstado(op)}
                                        className={`px-3 py-1.5 transition-all flex items-center gap-1 ${filtroEstado === op ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 hover:bg-indigo-50'}`}>
                                        {op}
                                        {cnt > 0 && <span className={`rounded-full px-1.5 text-[9px] font-black ${filtroEstado === op ? 'bg-white/25 text-white' : 'bg-slate-100 text-slate-600'}`}>{cnt}</span>}
                                    </button>
                                );
                            })}
                        </div>

                        <button onClick={() => setShowFiltros(p => !p)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${showFiltros ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'}`}>
                            <SlidersHorizontal size={13} /> Filtros
                        </button>
                        <button onClick={loadData}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-white text-slate-600 border border-slate-200 hover:border-indigo-300 transition-all">
                            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Actualizar
                        </button>
                    </div>

                    {/* Acciones de exportar */}
                    <div className="flex items-center gap-2">
                        {selectedBobinas.length > 0 && (
                            <button onClick={() => generarPDFBobinas(selectedBobinas, clienteNombre, clienteSel?.IDCliente || clienteSel?.CliIdCliente)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 text-white hover:bg-indigo-700 transition-all shadow">
                                <Download size={13} /> Exportar {selectedBobinas.length} seleccionada{selectedBobinas.length !== 1 ? 's' : ''}
                            </button>
                        )}
                        {bobinasFiltradas.length > 0 && selectedBobinas.length === 0 && (
                            <button onClick={() => generarPDFBobinas(bobinasFiltradas, clienteNombre, clienteSel?.IDCliente || clienteSel?.CliIdCliente)}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-700 text-white hover:bg-slate-800 transition-all">
                                <Download size={13} /> Exportar todas
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* ── Panel de filtros ── */}
            {showFiltros && (
                <div className="mb-4 p-4 bg-white border border-slate-200 rounded-2xl shadow-sm grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[{ key: 'desde', label: 'Desde', type: 'date' }, { key: 'hasta', label: 'Hasta', type: 'date' }].map(({ key, label, type }) => (
                        <div key={key}>
                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">{label}</label>
                            <input type={type} value={filtros[key]}
                                onChange={e => setFiltros(p => ({ ...p, [key]: e.target.value }))}
                                className="w-full text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-300" />
                        </div>
                    ))}
                    <div>
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-1">Tipo de Tela</label>
                        <select value={filtros.tela} onChange={e => setFiltros(p => ({ ...p, tela: e.target.value }))}
                            className="w-full text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 outline-none focus:ring-2 focus:ring-indigo-300">
                            <option value="">Todas las telas</option>
                            {telasUnicas.map(t => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </div>
                    <div className="flex items-end">
                        <button onClick={() => setFiltros({ desde: '', hasta: '', tela: '' })}
                            className="w-full flex items-center justify-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-500 border border-slate-200 hover:border-rose-300 hover:text-rose-600 transition-all">
                            <X size={12} /> Limpiar
                        </button>
                    </div>
                </div>
            )}

            {/* ── Estado vacío / cargando ── */}
            {!clienteSel && !loading && (
                <div className="flex flex-col items-center justify-center py-20 text-center">
                    <div className="p-4 bg-indigo-100 rounded-3xl mb-4"><Package size={32} className="text-indigo-500" /></div>
                    <p className="text-sm font-bold text-slate-400">Selecciona un cliente para ver sus bobinas</p>
                </div>
            )}
            {error && <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-sm font-bold mb-4">⚠ {error}</div>}
            {loading && <div className="flex items-center justify-center py-16"><Loader2 size={28} className="animate-spin text-indigo-400" /></div>}

            {/* ── Seleccionar todas ── */}
            {!loading && bobinasFiltradas.length > 0 && (
                <div className="flex items-center gap-3 mb-3 px-1">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-slate-500 hover:text-indigo-600 transition-colors">
                        <input type="checkbox"
                            checked={checkedIds.size === bobinasFiltradas.length && bobinasFiltradas.length > 0}
                            onChange={toggleAll}
                            className="w-4 h-4 rounded border-slate-300 accent-indigo-600 cursor-pointer" />
                        {checkedIds.size === bobinasFiltradas.length ? 'Desmarcar todas' : 'Seleccionar todas'}
                    </label>
                    {checkedIds.size > 0 && (
                        <span className="text-xs text-indigo-600 font-bold">{checkedIds.size} seleccionada{checkedIds.size !== 1 ? 's' : ''}</span>
                    )}
                </div>
            )}

            {/* ── Lista de bobinas ── */}
            {!loading && bobinasFiltradas.length > 0 && (
                <div className="space-y-3">
                    {bobinasFiltradas.map(b => (
                        <BobinaCard key={b.bobinaId} data={b}
                            checked={checkedIds.has(b.bobinaId)}
                            onCheck={toggleCheck}
                            clienteNombre={clienteNombre}
                            clienteId={clienteSel?.IDCliente || clienteSel?.CliIdCliente}
                        />
                    ))}
                </div>
            )}

            {!loading && clienteSel && bobinas.length > 0 && bobinasFiltradas.length === 0 && (
                <div className="flex flex-col items-center py-10 text-center">
                    <Scissors size={28} className="text-slate-300 mb-2" />
                    <p className="text-sm font-bold text-slate-400">No hay bobinas {filtroEstado === 'Activas' ? 'activas' : 'cerradas'} para este cliente</p>
                </div>
            )}

            {!loading && clienteSel && movimientos.length === 0 && !error && (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                    <FileText size={32} className="text-slate-300 mb-3" />
                    <p className="text-sm font-bold text-slate-400">Sin movimientos registrados</p>
                    <p className="text-xs text-slate-300 mt-1">Aún no hay ingresos de tela o no coincide con los filtros</p>
                </div>
            )}

            {/* Footer */}
            {!loading && bobinasFiltradas.length > 0 && (
                <div className="mt-4 px-1 flex items-center justify-between text-[10px] text-slate-400 font-bold">
                    <span>{bobinasFiltradas.length} bobina{bobinasFiltradas.length !== 1 ? 's' : ''} · {movimientos.length} movimiento{movimientos.length !== 1 ? 's' : ''}</span>
                    <span className="flex items-center gap-3">
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Ingresos</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-rose-400 inline-block" /> Consumos</span>
                        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Ajustes</span>
                    </span>
                </div>
            )}
        </div>
    );
}
