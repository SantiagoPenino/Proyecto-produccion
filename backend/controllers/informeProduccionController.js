const path     = require('path');
const fs       = require('fs');
const puppeteer = require('puppeteer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger   = require('../utils/logger');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// ─── Helpers de formato ───────────────────────────────────────────────────────
const fmt  = n => (n == null ? '—' : Number(n).toLocaleString('es-AR'));
const fmtM = n => {
    const v = parseFloat(n) || 0;
    return v >= 1000 ? (v / 1000).toFixed(1).replace('.', ',') + ' km' : v.toFixed(1).replace('.', ',') + ' m';
};
const fmtH = h => {
    const v = parseFloat(h) || 0;
    if (v < 1)  return `${Math.round(v * 60)}m`;
    if (v < 24) return `${v.toFixed(1)}h`;
    return `${(v / 24).toFixed(1)}d`;
};
const semaforo = (v, warn, bad) =>
    v >= bad ? '#ef4444' : v >= warn ? '#f59e0b' : '#10b981';

// ─── Generar análisis con Gemini ──────────────────────────────────────────────
async function generarAnalisis(datos) {
    const model  = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const { kpis, fallaReposicion, demoraPorPrioridad, topOperadores,
            topMateriales, topClientes, distribucionTurno, tendencia, periodo } = datos;

    const pctFalla = kpis.metros > 0
        ? Math.round((fallaReposicion.metros / kpis.metros) * 100) : 0;

    const demora = (demoraPorPrioridad || []).map(d =>
        `${d.prioridad}: prom ${fmtH(d.promedioHoras)} / mediana ${fmtH(d.medianaHoras)} (${d.totalOrdenes} órd.)`
    ).join('\n');

    const operadores = (topOperadores || []).slice(0, 5).map((o, i) =>
        `${i+1}. ${o.Usuario}: ${fmt(o.totalOrdenes)} órdenes`
    ).join('\n');

    const materiales = (topMateriales || []).slice(0, 5).map((m, i) =>
        `${i+1}. ${m.material}: ${fmt(m.totalOrdenes)} órd. — ${fmtM(m.totalMetros)}`
    ).join('\n');

    const turnos = (distribucionTurno || []).map(t =>
        `${t.turno}: ${fmt(t.totalOrdenes)} órd. (${fmtM(t.totalMetros)})`
    ).join(' | ');

    const prompt = `
Eres un analista industrial de producción textil. Redactá un informe ejecutivo profesional en español rioplatense (vos/ustedes) para la gerencia, basado en los siguientes datos reales del período ${periodo}.

DATOS DEL PERÍODO:
- Órdenes ingresadas: ${fmt(kpis.insertadas)}
- Órdenes cerradas: ${fmt(kpis.completadas)}
- Eficiencia: ${kpis.eficiencia}% (completadas/ingresadas)
- Metros procesados: ${fmtM(kpis.metros)}
- Flujo neto (entradas − salidas): ${fmt(kpis.insertadas - kpis.completadas)} órdenes acumuladas

FALLA Y REPOSICIÓN:
- Metros de falla/reposición: ${fmtM(fallaReposicion.metros)} (${pctFalla}% del total)
- Órdenes afectadas: ${fmt(fallaReposicion.ordenes)}

DEMORA PROMEDIO (tiempo efectivo, descontando 12h no laborables/día):
${demora}

TOP OPERADORES:
${operadores}

TOP MATERIALES:
${materiales}

DISTRIBUCIÓN POR TURNO:
${turnos}

INSTRUCCIONES DE REDACCIÓN:
1. Comenzá con un RESUMEN EJECUTIVO de 3-4 oraciones que resuma el estado general de la producción.
2. Escribí una sección "ANÁLISIS DE EFICIENCIA" interpretando los KPIs.
3. Escribí "ANÁLISIS DE CALIDAD" sobre fallas y reposiciones — si supera el 8% es preocupante.
4. Escribí "TIEMPOS DE RESPUESTA" analizando las demoras por prioridad — si Urgente supera 8h efectivas es una alerta.
5. Escribí "DESEMPEÑO OPERATIVO" mencionando los operadores destacados y materiales más demandados.
6. Cerrá con "RECOMENDACIONES" — máximo 4 puntos concretos y accionables.

Usá un tono profesional pero directo. No uses markdown (no uses ** ni #). Usá MAYÚSCULAS para los títulos de sección. Sé conciso pero valorativo.`;

    const result = await model.generateContent(prompt);
    return result.response.text();
}

// ─── Construir HTML del informe ───────────────────────────────────────────────
function buildHTML(datos, analisis) {
    const { kpis, fallaReposicion, demoraPorPrioridad, topOperadores,
            topMateriales, distribucionTurno, periodo } = datos;

    const pctFalla   = kpis.metros > 0
        ? Math.round((fallaReposicion.metros / kpis.metros) * 100) : 0;
    const pctFallaN  = kpis.insertadas > 0
        ? Math.round((fallaReposicion.ordenes / kpis.insertadas) * 100) : 0;
    const flujo      = (kpis.insertadas || 0) - (kpis.completadas || 0);

    const logoPath   = path.join(__dirname, '../../src/assets/images/logo/logo.webp');
    const logoB64    = fs.existsSync(logoPath)
        ? `data:image/webp;base64,${fs.readFileSync(logoPath).toString('base64')}`
        : '';

    const colFalla   = semaforo(pctFalla, 8, 15);
    const colEfic    = kpis.eficiencia >= 80 ? '#10b981' : kpis.eficiencia >= 50 ? '#f59e0b' : '#ef4444';

    const now = new Date().toLocaleDateString('es-AR', {
        day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    // Parsear secciones del análisis
    const seccionesHTML = analisis
        .split('\n')
        .map(l => l.trim())
        .filter(l => l.length > 0)
        .map(l => {
            if (l === l.toUpperCase() && l.length > 4 && !l.includes(':') === false)
                return `<h3 class="section-title">${l}</h3>`;
            if (l.match(/^\d+\./))
                return `<p class="rec-item">${l}</p>`;
            return `<p>${l}</p>`;
        })
        .join('\n');

    const demRows = (demoraPorPrioridad || []).map(d => {
        const color = d.prioridad === 'Falla' ? '#ef4444'
            : d.prioridad === 'Urgente' ? '#f97316'
            : d.prioridad === 'Reposición' ? '#8b5cf6' : '#64748b';
        return `<tr>
            <td><span class="badge" style="background:${color}20;color:${color}">${d.prioridad}</span></td>
            <td class="num">${fmt(d.totalOrdenes)}</td>
            <td class="num">${fmtH(d.promedioHoras)}</td>
            <td class="num">${fmtH(d.medianaHoras)}</td>
            <td class="num">${fmtH(d.minHoras)}</td>
            <td class="num">${fmtH(d.maxHoras)}</td>
        </tr>`;
    }).join('');

    const opRows = (topOperadores || []).slice(0, 8).map((o, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td>${o.Usuario}</td>
        <td class="num">${fmt(o.totalOrdenes)}</td>
        <td class="num">${fmt(o.preparacion || 0)}</td>
        <td class="num">${fmt(o.impresion || 0)}</td>
        <td class="num">${fmt(o.controlado || 0)}</td>
    </tr>`).join('');

    const matRows = (topMateriales || []).slice(0, 8).map((m, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td>${m.material}</td>
        <td class="num">${fmt(m.totalOrdenes)}</td>
        <td class="num">${fmtM(m.totalMetros)}</td>
    </tr>`).join('');

    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 11px; color: #1e293b; background: #fff; }
  .page { padding: 32px 40px; }

  /* Header */
  .header { display: flex; align-items: center; justify-content: space-between;
            border-bottom: 3px solid #6366f1; padding-bottom: 16px; margin-bottom: 24px; }
  .header img { height: 42px; }
  .header-title { text-align: right; }
  .header-title h1 { font-size: 18px; font-weight: 800; color: #6366f1; letter-spacing: -0.5px; }
  .header-title p  { font-size: 10px; color: #94a3b8; margin-top: 2px; }

  /* KPI strip */
  .kpi-strip { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; margin-bottom: 24px; }
  .kpi-box   { border-radius: 10px; padding: 12px 14px; background: #f8fafc; border: 1px solid #e2e8f0; }
  .kpi-box .val   { font-size: 20px; font-weight: 900; color: #1e293b; line-height: 1; }
  .kpi-box .label { font-size: 9px; font-weight: 700; text-transform: uppercase;
                    letter-spacing: 0.5px; color: #94a3b8; margin-top: 4px; }

  /* Analysis text */
  .analysis { background: #f8fafc; border-left: 4px solid #6366f1;
              border-radius: 0 8px 8px 0; padding: 18px 20px; margin-bottom: 24px; line-height: 1.7; }
  .analysis h3.section-title { font-size: 11px; font-weight: 800; text-transform: uppercase;
                                letter-spacing: 0.8px; color: #6366f1; margin: 14px 0 6px; }
  .analysis h3.section-title:first-child { margin-top: 0; }
  .analysis p  { color: #334155; margin-bottom: 4px; }
  .analysis .rec-item { padding-left: 8px; border-left: 2px solid #f59e0b;
                        margin-bottom: 6px; color: #78350f; font-weight: 500; }

  /* Tables */
  .section-title-main { font-size: 12px; font-weight: 800; text-transform: uppercase;
                         letter-spacing: 0.6px; color: #475569; margin: 20px 0 8px;
                         padding-bottom: 6px; border-bottom: 1px solid #e2e8f0; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th    { background: #f1f5f9; font-size: 9px; font-weight: 700; text-transform: uppercase;
          letter-spacing: 0.5px; color: #64748b; padding: 7px 10px; text-align: left; }
  td    { padding: 6px 10px; border-bottom: 1px solid #f1f5f9; color: #334155; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #fafafa; }
  .num  { text-align: right; font-weight: 700; font-variant-numeric: tabular-nums; }
  .badge { padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 700; }

  /* Turno */
  .turno-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .turno-card { padding: 14px 16px; border-radius: 10px; border: 1px solid #e2e8f0; }
  .turno-card .t-name { font-weight: 700; font-size: 11px; }
  .turno-card .t-val  { font-size: 22px; font-weight: 900; margin-top: 4px; }
  .turno-card .t-sub  { font-size: 10px; color: #94a3b8; margin-top: 2px; }

  /* Footer */
  .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e2e8f0;
            display: flex; justify-content: space-between; color: #94a3b8; font-size: 9px; }

  /* Alert box */
  .alert { display: flex; align-items: center; gap: 10px; padding: 10px 14px;
           border-radius: 8px; margin-bottom: 16px; font-size: 10px; font-weight: 600; }
  .alert-warn { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
  .alert-good { background: #f0fdf4; border: 1px solid #bbf7d0; color: #14532d; }
</style>
</head>
<body>
<div class="page">

  <!-- HEADER -->
  <div class="header">
    ${logoB64 ? `<img src="${logoB64}" alt="Logo" />` : '<div style="font-size:20px;font-weight:900;color:#6366f1">PRODUCCIÓN</div>'}
    <div class="header-title">
      <h1>Informe de Producción</h1>
      <p>Período: ${periodo} &nbsp;·&nbsp; Generado: ${now}</p>
    </div>
  </div>

  <!-- KPI STRIP -->
  <div class="kpi-strip">
    <div class="kpi-box">
      <div class="val" style="color:#6366f1">${fmt(kpis.insertadas)}</div>
      <div class="label">Órd. Ingresadas</div>
    </div>
    <div class="kpi-box">
      <div class="val" style="color:#10b981">${fmt(kpis.completadas)}</div>
      <div class="label">Cerradas</div>
    </div>
    <div class="kpi-box">
      <div class="val" style="color:${colEfic}">${kpis.eficiencia}%</div>
      <div class="label">Eficiencia</div>
    </div>
    <div class="kpi-box">
      <div class="val" style="color:#0ea5e9">${fmtM(kpis.metros)}</div>
      <div class="label">Metros procesados</div>
    </div>
    <div class="kpi-box">
      <div class="val" style="color:${colFalla}">${pctFalla}%</div>
      <div class="label">Falla + Repos.</div>
    </div>
  </div>

  ${pctFalla >= 8
    ? `<div class="alert alert-warn">⚠ El ${pctFalla}% de los metros corresponden a órdenes de falla y reposición (${fmtM(fallaReposicion.metros)}) — supera el umbral recomendado del 8%.</div>`
    : `<div class="alert alert-good">✓ Nivel de fallas y reposiciones dentro del rango aceptable (${pctFalla}% — umbral: 8%).</div>`
  }

  <!-- ANÁLISIS IA -->
  <div class="section-title-main">Análisis Ejecutivo</div>
  <div class="analysis">${seccionesHTML}</div>

  <!-- DEMORAS -->
  <div class="section-title-main">Demora Promedio por Prioridad <span style="font-weight:400;font-size:10px;color:#94a3b8">(tiempo efectivo — descuenta 12h no laborables/día)</span></div>
  <table>
    <thead><tr>
      <th>Prioridad</th><th style="text-align:right">Órdenes</th>
      <th style="text-align:right">Promedio</th><th style="text-align:right">Mediana</th>
      <th style="text-align:right">Mínimo</th><th style="text-align:right">Máximo</th>
    </tr></thead>
    <tbody>${demRows}</tbody>
  </table>

  <!-- 2 columnas: operadores + materiales -->
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
    <div>
      <div class="section-title-main">Top Operadores</div>
      <table>
        <thead><tr><th>#</th><th>Operador</th><th style="text-align:right">Órd.</th>
          <th style="text-align:right">Prep.</th><th style="text-align:right">Impr.</th><th style="text-align:right">Ctrl.</th></tr></thead>
        <tbody>${opRows}</tbody>
      </table>
    </div>
    <div>
      <div class="section-title-main">Top Materiales</div>
      <table>
        <thead><tr><th>#</th><th>Material</th><th style="text-align:right">Órd.</th><th style="text-align:right">Metros</th></tr></thead>
        <tbody>${matRows}</tbody>
      </table>
    </div>
  </div>

  <!-- TURNOS -->
  <div class="section-title-main">Distribución por Turno</div>
  <div class="turno-grid">
    ${(distribucionTurno || []).map(t => `
    <div class="turno-card">
      <div class="t-name" style="color:${t.turnoNum === 1 ? '#6366f1' : '#10b981'}">${t.turno}</div>
      <div class="t-val" style="color:${t.turnoNum === 1 ? '#6366f1' : '#10b981'}">${fmt(t.totalOrdenes)} <span style="font-size:13px">órd.</span></div>
      <div class="t-sub">${fmtM(t.totalMetros)} · ${t.totalOrdenes > 0 ? fmtM(t.totalMetros / t.totalOrdenes) : '—'} / ord.</div>
    </div>`).join('')}
  </div>

  <!-- FOOTER -->
  <div class="footer">
    <span>Sistema de Gestión de Producción</span>
    <span>Análisis generado con inteligencia artificial · Datos al ${now}</span>
  </div>

</div>
</body>
</html>`;
}

// ─── Controller principal ─────────────────────────────────────────────────────
exports.generarInforme = async (req, res) => {
    try {
        const datos = req.body;
        if (!datos || !datos.kpis) {
            return res.status(400).json({ error: 'Datos del dashboard requeridos' });
        }

        logger.info('[INFORME] Generando análisis con Gemini...');
        const analisis = await generarAnalisis(datos);

        logger.info('[INFORME] Generando PDF con Puppeteer...');
        const html    = buildHTML(datos, analisis);
        const browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });
        const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '0', right: '0', bottom: '0', left: '0' },
        });
        await browser.close();

        const fecha = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="informe-produccion-${fecha}.pdf"`);
        // puppeteer ≥ 22 devuelve Uint8Array: res.send lo serializaría como JSON → PDF inválido
        res.end(Buffer.from(pdf));

        logger.info('[INFORME] PDF enviado correctamente.');
    } catch (err) {
        logger.error('[INFORME] Error:', err.message);
        res.status(500).json({ error: err.message });
    }
};
