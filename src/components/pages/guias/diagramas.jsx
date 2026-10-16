/**
 * Diagramas de las guías de gran formato (cuadros canvas y terminaciones de lona), redibujados de
 * los PDF de octubre 2026 (public/guias/guiasenpdf/). Colores como en el original: magenta =
 * soldadura, amarillo = bolsillo, cian = ojales / borde del canvas.
 */
import { useId } from 'react';

const C = { cian: '#22A8E0', magenta: '#FF009D', amarillo: '#FFE600', oscuro: '#0C0C0C', gris: '#9A9A9A' };
const MONO = "'Roboto Mono', 'Google Sans Code', monospace";

function Rayado({ id, color }) {
  return (
    <pattern id={id} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
      <rect width="7" height="7" fill={color} fillOpacity="0.22" />
      <line x1="0" y1="0" x2="0" y2="7" stroke={color} strokeWidth="1.6" />
    </pattern>
  );
}

/** Canvas visto de frente: borde de 5 cm rayado, cara visible y (opcional) resguardo de 3 cm. */
export function DiagramaCanvas({ resguardo = false, pie }) {
  const id = useId().replace(/:/g, '');
  return (
    <figure className="flex flex-col items-center gap-1.5">
      <svg viewBox="0 0 220 270" className="w-full max-w-[240px]" role="img" aria-label="Canvas: borde de 5 cm por lado alrededor de la cara visible">
        <defs><Rayado id={`r${id}`} color={C.cian} /></defs>
        <rect x="2" y="2" width="216" height="266" fill={`url(#r${id})`} stroke={C.cian} strokeWidth="2.5" />
        <rect x="30" y="30" width="160" height="210" fill={C.oscuro} stroke={C.cian} strokeWidth="1.6" strokeDasharray="6 4" />
        {resguardo && <rect x="46" y="46" width="128" height="178" fill="none" stroke={C.gris} strokeWidth="1.2" strokeDasharray="1.5 4" />}
        <rect x="44" y="11" width="132" height="13" fill="#fff" fillOpacity="0.85" rx="2" />
        <text x="110" y="21" textAnchor="middle" fontSize="10" fontWeight="700" fill={C.cian} fontFamily={MONO}>borde 5 cm por lado</text>
        <text x="110" y="140" textAnchor="middle" fontSize="13" fontWeight="700" fill="#D4D4D4" fontFamily={MONO}>CARA VISIBLE</text>
      </svg>
      {pie && <figcaption className="text-center text-[12px] text-zinc-600 leading-snug">{pie}</figcaption>}
    </figure>
  );
}

/** Canvas de costado: los 5 cm de cada lado se doblan detrás del bastidor. */
export function DiagramaBastidor() {
  return (
    <figure className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 300 110" className="w-full max-w-[320px]" role="img" aria-label="Vista de costado del bastidor con el borde doblado hacia atrás">
        <text x="150" y="12" textAnchor="middle" fontSize="9.5" fontWeight="700" fill="#111" fontFamily={MONO}>CARA VISIBLE = MEDIDA FINAL</text>
        <rect x="50" y="30" width="200" height="34" fill="#C9A46A" />
        <rect x="50" y="56" width="200" height="8" fill="#A9834B" />
        <path d="M50 92 V24 H250 V92" fill="none" stroke={C.cian} strokeWidth="4" />
        <text x="40" y="66" textAnchor="end" fontSize="9" fontWeight="700" fill={C.cian} fontFamily={MONO}>5 cm</text>
        <text x="260" y="66" fontSize="9" fontWeight="700" fill={C.cian} fontFamily={MONO}>5 cm</text>
      </svg>
      <figcaption className="text-[11.5px] text-zinc-600">Los 5 cm de cada lado se doblan y se grapan detrás del bastidor.</figcaption>
    </figure>
  );
}

/**
 * Lona con su terminación, lado por lado. `lados` = { arriba, abajo, izquierda, derecha }, cada uno
 * 'soldadura' | 'bolsillo'. `ojales` = lados con ojales.
 */
export function DiagramaLona({ lados, ojales = [], chico = false, rotulo = 'ÁREA VISIBLE' }) {
  const id = useId().replace(/:/g, '');
  const W = 300, H = 190;
  const borde = (lado) => (lados[lado] === 'bolsillo' ? 30 : 12);
  const t = borde('arriba'), b = borde('abajo'), l = borde('izquierda'), r = borde('derecha');
  const color = (lado) => (lados[lado] === 'bolsillo' ? `url(#am${id})` : `url(#mg${id})`);
  const marco = (lado) => (lados[lado] === 'bolsillo' ? C.amarillo : C.magenta);
  const vis = { x: l, y: t, w: W - l - r, h: H - t - b };
  const off = 9;   // ojales: 7,5 cm desde el borde del archivo ≈ dentro del área visible
  const puntos = [];
  const xs = [0, 1 / 3, 2 / 3, 1].map(f => vis.x + off + f * (vis.w - 2 * off));
  const ys = [0, 0.5, 1].map(f => vis.y + off + f * (vis.h - 2 * off));
  if (ojales.includes('arriba')) xs.forEach(x => puntos.push([x, vis.y + off]));
  if (ojales.includes('abajo')) xs.forEach(x => puntos.push([x, vis.y + vis.h - off]));
  if (ojales.includes('izquierda')) ys.forEach(y => puntos.push([vis.x + off, y]));
  if (ojales.includes('derecha')) ys.forEach(y => puntos.push([vis.x + vis.w - off, y]));
  const unicos = puntos.filter(([x, y], i) => puntos.findIndex(([a, c]) => Math.abs(a - x) < 1 && Math.abs(c - y) < 1) === i);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`w-full ${chico ? '' : 'max-w-[340px]'}`} role="img" aria-label="Lona con las franjas que consume cada terminación">
      <defs><Rayado id={`mg${id}`} color={C.magenta} /><Rayado id={`am${id}`} color="#BFAE00" /></defs>
      <rect x="0" y="0" width={W} height={H} fill={C.oscuro} />
      <rect x="0" y="0" width={W} height={t} fill={color('arriba')} />
      <rect x="0" y={H - b} width={W} height={b} fill={color('abajo')} />
      <rect x="0" y={t} width={l} height={H - t - b} fill={color('izquierda')} />
      <rect x={W - r} y={t} width={r} height={H - t - b} fill={color('derecha')} />
      <line x1="0" y1="1" x2={W} y2="1" stroke={marco('arriba')} strokeWidth="2.5" />
      <line x1="0" y1={H - 1} x2={W} y2={H - 1} stroke={marco('abajo')} strokeWidth="2.5" />
      <line x1="1" y1="0" x2="1" y2={H} stroke={marco('izquierda')} strokeWidth="2.5" />
      <line x1={W - 1} y1="0" x2={W - 1} y2={H} stroke={marco('derecha')} strokeWidth="2.5" />
      <rect x={vis.x} y={vis.y} width={vis.w} height={vis.h} fill="none" stroke="#E5E5E5" strokeWidth="1.3" strokeDasharray="6 4" />
      {!chico && <rect x={vis.x + 12} y={vis.y + 12} width={vis.w - 24} height={vis.h - 24} fill="none" stroke={C.gris} strokeWidth="1" strokeDasharray="1.5 4" />}
      {unicos.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={chico ? 2.6 : 3.6} fill="none" stroke={C.cian} strokeWidth="1.6" />)}
      {!chico && <text x={W / 2} y={H / 2 + 4} textAnchor="middle" fontSize="12" fontWeight="700" fill="#BDBDBD" fontFamily={MONO}>{rotulo}</text>}
    </svg>
  );
}

/** Referencias de color de los diagramas. */
export function Leyenda({ items }) {
  const fondo = { magenta: C.magenta, amarillo: C.amarillo, cian: C.cian, gris: '#7A7A7A' };
  return (
    <ul className="flex flex-col gap-1 text-[12.5px] text-zinc-800">
      {items.map(([color, texto]) => (
        <li key={texto} className="flex items-center gap-2">
          <span className="w-3 h-3 flex-shrink-0" style={{ background: fondo[color] }} />{texto}
        </li>
      ))}
    </ul>
  );
}
