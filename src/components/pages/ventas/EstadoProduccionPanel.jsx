import React from 'react';
import { BLOQUE_DEL_REQUISITO } from './checklistSolicitud';

/**
 * Qué le falta a un producto para entrar a producción, agrupado igual que el panel "Estado del pedido"
 * del formulario de la solicitud. Junta en un solo lugar las dos fuentes de bloqueos:
 *   - la ficha de ingreso (evaluarProducto: nombre, fecha, talles, boceto, muestra…)
 *   - lo técnico de la conversión (faltantesConversion: precio, seña, datos de cada servicio, diseño pronto…)
 * Solo muestra: no decide nada (el backend ya mandó `ch` con todo).
 */
const GRUPOS = [
    { k: 'ident', t: 'Identificación' },
    { k: 'producto', t: 'Producto' },
    { k: 'talles', t: 'Lista de talles' },
    { k: 'extras', t: 'Servicios y extras' },
    { k: 'pago', t: 'Pago y seña' },
    { k: 'diseno', t: 'Diseño y archivos' },
];
const DISENO = ['Boceto, ficha técnica o muestra de referencia', 'Archivo de diseño entregado y verificado', 'Diseño aprobado por escrito por el cliente'];
const TALLES = ['Lista de talles', 'Lista de nombres y números completa y cerrada', 'Medidas exactas en cm y cantidad por medida', 'Tipo de terminación o costura', 'Medidas de la prenda'];

export function grupoDe(txt) {
    if (DISENO.includes(txt)) return 'diseno';
    if (TALLES.includes(txt)) return 'talles';
    if (/todavía no está diseñado|diseño pronto|Diseño todavía no aceptó|falta elegir la tela/i.test(txt)) return 'diseno';
    if (/seña|precio|cobra/i.test(txt)) return 'pago';
    if (/^(Corte|Costura|Bordado|Estampado)\b/i.test(txt)) return 'extras';
    const b = BLOQUE_DEL_REQUISITO[txt];
    if (b === 1) return 'ident';
    if (b === 7) return 'extras';
    return 'producto';
}

export default function EstadoProduccionPanel({ ch, titulo = 'Estado para producción' }) {
    if (!ch) return null;
    const porGrupo = Object.fromEntries(GRUPOS.map(g => [g.k, []]));
    (ch.faltan || []).forEach(x => { const g = grupoDe(x); if (!porGrupo[g].includes(x)) porGrupo[g].push(x); });
    const listos = GRUPOS.filter(g => !porGrupo[g.k].length).length;
    const listo = !(ch.faltan || []).length;
    return (
        <div className="fp-panel fp-panel-detalle">
            <h3>{titulo}</h3>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <span>{listo ? 'Tiene todo para entrar a producción' : `${listos} de ${GRUPOS.length} listos`}</span>
                <span className={`fp-sello ${listo ? 'si' : 'no'}`}>{listo ? 'Listo para ingresar' : 'Falta info'}</span>
            </div>
            <div className="fp-meter"><i style={{ width: `${(listos / GRUPOS.length) * 100}%` }} /></div>
            <ul className="fp-checks">
                {GRUPOS.map((g, i) => {
                    const f = porGrupo[g.k];
                    return (
                        <li key={g.k} className={f.length ? 'falta' : 'ok'}>
                            <div className="fila">
                                <span className="fp-dot">{f.length ? i + 1 : '✓'}</span>
                                <span><b>{g.t}</b>
                                    {f.length
                                        ? <ul className="fp-faltan">{f.map(x => <li key={x}>{x}</li>)}</ul>
                                        : <small>Listo</small>}
                                </span>
                            </div>
                        </li>
                    );
                })}
            </ul>
            {(ch.ok || []).length > 0 && <div className="fp-okcount">✓ {ch.ok.length} requisito{ch.ok.length === 1 ? '' : 's'} cumplido{ch.ok.length === 1 ? '' : 's'}</div>}
            {(ch.luego || []).length > 0 && <div className="fp-luego">Se puede completar después, no frena: {ch.luego.join(' · ')}</div>}
        </div>
    );
}
