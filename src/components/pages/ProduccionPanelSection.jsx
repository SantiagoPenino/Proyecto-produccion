// =============================================================================
// Panel de Producción — sección "Dashboard" de Reportes de Contabilidad.
// Es la maqueta dashboard_produccion_2.html pasada a React, alimentada por
// GET /api/dashboard/produccion/panel (datos reales de SecureAppDB).
//
// Cada tarjeta dice de dónde sale el dato. Lo que todavía NO tiene fuente
// (tiempo de inactividad) se muestra con "—" y la leyenda "sin fuente todavía".
// =============================================================================
import { useState, useEffect, useRef, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import api from '../../services/apiClient';
import ConfigDeliveryTimesModal from '../modals/config/ConfigDeliveryTimesModal';

// ─── Estilos de la maqueta (scoped a .viz-root) ──────────────────────────────
const CSS = `
.viz-root{--page:#eef0f5;--surface-1:#ffffff;--card:#ffffff;--text-primary:#1e2430;--text-secondary:#5b6472;--muted:#98a0ad;--grid:#eef0f5;--baseline:#dfe3ea;--border:rgba(20,24,40,0.09);--brand:#5b53d6;--brand2:#6d5ef0;--s1:#3b82f6;--s2:#16a34a;--s3:#f59e0b;--s4:#0ea5e9;--s5:#8b5cf6;--s6:#ef4444;--s7:#ec4899;--s8:#f97316;--good:#16a34a;--warning:#f59e0b;--serious:#f97316;--critical:#ef4444;}
.viz-root{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--text-primary);}
.viz-root *{box-sizing:border-box;}
/* Bloque fijo (encabezado + filtros). El contenedor de la página tiene padding de 16px (p-4): el margen
   negativo lo compensa para que el fondo tape lo que pasa por debajo al hacer scroll. */
.viz-root .viz-sticky{position:sticky;top:-16px;z-index:60;background:#f8fafc;margin:-16px -16px 0;padding:16px 16px 2px;box-shadow:0 6px 12px -8px rgba(20,24,40,.18);}
.viz-root .hero{background:linear-gradient(105deg,#221d54 0%,#33298f 52%,#4a3cb2 100%);color:#fff;border-radius:16px;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:16px;box-shadow:0 8px 24px rgba(51,41,143,.18);}
.viz-root .hero h1{font-size:22px;font-weight:800;letter-spacing:.4px;margin:0;}
.viz-root .hero .sub{color:rgba(255,255,255,.72);font-size:12.5px;margin-top:4px;}
.viz-root .hero .sub b{color:#fff;}
.viz-root .hero-right{display:flex;align-items:center;gap:14px;}
.viz-root .upd{color:rgba(255,255,255,.82);font-size:12.5px;font-variant-numeric:tabular-nums;}
.viz-root .btn{background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.30);color:#fff;padding:8px 16px;border-radius:9px;font-weight:600;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;transition:background .15s;}
.viz-root .btn:hover{background:rgba(255,255,255,.26);}
.viz-root .btn:disabled{opacity:.6;cursor:default;}
.viz-root .btn svg{width:15px;height:15px;stroke:#fff;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}
.viz-root .toolbar{background:var(--surface-1);border:1px solid var(--border);border-radius:14px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:14px 18px;flex-wrap:wrap;box-shadow:0 1px 2px rgba(20,24,40,.04);}
.viz-root .chips{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.viz-root .chips-lbl{font-size:11.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:700;margin-right:2px;}
.viz-root .chip{padding:7px 14px;border-radius:20px;border:1px solid var(--border);background:#fff;color:var(--text-secondary);font-size:12.5px;font-weight:600;cursor:pointer;transition:.13s;white-space:nowrap;}
.viz-root .chip:hover{border-color:var(--brand);color:var(--brand);}
.viz-root .chip.active{background:var(--brand);border-color:var(--brand);color:#fff;box-shadow:0 2px 8px rgba(91,83,214,.3);}
.viz-root .controls{display:flex;align-items:center;gap:14px;margin-left:auto;flex-wrap:wrap;}
.viz-root .fgroup{display:flex;flex-direction:column;gap:4px;}
.viz-root .fgroup label{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:700;}
.viz-root select{background:#fff;color:var(--text-primary);border:1px solid var(--border);border-radius:8px;padding:8px 30px 8px 12px;font-size:12.5px;font-family:inherit;font-weight:600;cursor:pointer;min-width:150px;appearance:none;background-image:linear-gradient(45deg,transparent 50%,#98a0ad 50%),linear-gradient(135deg,#98a0ad 50%,transparent 50%);background-position:calc(100% - 16px) 50%,calc(100% - 11px) 50%;background-size:5px 5px,5px 5px;background-repeat:no-repeat;}
.viz-root select:focus{outline:2px solid var(--brand);outline-offset:1px;}
.viz-root .switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:12.5px;font-weight:600;color:var(--text-secondary);user-select:none;}
.viz-root .switch input{display:none;}
.viz-root .track{width:38px;height:21px;border-radius:20px;background:var(--baseline);position:relative;transition:background .18s;flex:none;}
.viz-root .track::after{content:"";position:absolute;top:3px;left:3px;width:15px;height:15px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .18s;}
.viz-root .switch input:checked + .track{background:var(--good);}
.viz-root .switch input:checked + .track::after{transform:translateX(17px);}
.viz-root .livebadge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;color:var(--good);letter-spacing:.3px;}
.viz-root .livebadge .rec{width:8px;height:8px;border-radius:50%;background:var(--good);animation:vizpulse 1.4s infinite;}
@keyframes vizpulse{0%{box-shadow:0 0 0 0 rgba(22,163,74,.5);}70%{box-shadow:0 0 0 8px rgba(22,163,74,0);}100%{box-shadow:0 0 0 0 rgba(22,163,74,0);}}
.viz-root .grid{display:grid;grid-template-columns:repeat(12,1fr);gap:14px;}
.viz-root .card{background:var(--surface-1);border:1px solid var(--border);border-radius:14px;padding:16px 16px 14px;box-shadow:0 1px 2px rgba(20,24,40,.04);}
.viz-root .card h2{font-size:12px;font-weight:700;color:var(--text-secondary);letter-spacing:.4px;text-transform:uppercase;margin:0 0 2px;}
.viz-root .card .hint{font-size:11px;color:var(--muted);margin-bottom:10px;}
.viz-root .kpi{grid-column:span 3;display:flex;flex-direction:column;min-height:118px;}
.viz-root .kpi-top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;}
.viz-root .lbl{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;font-weight:700;padding-top:2px;}
.viz-root .kpi-ic{width:38px;height:38px;border-radius:10px;display:grid;place-items:center;flex:none;}
.viz-root .kpi-ic svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;}
.viz-root .kpi .val{font-size:32px;font-weight:800;color:var(--text-primary);margin-top:10px;line-height:1;font-variant-numeric:tabular-nums;}
.viz-root .kpi .val small{font-size:14px;font-weight:700;color:var(--muted);}
.viz-root .kpi .foot{font-size:12px;color:var(--text-secondary);margin-top:auto;padding-top:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.viz-root .delta{font-weight:700;} .viz-root .up{color:var(--good);} .viz-root .down{color:var(--critical);}
.viz-root .clickable{cursor:pointer;transition:box-shadow .15s,transform .05s,border-color .15s;}
.viz-root .clickable:hover{box-shadow:0 4px 14px rgba(20,24,40,.10);border-color:rgba(91,83,214,.4);}
.viz-root .clickable:active{transform:translateY(1px);}
.viz-root .link{color:var(--brand);font-weight:700;}
.viz-root .col-cumpl{grid-column:span 8;} .viz-root .col-gauge{grid-column:span 4;}
.viz-root .col-fallas{grid-column:span 6;} .viz-root .col-sector{grid-column:span 6;} .viz-root .col-top{grid-column:span 12;}
.viz-root svg.chart{display:block;width:100%;overflow:visible;}
.viz-root svg.gauge{max-width:240px;margin:10px auto 4px;}
.viz-root .axis-txt{fill:var(--muted);font-size:11px;font-family:inherit;}
.viz-root .val-txt{fill:var(--text-secondary);font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;font-family:inherit;}
.viz-root .grid-line{stroke:var(--grid);stroke-width:1;} .viz-root .baseline{stroke:var(--baseline);stroke-width:1.5;}
.viz-root .legend{display:flex;gap:16px;flex-wrap:wrap;font-size:11.5px;color:var(--text-secondary);margin-top:8px;}
.viz-root .legend span{display:inline-flex;align-items:center;gap:6px;}
.viz-root .swatch{width:11px;height:11px;border-radius:3px;display:inline-block;} .viz-root .dash{width:16px;height:0;border-top:2px dashed var(--warning);display:inline-block;}
.viz-root .entrega{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#5b4bd0;background:#efeafd;border:1px solid rgba(91,83,214,.25);padding:6px 12px;border-radius:20px;flex-wrap:wrap;}
.viz-root .maq-sum{display:flex;align-items:center;gap:22px;margin-bottom:12px;flex-wrap:wrap;}
.viz-root .maq-stat{display:flex;flex-direction:column;gap:1px;}
.viz-root .maq-stat .n{font-size:22px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1;}
.viz-root .maq-stat .l{font-size:10.5px;color:var(--muted);text-transform:uppercase;letter-spacing:.4px;font-weight:700;}
.viz-root .maq-util{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--text-secondary);font-weight:600;}
.viz-root .maq-util .ubar{width:110px;height:8px;border-radius:6px;background:var(--grid);overflow:hidden;}
.viz-root .maq-util .ubar i{display:block;height:100%;background:var(--good);border-radius:6px;}
.viz-root .maq-list{display:flex;flex-direction:column;gap:1px;max-height:296px;overflow:auto;}
.viz-root .maq-row{display:flex;align-items:center;gap:9px;padding:9px 8px;border-radius:8px;}
.viz-root .maq-row:hover{background:#f7f8fb;}
.viz-root .maq-row .dot{width:9px;height:9px;border-radius:50%;flex:none;}
.viz-root .maq-row .nm{font-size:13px;font-weight:600;color:var(--text-primary);}
.viz-root .maq-row .sec{font-size:11px;color:var(--muted);margin-left:2px;}
.viz-root .maq-row .right{margin-left:auto;display:flex;align-items:center;gap:10px;}
.viz-root .maq-row .st{font-size:10.5px;font-weight:700;padding:2px 9px;border-radius:20px;white-space:nowrap;}
.viz-root .maq-row .st.on{color:#16a34a;background:#e6f6ec;}
.viz-root .maq-row .st.off{color:#b91c1c;background:#fdeaea;}
.viz-root .maq-row .rz{font-size:11.5px;color:#b45309;font-weight:600;white-space:nowrap;background:#fff4e5;padding:2px 8px;border-radius:6px;}
.viz-root .maq-row .oc{font-size:11px;color:var(--text-secondary);white-space:nowrap;}
.viz-tip{position:fixed;pointer-events:none;background:#1e2430;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:8px 10px;font-size:12px;color:#fff;opacity:0;transition:opacity .08s;z-index:99;white-space:nowrap;box-shadow:0 8px 24px rgba(20,24,40,.3);}
.viz-tip b{font-weight:700;} .viz-tip .t-lbl{color:#b8bdc9;}
.viz-root .bar-hit:hover{opacity:.82;cursor:default;}
.viz-root .foot-note{margin-top:18px;font-size:11px;color:var(--muted);text-align:center;}
.viz-root .empty{font-size:12px;color:var(--muted);padding:24px 0;text-align:center;}
.viz-modal{position:fixed;inset:0;background:rgba(20,24,40,.45);display:flex;align-items:center;justify-content:center;z-index:200;padding:24px;backdrop-filter:blur(2px);}
.viz-modal .modal-card{background:#fff;border:1px solid rgba(20,24,40,0.09);border-radius:14px;width:min(1100px,100%);max-height:82vh;display:flex;flex-direction:column;box-shadow:0 30px 80px rgba(20,24,40,.28);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1e2430;}
.viz-modal .modal-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:18px 20px 10px;}
.viz-modal .modal-head h3{font-size:16px;font-weight:800;margin:0;}
.viz-modal .modal-close{background:#f2f4f8;border:1px solid rgba(20,24,40,0.09);color:#5b6472;width:30px;height:30px;border-radius:8px;font-size:15px;cursor:pointer;line-height:1;}
.viz-modal .modal-close:hover{color:#1e2430;border-color:rgba(20,24,40,.25);}
.viz-modal .modal-sub{padding:0 20px 12px;font-size:12.5px;color:#98a0ad;}
.viz-modal .modal-sub b{color:#1e2430;}
.viz-modal .modal-body{overflow:auto;padding:0 20px 18px;}
.viz-modal table.ord{width:100%;border-collapse:collapse;font-size:13px;}
.viz-modal table.ord th{text-align:left;color:#98a0ad;font-size:11px;text-transform:uppercase;letter-spacing:.4px;font-weight:700;padding:8px 10px;position:sticky;top:0;background:#fff;border-bottom:1px solid rgba(20,24,40,0.09);}
.viz-modal table.ord td{padding:9px 10px;border-bottom:1px solid #eef0f5;}
.viz-modal table.ord td.num{text-align:right;font-variant-numeric:tabular-nums;font-weight:700;}
.viz-modal table.ord tr:hover td{background:#f7f8fb;}
.viz-modal .estado-tag{font-size:11px;font-weight:600;color:#5b6472;background:#f2f4f8;border:1px solid rgba(20,24,40,0.09);padding:2px 8px;border-radius:20px;white-space:nowrap;}
.viz-modal .cli{font-size:11px;color:#98a0ad;}
/* Drawer de configuración (misma maqueta) */
.viz-drawer{position:fixed;inset:0;z-index:220;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1e2430;}
.viz-drawer *{box-sizing:border-box;}
.viz-drawer .drawer-ov{position:absolute;inset:0;background:rgba(20,24,40,.45);backdrop-filter:blur(2px);animation:vizfade .18s ease;}
@keyframes vizfade{from{opacity:0}to{opacity:1}}
@keyframes vizslidein{from{transform:translateX(100%)}to{transform:translateX(0)}}
.viz-drawer .drawer-panel{position:absolute;top:0;right:0;height:100%;width:min(520px,100%);background:#fff;box-shadow:-18px 0 60px rgba(20,24,40,.28);display:flex;flex-direction:column;animation:vizslidein .22s ease;}
.viz-drawer .drawer-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:20px 22px 14px;border-bottom:1px solid rgba(20,24,40,0.09);}
.viz-drawer .drawer-head h3{font-size:16px;font-weight:800;margin:0;}
.viz-drawer .drawer-sub{font-size:11.5px;color:#98a0ad;margin-top:3px;}
.viz-drawer .drawer-body{flex:1;overflow:auto;padding:18px 22px;}
.viz-drawer .drawer-foot{display:flex;gap:10px;justify-content:flex-end;align-items:center;padding:14px 22px;border-top:1px solid rgba(20,24,40,0.09);}
.viz-drawer .modal-close{background:#f2f4f8;border:1px solid rgba(20,24,40,0.09);color:#5b6472;width:30px;height:30px;border-radius:8px;font-size:15px;cursor:pointer;line-height:1;}
.viz-drawer .btn-primary{background:#5b53d6;color:#fff;border:none;padding:10px 18px;border-radius:9px;font-weight:700;font-size:13px;cursor:pointer;}
.viz-drawer .btn-primary:hover{background:#4a41c4;} .viz-drawer .btn-primary:disabled{opacity:.6;cursor:default;}
.viz-drawer .btn-ghost{background:#fff;color:#5b6472;border:1px solid rgba(20,24,40,0.09);padding:10px 16px;border-radius:9px;font-weight:600;font-size:13px;cursor:pointer;}
.viz-drawer .btn-ghost:hover{border-color:#98a0ad;color:#1e2430;}
.viz-drawer .cfg-sec{margin-bottom:24px;}
.viz-drawer .cfg-t{font-size:12.5px;font-weight:800;color:#1e2430;text-transform:uppercase;letter-spacing:.4px;}
.viz-drawer .cfg-hint{font-size:11.5px;color:#98a0ad;margin:2px 0 10px;}
.viz-drawer .cfg-row{display:flex;align-items:center;gap:8px;margin-bottom:7px;}
.viz-drawer .cfg-in{flex:1;background:#fff;border:1px solid rgba(20,24,40,0.09);border-radius:8px;padding:8px 11px;font-size:13px;font-family:inherit;color:#1e2430;}
.viz-drawer .cfg-in:focus{outline:2px solid #5b53d6;outline-offset:1px;}
.viz-drawer .cfg-num{width:90px;background:#fff;border:1px solid rgba(20,24,40,0.09);border-radius:8px;padding:8px 11px;font-size:15px;font-weight:800;font-family:inherit;text-align:center;color:#1e2430;}
.viz-drawer .cfg-num:focus{outline:2px solid #5b53d6;outline-offset:1px;}
.viz-drawer .cfg-add{background:#efeafd;color:#5b4bd0;border:1px dashed rgba(91,83,214,.45);border-radius:8px;padding:8px 12px;font-size:12.5px;font-weight:700;cursor:pointer;white-space:nowrap;}
.viz-drawer .cfg-add:hover{background:#e7e0fc;} .viz-drawer .cfg-add:disabled{opacity:.5;cursor:default;}
.viz-drawer .cfg-del{width:30px;height:30px;flex:none;border:1px solid rgba(20,24,40,0.09);background:#fff;color:#b91c1c;border-radius:8px;cursor:pointer;font-size:15px;line-height:1;}
.viz-drawer .cfg-del:hover{background:#fdeaea;border-color:#f3b4b4;}
.viz-drawer .cfg-srow{display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #eef0f5;}
.viz-drawer .cfg-srow:last-child{border-bottom:none;}
.viz-drawer .cfg-sname{font-size:12.5px;font-weight:700;color:#1e2430;width:140px;flex:none;padding-top:5px;}
.viz-drawer .cfg-tchips{display:flex;gap:6px;flex-wrap:wrap;}
.viz-drawer .cfg-tchip{padding:5px 12px;border-radius:20px;border:1px solid rgba(20,24,40,0.09);background:#fff;color:#5b6472;font-size:11.5px;font-weight:600;user-select:none;}
.viz-drawer .cfg-tchip.on{background:#e6f6ec;border-color:#a8dcb8;color:#16a34a;}
.viz-drawer .cfg-tchip.new{background:#efeafd;border-color:rgba(91,83,214,.45);color:#5b4bd0;}
.viz-drawer .cfg-erow{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #eef0f5;}
.viz-drawer .cfg-erow:last-child{border-bottom:none;}
.viz-drawer .cfg-egrp{margin-left:auto;display:flex;gap:14px;flex-wrap:wrap;justify-content:flex-end;font-size:11.5px;color:#5b6472;font-weight:600;}
.viz-drawer .cfg-egrp .edot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:5px;}
.viz-drawer .cfg-egrp .edot.n{background:#16a34a;} .viz-drawer .cfg-egrp .edot.u{background:#f97316;}
.viz-drawer .cfg-msg{font-size:12px;margin-right:auto;}
.viz-drawer select.cfg-sel{background:#fff;border:1px solid rgba(20,24,40,0.09);border-radius:8px;padding:8px 10px;font-size:12.5px;font-family:inherit;font-weight:600;color:#1e2430;}
@media(max-width:1050px){ .viz-root .kpi{grid-column:span 6;} .viz-root .col-cumpl,.viz-root .col-gauge,.viz-root .col-fallas,.viz-root .col-sector{grid-column:span 12;} .viz-root .controls{margin-left:0;} }
@media(max-width:620px){ .viz-root .kpi{grid-column:span 12;} .viz-root select{min-width:100%;} }
`;

// ─── Filtros: los mismos de "Ventas por Área" (FECHA + VER POR) ──────────────
const FECHA_PRESETS = [
    { label: 'Hoy',           value: 'hoy' },
    { label: 'Ayer',          value: 'ayer' },
    { label: '7 días',        value: '7d' },
    { label: '30 días',       value: '30d' },
    { label: '90 días',       value: '90d' },
    { label: 'Personalizado', value: 'custom' },
];

function getDateRange(preset) {
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    switch (preset) {
        case 'hoy':  return { desde: today, hasta: now };
        case 'ayer': { const d = new Date(today); d.setDate(d.getDate()-1); const e = new Date(d); e.setHours(23,59,59,999); return { desde: d, hasta: e }; }
        case '7d':   { const d = new Date(today); d.setDate(d.getDate()-7);  return { desde: d, hasta: now }; }
        case '30d':  { const d = new Date(today); d.setDate(d.getDate()-30); return { desde: d, hasta: now }; }
        case '90d':  { const d = new Date(today); d.setDate(d.getDate()-90); return { desde: d, hasta: now }; }
        default: return { desde: null, hasta: null };
    }
}
// Fecha local → 'YYYY-MM-DD' (sin pasar por UTC, para no correr un día)
const toYMD = d => d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
const fmtDMY = s => (s ? s.split('-').reverse().join('/') : '');

const Chip = ({ active, onClick, children, title }) => (
    <button onClick={onClick} title={title}
        className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
            active ? 'bg-brand-cyan text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
        {children}
    </button>
);

// ─── Helpers ─────────────────────────────────────────────────────────────────
const SVGNS = 'http://www.w3.org/2000/svg';
const nf  = n => Number(n || 0).toLocaleString('es-UY');
const nf2 = n => Number(n || 0).toLocaleString('es-UY', { maximumFractionDigits: 2 });
const COLORS = {
    s1: '#3b82f6', s6: '#ef4444', brand: '#5b53d6', baseline: '#dfe3ea', grid: '#eef0f5', surface: '#ffffff',
    good: '#16a34a', warning: '#f59e0b', critical: '#ef4444', muted: '#98a0ad', text: '#1e2430', text2: '#5b6472',
    pal: ['#3b82f6', '#16a34a', '#f59e0b', '#0ea5e9', '#8b5cf6', '#ef4444', '#ec4899', '#f97316'],
};
function el(tag, attrs) { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
function txt(attrs, content) { const t = el('text', attrs); t.textContent = content; return t; }
function statusColor(v, meta) { if (v == null) return COLORS.muted; if (v >= meta) return COLORS.good; if (v >= meta - 5) return COLORS.warning; return COLORS.critical; }
function clear(svg) { while (svg.firstChild) svg.removeChild(svg.firstChild); }

// Tooltip compartido (un div fijo)
function makeTip(tipEl) {
    const show = (html, evt) => { tipEl.innerHTML = html; tipEl.style.opacity = 1; move(evt); };
    const move = evt => { let x = evt.clientX + 14, y = evt.clientY + 14; if (x + 220 > window.innerWidth) x = evt.clientX - 220; tipEl.style.left = x + 'px'; tipEl.style.top = y + 'px'; };
    const hide = () => { tipEl.style.opacity = 0; };
    return (node, html) => { node.addEventListener('mousemove', e => show(html, e)); node.addEventListener('mouseleave', hide); };
}

// ─── Gráficos (SVG imperativo, mismo dibujo que la maqueta) ──────────────────
function renderLine(svg, serie, meta, bindTip) {
    clear(svg);
    const W = 720, H = 260, m = { t: 16, r: 14, b: 34, l: 34 };
    const d = serie.puntos, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const vals = d.filter(p => p.valor != null).map(p => p.valor);
    if (!vals.length) { svg.appendChild(txt({ x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'axis-txt' }, 'Sin órdenes prontas en el período')); return; }
    const yMin = Math.min(70, Math.floor(Math.min(...vals) / 10) * 10), yMax = 100;
    const n = d.length, x = i => m.l + (n === 1 ? iw / 2 : i / (n - 1) * iw), y = v => m.t + (1 - (v - yMin) / (yMax - yMin)) * ih;
    const step = (yMax - yMin) > 40 ? 20 : 10;
    for (let g = yMin; g <= yMax; g += step) {
        svg.appendChild(el('line', { x1: m.l, y1: y(g), x2: W - m.r, y2: y(g), class: 'grid-line' }));
        svg.appendChild(txt({ x: m.l - 8, y: y(g) + 4, 'text-anchor': 'end', class: 'axis-txt' }, g));
    }
    svg.appendChild(el('line', { x1: m.l, y1: y(meta), x2: W - m.r, y2: y(meta), stroke: COLORS.warning, 'stroke-width': 2, 'stroke-dasharray': '6 5' }));
    svg.appendChild(txt({ x: m.l + 4, y: y(meta) - 7, 'text-anchor': 'start', class: 'val-txt', fill: COLORS.warning }, 'Meta ' + meta + '%'));
    // camino solo por los puntos con dato (los huecos se saltan)
    let dp = '', first = null, last = null;
    d.forEach((p, i) => { if (p.valor == null) return; dp += (dp ? ' L' : 'M') + x(i) + ' ' + y(p.valor); if (first === null) first = i; last = i; });
    const defs = el('defs', {}), grad = el('linearGradient', { id: 'viz-lg', x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.appendChild(el('stop', { offset: '0%', 'stop-color': COLORS.s1, 'stop-opacity': .22 }));
    grad.appendChild(el('stop', { offset: '100%', 'stop-color': COLORS.s1, 'stop-opacity': 0 }));
    defs.appendChild(grad); svg.appendChild(defs);
    svg.appendChild(el('path', { d: dp + ` L${x(last)} ${m.t + ih} L${x(first)} ${m.t + ih} Z`, fill: 'url(#viz-lg)' }));
    svg.appendChild(el('path', { d: dp, fill: 'none', stroke: COLORS.s1, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const showMarks = n <= 31, lstep = Math.max(1, Math.ceil(n / 9));
    d.forEach((p, i) => {
        if (i % lstep === 0) svg.appendChild(txt({ x: x(i), y: H - 12, 'text-anchor': 'middle', class: 'axis-txt' }, p.label));
        if (p.valor == null) return;
        if (showMarks) svg.appendChild(el('circle', { cx: x(i), cy: y(p.valor), r: 4.5, fill: COLORS.surface, stroke: statusColor(p.valor, meta), 'stroke-width': 2.5 }));
        const hit = el('circle', { cx: x(i), cy: y(p.valor), r: 13, fill: 'transparent' });
        bindTip(hit, `<span class="t-lbl">${serie.modo === 'hora' ? p.label : 'Día ' + p.label}</span><br><b>${p.valor}%</b> en tiempo · ${nf(p.n)} órdenes prontas`);
        svg.appendChild(hit);
    });
}

function renderRing(svg, val, meta) {
    clear(svg);
    const cx = 100, cy = 96, r = 74, C = 2 * Math.PI * r, col = statusColor(val, meta);
    svg.appendChild(el('circle', { cx, cy, r, fill: 'none', stroke: COLORS.grid, 'stroke-width': 18 }));
    if (val != null) {
        const frac = Math.max(0, Math.min(1, val / 100));
        svg.appendChild(el('circle', { cx, cy, r, fill: 'none', stroke: col, 'stroke-width': 18, 'stroke-linecap': 'round', 'stroke-dasharray': `${(C * frac).toFixed(1)} ${C.toFixed(1)}`, transform: `rotate(-90 ${cx} ${cy})` }));
    }
    svg.appendChild(txt({ x: cx, y: cy - 2, 'text-anchor': 'middle', fill: COLORS.text, 'font-size': 36, 'font-weight': 800, 'font-family': 'inherit' }, val == null ? '—' : val.toFixed(1) + '%'));
    svg.appendChild(txt({ x: cx, y: cy + 20, 'text-anchor': 'middle', fill: COLORS.muted, 'font-size': 12.5, 'font-family': 'inherit' }, 'meta ' + meta + '%'));
    const word = val == null ? 'SIN DATOS' : val >= meta ? 'EN META' : val >= meta - 5 ? 'CERCA DE META' : 'BAJO META';
    svg.appendChild(txt({ x: cx, y: 196, 'text-anchor': 'middle', fill: col, 'font-size': 11.5, 'font-weight': 700, 'letter-spacing': 1, 'font-family': 'inherit' }, word));
}

// opts: { l: margen izquierdo para la etiqueta, maxLabel: largo máximo antes de cortar con "…" }
function hBars(svg, data, keyLbl, keyVal, W, H, color, fmt, mr, tipExtra, opts = {}) {
    clear(svg);
    if (!data.length) { svg.appendChild(txt({ x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'axis-txt' }, 'Sin datos en el período')); return; }
    const m = { t: 8, r: mr || 64, b: 8, l: opts.l || 158 }, iw = W - m.l - m.r, rowH = (H - m.t - m.b) / data.length, bh = Math.min(26, rowH * 0.62);
    const maxLabel = opts.maxLabel || 26;
    const max = Math.max(...data.map(d => d[keyVal]), 1), x = v => m.l + v / max * iw;
    data.forEach((d, i) => {
        const cy = m.t + rowH * i + rowH / 2;
        const lbl = String(d[keyLbl]); const short = lbl.length > maxLabel ? lbl.slice(0, maxLabel - 1) + '…' : lbl;
        svg.appendChild(txt({ x: m.l - 10, y: cy + 4, 'text-anchor': 'end', class: 'val-txt', fill: COLORS.text2 }, short));
        svg.appendChild(el('rect', { x: m.l, y: cy - bh / 2, width: iw, height: bh, rx: 4, fill: COLORS.grid }));
        const w = Math.max(4, x(d[keyVal]) - m.l);
        svg.appendChild(el('rect', { x: m.l, y: cy - bh / 2, width: w, height: bh, rx: 4, fill: color }));
        svg.appendChild(txt({ x: m.l + w + 8, y: cy + 4, class: 'val-txt' }, fmt(d[keyVal], d)));
        const hit = el('rect', { x: 0, y: cy - rowH / 2, width: W, height: rowH, fill: 'transparent', class: 'bar-hit' });
        svg._bindTip(hit, `<span class="t-lbl">${lbl}</span><br><b>${fmt(d[keyVal], d)}</b>${tipExtra ? '<br>' + tipExtra(d) : ''}`);
        svg.appendChild(hit);
    });
}

function niceStep(max) {
    if (max <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(max))), f = max / p;
    return (f <= 1 ? 0.2 : f <= 2 ? 0.5 : f <= 5 ? 1 : 2) * p;
}

// modo: 'ordenes' (cantidad de órdenes) | 'volumen' (suma de Magnitud, con la unidad del grupo)
function vBars(svg, d, sectorSel, bindTip, modo = 'ordenes') {
    clear(svg);
    const W = 520, H = 300;
    if (!d.length) { svg.appendChild(txt({ x: W / 2, y: H / 2, 'text-anchor': 'middle', class: 'axis-txt' }, 'Sin órdenes finalizadas en el período')); return; }
    const porVol = modo === 'volumen';
    const val = p => (porVol ? p.metros : p.unidades);
    const umDe = p => (p.um === 'mixta' ? 'unid. mixtas' : p.um || '');
    const lblVal = p => (porVol ? `${nf2(p.metros)} ${umDe(p)}` : nf(p.unidades));
    const m = { t: 16, r: 12, b: 64, l: 54 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const step = niceStep(Math.max(...d.map(val))), max = Math.ceil(Math.max(...d.map(val)) / step) * step || step;
    const gap = iw / d.length, bw = gap * 0.58, y = v => m.t + (1 - v / max) * ih;
    for (let g = 0; g <= max + 1e-9; g += step) {
        svg.appendChild(el('line', { x1: m.l, y1: y(g), x2: W - m.r, y2: y(g), class: 'grid-line' }));
        svg.appendChild(txt({ x: m.l - 8, y: y(g) + 4, 'text-anchor': 'end', class: 'axis-txt' }, nf(Math.round(g))));
    }
    svg.appendChild(el('line', { x1: m.l, y1: y(0), x2: W - m.r, y2: y(0), class: 'baseline' }));
    const focus = !!sectorSel;
    d.forEach((p, i) => {
        const cx = m.l + gap * i + gap / 2, bh = ih - (y(val(p)) - m.t), sel = p.id === sectorSel;
        const fill = focus ? (sel ? COLORS.brand : COLORS.baseline) : COLORS.pal[i % 8];
        svg.appendChild(el('rect', { x: cx - bw / 2, y: y(val(p)), width: bw, height: bh, rx: 4, fill }));
        svg.appendChild(txt({ x: cx, y: y(val(p)) - 7, 'text-anchor': 'middle', class: 'val-txt', opacity: (focus && !sel) ? 0.5 : 1 }, lblVal(p)));
        const short = p.sector.length > 13 ? p.sector.slice(0, 12) + '…' : p.sector;
        svg.appendChild(txt({ x: cx, y: H - 38, 'text-anchor': 'end', class: 'axis-txt', transform: `rotate(-40 ${cx} ${H - 38})`, 'font-weight': sel ? 700 : 400, fill: sel ? COLORS.text : COLORS.muted }, short));
        const hit = el('rect', { x: cx - gap / 2, y: m.t, width: gap, height: ih, fill: 'transparent', class: 'bar-hit' });
        bindTip(hit, `<span class="t-lbl">${p.sector}</span><br><b>${nf(p.unidades)}</b> órdenes finalizadas<br><span class="t-lbl">Volumen:</span> ${nf2(p.metros)} ${umDe(p)}`);
        svg.appendChild(hit);
    });
}

function renderDaily(svg, d, bindTip) {
    clear(svg);
    const W = 1040, H = 300, m = { t: 22, r: 14, b: 34, l: 52 }, iw = W - m.l - m.r, ih = H - m.t - m.b;
    const maxV = Math.max(...d.map(x => x.unidades), 1), step = niceStep(maxV), max = Math.ceil(maxV / step) * step || step;
    const diasConDato = d.filter(x => x.unidades > 0).length || 1;
    const avg = d.reduce((s, x) => s + x.unidades, 0) / diasConDato, gap = iw / d.length, bw = gap * 0.6, y = v => m.t + (1 - v / max) * ih;
    for (let g = 0; g <= max + 1e-9; g += step) {
        svg.appendChild(el('line', { x1: m.l, y1: y(g), x2: W - m.r, y2: y(g), class: 'grid-line' }));
        svg.appendChild(txt({ x: m.l - 8, y: y(g) + 4, 'text-anchor': 'end', class: 'axis-txt' }, nf(Math.round(g))));
    }
    svg.appendChild(el('line', { x1: m.l, y1: y(0), x2: W - m.r, y2: y(0), class: 'baseline' }));
    svg.appendChild(el('line', { x1: m.l, y1: y(avg), x2: W - m.r, y2: y(avg), stroke: COLORS.warning, 'stroke-width': 2, 'stroke-dasharray': '6 5' }));
    svg.appendChild(txt({ x: W - m.r, y: m.t + 2, 'text-anchor': 'end', class: 'val-txt', fill: COLORS.warning }, 'Promedio ' + nf(Math.round(avg)) + ' órdenes/día (días con producción)'));
    let prev = null;
    d.forEach((p, i) => {
        const cx = m.l + gap * i + gap / 2, total = p.unidades, repo = Math.min(p.repo, total), normal = total - repo;
        const cNormal = p.hoy ? COLORS.brand : COLORS.baseline, yNorm = y(normal), yTot = y(total), base0 = y(0);
        svg.appendChild(el('rect', { x: cx - bw / 2, y: yNorm, width: bw, height: Math.max(0, base0 - yNorm), rx: repo > 0 ? 0 : 3, fill: cNormal }));
        if (repo > 0) svg.appendChild(el('rect', { x: cx - bw / 2, y: yTot, width: bw, height: Math.max(1.5, yNorm - yTot), rx: 3, fill: COLORS.critical }));
        if (p.hoy) svg.appendChild(txt({ x: cx, y: yTot - 8, 'text-anchor': 'middle', class: 'val-txt', fill: COLORS.text }, nf(total)));
        if (i % 2 === 0 || p.hoy) svg.appendChild(txt({ x: cx, y: H - 14, 'text-anchor': 'middle', class: 'axis-txt', fill: p.hoy ? COLORS.brand : COLORS.muted, 'font-weight': p.hoy ? 700 : 400 }, p.hoy ? 'Hoy' : p.label));
        const delta = prev !== null ? total - prev : 0, dpct = prev ? ((delta / prev) * 100).toFixed(1) : '0.0';
        const hit = el('rect', { x: cx - gap / 2, y: m.t, width: gap, height: ih, fill: 'transparent', class: 'bar-hit' });
        bindTip(hit, `<span class="t-lbl">${p.hoy ? 'Hoy · ' + p.label : p.label}</span><br><b>${nf(total)}</b> órdenes prontas · ${nf2(p.metros)} de magnitud<br><span class="t-lbl">Normales:</span> ${nf(normal)}<br><span class="t-lbl">Falla / reposición:</span> ${nf(repo)} (${(total ? repo / total * 100 : 0).toFixed(1)}%)${prev !== null ? `<br><span class="t-lbl">vs. día anterior:</span> ${delta >= 0 ? '+' : ''}${nf(delta)} (${dpct}%)` : ''}`);
        svg.appendChild(hit);
        prev = total;
    });
}

// modo: 'ordenes' (cantidad de órdenes prontas) | 'volumen' (suma de Magnitud, deduplicada por orden)
function renderCalidad(svg, k, bindTip, modo = 'ordenes') {
    clear(svg);
    const porVol = modo === 'volumen';
    const prod = porVol ? (k.metros || 0) : (k.prontas || 0);
    const des  = porVol ? (k.conFallaMetros || 0) : (k.conFalla || 0);
    const rep  = porVol ? (k.reposicionesMetros || 0) : (k.reposiciones || 0);
    const conf = Math.max(0, prod - des - rep);
    const um = u => (u === 'mixta' ? 'unid. mixtas' : u || '');
    const rate = prod ? +((des + rep) / prod * 100).toFixed(1) : null, rc = rate == null ? COLORS.muted : rate <= 4 ? COLORS.good : rate <= 7 ? COLORS.warning : COLORS.critical;
    svg.appendChild(txt({ x: 0, y: 40, fill: rc, 'font-size': 40, 'font-weight': 800, 'font-family': 'inherit' }, rate == null ? '—' : rate.toFixed(1) + '%'));
    svg.appendChild(txt({ x: 0, y: 60, fill: COLORS.muted, 'font-size': 12, 'font-family': 'inherit' },
        porVol ? 'volumen con falla + en reposición sobre lo pronto del período' : 'órdenes con falla + reposiciones sobre las prontas del período'));
    const W = 520, by = 80, bh = 28, total = Math.max(1, prod); let x = 0;
    const segs = porVol
        ? [['Conforme', conf, COLORS.good, k.um], ['Reposición', rep, COLORS.warning, k.reposicionesUm], ['Con falla', des, COLORS.critical, k.conFallaUm]]
        : [['Conformes', conf, COLORS.good, ''], ['Reposiciones', rep, COLORS.warning, ''], ['Con falla', des, COLORS.critical, '']];
    segs.forEach(([lab, val, col, u], i) => {
        const w = val / total * W;
        if (w > 0.5) {
            svg.appendChild(el('rect', { x, y: by, width: Math.max(2, w - (i < 2 ? 2 : 0)), height: bh, rx: 4, fill: col }));
            const hit = el('rect', { x, y: by, width: w, height: bh, fill: 'transparent', class: 'bar-hit' });
            bindTip(hit, `<span class="t-lbl">${lab}</span><br><b>${porVol ? nf2(val) + ' ' + um(u) : nf(val) + ' órdenes'}</b> · ${(val / total * 100).toFixed(1)}%`);
            svg.appendChild(hit);
        }
        x += w;
    });
    return segs.map(([lab, val, col]) => ({ lab, val, col, pct: (val / total * 100).toFixed(1) }));
}

// ─── Iconos de las tarjetas (mismos trazos que la maqueta) ───────────────────
const ICONS = {
    check:   <svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></svg>,
    pulse:   <svg viewBox="0 0 24 24"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>,
    layers:  <svg viewBox="0 0 24 24"><path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>,
    clock:   <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
    truck:   <svg viewBox="0 0 24 24"><path d="M1 4h13v9H1z" /><path d="M14 8h4l3 3v2h-7z" /><circle cx="5.5" cy="17.5" r="1.8" /><circle cx="17.5" cy="17.5" r="1.8" /></svg>,
    warn:    <svg viewBox="0 0 24 24"><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4" /><path d="M12 17h.01" /></svg>,
    refresh: <svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-3-6.7" /><path d="M21 3v5h-5" /></svg>,
    box:     <svg viewBox="0 0 24 24"><path d="M21 8 12 3 3 8l9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /></svg>,
    sliders: <svg viewBox="0 0 24 24"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>,
};

function Kpi({ label, icon, bg, color, value, foot, onClick, id }) {
    return (
        <section className={'card kpi' + (onClick ? ' clickable' : '')} onClick={onClick} id={id}>
            <div className="kpi-top"><span className="lbl">{label}</span><span className="kpi-ic" style={{ background: bg, color }}>{icon}</span></div>
            <div className="val">{value}</div>
            <div className="foot">{foot}</div>
        </section>
    );
}

function Delta({ actual, previo, sufijo = '', mejorSiSube = true, etiqueta }) {
    if (actual == null || previo == null) return <span style={{ color: '#98a0ad' }}>sin comparación</span>;
    const d = +(actual - previo).toFixed(1), sube = d >= 0, bien = mejorSiSube ? sube : !sube;
    return <><span className={(bien ? 'up' : 'down') + ' delta'}>{sube ? '▲' : '▼'} {Math.abs(d)}{sufijo}</span> {etiqueta}</>;
}

// =============================================================================
export default function ProduccionPanelSection() {
    // Filtros (mismos que Ventas por Área): fecha + ver por (sector comercial | área productiva)
    const [fechaPreset, setFechaPreset] = useState('hoy');
    const [fechaDesde, setFechaDesde]   = useState('');
    const [fechaHasta, setFechaHasta]   = useState('');
    const [verPor, setVerPor]           = useState('sector');   // 'sector' | 'area'
    const [ambito, setAmbito]           = useState('Todas');    // 'Todas' | 'S:<id>' | 'A:<nombre>'
    const [data, setData]       = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError]     = useState(null);
    const [modal, setModal]     = useState(null); // 'proc' | 'cola' | null
    const [reloj, setReloj]     = useState(new Date());
    const [calidadLeg, setCalidadLeg] = useState([]);
    // Switch global "MEDIR EN": Órdenes (cantidad) | Volumen (suma de Magnitud). Está en la barra de
    // filtros y aplica a los gráficos que el usuario indique (hoy: por sector y top 10 materiales).
    const [medida, setMedida] = useState('ordenes'); // 'ordenes' | 'volumen'
    const topModo = medida, sectorModo = medida;

    // Fallas por tipo: en "Órdenes" cuenta fallas registradas (y % del total); en "Volumen" suma la
    // magnitud de las órdenes distintas afectadas por cada tipo, con su unidad.
    const dibujarFallas = (d, modo, bindTip) => {
        if (!refs.fallas.current) return;
        const lista = d.fallasPorTipo || [];
        const porVol = modo === 'volumen';
        const totF = lista.reduce((s, f) => s + f.cantidad, 0) || 1;
        const totM = lista.reduce((s, f) => s + f.metros, 0) || 1;
        const umDe = f => (f.um === 'mixta' ? 'unid. mixtas' : f.um || '');
        const top8 = porVol ? lista.slice().sort((a, b) => b.metros - a.metros).slice(0, 8) : lista.slice(0, 8);
        refs.fallas.current._bindTip = bindTip;
        hBars(refs.fallas.current, top8, 'tipo', porVol ? 'metros' : 'cantidad', 520, 300, COLORS.s6,
            porVol ? (v, f) => `${nf2(v)} ${umDe(f)}  ·  ${Math.round(v / totM * 100)}%` : v => `${nf(v)}  ·  ${Math.round(v / totF * 100)}%`,
            porVol ? 130 : 96,
            porVol ? f => `${nf(f.cantidad)} fallas en ${nf(f.ordenes)} órdenes` : f => `en ${nf(f.ordenes)} órdenes · ${nf2(f.metros)} ${umDe(f)} afectados`);
    };

    // Redibuja solo los gráficos que dependen de la medida cuando cambia el switch
    useEffect(() => {
        if (!data || !refs.tip.current || !refs.sector.current) return;
        const bindTip = makeTip(refs.tip.current);
        vBars(refs.sector.current, data.porSector, ambito !== 'Todas' ? ambito : '', bindTip, sectorModo);
        dibujarFallas(data, medida, bindTip);
        setCalidadLeg(renderCalidad(refs.calidad.current, data.kpis, bindTip, medida));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [medida]);

    // ── Configuración (drawer "Configurar") ──────────────────────────────────
    const [cfgOpen, setCfgOpen]   = useState(false);
    const [cfg, setCfg]           = useState(null);       // respuesta de GET panel/config
    const [cfgLoading, setCfgLoading] = useState(false);
    const [cfgMsg, setCfgMsg]     = useState(null);       // { tipo: 'ok'|'error', texto }
    const [metaInput, setMetaInput] = useState('');
    const [nuevoTipo, setNuevoTipo] = useState({ areaCode: '', titulo: '' });
    const [tiposPendientes, setTiposPendientes] = useState([]); // [{ areaCode, area, titulo }] a crear al aplicar
    const [timesOpen, setTimesOpen] = useState(false);
    const [guardando, setGuardando] = useState(false);

    const cargarConfig = useCallback(async () => {
        setCfgLoading(true); setCfgMsg(null);
        try {
            const { data: c } = await api.get('/dashboard/produccion/panel/config');
            setCfg(c);
            setMetaInput(String(c.meta));
            setTiposPendientes([]);
            setNuevoTipo(n => ({ areaCode: n.areaCode || (c.areas[0]?.code || ''), titulo: '' }));
        } catch (e) {
            setCfgMsg({ tipo: 'error', texto: 'No se pudo cargar la configuración: ' + (e.response?.data?.message || e.message) });
        } finally { setCfgLoading(false); }
    }, []);

    const abrirConfig = () => { setCfgOpen(true); cargarConfig(); };

    const agregarTipoPendiente = () => {
        const titulo = nuevoTipo.titulo.trim();
        if (!titulo || !nuevoTipo.areaCode) return;
        const area = cfg?.areas.find(a => a.code === nuevoTipo.areaCode)?.nombre || nuevoTipo.areaCode;
        const existe = (cfg?.tiposFalla || []).some(t => t.areaCode === nuevoTipo.areaCode && t.titulo.toLowerCase() === titulo.toLowerCase())
            || tiposPendientes.some(t => t.areaCode === nuevoTipo.areaCode && t.titulo.toLowerCase() === titulo.toLowerCase());
        if (existe) { setCfgMsg({ tipo: 'error', texto: `"${titulo}" ya existe en ${area}.` }); return; }
        setTiposPendientes(l => [...l, { areaCode: nuevoTipo.areaCode, area, titulo }]);
        setNuevoTipo(n => ({ ...n, titulo: '' }));
        setCfgMsg(null);
    };

    const aplicarConfig = async () => {
        if (!cfg) return;
        const meta = Number(String(metaInput).replace(',', '.'));
        if (!(meta > 0 && meta <= 100)) { setCfgMsg({ tipo: 'error', texto: 'La meta de cumplimiento debe ser un porcentaje entre 1 y 100.' }); return; }
        setGuardando(true); setCfgMsg(null);
        const hechos = [];
        try {
            if (meta !== cfg.meta) { await api.put('/dashboard/produccion/panel/config', { meta }); hechos.push(`meta ${meta}%`); }
            for (const t of tiposPendientes) {
                await api.post('/failures/titles', { areaId: t.areaCode, titulo: t.titulo }); // mismo endpoint que el alta de fallas
                hechos.push(`tipo de falla "${t.titulo}" (${t.area})`);
            }
            await fetchPanel();
            if (hechos.length) { setCfgMsg({ tipo: 'ok', texto: 'Guardado: ' + hechos.join(', ') + '.' }); await cargarConfig(); }
            else setCfgMsg({ tipo: 'ok', texto: 'No había cambios para guardar.' });
        } catch (e) {
            setCfgMsg({ tipo: 'error', texto: 'Error al guardar: ' + (e.response?.data?.message || e.response?.data?.error || e.message) + (hechos.length ? ' · ya guardado: ' + hechos.join(', ') : '') });
        } finally { setGuardando(false); }
    };

    const refs = { line: useRef(), gauge: useRef(), daily: useRef(), fallas: useRef(), sector: useRef(), calidad: useRef(), top: useRef(), tip: useRef() };

    // Rango efectivo en 'YYYY-MM-DD' (null si el personalizado está incompleto)
    const rangoEfectivo = (() => {
        if (fechaPreset !== 'custom') { const r = getDateRange(fechaPreset); return { desde: toYMD(r.desde), hasta: toYMD(r.hasta) }; }
        return fechaDesde && fechaHasta && fechaHasta >= fechaDesde ? { desde: fechaDesde, hasta: fechaHasta } : null;
    })();
    const rangoKey = rangoEfectivo ? rangoEfectivo.desde + '|' + rangoEfectivo.hasta : '';

    const fetchPanel = useCallback(async () => {
        if (!rangoKey) return; // personalizado sin las dos fechas: no consulta
        const [desde, hasta] = rangoKey.split('|');
        setLoading(true); setError(null);
        try {
            const params = { desde, hasta, verPor };
            if (ambito.startsWith('S:')) params.sector = ambito.slice(2);
            if (ambito.startsWith('A:')) params.area   = ambito.slice(2);
            const { data: d } = await api.get('/dashboard/produccion/panel', { params });
            setData(d);
        } catch (e) {
            setError(e.response?.data?.message || e.message);
        } finally { setLoading(false); }
    }, [rangoKey, verPor, ambito]);

    useEffect(() => { fetchPanel(); }, [fetchPanel]);

    useEffect(() => { const t = setInterval(() => setReloj(new Date()), 1000); return () => clearInterval(t); }, []);
    useEffect(() => {
        const h = e => { if (e.key === 'Escape') setModal(null); };
        document.addEventListener('keydown', h); return () => document.removeEventListener('keydown', h);
    }, []);

    // Dibujo de los gráficos cada vez que llegan datos
    useEffect(() => {
        if (!data || !refs.tip.current) return;
        const bindTip = makeTip(refs.tip.current);
        const k = data.kpis;
        renderLine(refs.line.current, data.serie, data.meta, bindTip);
        renderRing(refs.gauge.current, k.cumplimiento, data.meta);
        renderDaily(refs.daily.current, data.daily, bindTip);
        dibujarFallas(data, medida, bindTip);
        vBars(refs.sector.current, data.porSector, ambito !== 'Todas' ? ambito : '', bindTip, sectorModo);
        setCalidadLeg(renderCalidad(refs.calidad.current, k, bindTip, medida));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data]);

    // Top 10 materiales: por cantidad de órdenes o por volumen (suma de Magnitud con su unidad).
    // La descripción del material se muestra completa (margen izquierdo ancho, sin cortar).
    useEffect(() => {
        if (!data || !refs.tip.current || !refs.top.current) return;
        refs.top.current._bindTip = makeTip(refs.tip.current);
        const porVolumen = topModo === 'volumen';
        const lista = porVolumen ? (data.topProductosVolumen || []) : (data.topProductos || []);
        const unidad = d => (d.um === 'mixta' ? 'unid. mixtas' : d.um || '');
        hBars(refs.top.current, lista, 'producto', porVolumen ? 'metros' : 'unidades', 1040, 340, COLORS.s1,
            porVolumen ? (v, d) => `${nf2(v)} ${unidad(d)}` : v => nf(v) + ' órdenes', 150,
            porVolumen ? d => `${nf(d.unidades)} órdenes` : d => `${nf2(d.metros)} ${unidad(d)} de magnitud`,
            { l: 380, maxLabel: 60 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, topModo]);

    const k = data?.kpis;
    const presetLbl = FECHA_PRESETS.find(p => p.value === fechaPreset)?.label || '';
    const rangoLbl  = fechaPreset === 'custom'
        ? (rangoEfectivo ? `${fmtDMY(rangoEfectivo.desde)} — ${fmtDMY(rangoEfectivo.hasta)}` : 'elegí las dos fechas')
        : presetLbl;
    const esUnDia   = data?.periodo?.dias === 1;
    const prevLbl   = fechaPreset === 'hoy' ? 'vs. ayer' : esUnDia ? 'vs. día anterior' : 'vs. período previo';
    const turnoActual = reloj.getHours() < (data?.horaCorteTurno ?? 14) ? 'Turno 1' : 'Turno 2';
    const filtrado  = ambito !== 'Todas';
    const ambitoNombre = data?.sector?.nombre || data?.area?.nombre || (verPor === 'sector' ? 'Todos los sectores' : 'Todas las áreas');
    const tasaDefOrdenes = k && k.prontas ? +(((k.conFalla || 0) + (k.reposiciones || 0)) / k.prontas * 100).toFixed(1) : null;
    const tasaDefMetros  = k && k.metros  ? +(((k.conFallaMetros || 0) + (k.reposicionesMetros || 0)) / k.metros * 100).toFixed(1) : null;
    const tasaDef = medida === 'volumen' ? tasaDefMetros : tasaDefOrdenes;
    const umTxt = u => (u === 'mixta' ? 'unid. mixtas' : u || '');
    const umLbl = k?.um === 'mixta' ? 'unid. mixtas (m / m² / u)' : (k?.um || '');
    const maquinas = data?.maquinas || [];
    const mAct = maquinas.filter(m => m.activa).length, mTot = maquinas.length, mUtil = mTot ? Math.round(mAct / mTot * 100) : 0;
    const [fallasTab, setFallasTab] = useState('fallas'); // 'fallas' | 'repos'
    // Filtros de los modales de detalle (texto libre + área + estado/tipo), se limpian al abrir
    const [fTxt, setFTxt] = useState('');
    const [fArea, setFArea] = useState('');
    const [fEstado, setFEstado] = useState('');
    const abrirModal = (kind, tab) => { setFTxt(''); setFArea(''); setFEstado(''); if (tab) setFallasTab(tab); setModal(kind); };
    const cambiarTab = t => { setFallasTab(t); setFTxt(''); setFArea(''); setFEstado(''); };

    // Qué lista muestra cada modal y por qué campos filtra
    const vistaModal = modal === 'fallas' && fallasTab === 'fallas'
        ? { lista: data?.fallasDetalle || [], txt: ['orden', 'trabajo', 'cliente', 'observaciones', 'equipo', 'tipo'], area: 'area', estado: 'tipo', estadoLbl: 'Tipo de falla', unidad: 'fallas' }
        : modal === 'fallas'
        ? { lista: data?.reposiciones || [], txt: ['id', 'trabajo', 'cliente', 'origen'], area: 'area', estado: 'tipo', estadoLbl: 'Tipo', unidad: 'órdenes' }
        : modal === 'transito'
        ? { lista: data?.ordenesTransito || [], txt: ['id', 'trabajo', 'cliente', 'remito', 'origen', 'destino'], area: 'area', estado: 'estadoEnvio', estadoLbl: 'Estado envío', unidad: 'órdenes' }
        : modal === 'deposito'
        ? { lista: data?.ordenesDeposito || [], txt: ['id', 'trabajo', 'cliente', 'remito', 'origen'], area: 'area', estado: 'estado', estadoLbl: 'Estado actual', unidad: 'órdenes' }
        : modal === 'proc'
        ? { lista: data?.ordenesProceso || [], txt: ['id', 'trabajo', 'cliente'], area: 'area', estado: 'estado', estadoLbl: 'Estado', unidad: 'órdenes' }
        : { lista: data?.ordenesCola || [], txt: ['id', 'trabajo', 'cliente'], area: 'area', estado: 'estado', estadoLbl: 'Estado', unidad: 'órdenes' };
    const opcionesDe = key => [...new Set(vistaModal.lista.map(x => x[key]).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'es'));
    const txtNorm = fTxt.trim().toLowerCase();
    const listaModal = vistaModal.lista.filter(x =>
        (!fArea || x[vistaModal.area] === fArea) &&
        (!fEstado || x[vistaModal.estado] === fEstado) &&
        (!txtNorm || vistaModal.txt.some(k => String(x[k] || '').toLowerCase().includes(txtNorm))));
    const totalBase = vistaModal.lista.length;
    const hayFiltro = !!(fArea || fEstado || txtNorm);
    const fmtHora = s => (s ? new Date(s).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
    const TITULOS_MODAL = { proc: 'Órdenes en proceso', cola: 'Órdenes en cola', transito: 'Órdenes en tránsito', fallas: 'Fallas y reposiciones', deposito: 'Órdenes ingresadas a depósito' };
    const DEF_MODAL = {
        proc: ' · órdenes con estado general "Produccion", sin contar las que están en tránsito',
        cola: ' · órdenes activas con estado "Pendiente"',
        transito: ' · estado de área "En transito" · origen, destino y remito del último envío (Logística)',
        deposito: ' · envíos de Logística con destino DEPOSITO recibidos dentro del período (fecha de llegada) · cada orden cuenta una vez',
    };
    const totalModal = listaModal.reduce((s, o) => s + o.metros, 0);
    const haySectores = (data?.sectores || []).length > 0;
    const porSectorUI = verPor === 'sector' && haySectores;

    // Tiempos de entrega del sector / área (badge)
    const entregaPorArea = {};
    for (const e of (data?.entrega || [])) (entregaPorArea[e.area] = entregaPorArea[e.area] || []).push(e);

    return (
        <div className="viz-root">
            <style>{CSS}</style>

            {/* Encabezado + filtros fijos: quedan pegados arriba mientras se desplaza el resto del panel */}
            <div className="viz-sticky">
            <div className="hero">
                <div>
                    <h1>Panel de Producción</h1>
                    <div className="sub">Análisis por sector, área y período · <b>{turnoActual}</b> · {ambitoNombre} · {rangoLbl}</div>
                </div>
                <div className="hero-right">
                    <span className="upd">{data ? 'Actualizado: ' + new Date(data.generadoEn).toLocaleTimeString('es-UY') : '—'}</span>
                    <button className="btn" onClick={abrirConfig} title="Meta de cumplimiento, tipos de falla y tiempos de entrega">{ICONS.sliders}Configurar</button>
                </div>
            </div>

            {/* ── Filtros: mismas filas que "Ventas por Área" (sin moneda ni artículo) + refresh ── */}
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm space-y-2.5 mb-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[11px] font-bold text-slate-500 w-11 shrink-0 tracking-wide">FECHA</span>
                        {FECHA_PRESETS.map(p => (
                            <button key={p.value} onClick={() => setFechaPreset(p.value)}
                                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                    fechaPreset === p.value ? 'bg-brand-cyan text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                }`}>
                                {p.label}
                            </button>
                        ))}
                        {fechaPreset === 'custom' && (
                            <div className="flex items-center gap-2 ml-1">
                                <input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)}
                                    className="text-xs border border-slate-300 rounded-lg px-2 py-1 focus:ring-2 focus:ring-brand-cyan/30 outline-none" />
                                <span className="text-slate-400 text-xs">—</span>
                                <input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)}
                                    className="text-xs border border-slate-300 rounded-lg px-2 py-1 focus:ring-2 focus:ring-brand-cyan/30 outline-none" />
                            </div>
                        )}
                    </div>
                    <button onClick={fetchPanel} disabled={loading || !rangoKey}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 text-xs font-medium rounded-lg transition-all shrink-0"
                        title="Actualizar">
                        <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold text-slate-500 shrink-0 tracking-wide">VER POR</span>
                    {haySectores && (
                        <div className="flex items-center gap-1 bg-slate-100 rounded-full p-0.5 shrink-0">
                            {[{ v: 'sector', l: 'Sectores comerciales' }, { v: 'area', l: 'Áreas productivas' }].map(o => (
                                <button key={o.v}
                                    onClick={() => { setVerPor(o.v); setAmbito('Todas'); }}
                                    title={o.v === 'sector'
                                        ? 'Agrupación comercial: un sector junta varias áreas (CENCO = Corte + Costura)'
                                        : 'Detalle fino por área de producción'}
                                    className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                        verPor === o.v ? 'bg-brand-cyan text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200'}`}>
                                    {o.l}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="h-4 w-px bg-slate-200 shrink-0 hidden sm:block" />
                    <Chip active={ambito === 'Todas'} onClick={() => setAmbito('Todas')}>{porSectorUI ? 'Todos' : 'Todas'}</Chip>
                    {porSectorUI
                        ? (data?.sectores || []).map(s => (
                            <Chip key={s.id} active={ambito === `S:${s.id}`} onClick={() => setAmbito(`S:${s.id}`)}
                                title={s.areas?.length ? `Agrupa: ${s.areas.join(' + ')}` : 'Sin áreas asignadas'}>{s.nombre}</Chip>
                        ))
                        : (data?.areas || []).map(a => (
                            <Chip key={a.nombre} active={ambito === `A:${a.nombre}`} onClick={() => setAmbito(`A:${a.nombre}`)}>{a.nombre}</Chip>
                        ))}
                    {(data?.sector || data?.area) && Object.keys(entregaPorArea).length > 0 && (
                        <span className="entrega" style={{ marginLeft: 'auto' }}>⏱ Entrega —
                            {Object.entries(entregaPorArea).map(([area, lst]) => (
                                <span key={area}>{Object.keys(entregaPorArea).length > 1 ? <b>{area}: </b> : null}
                                    {lst.map((e, i) => <span key={i}>{i > 0 ? ' · ' : ''}<b style={e.prioridad === 'Urgente' ? { color: '#f97316' } : undefined}>{e.prioridad} {e.texto}</b></span>)}
                                </span>
                            ))}
                        </span>
                    )}
                </div>

                {/* Fila MEDIR EN: Órdenes (cantidad) | Volumen (suma de Magnitud). Aplica a "por sector" y al top 10 de materiales. */}
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[11px] font-bold text-slate-500 shrink-0 tracking-wide">MEDIR EN</span>
                    <div className="flex items-center gap-1 bg-slate-100 rounded-full p-0.5 shrink-0">
                        {[{ v: 'ordenes', l: 'Órdenes' }, { v: 'volumen', l: 'Volumen' }].map(o => (
                            <button key={o.v} onClick={() => setMedida(o.v)}
                                title={o.v === 'ordenes' ? 'Cantidad de órdenes' : 'Suma de la magnitud de las órdenes (metros / m² / unidades según el material)'}
                                className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${
                                    medida === o.v ? 'bg-brand-cyan text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200'}`}>
                                {o.l}
                            </button>
                        ))}
                    </div>
                    <span className="text-[11px] text-slate-400">aplica a "Cantidades de producción por sector", "Fallas por tipo", "Tasa de defectos / reposición" y "Top 10 materiales"{medida === 'volumen' ? ' · con varios sectores las unidades (m, m², u) no son comparables entre sí' : ''}</span>
                </div>
            </div>
            </div>

            {error && <div className="card" style={{ marginBottom: 14, color: '#b91c1c', fontSize: 13 }}>Error al cargar el panel: {error}</div>}
            {fechaPreset === 'custom' && !rangoKey && <div className="card" style={{ marginBottom: 14, color: '#5b6472', fontSize: 13 }}>Elegí la fecha desde y la fecha hasta para consultar el período personalizado.</div>}

            <div className="grid">
                <Kpi label="Cumplimiento de preparación" icon={ICONS.check} bg="#e6f6ec" color="#16a34a"
                    value={k && k.cumplimiento != null ? <>{k.cumplimiento.toFixed(1)}<small>%</small></> : '—'}
                    foot={k ? <><Delta actual={k.cumplimiento} previo={k.cumplimientoPrev} sufijo=" pts" etiqueta={prevLbl} /> · meta {data.meta}% · {nf(k.prontasConFecha)} prontas con fecha</> : ''} />
                <Kpi label="Órdenes en proceso" icon={ICONS.pulse} bg="#e8f0fe" color="#3b82f6" onClick={() => abrirModal('proc')}
                    value={k ? nf(k.enProceso) : '—'}
                    foot={k ? <><b style={{ color: '#5b6472' }}>{nf2(k.metrosProceso)} de magnitud</b> · <span className="link">ver detalle ›</span></> : ''} />
                <Kpi label="Órdenes en cola" icon={ICONS.layers} bg="#efeafd" color="#8b5cf6" onClick={() => abrirModal('cola')}
                    value={k ? nf(k.enCola) : '—'}
                    foot={k ? <><b style={{ color: '#5b6472' }}>{nf2(k.metrosCola)} de magnitud</b> · <span className="link">ver detalle ›</span></> : ''} />
                <Kpi label="Tiempo de inactividad" icon={ICONS.clock} bg="#fdf0e0" color="#f59e0b"
                    value="—" foot="Sin fuente de datos todavía" />
                <Kpi label="Órdenes en tránsito" icon={ICONS.truck} bg="#e4f6f4" color="#14b8a6" onClick={() => abrirModal('transito')}
                    value={k ? nf(k.enTransito) : '—'}
                    foot={k ? <><b style={{ color: '#5b6472' }}>{nf2(k.metrosTransito)} de magnitud</b> · <span className="link">ver detalle ›</span></> : ''} />
                <Kpi label="Fallas reportadas" icon={ICONS.warn} bg="#fdeaea" color="#ef4444"
                    value={k ? nf(k.fallas) : '—'}
                    onClick={() => abrirModal('fallas', 'fallas')}
                    foot={k ? <><Delta actual={k.fallas} previo={k.fallasPrev} mejorSiSube={false} etiqueta={`${prevLbl} (${nf(k.fallasPrev)})`} /> · en {nf(k.fallasOrdenes)} órdenes · <span className="link">ver detalle ›</span></> : ''} />
                <Kpi label="Tasa de defectos / reposición" icon={ICONS.refresh} bg="#fdeaf3" color="#ec4899"
                    value={tasaDef != null ? <>{tasaDef.toFixed(1)}<small>%</small></> : '—'}
                    foot={k ? (medida === 'volumen'
                        ? `${nf2(k.conFallaMetros)} ${umTxt(k.conFallaUm)} con falla · ${nf2(k.reposicionesMetros)} ${umTxt(k.reposicionesUm)} en reposiciones · de ${nf2(k.metros)} ${umTxt(k.um)} prontos`
                        : `${nf(k.conFalla)} con falla reportada · ${nf(k.reposiciones)} reposiciones prontas · de ${nf(k.prontas)} prontas`) : ''} />
                <Kpi label={fechaPreset === 'hoy' ? 'Ingresado a depósito hoy' : 'Ingresado a depósito (' + rangoLbl.toLowerCase() + ')'} icon={ICONS.box} bg="#e8f0fe" color="#3b82f6"
                    onClick={() => abrirModal('deposito')}
                    value={k ? <>{nf(k.deposito)}<small> órdenes</small></> : '—'}
                    foot={k ? <><Delta actual={k.deposito} previo={k.depositoPrev} etiqueta={`${prevLbl} (${nf(k.depositoPrev)})`} /> · {nf2(k.depositoMetros)} {k.depositoUm === 'mixta' ? 'unid. mixtas' : k.depositoUm} · <span className="link">ver detalle ›</span></> : ''} />

                <section className="card col-cumpl">
                    <h2>Cumplimiento de tiempos de preparación</h2>
                    <div className="hint">{data?.serie?.modo === 'hora' ? '% de órdenes prontas antes de su fecha prometida, por hora del día' : '% de órdenes prontas antes de su fecha prometida, por día · ' + rangoLbl.toLowerCase()} · fecha prometida = compromiso de Bordado del portal, o la fecha estimada de entrega para el resto</div>
                    <svg ref={refs.line} className="chart" viewBox="0 0 720 260" preserveAspectRatio="none"></svg>
                    <div className="legend">
                        <span><span className="swatch" style={{ background: COLORS.s1 }}></span>Cumplimiento</span>
                        <span><span className="dash"></span>Meta (<b>{data?.meta ?? 90}</b>%)</span>
                    </div>
                </section>

                <section className="card col-gauge">
                    <h2>Cumplimiento general</h2>
                    <div className="hint">Promedio del período vs. meta · {ambitoNombre}</div>
                    <svg ref={refs.gauge} className="chart gauge" viewBox="0 0 200 200"></svg>
                </section>

                <section className="card col-top">
                    <h2>Producción diaria — variación (últimos 14 días)</h2>
                    <div className="hint">Órdenes marcadas "Pronto" por día, separando las que son falla o reposición · la barra de hoy se resalta · respeta el sector/área elegido, no la fecha</div>
                    <svg ref={refs.daily} className="chart" viewBox="0 0 1040 300"></svg>
                    <div className="legend">
                        <span><span className="swatch" style={{ background: COLORS.baseline }}></span>Producción normal</span>
                        <span><span className="swatch" style={{ background: COLORS.brand }}></span>Hoy</span>
                        <span><span className="swatch" style={{ background: COLORS.critical }}></span>Falla / reposición</span>
                    </div>
                </section>

                <section className="card col-fallas">
                    <h2>Fallas reportadas por tipo · {medida === 'volumen' ? 'volumen afectado' : 'cantidad de fallas'}</h2>
                    <div className="hint">
                        {medida === 'volumen'
                            ? 'Suma de la magnitud (m / m² / u) de las órdenes distintas con cada tipo de falla en el período, y % del total afectado · las de mayor volumen primero'
                            : 'Cantidad de fallas registradas en el período y % del total · las más habituales primero'}
                        {' · se cuentan sobre la orden original, no sobre la reposición que generan'}
                    </div>
                    <svg ref={refs.fallas} className="chart" viewBox="0 0 520 300"></svg>
                </section>

                <section className="card col-sector">
                    <h2>{filtrado ? 'Máquinas · ' + ambitoNombre : 'Máquinas — todos los sectores'}</h2>
                    <div className="hint">Equipos configurados: activa = con órdenes en máquina o con proceso en curso · inactiva muestra el motivo</div>
                    {mTot === 0 ? <div className="empty">Sin equipos configurados para esta selección</div> : (
                        <>
                            <div className="maq-sum">
                                <div className="maq-stat"><span className="n">{mTot}</span><span className="l">máquinas</span></div>
                                <div className="maq-stat"><span className="n" style={{ color: COLORS.good }}>{mAct}</span><span className="l">activas</span></div>
                                <div className="maq-stat"><span className="n" style={{ color: COLORS.critical }}>{mTot - mAct}</span><span className="l">inactivas</span></div>
                                <div className="maq-util"><div className="ubar"><i style={{ width: mUtil + '%' }}></i></div><span>{mUtil}% en uso</span></div>
                            </div>
                            <div className="maq-list">
                                {maquinas.slice().sort((a, b) => (a.activa === b.activa) ? 0 : (a.activa ? 1 : -1)).map(m => (
                                    <div className="maq-row" key={m.id}>
                                        <span className="dot" style={{ background: m.activa ? COLORS.good : COLORS.critical }}></span>
                                        <span className="nm">{m.n}</span>
                                        {!data?.area && <span className="sec">· {m.area}</span>}
                                        <span className="right">
                                            {m.ordenesEnMaquina > 0 && <span className="oc">{nf(m.ordenesEnMaquina)} en máquina</span>}
                                            {m.activa
                                                ? <span className="st on">{m.proceso && !/^detenid/i.test(m.proceso) ? m.proceso : 'Activa'}</span>
                                                : <><span className="rz">{m.motivo || 'Inactiva'}</span><span className="st off">Inactiva</span></>}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </section>

                <section className="card col-fallas">
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div>
                            <h2>{verPor === 'area' ? 'Cantidades de producción por área' : 'Cantidades de producción por sector'}</h2>
                            <div className="hint">
                                {sectorModo === 'volumen' ? 'Suma de la magnitud (metros, m² o unidades)' : 'Cantidad'} de órdenes en estado "Finalizado" prontas en el período, {verPor === 'area' ? 'por área productiva' : 'por sector comercial'} · la selección se resalta
                            </div>
                        </div>
                    </div>
                    <svg ref={refs.sector} className="chart" viewBox="0 0 520 300"></svg>
                </section>

                <section className="card col-sector">
                    <h2>Tasa de defectos / reposición · {medida === 'volumen' ? 'volumen' : 'órdenes'}</h2>
                    <div className="hint">
                        {medida === 'volumen'
                            ? 'Volumen (metros, m² o unidades) con falla reportada más el de las reposiciones prontas, sobre el volumen total pronto del período'
                            : 'Órdenes con falla reportada (fallas de producción) más órdenes de reposición prontas, sobre las prontas del período'}
                    </div>
                    <svg ref={refs.calidad} className="chart" viewBox="0 0 520 118"></svg>
                    <div className="legend">
                        {calidadLeg.map(s => <span key={s.lab}><span className="swatch" style={{ background: s.col }}></span>{s.lab} <b style={{ color: COLORS.text }}>{s.pct}%</b></span>)}
                    </div>
                </section>

                <section className="card col-top">
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                        <div>
                            <h2>Top 10 materiales más producidos</h2>
                            <div className="hint">
                                {topModo === 'volumen'
                                    ? 'Suma de la magnitud (metros, m² o unidades según el material) de las órdenes en estado "Finalizado" prontas en el período' + (filtrado ? ' · ' + ambitoNombre : ' · ranking global') + ' · con "Todos los sectores" las unidades no son comparables entre sí'
                                    : 'Cantidad de órdenes en estado "Finalizado" prontas en el período, por material' + (filtrado ? ' · ' + ambitoNombre : ' · ranking global')}
                            </div>
                        </div>
                    </div>
                    <svg ref={refs.top} className="chart" viewBox="0 0 1040 340"></svg>
                </section>
            </div>

            <div className="foot-note">Datos reales de producción · Turno 1 = antes de las {data?.horaCorteTurno ?? 14} h, Turno 2 = desde las {data?.horaCorteTurno ?? 14} h · "Tiempo de inactividad" todavía no tiene fuente de datos</div>

            <div ref={refs.tip} className="viz-tip"></div>

            {cfgOpen && (
                <div className="viz-drawer">
                    <div className="drawer-ov" onClick={() => setCfgOpen(false)}></div>
                    <aside className="drawer-panel">
                        <div className="drawer-head">
                            <div><h3>Configuración de parámetros</h3><div className="drawer-sub">Meta de cumplimiento · tipos de falla por área · tiempos de entrega</div></div>
                            <button className="modal-close" onClick={() => setCfgOpen(false)}>✕</button>
                        </div>
                        <div className="drawer-body">
                            {cfgLoading && !cfg ? <div style={{ color: '#98a0ad', fontSize: 13 }}>Cargando configuración…</div> : cfg && (
                                <>
                                    <div className="cfg-sec">
                                        <div className="cfg-t">Meta de cumplimiento</div>
                                        <div className="cfg-hint">% objetivo de órdenes prontas antes de su fecha prometida (compromiso de Bordado del portal, o la fecha estimada de entrega para el resto). Se usa en el gráfico de cumplimiento y en el gauge. Se guarda en ConfiguracionGlobal (clave {cfg.clave}); si no está, vale {cfg.metaDefault}%.</div>
                                        <div className="cfg-row"><input type="number" min="1" max="100" step="0.5" className="cfg-num" value={metaInput} onChange={e => setMetaInput(e.target.value)} /><span style={{ fontSize: 13, color: '#5b6472' }}>% · actual: <b>{cfg.meta}%</b></span></div>
                                    </div>

                                    <div className="cfg-sec">
                                        <div className="cfg-t">Tipos de falla por área</div>
                                        <div className="cfg-hint">Catálogo que se ofrece al reportar una falla y que agrupa el panel "Fallas por tipo". Acá se pueden AGREGAR tipos (los existentes no se editan desde este panel).</div>
                                        {Object.entries((cfg.tiposFalla || []).reduce((acc, t) => { (acc[t.area] = acc[t.area] || []).push(t); return acc; }, {})).map(([area, lst]) => (
                                            <div className="cfg-srow" key={area}>
                                                <span className="cfg-sname">{area}</span>
                                                <span className="cfg-tchips">
                                                    {lst.map(t => <span key={t.id} className={'cfg-tchip' + (t.frecuente ? ' on' : '')} title={t.frecuente ? 'Marcado como frecuente' : ''}>{t.titulo}</span>)}
                                                    {tiposPendientes.filter(p => p.area === area).map((p, i) => <span key={'p' + i} className="cfg-tchip new" title="Se crea al aplicar">{p.titulo} ✦</span>)}
                                                </span>
                                            </div>
                                        ))}
                                        {tiposPendientes.filter(p => !(cfg.tiposFalla || []).some(t => t.area === p.area)).map((p, i) => (
                                            <div className="cfg-srow" key={'np' + i}><span className="cfg-sname">{p.area}</span><span className="cfg-tchips"><span className="cfg-tchip new">{p.titulo} ✦</span></span></div>
                                        ))}
                                        <div className="cfg-row" style={{ marginTop: 10 }}>
                                            <select className="cfg-sel" value={nuevoTipo.areaCode} onChange={e => setNuevoTipo(n => ({ ...n, areaCode: e.target.value }))}>
                                                {cfg.areas.map(a => <option key={a.code} value={a.code}>{a.nombre}</option>)}
                                                <option value="General">General</option>
                                            </select>
                                            <input className="cfg-in" placeholder="Nuevo tipo de falla" value={nuevoTipo.titulo}
                                                onChange={e => setNuevoTipo(n => ({ ...n, titulo: e.target.value }))}
                                                onKeyDown={e => { if (e.key === 'Enter') agregarTipoPendiente(); }} />
                                            <button className="cfg-add" onClick={agregarTipoPendiente} disabled={!nuevoTipo.titulo.trim()}>+ Agregar</button>
                                        </div>
                                        {tiposPendientes.length > 0 && <div className="cfg-hint" style={{ marginTop: 6 }}>{tiposPendientes.length} tipo(s) nuevo(s) se crean al tocar "Aplicar cambios". <button className="cfg-del" style={{ width: 'auto', padding: '0 8px', fontSize: 11 }} onClick={() => setTiposPendientes([])}>quitar</button></div>}
                                    </div>

                                    <div className="cfg-sec">
                                        <div className="cfg-t">Tiempos de entrega por área</div>
                                        <div className="cfg-hint">Horas/días objetivo por prioridad (tabla ConfiguracionTiemposEntrega, la misma que ve el portal del cliente). Se editan con el mismo modal de Configuración.</div>
                                        {Object.entries((cfg.entrega || []).reduce((acc, t) => { (acc[t.area] = acc[t.area] || []).push(t); return acc; }, {})).map(([area, lst]) => (
                                            <div className="cfg-erow" key={area}>
                                                <span className="cfg-sname">{area}</span>
                                                <div className="cfg-egrp">
                                                    {lst.map(t => <span key={t.id}><span className={'edot ' + (t.prioridad === 'Urgente' ? 'u' : 'n')}></span>{t.prioridad} <b>{t.resumen}</b></span>)}
                                                </div>
                                            </div>
                                        ))}
                                        {(cfg.entrega || []).length === 0 && <div className="cfg-hint">Sin tiempos configurados.</div>}
                                        <button className="cfg-add" style={{ marginTop: 8 }} onClick={() => setTimesOpen(true)}>Editar tiempos de entrega…</button>
                                    </div>
                                </>
                            )}
                        </div>
                        <div className="drawer-foot">
                            {cfgMsg && <span className="cfg-msg" style={{ color: cfgMsg.tipo === 'ok' ? '#16a34a' : '#b91c1c' }}>{cfgMsg.texto}</span>}
                            <button className="btn-ghost" onClick={cargarConfig} disabled={cfgLoading || guardando} title="Vuelve a leer la configuración guardada y descarta lo no aplicado">Restablecer</button>
                            <button className="btn-primary" onClick={aplicarConfig} disabled={!cfg || guardando}>{guardando ? 'Guardando…' : 'Aplicar cambios'}</button>
                        </div>
                    </aside>
                </div>
            )}
            {timesOpen && <ConfigDeliveryTimesModal isOpen={true} onClose={() => { setTimesOpen(false); cargarConfig(); fetchPanel(); }} />}

            {modal && (
                <div className="viz-modal" onClick={e => { if (e.target === e.currentTarget) setModal(null); }}>
                    <div className="modal-card">
                        <div className="modal-head"><h3>{TITULOS_MODAL[modal]} · {ambitoNombre}</h3><button className="modal-close" onClick={() => setModal(null)}>✕</button></div>

                        {modal === 'fallas' && (
                            <div style={{ padding: '0 20px 10px' }}>
                                <div className="flex items-center gap-1 bg-slate-100 rounded-full p-0.5" style={{ display: 'inline-flex' }}>
                                    {[{ v: 'fallas', l: `Fallas reportadas (${nf((data?.fallasDetalle || []).length)})` }, { v: 'repos', l: `Reposiciones (${nf((data?.reposiciones || []).length)})` }].map(o => (
                                        <button key={o.v} onClick={() => cambiarTab(o.v)}
                                            className={`px-3 py-1 rounded-full text-xs font-medium transition-all ${fallasTab === o.v ? 'bg-brand-cyan text-white shadow-sm' : 'text-slate-600 hover:bg-slate-200'}`}>
                                            {o.l}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="modal-sub">
                            <b>{nf(listaModal.length)}</b>{hayFiltro ? <> de {nf(totalBase)}</> : null} {vistaModal.unidad}
                            {modal !== 'fallas' && <> · <b>{nf2(totalModal)}</b> de magnitud</>}
                            {totalBase === 0 ? ' — sin datos para la selección actual' : ''}
                            {modal === 'fallas'
                                ? (fallasTab === 'fallas'
                                    ? ' · fallas registradas en producción dentro del período (fecha de la falla)'
                                    : ' · órdenes de reposición (-R#) y de falla (-F#####) ingresadas dentro del período')
                                : DEF_MODAL[modal]}
                        </div>

                        {/* Filtros del detalle: texto libre, área y estado/tipo (se aplican sobre la lista ya cargada) */}
                        <div className="flex items-center gap-2 flex-wrap" style={{ padding: '0 20px 12px' }}>
                            <input value={fTxt} onChange={e => setFTxt(e.target.value)} placeholder="Buscar orden, trabajo, cliente…"
                                className="text-xs border border-slate-300 rounded-lg px-2 py-1 focus:ring-2 focus:ring-brand-cyan/30 outline-none" style={{ minWidth: 240 }} />
                            <select value={fArea} onChange={e => setFArea(e.target.value)} className="text-xs border border-slate-300 rounded-lg px-2 py-1 outline-none bg-white">
                                <option value="">Área: todas</option>
                                {opcionesDe(vistaModal.area).map(a => <option key={a} value={a}>{a}</option>)}
                            </select>
                            <select value={fEstado} onChange={e => setFEstado(e.target.value)} className="text-xs border border-slate-300 rounded-lg px-2 py-1 outline-none bg-white">
                                <option value="">{vistaModal.estadoLbl}: todos</option>
                                {opcionesDe(vistaModal.estado).map(a => <option key={a} value={a}>{a}</option>)}
                            </select>
                            {hayFiltro && <button onClick={() => { setFTxt(''); setFArea(''); setFEstado(''); }} className="text-xs text-red-500 hover:text-red-700 font-bold">✕ limpiar filtros</button>}
                        </div>

                        <div className="modal-body">
                            <table className="ord">
                                {modal === 'fallas' && fallasTab === 'fallas' ? (
                                    <>
                                        <thead><tr><th>Fecha</th><th>N° orden</th><th>Trabajo</th><th>Área</th><th>Tipo de falla</th><th>Máquina</th><th>Observaciones</th><th style={{ textAlign: 'right' }}>Cant.</th></tr></thead>
                                        <tbody>
                                            {listaModal.map(f => (
                                                <tr key={f.id}>
                                                    <td style={{ whiteSpace: 'nowrap' }}>{fmtHora(f.fecha)}</td>
                                                    <td>{f.orden || '—'}{f.estadoOrden && <><br /><span className="cli">{f.estadoOrden}</span></>}</td>
                                                    <td>{f.trabajo || '—'}<br /><span className="cli">{f.cliente}</span></td>
                                                    <td>{f.area}</td>
                                                    <td><span className="estado-tag">{f.tipo}</span></td>
                                                    <td>{f.equipo || <span className="cli">—</span>}</td>
                                                    <td style={{ maxWidth: 260 }}>{f.observaciones || <span className="cli">—</span>}{f.imagen && <><br /><span className="cli">con foto</span></>}</td>
                                                    <td className="num">{f.copias ? `${nf(f.copias)} copias` : f.cantidad ? nf2(f.cantidad) : '—'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </>
                                ) : modal === 'fallas' ? (
                                    <>
                                        <thead><tr><th>Ingreso</th><th>N° orden</th><th>Tipo</th><th>Orden original</th><th>Trabajo</th><th>Área</th><th>Estado</th><th style={{ textAlign: 'right' }}>Magnitud</th></tr></thead>
                                        <tbody>
                                            {listaModal.map(o => (
                                                <tr key={o.ordenId}>
                                                    <td style={{ whiteSpace: 'nowrap' }}>{fmtHora(o.ingreso)}</td>
                                                    <td><b>{o.id}</b></td>
                                                    <td><span className="estado-tag" style={o.tipo === 'Falla' ? { color: '#b91c1c', background: '#fdeaea' } : undefined}>{o.tipo}</span></td>
                                                    <td>{o.origen && o.origen !== o.id ? o.origen : <span className="cli">—</span>}</td>
                                                    <td>{o.trabajo || '—'}<br /><span className="cli">{o.cliente}</span></td>
                                                    <td>{o.area}</td>
                                                    <td><span className="estado-tag">{o.estado}</span>{o.estadoGeneral && o.estadoGeneral !== o.estado && <><br /><span className="cli">{o.estadoGeneral}</span></>}</td>
                                                    <td className="num">{nf2(o.metros)} {o.um}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </>
                                ) : modal === 'deposito' ? (
                                    <>
                                        <thead><tr><th>Llegada</th><th>N° orden</th><th>Trabajo</th><th>Área</th><th>Origen</th><th>Remito</th><th>Estado actual</th><th style={{ textAlign: 'right' }}>Magnitud</th></tr></thead>
                                        <tbody>
                                            {listaModal.map(o => (
                                                <tr key={o.ordenId}>
                                                    <td style={{ whiteSpace: 'nowrap' }}>{fmtHora(o.llegada)}</td>
                                                    <td>{o.id}</td>
                                                    <td>{o.trabajo || '—'}<br /><span className="cli">{o.cliente}</span></td>
                                                    <td>{o.area}</td>
                                                    <td>{o.origen}</td>
                                                    <td>{o.remito ? <b>{o.remito}</b> : <span className="cli">—</span>}</td>
                                                    <td><span className="estado-tag">{o.estado}</span>{o.estadoGeneral && o.estadoGeneral !== o.estado && <><br /><span className="cli">{o.estadoGeneral}</span></>}</td>
                                                    <td className="num">{nf2(o.metros)} {o.um}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </>
                                ) : modal === 'transito' ? (
                                    <>
                                        <thead><tr><th>N° orden</th><th>Trabajo</th><th>Origen</th><th>Destino</th><th>Remito</th><th>Estado envío</th><th>Salida</th><th style={{ textAlign: 'right' }}>Magnitud</th></tr></thead>
                                        <tbody>
                                            {listaModal.map(o => (
                                                <tr key={o.ordenId}>
                                                    <td>{o.id}</td>
                                                    <td>{o.trabajo || '—'}<br /><span className="cli">{o.cliente}</span></td>
                                                    <td>{o.origen}</td>
                                                    <td>{o.destino}</td>
                                                    <td>{o.remito ? <b>{o.remito}</b> : <span className="cli">sin remito</span>}{o.bulto && <><br /><span className="cli">bulto {o.bulto}</span></>}</td>
                                                    <td><span className="estado-tag">{o.estadoEnvio || '—'}</span></td>
                                                    <td>{fmtHora(o.salida)}</td>
                                                    <td className="num">{nf2(o.metros)} {o.um}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </>
                                ) : (
                                    <>
                                        <thead><tr><th>N° orden</th><th>Trabajo</th><th>Área</th><th>Estado</th><th style={{ textAlign: 'right' }}>Magnitud</th></tr></thead>
                                        <tbody>
                                            {listaModal.map(o => (
                                                <tr key={o.ordenId}>
                                                    <td>{o.id}</td>
                                                    <td>{o.trabajo || '—'}<br /><span className="cli">{o.cliente}</span></td>
                                                    <td>{o.area}</td>
                                                    <td><span className="estado-tag">{o.estado}</span></td>
                                                    <td className="num">{nf2(o.metros)} {o.um}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </>
                                )}
                            </table>
                            {listaModal.length === 0 && totalBase > 0 && <div className="empty" style={{ fontSize: 12, color: '#98a0ad', padding: '24px 0', textAlign: 'center' }}>Ningún registro coincide con los filtros.</div>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
