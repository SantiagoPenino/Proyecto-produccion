import React from 'react';
import { LADOS, LADO_NOMBRE, ladosDeUbicacion, posicionesOjales, ojalesEnLado, largoLado } from '../../utils/terminacionesGeo';

/**
 * Plano ÚNICO de una pieza con TODAS sus terminaciones dibujadas encima,
 * sobre el arte real si está disponible.
 *
 * capas: [{
 *    id, nombre, color, ubicacion,
 *    tipo: 'linea' | 'bolsillo' | 'ojales' | 'palos' | 'rollup',
 *    anchoCm — bolsillo: a qué distancia del borde va la costura
 *    pasoM   — ojales: separación entre ojales
 * }]
 *
 * 'palos' y 'rollup' no dependen de la ubicación (van siempre en los extremos):
 * se dibujan con su símbolo propio para que el cliente vea cómo queda armado.
 */
export default function PlanoPieza({
    anchoM = 1, altoM = 1,
    capas = [], arteUrl = null,
    interactivo = false, capaActivaId = null, onToggleLado,
    size = 'sm', cotas = true, className = '',
}) {
    const W = parseFloat(anchoM) || 1;
    const H = parseFloat(altoM) || 1;
    const uid = React.useId();

    const maxW = size === 'sm' ? 178 : 420;
    const maxH = size === 'sm' ? 112 : 260;
    const esc = Math.min(maxW / W, maxH / H);
    const w = Math.max(size === 'sm' ? 76 : 140, W * esc);
    const h = Math.max(size === 'sm' ? 50 : 90, H * esc);
    const mar = size === 'sm' ? 15 : 28;
    const cotaSpace = cotas ? (size === 'sm' ? 11 : 20) : 0;
    const vbW = w + mar * 2, vbH = h + mar * 2 + cotaSpace;
    const x0 = mar, y0 = mar, x1 = x0 + w, y1 = y0 + h;

    const pxPorM = w / W;
    const grosor = size === 'sm' ? 3 : 5;
    const ojalR = size === 'sm' ? 2.5 : 4;

    const seg = { t: [x0, y0, x1, y0], b: [x0, y1, x1, y1], l: [x0, y0, x0, y1], r: [x1, y0, x1, y1] };
    const haciaAdentro = (lado, d) => ({ t: [0, d], b: [0, -d], l: [d, 0], r: [-d, 0] }[lado] || [0, 0]);

    const capaActiva = capas.find(c => c.id === capaActivaId) || null;
    const ladosActivos = capaActiva ? ladosDeUbicacion(capaActiva.ubicacion) : [];

    return (
        <svg viewBox={`0 0 ${vbW} ${vbH}`} width={vbW} height={vbH} className={className}
            role="img" aria-label={`Pieza de ${W.toFixed(2)} por ${H.toFixed(2)} metros`}>

            <defs>
                <clipPath id={`arte-${uid}`}>
                    <rect x={x0} y={y0} width={w} height={h} />
                </clipPath>
            </defs>

            {/* El arte del cliente dentro de la pieza */}
            {arteUrl
                ? <image href={arteUrl} x={x0} y={y0} width={w} height={h}
                    preserveAspectRatio="none" clipPath={`url(#arte-${uid})`} opacity="0.85" />
                : <rect x={x0} y={y0} width={w} height={h} fill="rgba(255,255,255,.03)" />}
            <rect x={x0} y={y0} width={w} height={h}
                fill="none" stroke="#6a6a75" strokeWidth="1" strokeDasharray="3 3" />

            {capas.map((capa, ci) => {
                const sep = ci * (grosor + 1.5);

                // PALOS: barras en los extremos (arriba y abajo), como el pasacalle armado
                if (capa.tipo === 'palos') {
                    const gr = grosor * 1.6;
                    return ['t', 'b'].map(lado => {
                        const y = (lado === 't') ? y0 - gr / 2 : y1 - gr / 2;
                        return (
                            <g key={`${capa.id}-${lado}`}>
                                <rect x={x0 - 4} y={y} width={w + 8} height={gr} rx={gr / 2} fill={capa.color} opacity="0.9" />
                                <circle cx={x0 - 4} cy={y + gr / 2} r={gr * 0.55} fill={capa.color} />
                                <circle cx={x1 + 4} cy={y + gr / 2} r={gr * 0.55} fill={capa.color} />
                            </g>
                        );
                    });
                }

                // ROLL UP: estuche abajo (barra gruesa) y varilla arriba (fina)
                if (capa.tipo === 'rollup') {
                    const gEst = grosor * 2.2, gVar = grosor * 0.9;
                    return (
                        <g key={capa.id}>
                            <rect x={x0 - 5} y={y1 - gEst / 2} width={w + 10} height={gEst} rx={gEst / 2}
                                fill={capa.color} opacity="0.9" />
                            <rect x={x0} y={y0 - gVar / 2} width={w} height={gVar} rx={gVar / 2}
                                fill={capa.color} opacity="0.7" />
                        </g>
                    );
                }

                const lados = ladosDeUbicacion(capa.ubicacion);
                if (!lados.length) return null;

                // OJALES: van SOBRE el borde, sin desplazar por capa — si se corrieran
                // hacia adentro, el punto de la esquina del lado de arriba y el del
                // lateral caerían en lugares distintos y la esquina saldría con dos
                // ojales. Se calculan todos los puntos y se descartan los repetidos.
                if (capa.tipo === 'ojales') {
                    const vistos = new Set();
                    const puntos = [];
                    lados.forEach(lado => {
                        const n = ojalesEnLado(largoLado(lado, W, H), capa.pasoM || 0.5);
                        posicionesOjales(n).forEach(f => {
                            const cx = (lado === 'l') ? x0 : (lado === 'r') ? x1 : x0 + f * w;
                            const cy = (lado === 't') ? y0 : (lado === 'b') ? y1 : y0 + f * h;
                            const clave = `${Math.round(cx)}|${Math.round(cy)}`;
                            if (vistos.has(clave)) return;   // esquina ya dibujada
                            vistos.add(clave);
                            puntos.push([cx, cy]);
                        });
                    });
                    return puntos.map(([cx, cy], i) => (
                        <circle key={`${capa.id}-oj-${i}`} cx={cx} cy={cy} r={ojalR}
                            fill="#0d0d0f" stroke={capa.color} strokeWidth={size === 'sm' ? 1.4 : 2} />
                    ));
                }

                // BOLSILLO: borde + costura interior a la distancia real
                if (capa.tipo === 'bolsillo') {
                    const anchoPx = Math.max(3, Math.min(((capa.anchoCm || 8) / 100) * pxPorM, Math.min(w, h) / 3));
                    return lados.map(lado => {
                        const g = seg[lado];
                        const [dx, dy] = haciaAdentro(lado, sep);
                        const [ix, iy] = haciaAdentro(lado, sep + anchoPx);
                        return (
                            <g key={`${capa.id}-${lado}`}>
                                <line x1={g[0] + dx} y1={g[1] + dy} x2={g[2] + dx} y2={g[3] + dy}
                                    stroke={capa.color} strokeWidth={grosor} strokeLinecap="square" />
                                <line x1={g[0] + ix} y1={g[1] + iy} x2={g[2] + ix} y2={g[3] + iy}
                                    stroke={capa.color} strokeWidth={grosor * 0.6} strokeDasharray="3 2" opacity="0.9" />
                            </g>
                        );
                    });
                }

                // Línea simple: soldadura, dobladillo...
                return lados.map(lado => {
                    const g = seg[lado];
                    const [dx, dy] = haciaAdentro(lado, sep);
                    return <line key={`${capa.id}-${lado}`}
                        x1={g[0] + dx} y1={g[1] + dy} x2={g[2] + dx} y2={g[3] + dy}
                        stroke={capa.color} strokeWidth={grosor} strokeLinecap="square" />;
                });
            })}

            {/* Bordes clickeables: aplican a la capa activa */}
            {interactivo && capaActiva && ladosDeUbicacion(capaActiva.ubicacion) !== null && LADOS.map(lado => {
                const g = seg[lado];
                const horiz = (lado === 't' || lado === 'b');
                const hit = size === 'sm' ? 13 : 18;
                const on = ladosActivos.includes(lado);
                return (
                    <rect key={`hit-${lado}`}
                        x={horiz ? x0 : g[0] - hit / 2} y={horiz ? g[1] - hit / 2 : y0}
                        width={horiz ? w : hit} height={horiz ? hit : h}
                        fill={on ? 'rgba(255,255,255,.07)' : 'transparent'}
                        style={{ cursor: 'pointer' }}
                        onClick={() => onToggleLado && onToggleLado(lado)}>
                        <title>{`${on ? 'Quitar de' : 'Poner'} ${LADO_NOMBRE[lado]}${capaActiva.nombre ? ' — ' + capaActiva.nombre : ''}`}</title>
                    </rect>
                );
            })}

            {cotas && (
                <>
                    <text x={(x0 + x1) / 2} y={vbH - (size === 'sm' ? 2 : 5)}
                        fill="currentColor" fontSize={size === 'sm' ? 8.5 : 12} fontWeight="700" textAnchor="middle">
                        {W.toFixed(2)} m
                    </text>
                    <text transform={`translate(${size === 'sm' ? 6 : 10},${(y0 + y1) / 2}) rotate(-90)`}
                        fill="currentColor" fontSize={size === 'sm' ? 8.5 : 12} fontWeight="700" textAnchor="middle">
                        {H.toFixed(2)} m
                    </text>
                </>
            )}
        </svg>
    );
}

/** Paleta estable por posición: cada terminación conserva su color. */
export const COLOR_CAPA = ['#fbbf24', '#22d3ee', '#a855f7', '#4ade80', '#fb7185', '#f97316'];

/**
 * Ícono de bordes tipo Word: rectángulo con los lados del preset marcados.
 * Se usa para los atajos "los 4 lados / arriba y abajo / laterales / limpiar".
 */
export const IconoBordes = ({ lados = [], color = '#fbbf24', size = 20 }) => {
    const has = (s) => lados.includes(s);
    const g = { t: [3.5, 3.5, 18.5, 3.5], r: [18.5, 3.5, 18.5, 18.5], b: [3.5, 18.5, 18.5, 18.5], l: [3.5, 3.5, 3.5, 18.5] };
    return (
        <svg width={size} height={size} viewBox="0 0 22 22" aria-hidden="true">
            <rect x="3.5" y="3.5" width="15" height="15" fill="none" stroke="#5b5b66" strokeWidth="1" strokeDasharray="2 2" />
            {LADOS.map(k => has(k) && (
                <line key={k} x1={g[k][0]} y1={g[k][1]} x2={g[k][2]} y2={g[k][3]}
                    stroke={color} strokeWidth="2.6" strokeLinecap="round" />
            ))}
        </svg>
    );
};

/** Atajos de borde: los pares primero, después cada lado suelto. */
export const PRESETS_BORDE = [
    { lados: ['t', 'r', 'b', 'l'], label: 'Los 4 lados' },
    { lados: ['t', 'b'], label: 'Arriba y abajo' },
    { lados: ['l', 'r'], label: 'Los dos costados' },
    { lados: ['t'], label: 'Solo arriba' },
    { lados: ['b'], label: 'Solo abajo' },
    { lados: ['l'], label: 'Solo izquierda' },
    { lados: ['r'], label: 'Solo derecha' },
    { lados: [], label: 'Ninguno' },
];
