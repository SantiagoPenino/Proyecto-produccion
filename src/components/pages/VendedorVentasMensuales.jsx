import React, { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronLeft, ChevronRight, Crown, Flame, RefreshCw, TrendingUp, Trophy, Users } from 'lucide-react';
import api from '../../services/apiClient';

/* ══════════════════════════════════════════════════════════════════════
   VENTAS DEL MES POR VENDEDOR  (/vendedores/ventas)

   Desde el 01/10/2026 cuenta PLATA sobre DOCUMENTOS, no órdenes (las reglas
   están en vendedorVistaController.getVentasMensuales):
     · VENDIDO    = total de los documentos de venta del mes (e-tickets,
                    e-facturas y Pedidos Caja, sin anulados) menos las notas
                    de crédito. Mismo universo que Contabilidad → Reportes →
                    Ventas por Documento. Entran todos, estén o no aceptados
                    por DGI.
     · PENDIENTE  = lo que todavía se debe de esos documentos.
     · COBRADO    = vendido − pendiente. Van en la misma columna: el cobrado
                    arriba (verde) y el pendiente abajo (rojo).
     · EL MES     = por fecha de emisión del documento.
     · VENDEDOR   = el de la cartera del cliente del documento.
     · Las monedas son las del documento y NO se convierten. Debajo del vendido
                    en pesos va, en chico, cuánto es en dólares (solo informativo).
     · TOTAL UNIFICADO EN US$ = US$ vendido + $ vendido ÷ cotización. La única
                    columna que mezcla monedas. La cotización (02/10/2026): en el
                    mes en curso, la del día (la de Caja, /apicotizaciones/hoy);
                    en un mes cerrado, la última de ese mes (/apicotizaciones/hasta),
                    así el total de un mes que ya pasó no cambia según el día en
                    que se mire. Nunca la de cada documento.
     · FRANJAS    = comisión sobre el total unificado (02/10/2026): el % de la
                    franja alcanzada se aplica a TODO el total. Cada vendedor
                    lleva una barra que se llena al cargar y va completando las
                    franjas.
     · ORDEN      = los vendedores por total unificado, de mayor a menor. Al
                    cargar, las filas aparecen como llegan y enseguida se acomodan
                    a la vista: cada fila se desliza entera hasta su lugar.
     · OTRAS VENTAS = lo que no es de ningún vendedor (clientes sin vendedor
                    del área, mostrador sin identificar) va junto en una sola
                    card al final; al tocarla se despliega cada parte con sus
                    números (02/10/2026).
     · GANADORES  = el primero de cada mes por total unificado, desde junio
                    2026 (/vendedor-360/ganadores). Una tira arriba de la tabla
                    con el ganador de cada mes (a lo sumo LIMITE_TIRA meses, con
                    flechas para ver los anteriores), donde los meses seguidos
                    del mismo vendedor van unidos con la racha; en la fila del
                    primero, corona, «Ganó <mes>» y la racha; si el mes está en
                    curso, solo «Va ganando». Y la ventaja sobre el segundo.
     · CAMBIO DE MES = el nombre del mes y la tabla entran deslizándose desde
                    el lado hacia el que se fue (adelante: desde la derecha).
     · El endpoint también acepta un filtro de DGI: el selector se sacó de la
       pantalla el 1-oct-2026.
   ══════════════════════════════════════════════════════════════════════ */

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Setiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const MONEDAS = ['UYU', 'USD'];
const SIMBOLO = { UYU: '$', USD: 'US$' };
const COLUMNAS = ['vendido', 'cobrado', 'sinCobrar'];

// Franjas de comisión sobre el total unificado en US$ (las definió Santiago el 02/10/2026): el % de la
// franja alcanzada se aplica a TODO el total. Por debajo de la primera no hay comisión.
const FRANJAS = [
    { desde: 50000, pct: 0.8, texto: '0,8 %' },
    { desde: 75000, pct: 1, texto: '1 %' },
    { desde: 100000, pct: 1.2, texto: '1,2 %' },
    { desde: 125000, pct: 1.3, texto: '1,3 %' },
];
// Un color por tramo de la barra: el de antes de la primera franja gris, y cada franja un azul más fuerte
const COLOR_TRAMO = ['bg-slate-300', 'bg-sky-300', 'bg-sky-500', 'bg-sky-700', 'bg-sky-900'];
// La barra llega hasta acá, o más lejos si algún vendedor pasa
const ESCALA_MINIMA = 150000;
// El primer mes que se puede ver: antes de junio 2026 no hay datos, o no son confiables (Santiago, 02/10)
const PRIMER_MES = { anio: 2026, mes: 6 };
// Alto de la fila de cada vendedor: su foto es un cuadrado de ese lado, pegado a la izquierda
const ALTO_FILA = 76;
// El salto de la pastilla de la franja cuando cambia, y la entrada de las filas que se despliegan
const ESTILOS = '@keyframes franjaSalto{0%{transform:scale(1.35)}100%{transform:scale(1)}}'
    + '@keyframes filaEntra{0%{opacity:0;transform:translateY(-6px)}100%{opacity:1;transform:none}}'
    + '@keyframes mesEntra{0%{opacity:0;transform:translateX(var(--desde,0))}100%{opacity:1;transform:none}}'
    + '@media (prefers-reduced-motion: reduce){.animado-mes{animation:none!important}}';
// Entrada al cambiar de mes: desde la derecha si se fue para adelante, desde la izquierda si para atrás;
// sin dirección (al abrir o al actualizar), solo aparece
const entradaMes = (direccion, distancia, duracion) => ({ '--desde': `${direccion * distancia}px`, animation: `mesEntra ${duracion} ease-out` });
// Clave de la card que junta todo lo que no es de un vendedor
const OTRAS_VENTAS = 'OTRAS_VENTAS';
const MESES_CORTOS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Dic'];
// La tira de ganadores muestra a lo sumo estos meses; con las flechas se ven los anteriores
const LIMITE_TIRA = 6;
const iniciales = (nombre) => String(nombre || '?').trim().split(/\s+/).slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('');
// Cuántos meses cerrados seguidos ganó `cedula` justo antes del mes que está en la posición `i` de la lista
const rachaAntesDe = (meses, i, cedula) => {
    let n = 0;
    for (let k = i - 1; k >= 0; k -= 1) {
        const m = meses[k];
        if (m.enCurso || !m.ganador || m.ganador.cedula !== cedula) break;
        n += 1;
    }
    return n;
};

const money = (n) => (Number(n) || 0).toLocaleString('es-UY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const importe = (v, moneda, columna) => Number(v?.monedas?.[moneda]?.[columna]) || 0;
// Las dos monedas en dólares: los dólares más los pesos pasados con la cotización. Sin cotización no hay número.
const unificado = (usd, uyu, cotizacion) => (cotizacion > 0 ? usd + uyu / cotizacion : null);
const totalDe = (v, cotizacion) => unificado(importe(v, 'USD', 'vendido'), importe(v, 'UYU', 'vendido'), cotizacion);
// Las fechas llegan como texto (AAAA-MM-DD…): se toma el día del texto para que la zona horaria no lo corra.
const diaMes = (fecha) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(fecha || '')); return m ? `${m[3]}/${m[2]}` : ''; };
// La franja alcanzada (-1 = ninguna) y la comisión: el % de esa franja sobre todo el total, al centavo
const franjaDe = (total) => FRANJAS.reduce((i, f, k) => (r2(total) >= f.desde ? k : i), -1);
const comisionDe = (total) => { const i = franjaDe(total); return i < 0 ? 0 : Math.round(r2(total) * FRANJAS[i].pct) / 100; };

// Foto del vendedor: la misma del registro del portal (public/assets/images/asesores/<cédula>.webp,
// ver RegisterPage.jsx), pegada a la izquierda y de todo el alto de la fila (va dentro de una celda con
// `relative`; la fila mide ALTO_FILA y el ancho sale del alto, así que queda cuadrada). Si no hay foto, la inicial. Las filas que
// no son de un vendedor llevan un cuadrado neutro, para que todo quede alineado.
function FotoVendedor({ cedula, nombre }) {
    const [sinFoto, setSinFoto] = useState(false);
    const lugar = 'absolute top-0 left-0 h-full aspect-square';
    const tope = { maxWidth: ALTO_FILA };   // si la fila creciera, la foto no se mete debajo del texto
    if (!cedula) {
        return <span style={tope} className={`${lugar} bg-slate-100 text-slate-400 flex items-center justify-center`}><Users size={22} /></span>;
    }
    if (sinFoto) {
        return (
            <span style={tope} className={`${lugar} bg-brand-cyan text-white flex items-center justify-center text-2xl font-black`}>
                {String(nombre || '?').trim().charAt(0).toUpperCase()}
            </span>
        );
    }
    return <img src={`/assets/images/asesores/${cedula}.webp`} alt="" onError={() => setSinFoto(true)}
        style={tope} className={`${lugar} object-cover bg-slate-100`} />;
}

// Foto chica y redonda, para la tira de ganadores. Sin foto, las iniciales.
function MiniFoto({ cedula, nombre, className = '' }) {
    const [sinFoto, setSinFoto] = useState(false);
    if (!cedula || sinFoto) {
        return <span className={`rounded-full bg-slate-100 text-slate-500 text-[10px] font-black flex items-center justify-center ${className}`}>{iniciales(nombre)}</span>;
    }
    return <img src={`/assets/images/asesores/${cedula}.webp`} alt="" onError={() => setSinFoto(true)}
        className={`rounded-full object-cover bg-slate-100 ${className}`} />;
}

// «Ganó <mes>» en un mes cerrado; «Va ganando», con borde punteado, en el mes en curso
function PastillaGanador({ enCurso, mes }) {
    return (
        <span className={`shrink-0 inline-flex items-center gap-1 px-1.5 rounded text-[10px] leading-4 font-black tracking-wider whitespace-nowrap ${enCurso ? 'py-px border border-dashed border-amber-400 text-amber-700' : 'py-0.5 bg-amber-100 text-amber-800'}`}>
            {enCurso ? <Crown size={11} /> : <Trophy size={11} />}
            {enCurso ? 'VA GANANDO' : `GANÓ ${mes.toUpperCase()}`}
        </span>
    );
}

// Meses seguidos en primer lugar. Solo en un mes cerrado: en el mes en curso todavía no hay racha.
function PastillaRacha({ racha }) {
    return (
        <span title={`${racha} meses seguidos en primer lugar`}
            className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] leading-4 font-black tracking-wider whitespace-nowrap bg-orange-100 text-orange-700">
            <Flame size={11} />
            {racha} MESES SEGUIDOS
        </span>
    );
}

// Tira de ganadores: el ganador de cada mes desde junio 2026, con su foto. Los meses cerrados seguidos del
// mismo vendedor van unidos en una franja dorada con la racha; el mes en curso va con borde punteado (es
// provisorio). Muestra a lo sumo LIMITE_TIRA meses: las flechas llevan a los anteriores y de vuelta.
// Tocar un mes lo abre en la tabla.
function TiraGanadores({ meses, anio, mes, onElegir }) {
    const anioActual = new Date().getFullYear();
    const ultimo = meses.length - 1;
    const [finPedido, setFinPedido] = useState(null);   // null = hasta el último mes
    const fin = Math.min(finPedido ?? ultimo, ultimo);
    const inicio = Math.max(0, fin - LIMITE_TIRA + 1);
    const elegido = meses.findIndex(m => m.anio === anio && m.mes === mes);
    // Si el mes que se mira en la tabla queda fuera de la tira, la tira se corre. Solo cuando cambia el mes
    // elegido: si dependiera de la ventana, las flechas no podrían alejarse de él.
    useEffect(() => {
        if (elegido < 0) return;
        if (elegido > fin) setFinPedido(elegido);
        else if (elegido < inicio) setFinPedido(Math.min(ultimo, elegido + LIMITE_TIRA - 1));
    }, [elegido]); // eslint-disable-line react-hooks/exhaustive-deps

    // Meses a la vista, agrupados: los cerrados seguidos con el mismo ganador van juntos
    const grupos = [];
    meses.slice(inicio, fin + 1).forEach((m, j) => {
        const cedula = !m.enCurso && m.ganador ? m.ganador.cedula : null;
        const anterior = grupos[grupos.length - 1];
        const conIndice = { ...m, i: inicio + j };
        if (cedula && anterior && anterior.cedula === cedula) anterior.meses.push(conIndice);
        else grupos.push({ cedula, meses: [conIndice] });
    });

    const chip = (m) => {
        const g = m.ganador;
        const esElegido = m.anio === anio && m.mes === mes;
        const nombreMes = `${MESES[m.mes - 1]} ${m.anio}`;
        const titulo = !g ? `${nombreMes}: sin ventas`
            : m.enCurso ? `${nombreMes}, en curso: va ganando ${g.nombre} (US$ ${money(g.total)})`
                : `${nombreMes}: ganó ${g.nombre} con US$ ${money(g.total)}`;
        return (
            <button key={`${m.anio}-${m.mes}`} onClick={() => onElegir(m.anio, m.mes)} title={titulo}
                className={`flex flex-col items-center gap-0.5 px-1.5 py-1 rounded-lg ${esElegido ? 'bg-brand-cyan/10' : 'hover:bg-slate-100'}`}>
                {g ? (
                    <MiniFoto cedula={g.cedula} nombre={g.nombre} className={`w-7 h-7 border-2 border-amber-400 ${m.enCurso ? 'border-dashed' : ''}`} />
                ) : (
                    <span className="w-7 h-7 rounded-full border-2 border-slate-200 bg-slate-50 text-slate-300 flex items-center justify-center text-xs">—</span>
                )}
                <span className={`text-[10px] font-bold uppercase tracking-wider ${esElegido ? 'text-brand-cyan' : 'text-slate-500'}`}>
                    {MESES_CORTOS[m.mes - 1]}{m.anio !== anioActual ? ` ${m.anio}` : ''}
                </span>
            </button>
        );
    };
    const flecha = 'w-7 h-7 shrink-0 rounded-md border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-500';

    return (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-200 overflow-x-auto">
            <span className="shrink-0 mr-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                <Trophy size={13} className="text-amber-500" /> Ganadores
            </span>
            {inicio > 0 && (
                <button onClick={() => setFinPedido(Math.max(Math.min(ultimo, LIMITE_TIRA - 1), inicio - 1))} className={flecha} title="Meses anteriores">
                    <ChevronLeft size={14} />
                </button>
            )}
            <div className="flex items-center gap-1.5">
                {grupos.map((gr, k) => {
                    const ultimoDelGrupo = gr.meses[gr.meses.length - 1];
                    const racha = gr.cedula ? 1 + rachaAntesDe(meses, ultimoDelGrupo.i, gr.cedula) : 0;
                    if (racha < 2) return <React.Fragment key={`g${k}`}>{gr.meses.map(chip)}</React.Fragment>;
                    return (
                        <div key={`g${k}`} className="flex items-center gap-0.5 rounded-xl bg-amber-50 pl-0.5 pr-2">
                            {gr.meses.map(chip)}
                            <span className="ml-1 flex items-center gap-0.5 whitespace-nowrap text-[10px] font-black text-amber-700">
                                <Flame size={12} /> {racha} SEGUIDOS
                            </span>
                        </div>
                    );
                })}
            </div>
            {fin < ultimo && (
                <button onClick={() => setFinPedido(Math.min(ultimo, fin + LIMITE_TIRA))} className={flecha} title="Meses siguientes">
                    <ChevronRight size={14} />
                </button>
            )}
        </div>
    );
}

// Una celda de plata: guion si es cero (o si no se puede calcular), y el color lo decide la columna.
// `primera` = primera columna de su grupo (pesos, dólares, total): lleva la línea divisoria.
// Van centradas en su columna y en el alto de la fila (02/10). El vendido en pesos lleva debajo cuánto es en dólares, y el
// cobrado lleva debajo el pendiente.
const COLOR = { vendido: 'text-slate-700', cobrado: 'text-emerald-500', pendiente: 'font-bold text-red-500', total: 'font-black text-slate-800' };
const claseCelda = (primera, ultima, total) => `${total ? 'py-3' : 'py-2'} align-middle text-center tabular-nums whitespace-nowrap ${ultima ? 'pl-3 pr-4' : 'px-3'} ${primera ? `border-l ${total ? 'border-slate-200' : 'border-slate-100'}` : ''}`;
const esCero = (valor) => valor == null || Math.abs(valor) < 0.005;

function Monto({ valor, columna }) {
    return <div className={esCero(valor) ? 'font-normal text-slate-300' : COLOR[columna]}>{esCero(valor) ? '—' : money(valor)}</div>;
}

// `enDolares` = el importe pasado a dólares, que va debajo en letra chica (solo en el vendido en pesos)
function Celda({ valor, columna, primera, ultima, total = false, enDolares = null }) {
    return (
        <td className={claseCelda(primera, ultima, total)}>
            <Monto valor={valor} columna={columna} />
            {enDolares != null && !esCero(valor) && (
                <div className="text-[11px] leading-4 font-normal text-slate-400">US$ {money(enDolares)}</div>
            )}
        </td>
    );
}

// Cobrado arriba y pendiente abajo, en la misma celda, con una línea entre los dos como en el encabezado
function CeldaCobro({ cobrado, pendiente, total = false }) {
    return (
        <td className={claseCelda(false, false, total)}>
            <div className="inline-flex flex-col items-stretch">
                <Monto valor={cobrado} columna="cobrado" />
                <div className="mt-1 pt-1 border-t border-slate-300"><Monto valor={pendiente} columna="pendiente" /></div>
            </div>
        </td>
    );
}

// Total unificado en US$ y, debajo, la comisión (en las filas de vendedores y en la de totales)
function CeldaTotal({ valor, comision, total = false }) {
    return (
        <td className={claseCelda(true, true, total)}>
            <Monto valor={valor} columna="total" />
            {comision != null && (
                <div className={`text-[11px] leading-4 ${comision > 0 ? 'font-bold text-sky-700' : 'font-normal text-slate-300'}`}>
                    {comision > 0 ? `${total ? 'Comisiones' : 'Comisión'} US$ ${money(comision)}` : 'Sin comisión'}
                </div>
            )}
        </td>
    );
}

// Barra de franjas: un tramo por franja, con la misma escala para todos los vendedores; se llena hasta `valor`
function BarraFranjas({ valor, escala }) {
    const limites = [0, ...FRANJAS.map(f => f.desde), escala];
    return (
        <div className="flex gap-0.5 h-2.5" aria-hidden="true">
            {limites.slice(0, -1).map((desde, k) => {
                const hasta = limites[k + 1];
                const lleno = Math.max(0, Math.min(1, (valor - desde) / (hasta - desde)));
                return (
                    <div key={desde} style={{ flexGrow: hasta - desde, flexBasis: 0 }}
                        className={`relative overflow-hidden bg-slate-100 ${k === 0 ? 'rounded-l-full' : ''} ${k === limites.length - 2 ? 'rounded-r-full' : ''}`}>
                        <div className={`absolute inset-y-0 left-0 ${COLOR_TRAMO[k]}`} style={{ width: `${lleno * 100}%` }} />
                    </div>
                );
            })}
        </div>
    );
}

// La franja alcanzada. Mientras la barra se llena va cambiando, con un saltito en cada cambio.
function PastillaFranja({ valor }) {
    const i = franjaDe(valor);
    return (
        <span key={i} style={{ animation: 'franjaSalto .25s ease-out' }}
            className={`inline-block px-1.5 py-0.5 rounded text-[10px] leading-4 font-black tracking-wider whitespace-nowrap ${i < 0 ? 'bg-slate-100 text-slate-400' : 'bg-sky-100 text-sky-800'}`}>
            {i < 0 ? 'SIN FRANJA' : FRANJAS[i].texto}
        </span>
    );
}

// Cuánto le falta para la próxima franja
function FaltaParaFranja({ total }) {
    const proxima = FRANJAS[franjaDe(total) + 1];
    if (!proxima) return <span>En la franja más alta</span>;
    return <span>Faltan <b className="font-bold text-slate-600 tabular-nums">US$ {money(proxima.desde - r2(total))}</b> para la siguiente franja ({proxima.texto})</span>;
}

// Encabezado de la columna del vendedor: el título sobre las fotos y cada franja centrada sobre su tramo de
// las barras. Reparte el ancho igual que BarraFranjas, así cada rótulo cae justo encima de su tramo.
function EncabezadoFranjas({ escala }) {
    const limites = [0, ...FRANJAS.map(f => f.desde), escala];
    return (
        <div className="flex items-end">
            <div className="shrink-0 pl-4 pb-3 whitespace-nowrap" style={{ width: ALTO_FILA }}>Vendedor</div>
            <div className="flex-1 mx-4 pb-2 min-w-[240px] flex items-end gap-0.5 leading-tight">
                {limites.slice(0, -1).map((desde, k) => {
                    const franja = FRANJAS[k - 1];   // el primer tramo (antes de la primera franja) va sin rótulo
                    return (
                        <div key={desde} style={{ flexGrow: limites[k + 1] - desde, flexBasis: 0 }} className="min-w-0 text-center whitespace-nowrap">
                            {franja && (
                                <>
                                    <div className="text-slate-400 tabular-nums">{franja.desde.toLocaleString('es-UY')}</div>
                                    <div className="text-sky-700">{franja.texto}</div>
                                </>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

const claveFila = (v) => v.cedula || v.tipo;
const esFilaVendedor = (v) => (v.tipo || 'VENDEDOR') === 'VENDEDOR';
// Sombra de la fila mientras se acomoda (aparece y se va con el movimiento)
const SOMBRA_FILA = '0 6px 16px -4px rgba(15, 23, 42, 0.18)';
const SIN_SOMBRA = '0 6px 16px -4px rgba(15, 23, 42, 0)';

// Anima los cambios de orden de las filas de un <tbody>: cada fila (las que llevan `data-fila`) se desliza
// entera desde donde estaba hasta su lugar nuevo. Devuelve el `ref` para el <tbody>.
function useOrdenAnimado() {
    const cuerpo = useRef(null);
    const ultima = useRef(new Map());        // clave de la fila → { puesto, altura } de la última vez
    const enCurso = useRef(new WeakMap());   // <tr> → su animación

    useLayoutEffect(() => {
        const quieto = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const filas = [...(cuerpo.current?.querySelectorAll('tr[data-fila]') || [])];
        const ahora = new Map();
        // La altura de cada fila es la suma de los altos de las de arriba: a diferencia de su posición en
        // pantalla, no cambia con una animación en curso.
        let debajo = 0;
        filas.forEach((tr, puesto) => {
            const altura = debajo;
            debajo += tr.getBoundingClientRect().height;
            ahora.set(tr.dataset.fila, { puesto, altura });
            const antes = ultima.current.get(tr.dataset.fila);
            if (!antes || antes.puesto === puesto || antes.altura === altura || quieto || typeof tr.animate !== 'function') return;
            enCurso.current.get(tr)?.cancel();
            // Mientras se mueve, la fila va por encima del resto como una tarjeta, con su sombra: las que
            // suben sobre las que bajan y, entre las que van para el mismo lado, la de mejor puesto arriba.
            tr.style.position = 'relative';
            tr.style.zIndex = String((antes.altura > altura ? filas.length : 0) + filas.length - puesto);
            const animacion = tr.animate([
                { transform: `translateY(${antes.altura - altura}px)`, boxShadow: SIN_SOMBRA },
                { boxShadow: SOMBRA_FILA, offset: 0.15 },
                { boxShadow: SOMBRA_FILA, offset: 0.85 },
                { transform: 'translateY(0)', boxShadow: SIN_SOMBRA },
            ], { duration: 750, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' });
            enCurso.current.set(tr, animacion);
            // Al terminar (o si la corta otra), vuelve a ser una fila común
            const soltar = () => {
                if (enCurso.current.get(tr) !== animacion) return;
                tr.style.position = '';
                tr.style.zIndex = '';
            };
            animacion.finished.then(soltar, soltar);
        });
        ultima.current = ahora;
    });

    return cuerpo;
}

// Va de 0 a 1 en `duracion` ms, frenando al final, cada vez que cambia `clave` (con null queda en 1).
// Con él se llenan las barras de las franjas.
function useProgreso(clave, duracion = 1100) {
    const [estado, setEstado] = useState({ clave: null, p: 1 });
    useEffect(() => {
        if (clave == null) return undefined;
        const quieto = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (quieto) { setEstado({ clave, p: 1 }); return undefined; }
        let raf = 0;
        const inicio = performance.now();
        const paso = (ahora) => {
            const x = Math.min(1, Math.max(0, (ahora - inicio) / duracion));
            setEstado({ clave, p: 1 - Math.pow(1 - x, 3) });
            if (x < 1) raf = requestAnimationFrame(paso);
        };
        raf = requestAnimationFrame(paso);
        return () => cancelAnimationFrame(raf);
    }, [clave, duracion]);
    // Hasta que arranca, la clave nueva vale 0: así las barras no se ven llenas un instante antes de empezar
    return clave == null ? 1 : (estado.clave === clave ? estado.p : 0);
}

export default function VendedorVentasMensuales() {
    const hoy = new Date();
    const [anio, setAnio] = useState(hoy.getFullYear());
    const [mes, setMes] = useState(hoy.getMonth() + 1);
    const [data, setData] = useState([]);
    const [notas, setNotas] = useState({ UYU: 0, USD: 0 });
    const [loading, setLoading] = useState(false);
    const [vuelta, setVuelta] = useState(0);         // una por cada carga que llega: arranca el llenado de las barras
    const [verOtras, setVerOtras] = useState(false);   // card «Otras ventas» desplegada
    const [ganadores, setGanadores] = useState([]);     // el ganador de cada mes desde junio 2026
    const [direccion, setDireccion] = useState(0);      // hacia dónde se cambió de mes: 1 adelante, -1 atrás, 0 ninguno

    // Cotización con la que se unifica (pesos por dólar), guardada por mes: en el mes en curso la del
    // día, la misma de Caja; en un mes cerrado, la última de ese mes, para que su total no cambie.
    const esMesActual = anio === hoy.getFullYear() && mes === hoy.getMonth() + 1;
    const [cotizaciones, setCotizaciones] = useState({});   // `${anio}-${mes}` → { valor, fecha }
    const [cargandoCot, setCargandoCot] = useState(false);
    const cotizacion = cotizaciones[`${anio}-${mes}`]?.valor ?? null;
    const cotFecha = cotizaciones[`${anio}-${mes}`]?.fecha ?? null;

    const leerCotizacion = useCallback(async () => {
        const ultimoDia = String(new Date(anio, mes, 0).getDate()).padStart(2, '0');
        const r = esMesActual
            ? await api.get('/apicotizaciones/hoy')
            : await api.get('/apicotizaciones/hasta', { params: { fecha: `${anio}-${String(mes).padStart(2, '0')}-${ultimoDia}` } });
        const c = r.data?.cotizaciones?.[0];
        const valor = Number(c?.CotDolar);
        if (!(valor > 0)) throw new Error('Sin cotización cargada');
        setCotizaciones(prev => ({ ...prev, [`${anio}-${mes}`]: { valor, fecha: c.CotFecha || null } }));
        return valor;
    }, [anio, mes, esMesActual]);

    useEffect(() => {
        leerCotizacion().catch(() => toast.error('No se pudo cargar la cotización del dólar'));
    }, [leerCotizacion]);

    // Solo en el mes en curso: pide la de hoy; si todavía no está cargada, el servidor la busca en el BCU y la guarda
    const refrescarCotizacion = async () => {
        if (cargandoCot) return;
        setCargandoCot(true);
        try {
            await api.get('/apicotizaciones/bcu');
            const valor = await leerCotizacion();
            toast.success(`Cotización: 1 US$ = $ ${money(valor)}`);
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudo actualizar la cotización');
        } finally { setCargandoCot(false); }
    };

    const cargar = useCallback(async () => {
        setLoading(true);
        try {
            const r = await api.get('/vendedor-360/ventas-mensuales', { params: { anio, mes } });
            setData(r.data?.data || []);
            setNotas(r.data?.notas || { UYU: 0, USD: 0 });
            setVuelta(n => n + 1);
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudieron cargar las ventas del mes');
            setData([]);
            setNotas({ UYU: 0, USD: 0 });
        } finally { setLoading(false); }
    }, [anio, mes]);

    useEffect(() => { cargar(); }, [cargar]);

    const cargarGanadores = useCallback(async () => {
        try {
            const r = await api.get('/vendedor-360/ganadores');
            setGanadores(r.data?.meses || []);
        } catch (e) {
            toast.error(e.response?.data?.error || 'No se pudieron cargar los ganadores de cada mes');
        }
    }, []);
    useEffect(() => { cargarGanadores(); }, [cargarGanadores]);

    // Ir a un mes (con las flechas o desde la tira de ganadores), anotando para qué lado para la animación
    const irA = (a, m) => {
        const d = Math.sign((a * 12 + m) - (anio * 12 + mes));
        if (d === 0) return;
        setDireccion(d);
        setMes(m); setAnio(a);
    };
    const mover = (delta) => {
        let m = mes + delta, a = anio;
        if (m < 1) { m = 12; a -= 1; }
        if (m > 12) { m = 1; a += 1; }
        if (a < PRIMER_MES.anio || (a === PRIMER_MES.anio && m < PRIMER_MES.mes)) return;
        irA(a, m);
    };

    // Totales de la fila de cierre: incluye las filas sin vendedor, para que cierre con Contabilidad
    const tot = useMemo(() => {
        const t = { UYU: { vendido: 0, cobrado: 0, sinCobrar: 0 }, USD: { vendido: 0, cobrado: 0, sinCobrar: 0 } };
        data.forEach(v => MONEDAS.forEach(m => COLUMNAS.forEach(c => { t[m][c] += importe(v, m, c); })));
        return t;
    }, [data]);

    // Debajo del vendido en pesos va cuánto es en dólares, con la misma cotización
    const enDolares = (moneda, valor) => (moneda === 'UYU' && cotizacion > 0 ? valor / cotizacion : null);

    // Los vendedores van cada uno en su card; lo demás (clientes sin vendedor del área, mostrador) se
    // junta en una sola card, «Otras ventas», que suma sus partes y al tocarla las muestra
    const vendedores = useMemo(() => data.filter(esFilaVendedor), [data]);
    const otrasVentas = useMemo(() => {
        const partes = data.filter(v => !esFilaVendedor(v));
        if (partes.length === 0) return null;
        const monedas = {};
        MONEDAS.forEach(m => {
            monedas[m] = {};
            COLUMNAS.forEach(c => { monedas[m][c] = partes.reduce((s, v) => s + importe(v, m, c), 0); });
        });
        return { tipo: OTRAS_VENTAS, nombre: 'Otras ventas', monedas, partes };
    }, [data]);

    // Franjas: la escala común de las barras y la suma de las comisiones (solo vendedores)
    const escala = useMemo(() => {
        const mayor = vendedores.reduce((m, v) => Math.max(m, totalDe(v, cotizacion) || 0), 0);
        return Math.max(ESCALA_MINIMA, Math.ceil(mayor / 25000) * 25000);
    }, [vendedores, cotizacion]);
    const totalComisiones = useMemo(() => (cotizacion > 0
        ? r2(vendedores.reduce((s, v) => s + comisionDe(totalDe(v, cotizacion)), 0))
        : null), [vendedores, cotizacion]);
    // Las barras se llenan cuando están los datos y la cotización, una vez por carga
    const progreso = useProgreso(!loading && data.length > 0 && cotizacion > 0 ? vuelta : null);

    // Orden de las cards: los vendedores por total unificado, de mayor a menor («Otras ventas» va siempre
    // al final). Sin cotización no hay total y quedan como llegan.
    const porTotal = useMemo(() => {
        if (!(cotizacion > 0)) return vendedores;
        return [...vendedores].sort((a, b) => totalDe(b, cotizacion) - totalDe(a, cotizacion));
    }, [vendedores, cotizacion]);

    // El primero del mes (la primera fila, con más de cero): su racha cuenta este mes más los meses cerrados
    // seguidos que ganó justo antes. La ventaja es sobre el segundo.
    const lider = useMemo(() => {
        if (!(cotizacion > 0) || porTotal.length === 0) return null;
        const total = totalDe(porTotal[0], cotizacion);
        if (!(total > 0)) return null;
        const segundo = porTotal[1] && totalDe(porTotal[1], cotizacion) > 0 ? porTotal[1] : null;
        const i = ganadores.findIndex(m => m.anio === anio && m.mes === mes);
        return {
            cedula: porTotal[0].cedula,
            racha: 1 + (i >= 0 ? rachaAntesDe(ganadores, i, porTotal[0].cedula) : 0),
            segundo,
            ventaja: segundo ? total - totalDe(segundo, cotizacion) : null,
        };
    }, [porTotal, cotizacion, ganadores, anio, mes]);

    // Al cargar, las filas se dibujan como llegan (así se sabe de dónde sale cada una) y en el paso
    // siguiente se ordenan por total: arrancan a moverse apenas aparecen, todas juntas y sin pausa
    const [acomodadas, setAcomodadas] = useState(false);
    useEffect(() => {
        setAcomodadas(!loading && data.length > 0);
    }, [loading, data]);
    const filas = acomodadas ? porTotal : vendedores;
    // Las celdas de plata de una fila: vendido y cobrado / pendiente, en pesos y en dólares
    const celdasPlata = (v) => MONEDAS.map(m => (
        <React.Fragment key={m}>
            <Celda valor={importe(v, m, 'vendido')} columna="vendido" primera enDolares={enDolares(m, importe(v, m, 'vendido'))} />
            <CeldaCobro cobrado={importe(v, m, 'cobrado')} pendiente={importe(v, m, 'sinCobrar')} />
        </React.Fragment>
    ));
    const alternarOtras = () => setVerOtras(x => !x);
    const cuerpoTabla = useOrdenAnimado();

    const esMesFuturo = anio > hoy.getFullYear() || (anio === hoy.getFullYear() && mes > hoy.getMonth() + 1);
    const esPrimerMes = anio < PRIMER_MES.anio || (anio === PRIMER_MES.anio && mes <= PRIMER_MES.mes);
    // Las notas llegan con su signo (crédito resta, débito suma) y ya están dentro del vendido
    const hayNotas = Math.abs(notas.UYU) >= 0.005 || Math.abs(notas.USD) >= 0.005;
    const textoNotas = [
        Math.abs(notas.UYU) >= 0.005 ? `$ ${money(notas.UYU)}` : null,
        Math.abs(notas.USD) >= 0.005 ? `US$ ${money(notas.USD)}` : null,
    ].filter(Boolean).join(' y ');
    const nombreMes = MESES[mes - 1].toLowerCase();

    return (
        <div className="px-4 pt-3 pb-4 md:px-6 md:pt-0 md:pb-6 w-full font-sans text-slate-800">
            {/* Sin margen arriba en pantallas grandes: el layout ya deja 24 px, y así queda cerca de la barra de arriba */}
            <style>{ESTILOS}</style>
            {/* Encabezado */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-cyan/10 text-brand-cyan flex items-center justify-center">
                        <TrendingUp size={20} />
                    </div>
                    <div>
                        <h1 className="text-xl font-black tracking-tight text-slate-800">Ventas por vendedor</h1>
                        <p className="text-xs text-slate-500">Documentos de venta emitidos en el mes, por cartera de cliente</p>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {/* Cotización con la que se arma el total unificado: la del día, o la última del mes si ya pasó */}
                    <div className="flex items-center h-9 rounded-lg border border-slate-200 bg-white overflow-hidden"
                        title={!cotFecha ? 'Sin cotización cargada'
                            : esMesActual ? `Cotización del día (${diaMes(cotFecha)})` : `Última cotización de ${nombreMes} (${diaMes(cotFecha)})`}>
                        <span className="pl-3 pr-3 text-xs text-slate-500 whitespace-nowrap">
                            1 US$ = <b className="text-sm text-slate-800 tabular-nums">{cotizacion ? `$ ${money(cotizacion)}` : '—'}</b>
                            {cotFecha && <span className="ml-1.5 text-[11px] text-slate-400 tabular-nums">{diaMes(cotFecha)}</span>}
                        </span>
                        {esMesActual && (
                            <button onClick={refrescarCotizacion} disabled={cargandoCot}
                                className="w-9 h-9 border-l border-slate-200 hover:bg-slate-50 flex items-center justify-center text-brand-cyan disabled:opacity-40"
                                title="Actualizar la cotización">
                                <RefreshCw size={14} className={cargandoCot ? 'animate-spin' : ''} />
                            </button>
                        )}
                    </div>

                    <div className="flex items-center gap-2">
                        <button onClick={() => mover(-1)} disabled={loading || esPrimerMes}
                            className="w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600 disabled:opacity-40"
                            title="Mes anterior">
                            <ChevronLeft size={16} />
                        </button>
                        <div className="px-4 py-2 rounded-lg border border-slate-200 bg-white text-sm font-bold min-w-[170px] text-center overflow-hidden">
                            <span key={`${anio}-${mes}`} className="inline-block animado-mes" style={entradaMes(direccion, 14, '.3s')}>
                                {MESES[mes - 1]} {anio}
                            </span>
                        </div>
                        <button onClick={() => mover(1)} disabled={loading || esMesFuturo}
                            className="w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600 disabled:opacity-40"
                            title="Mes siguiente">
                            <ChevronRight size={16} />
                        </button>
                        <button onClick={() => { setDireccion(0); cargar(); cargarGanadores(); }} disabled={loading}
                            className="w-9 h-9 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 flex items-center justify-center text-slate-600 disabled:opacity-40"
                            title="Actualizar">
                            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>
            </div>

            {/* Tabla */}
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                {ganadores.length > 0 && (
                    <TiraGanadores meses={ganadores} anio={anio} mes={mes} onElegir={irA} />
                )}
                <div key={vuelta} className="overflow-x-auto animado-mes" style={entradaMes(direccion, 40, '.4s')}>
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-500">
                                <th className="text-left font-bold p-0"><EncabezadoFranjas escala={escala} /></th>
                                {MONEDAS.map(m => (
                                    <React.Fragment key={m}>
                                        <th className="text-center font-bold px-3 py-3 border-l border-slate-200 whitespace-nowrap">{SIMBOLO[m]} vendido</th>
                                        {/* Cobrado sobre pendiente, con una línea entre los dos: así se lee la celda */}
                                        <th className="text-center font-bold px-3 py-2 whitespace-nowrap">
                                            <span className="inline-flex flex-col items-stretch">
                                                <span>{SIMBOLO[m]} cobrado</span>
                                                <span className="mt-1 pt-1 border-t border-slate-300">{SIMBOLO[m]} pendiente</span>
                                            </span>
                                        </th>
                                    </React.Fragment>
                                ))}
                                <th className="text-center font-bold pl-3 pr-4 py-3 border-l border-slate-200 whitespace-nowrap text-slate-700"
                                    title="US$ vendido + $ vendido ÷ cotización: la del día en el mes en curso, la última del mes en un mes cerrado">
                                    Total unificado en US$
                                </th>
                            </tr>
                        </thead>
                        <tbody ref={cuerpoTabla}>
                            {loading && (
                                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">Cargando…</td></tr>
                            )}
                            {!loading && data.length === 0 && (
                                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">Sin vendedores en el área de Ventas.</td></tr>
                            )}
                            {!loading && filas.map(v => {
                                const clave = claveFila(v);
                                const total = totalDe(v, cotizacion);
                                const esLider = !!lider && lider.cedula === v.cedula;
                                const esSegundo = !!lider?.segundo && lider.segundo.cedula === v.cedula;
                                return (
                                    // Fondo liso (el celeste va como degradé sobre blanco): al acomodarse, unas filas pasan por encima de otras
                                    <tr key={clave} data-fila={clave}
                                        className={`border-b border-slate-100 last:border-0 bg-white ${v.esMio ? 'bg-gradient-to-r from-brand-cyan/5 to-brand-cyan/5' : 'hover:bg-slate-50'}`}>
                                        <td className="p-0 align-middle relative" style={{ height: ALTO_FILA }}>
                                            <FotoVendedor cedula={v.cedula} nombre={v.nombre} />
                                            {esLider && (
                                                <span className={`absolute top-0 left-0 z-[1] w-6 h-6 rounded-br-lg flex items-center justify-center text-white ${esMesActual ? 'bg-amber-400' : 'bg-amber-500'}`}
                                                    title={esMesActual ? 'Va ganando' : `Ganó ${nombreMes}`}>
                                                    <Crown size={14} />
                                                </span>
                                            )}
                                            <div className="min-w-[240px] px-4 py-2 flex flex-col gap-1.5" style={{ marginLeft: ALTO_FILA }}>
                                                {/* En una sola línea cada renglón: la fila no crece y la foto sigue cuadrada */}
                                                <div className="flex items-center gap-2 min-w-0 overflow-hidden leading-5">
                                                    <span className="font-bold text-slate-700 truncate">{v.nombre}</span>
                                                    {v.esMio && (
                                                        <span className="px-1.5 py-0.5 rounded bg-brand-cyan text-white text-[9px] leading-4 font-black tracking-wider">VOS</span>
                                                    )}
                                                    {v.puesto === 'ENCARGADO' && (
                                                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 text-[9px] leading-4 font-bold tracking-wider">ENCARGADO</span>
                                                    )}
                                                    {total != null && <PastillaFranja valor={total * progreso} />}
                                                    {esLider && <PastillaGanador enCurso={esMesActual} mes={nombreMes} />}
                                                    {esLider && !esMesActual && lider.racha >= 2 && <PastillaRacha racha={lider.racha} />}
                                                </div>
                                                {total != null ? (
                                                    <>
                                                        <BarraFranjas valor={total * progreso} escala={escala} />
                                                        <div className="text-[11px] leading-4 text-slate-400 truncate">
                                                            <FaltaParaFranja total={total} />
                                                            {esLider && lider.segundo && (
                                                                <> · {esMesActual ? 'Le lleva' : 'Le sacó'} <b className="font-bold text-slate-600 tabular-nums">US$ {money(lider.ventaja)}</b> a {lider.segundo.nombre}</>
                                                            )}
                                                            {esSegundo && (
                                                                <> · A <b className="font-bold text-slate-600 tabular-nums">US$ {money(lider.ventaja)}</b> del primer lugar</>
                                                            )}
                                                        </div>
                                                    </>
                                                ) : (
                                                    <div className="text-[11px] leading-4 text-slate-300">Falta la cotización para ubicarlo en las franjas</div>
                                                )}
                                            </div>
                                        </td>
                                        {celdasPlata(v)}
                                        <CeldaTotal valor={total} comision={total != null ? comisionDe(total) : null} />
                                    </tr>
                                );
                            })}
                            {/* Todo lo que no es de un vendedor, en una sola card: al tocarla se despliegan sus partes */}
                            {!loading && otrasVentas && (
                                <>
                                    <tr data-fila={OTRAS_VENTAS} onClick={alternarOtras} role="button" tabIndex={0} aria-expanded={verOtras}
                                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); alternarOtras(); } }}
                                        title={verOtras ? 'Ocultar el detalle' : 'Ver el detalle'}
                                        className="border-b border-slate-100 last:border-0 bg-white hover:bg-slate-50 cursor-pointer select-none outline-none focus-visible:bg-slate-50">
                                        {/* Sin foto ni ícono: el nombre arranca a la izquierda, como «Total», y la fila no guarda el alto de la foto */}
                                        <td className="p-0 align-middle">
                                            <div className="min-w-[240px] px-4 py-2 flex items-center gap-2 leading-5">
                                                <span className="font-bold text-slate-600">{otrasVentas.nombre}</span>
                                                <ChevronDown size={16} className={`text-slate-400 transition-transform duration-300 ${verOtras ? 'rotate-180' : ''}`} />
                                            </div>
                                        </td>
                                        {celdasPlata(otrasVentas)}
                                        <CeldaTotal valor={totalDe(otrasVentas, cotizacion)} comision={null} />
                                    </tr>
                                    {verOtras && otrasVentas.partes.map(p => (
                                        <tr key={p.tipo} className="border-b border-slate-100 last:border-0 bg-slate-50/70" style={{ animation: 'filaEntra .25s ease-out' }}>
                                            <td className="py-2 pl-10 pr-4 align-middle italic text-slate-500">{p.nombre}</td>
                                            {celdasPlata(p)}
                                            <CeldaTotal valor={totalDe(p, cotizacion)} comision={null} />
                                        </tr>
                                    ))}
                                </>
                            )}
                        </tbody>
                        {!loading && data.length > 0 && (
                            <tfoot>
                                <tr className="bg-slate-50 border-t-2 border-slate-200 font-black">
                                    <td className="px-4 py-3 text-[11px] uppercase tracking-wider text-slate-500">Total</td>
                                    {MONEDAS.map(m => (
                                        <React.Fragment key={m}>
                                            <Celda valor={tot[m].vendido} columna="vendido" total primera
                                                enDolares={enDolares(m, tot[m].vendido)} />
                                            <CeldaCobro cobrado={tot[m].cobrado} pendiente={tot[m].sinCobrar} total />
                                        </React.Fragment>
                                    ))}
                                    <CeldaTotal valor={unificado(tot.USD.vendido, tot.UYU.vendido, cotizacion)} comision={totalComisiones} total />
                                </tr>
                            </tfoot>
                        )}
                    </table>
                </div>
            </div>

            {/* Pie: qué se está contando */}
            <div className="mt-4 flex items-start gap-2 text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                <Users size={13} className="mt-0.5 shrink-0" />
                <span>
                    <b>Vendido</b> es el total de los documentos de venta emitidos en el mes (e-tickets, e-facturas y pedidos de caja),
                    menos las notas de crédito, atribuido al vendedor de la cartera del cliente.
                    {' '}<b>Pendiente</b> es lo que todavía se debe de esos documentos y <b>cobrado</b> es la diferencia.
                    {otrasVentas && <> <b>Otras ventas</b> junta lo que no es de ningún vendedor (clientes sin vendedor del área, mostrador): tocala para ver cada parte.</>}
                    {' '}<b>Ganadores:</b> el primero de cada mes por total unificado, desde junio 2026; los meses seguidos del mismo vendedor van unidos en la tira. En el mes en curso es provisorio.
                    {' '}Los rollos y la carga de billetera cuentan cuando se venden; los anticipos y los recibos no son ventas.
                    {' '}Las monedas son las del documento y van separadas{cotizacion ? '; debajo del vendido en pesos está cuánto es en dólares' : ''}.
                    {' '}<b>Total unificado en US$</b> suma lo vendido en dólares y lo vendido en pesos pasado a dólares
                    {cotizacion
                        ? <> con {esMesActual ? 'la cotización del día' : `la última cotización de ${nombreMes}`} ({cotFecha ? `${diaMes(cotFecha)}, ` : ''}<b>$ {money(cotizacion)}</b>), no con la de cada documento.</>
                        : <>; falta la cotización para calcularlo.</>}
                    {' '}Con esa misma cotización da lo mismo que el «Total facturado» de Contabilidad.
                    {' '}<b>Comisión:</b> el porcentaje de la franja alcanzada sobre todo el total unificado
                    {' '}({FRANJAS.map(f => `desde US$ ${f.desde.toLocaleString('es-UY')}, ${f.texto}`).join('; ')}). Por debajo de US$ {FRANJAS[0].desde.toLocaleString('es-UY')} no hay comisión.
                    {hayNotas && <> Las notas de este mes suman <b>{textoNotas}</b> y ya están restadas del vendido.</>}
                </span>
            </div>
        </div>
    );
}
