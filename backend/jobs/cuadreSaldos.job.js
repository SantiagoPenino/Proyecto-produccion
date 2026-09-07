/**
 * cuadreSaldos.job.js — CUADRE NOCTURNO DE SALDOS
 * ----------------------------------------------------------------------------
 * Corre todas las noches y contesta una sola pregunta: ¿hay cuentas que HOY no
 * cumplen el modelo, y cuántas son NUEVAS respecto de ayer?
 *
 * El modelo (definido por el usuario, 05-09-2026):
 *   · Común / Deudor   → saldo en CERO (o diferencias muy chicas).
 *   · Semanal / Rollo  → pueden deber, y ese debe tiene que ser IGUAL a la deuda
 *                        documentada (facturas emitidas) que tengan viva.
 *   · A favor          → excepción; cada uno con explicación.
 *
 * La verdad es el LIBRO: SUM(MovimientosCuenta.MovImporte) sin ORDEN/ORDEN_ANTICIPO.
 * La deuda que cuenta es SOLO la que apunta a un documento (la deuda por orden es
 * pasiva hasta que se factura el ciclo).
 *
 * Detectores (los mismos de scripts/diag_revision_general_saldos.sql):
 *   1. Cuentas fuera del modelo (debe y no cuadra / debe sin documento / a favor).
 *   2. Documentos PC/ET/FA cuyo cargo en el libro ≠ total (una sola cuenta).
 *   3. Documentos PC/ET/FA sin ningún cargo en el libro.
 *   4. CueSaldoActual distinto del libro, y "falsos positivos" (la columna dice que
 *      hay plata y el libro dice que no — los que el cruce automático puede vaciar).
 *   5. Ajustes manuales (AJUSTE/AJUSTE_POS/AJUSTE_NEG) de las últimas 24 hs.
 *   6. Cobro doble: pago a nivel orden Y a nivel documento por la misma orden.
 *
 * Guarda una foto diaria en dbo.CuadreSaldosDiario (la crea si no existe) para
 * comparar contra ayer, y avisa por mail si hay algo nuevo. Sin mail configurado,
 * deja todo en el log y en el registro de jobs.
 *
 * Configuración (ConfiguracionGlobal, sin reiniciar):
 *   ActivarCuadreSaldos        '1'/'0'  (default: activo)
 *   CuadreSaldos_EmailAlertas  destinatarios separados por coma
 *                              (fallback: process.env.CUADRE_ALERTAS_EMAIL)
 *   CuadreSaldos_Tolerancia    diferencia que se considera "cero" (default 1.00)
 */

'use strict';

const { getPool, sql } = require('../config/db');
const logger           = require('../utils/logger');
const emailSvc         = require('../services/contabilidadEmailService');

let isRunning = false;

// ─── Config ──────────────────────────────────────────────────────────────────
async function leerConfig(pool) {
  const res = await pool.request().query(`
    SELECT Clave, Valor FROM dbo.ConfiguracionGlobal WITH(NOLOCK)
    WHERE Clave IN ('ActivarCuadreSaldos','CuadreSaldos_EmailAlertas','CuadreSaldos_Tolerancia')`);
  const cfg = {};
  for (const r of res.recordset) cfg[r.Clave] = r.Valor;
  return {
    activo:     cfg.ActivarCuadreSaldos == null ? true : ['1','true'].includes(String(cfg.ActivarCuadreSaldos).toLowerCase()),
    emails:     (cfg.CuadreSaldos_EmailAlertas || process.env.CUADRE_ALERTAS_EMAIL || '').split(',').map(s => s.trim()).filter(Boolean),
    tolerancia: Number(cfg.CuadreSaldos_Tolerancia) > 0 ? Number(cfg.CuadreSaldos_Tolerancia) : 1.0,
  };
}

// ─── Tabla de fotos diarias ──────────────────────────────────────────────────
async function asegurarTabla(pool) {
  await pool.request().query(`
    IF OBJECT_ID('dbo.CuadreSaldosDiario') IS NULL
    CREATE TABLE dbo.CuadreSaldosDiario (
      Id INT IDENTITY(1,1) PRIMARY KEY,
      Fecha DATE NOT NULL,
      Corrida DATETIME NOT NULL DEFAULT GETDATE(),
      CuentasFueraDelModelo INT NOT NULL,
      DebeNoCuadra INT NOT NULL,
      DebeSinDocumento INT NOT NULL,
      AFavor INT NOT NULL,
      AFavorConDeuda INT NOT NULL,
      CargoDistintoTotal INT NOT NULL,
      DocsSinCargo INT NOT NULL,
      ColumnaMal INT NOT NULL,
      FalsosPositivos INT NOT NULL,
      AjustesManuales24h INT NOT NULL,
      DobleCobro INT NOT NULL,
      Detalle NVARCHAR(MAX) NULL
    );
    IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_CuadreSaldosDiario_Fecha')
      CREATE INDEX IX_CuadreSaldosDiario_Fecha ON dbo.CuadreSaldosDiario (Fecha DESC);
  `);
}

// ─── Detectores ──────────────────────────────────────────────────────────────
const SQL_CUENTAS = (tol) => `
  WITH C AS (
    SELECT cc.CueIdCuenta, cc.CliIdCliente, Cliente = RTRIM(c.Nombre),
           Tipo = CASE c.TClIdTipoCliente WHEN 1 THEN 'Comun' WHEN 2 THEN 'Semanal' WHEN 3 THEN 'Rollo' WHEN 4 THEN 'Deudor' ELSE 'sin tipo' END,
           Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
           Guardado = cc.CueSaldoActual,
           Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                    WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0),
           VivaDoc = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd WITH(NOLOCK)
                    WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DocIdDocumento IS NOT NULL
                      AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND dd.DDeImportePendiente > 0.01), 0),
           Movs = (SELECT COUNT(*) FROM dbo.MovimientosCuenta m WITH(NOLOCK) WHERE m.CueIdCuenta = cc.CueIdCuenta)
    FROM dbo.CuentasCliente cc WITH(NOLOCK)
    JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
    WHERE cc.CueTipo LIKE 'DINERO%'
  ), S AS (
    SELECT *, Situacion = CASE
      WHEN ABS(Saldo) <= ${tol} AND VivaDoc <= ${tol}          THEN 'EN CERO'
      WHEN Saldo < -${tol} AND ABS(VivaDoc + Saldo) <= ${tol}  THEN 'DEBE Y CUADRA'
      WHEN Saldo < -${tol} AND VivaDoc > ${tol}                THEN 'DEBE Y NO CUADRA'
      WHEN Saldo < -${tol}                                     THEN 'DEBE SIN DOCUMENTO'
      WHEN Saldo >  ${tol} AND VivaDoc > ${tol}                THEN 'A FAVOR Y CON DEUDA VIVA'
      WHEN Saldo >  ${tol}                                     THEN 'A FAVOR'
      ELSE 'REVISAR' END
    FROM C WHERE Movs > 0
  )
  SELECT CueIdCuenta, CliIdCliente, Cliente, Tipo, Moneda, Situacion,
         Saldo = CAST(Saldo AS DECIMAL(18,2)), VivaDoc = CAST(VivaDoc AS DECIMAL(18,2)),
         Guardado = CAST(Guardado AS DECIMAL(18,2)),
         ColumnaMal = CASE WHEN ABS(Guardado - Saldo) > ${tol} THEN 1 ELSE 0 END,
         FalsoPositivo = CASE WHEN Guardado > 0.01 AND Saldo <= 0.01 THEN 1 ELSE 0 END
  FROM S
  WHERE Situacion NOT IN ('EN CERO','DEBE Y CUADRA') OR ABS(Guardado - Saldo) > ${tol}
  ORDER BY ABS(Saldo) DESC`;

const SQL_CARGO_VS_TOTAL = `
  WITH Cargos AS (
    SELECT m.DocIdDocumento, Cargo = SUM(-m.MovImporte), Cuentas = COUNT(DISTINCT m.CueIdCuenta), CueIdCuenta = MIN(m.CueIdCuenta)
    FROM dbo.MovimientosCuenta m WITH(NOLOCK)
    WHERE m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') AND m.MovImporte < 0
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND m.DocIdDocumento IS NOT NULL
    GROUP BY m.DocIdDocumento
  )
  SELECT Doc = RTRIM(d.DocSerie) + '-' + CAST(d.DocNumero AS VARCHAR), Cliente = RTRIM(c.Nombre), d.CfeEstado,
         DocTotal = CAST(d.DocTotal AS DECIMAL(18,2)), Cargo = CAST(g.Cargo AS DECIMAL(18,2)),
         Esperado = CAST(CASE WHEN d.MonIdMoneda = cc.MonIdMoneda THEN d.DocTotal
                              WHEN d.MonIdMoneda = 1 AND cc.MonIdMoneda = 2 AND ISNULL(d.DocCotizacion,0) > 0 THEN d.DocTotal / d.DocCotizacion
                              WHEN d.MonIdMoneda = 2 AND cc.MonIdMoneda = 1 AND ISNULL(d.DocCotizacion,0) > 0 THEN d.DocTotal * d.DocCotizacion END AS DECIMAL(18,2))
  FROM Cargos g
  JOIN dbo.DocumentosContables d WITH(NOLOCK) ON d.DocIdDocumento = g.DocIdDocumento
  JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = g.CueIdCuenta
  LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = d.CliIdCliente
  WHERE g.Cuentas = 1 AND RTRIM(d.DocSerie) IN ('PC','ET','FA') AND ISNULL(d.DocEstado,'') <> 'ANULADO'
    AND ABS(g.Cargo - CASE WHEN d.MonIdMoneda = cc.MonIdMoneda THEN d.DocTotal
                           WHEN d.MonIdMoneda = 1 AND cc.MonIdMoneda = 2 AND ISNULL(d.DocCotizacion,0) > 0 THEN d.DocTotal / d.DocCotizacion
                           WHEN d.MonIdMoneda = 2 AND cc.MonIdMoneda = 1 AND ISNULL(d.DocCotizacion,0) > 0 THEN d.DocTotal * d.DocCotizacion
                           ELSE g.Cargo END) > 1
  ORDER BY ABS(g.Cargo - d.DocTotal) DESC`;

const SQL_SIN_CARGO = `
  SELECT Doc = RTRIM(d.DocSerie) + '-' + CAST(d.DocNumero AS VARCHAR), Cliente = RTRIM(c.Nombre), d.CfeEstado,
         DocTotal = CAST(d.DocTotal AS DECIMAL(18,2)), Moneda = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
         d.DocFechaEmision
  FROM dbo.DocumentosContables d WITH(NOLOCK)
  LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = d.CliIdCliente
  WHERE RTRIM(d.DocSerie) IN ('PC','ET','FA') AND ISNULL(d.DocEstado,'') <> 'ANULADO' AND d.DocTotal > 0
    AND d.DocTipo NOT LIKE '%NOTA%'
    AND NOT EXISTS (SELECT 1 FROM dbo.MovimientosCuenta m WITH(NOLOCK)
                    WHERE m.DocIdDocumento = d.DocIdDocumento AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')
                      AND m.MovImporte < 0 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0))
  ORDER BY d.DocTotal DESC`;

const SQL_AJUSTES_24H = `
  SELECT Cliente = RTRIM(c.Nombre), Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
         m.MovTipo, Importe = CAST(m.MovImporte AS DECIMAL(18,2)), m.MovFecha,
         Usuario = RTRIM(ISNULL(u.Usuario,'?')), Motivo = LEFT(m.MovConcepto, 120)
  FROM dbo.MovimientosCuenta m WITH(NOLOCK)
  JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
  JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
  LEFT JOIN dbo.Usuarios u WITH(NOLOCK) ON u.IdUsuario = m.MovUsuarioAlta
  WHERE m.MovTipo IN ('AJUSTE','AJUSTE_POS','AJUSTE_NEG') AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    AND cc.CueTipo LIKE 'DINERO%' AND m.MovFecha >= DATEADD(HOUR, -24, GETDATE())
  ORDER BY ABS(m.MovImporte) DESC`;

const SQL_DOBLE_COBRO = `
  WITH OrdDoc AS (
    SELECT DISTINCT o.OrdIdOrden, o.DocIdDocumento, o.CueIdCuenta FROM dbo.MovimientosCuenta o WITH(NOLOCK)
    WHERE o.MovTipo IN ('ORDEN','ORDEN_ANTICIPO') AND o.DocIdDocumento IS NOT NULL AND (o.MovAnulado IS NULL OR o.MovAnulado = 0)
  ), PagoOrden AS (
    SELECT p.OrdIdOrden, p.CueIdCuenta, Importe = SUM(p.MovImporte) FROM dbo.MovimientosCuenta p WITH(NOLOCK)
    WHERE p.MovTipo IN ('PAGO','PAGO_CRUZADO') AND p.MovImporte > 0 AND p.DocIdDocumento IS NULL AND p.OrdIdOrden IS NOT NULL
      AND (p.MovAnulado IS NULL OR p.MovAnulado = 0)
    GROUP BY p.OrdIdOrden, p.CueIdCuenta
  ), PagoDoc AS (
    SELECT d.DocIdDocumento, d.CueIdCuenta, Importe = SUM(d.MovImporte) FROM dbo.MovimientosCuenta d WITH(NOLOCK)
    WHERE d.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO') AND d.MovImporte > 0 AND d.DocIdDocumento IS NOT NULL
      AND (d.MovAnulado IS NULL OR d.MovAnulado = 0)
    GROUP BY d.DocIdDocumento, d.CueIdCuenta
  )
  SELECT Doc = RTRIM(dc.DocSerie) + '-' + CAST(dc.DocNumero AS VARCHAR), Cliente = RTRIM(c.Nombre),
         Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
         PagoOrden = CAST(SUM(po.Importe) AS DECIMAL(18,2)), PagoDoc = CAST(MAX(pd.Importe) AS DECIMAL(18,2))
  FROM OrdDoc od
  JOIN PagoOrden po ON po.OrdIdOrden = od.OrdIdOrden AND po.CueIdCuenta = od.CueIdCuenta
  JOIN PagoDoc  pd ON pd.DocIdDocumento = od.DocIdDocumento AND pd.CueIdCuenta = od.CueIdCuenta
  JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = od.DocIdDocumento
  JOIN dbo.CuentasCliente cc WITH(NOLOCK) ON cc.CueIdCuenta = od.CueIdCuenta
  JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = cc.CliIdCliente
  WHERE RTRIM(dc.DocSerie) IN ('PC','ET','FA') AND ISNULL(dc.DocEstado,'') <> 'ANULADO'
  GROUP BY dc.DocSerie, dc.DocNumero, c.Nombre, cc.MonIdMoneda
  ORDER BY SUM(po.Importe) DESC`;

// ─── Corrida ─────────────────────────────────────────────────────────────────
async function run() {
  if (isRunning) { logger.warn('[CUADRE-SALDOS] corrida anterior aún en curso, omito.'); return null; }
  isRunning = true;
  const t0 = Date.now();
  try {
    const pool = await getPool();
    const cfg  = await leerConfig(pool);
    if (!cfg.activo) { logger.info('[CUADRE-SALDOS] desactivado en ConfiguracionGlobal.'); return 'Desactivado'; }

    try { await asegurarTabla(pool); } catch (e) { logger.warn(`[CUADRE-SALDOS] no pude asegurar la tabla de fotos: ${e.message}`); }

    const [cuentas, cargoVsTotal, sinCargo, ajustes, dobleCobro] = await Promise.all([
      pool.request().query(SQL_CUENTAS(cfg.tolerancia)).then(r => r.recordset),
      pool.request().query(SQL_CARGO_VS_TOTAL).then(r => r.recordset),
      pool.request().query(SQL_SIN_CARGO).then(r => r.recordset),
      pool.request().query(SQL_AJUSTES_24H).then(r => r.recordset),
      pool.request().query(SQL_DOBLE_COBRO).then(r => r.recordset),
    ]);

    const cnt = (s) => cuentas.filter(x => x.Situacion === s).length;
    const foto = {
      CuentasFueraDelModelo: cuentas.filter(x => !['EN CERO','DEBE Y CUADRA'].includes(x.Situacion)).length,
      DebeNoCuadra:        cnt('DEBE Y NO CUADRA'),
      DebeSinDocumento:    cnt('DEBE SIN DOCUMENTO'),
      AFavor:              cnt('A FAVOR'),
      AFavorConDeuda:      cnt('A FAVOR Y CON DEUDA VIVA'),
      CargoDistintoTotal:  cargoVsTotal.length,
      DocsSinCargo:        sinCargo.length,
      ColumnaMal:          cuentas.filter(x => x.ColumnaMal).length,
      FalsosPositivos:     cuentas.filter(x => x.FalsoPositivo).length,
      AjustesManuales24h:  ajustes.length,
      DobleCobro:          dobleCobro.length,
    };

    // ayer, para saber qué es NUEVO
    let ayer = null;
    try {
      const a = await pool.request().query(`
        SELECT TOP 1 * FROM dbo.CuadreSaldosDiario WITH(NOLOCK)
        WHERE Fecha < CAST(GETDATE() AS DATE) ORDER BY Fecha DESC, Corrida DESC`);
      ayer = a.recordset[0] || null;
    } catch { /* primera corrida */ }

    const delta = (k) => ayer ? foto[k] - Number(ayer[k] || 0) : null;
    const nuevos = Object.keys(foto).filter(k => (delta(k) ?? 0) > 0);

    const detalle = {
      cuentas:       cuentas.slice(0, 40),
      cargoVsTotal:  cargoVsTotal.slice(0, 20),
      sinCargo:      sinCargo.slice(0, 20),
      ajustes,
      dobleCobro:    dobleCobro.slice(0, 20),
    };

    try {
      await pool.request()
        .input('f', sql.NVarChar(sql.MAX), JSON.stringify(detalle))
        .query(`
          INSERT INTO dbo.CuadreSaldosDiario
            (Fecha, CuentasFueraDelModelo, DebeNoCuadra, DebeSinDocumento, AFavor, AFavorConDeuda,
             CargoDistintoTotal, DocsSinCargo, ColumnaMal, FalsosPositivos, AjustesManuales24h, DobleCobro, Detalle)
          VALUES (CAST(GETDATE() AS DATE), ${foto.CuentasFueraDelModelo}, ${foto.DebeNoCuadra}, ${foto.DebeSinDocumento},
                  ${foto.AFavor}, ${foto.AFavorConDeuda}, ${foto.CargoDistintoTotal}, ${foto.DocsSinCargo},
                  ${foto.ColumnaMal}, ${foto.FalsosPositivos}, ${foto.AjustesManuales24h}, ${foto.DobleCobro}, @f)`);
    } catch (e) { logger.warn(`[CUADRE-SALDOS] no pude guardar la foto: ${e.message}`); }

    const resumen = Object.entries(foto).map(([k, v]) => {
      const d = delta(k);
      return `${k}=${v}${d == null ? '' : (d > 0 ? ` (+${d})` : d < 0 ? ` (${d})` : '')}`;
    }).join(' · ');
    logger.info(`[CUADRE-SALDOS] ${resumen} — ${Date.now() - t0} ms`);

    // Avisar si hay algo que mirar: cualquier cosa NUEVA, falsos positivos (el cruce puede
    // vaciar esas cuentas), ajustes a mano o cobros dobles.
    const hayQueMirar = nuevos.length > 0 || foto.FalsosPositivos > 0 || foto.AjustesManuales24h > 0 || foto.DobleCobro > 0;
    if (hayQueMirar) {
      await avisar({ cfg, foto, delta, nuevos, detalle, ayer });
    }
    return resumen;
  } finally {
    isRunning = false;
  }
}

// ─── Aviso ───────────────────────────────────────────────────────────────────
function tabla(filas, cols) {
  if (!filas?.length) return '<p style="color:#666">— nada —</p>';
  const th = cols.map(c => `<th style="text-align:left;padding:4px 8px;border-bottom:1px solid #ccc">${c}</th>`).join('');
  const tr = filas.map(f => '<tr>' + cols.map(c => `<td style="padding:3px 8px;border-bottom:1px solid #eee">${f[c] ?? ''}</td>`).join('') + '</tr>').join('');
  return `<table style="border-collapse:collapse;font:13px system-ui">${th ? `<tr>${th}</tr>` : ''}${tr}</table>`;
}

async function avisar({ cfg, foto, delta, nuevos, detalle, ayer }) {
  const fila = (k, label) => {
    const d = delta(k);
    const tag = d == null ? '' : d > 0 ? ` <b style="color:#b00">(+${d} nuevos)</b>` : d < 0 ? ` <span style="color:#080">(${d})</span>` : '';
    return `<tr><td style="padding:3px 8px">${label}</td><td style="padding:3px 8px;text-align:right"><b>${foto[k]}</b>${tag}</td></tr>`;
  };
  const html = `
    <div style="font:14px system-ui;max-width:900px">
      <h2 style="margin:0 0 8px">Cuadre nocturno de saldos — ${new Date().toLocaleDateString('es-UY')}</h2>
      <p style="margin:0 0 12px;color:#444">Contra ${ayer ? 'la foto de ayer' : 'ninguna foto previa (primera corrida)'}.
        ${nuevos.length ? `<b style="color:#b00">Hay ${nuevos.length} indicador(es) que empeoraron.</b>` : 'Nada nuevo respecto de ayer.'}</p>
      <table style="border-collapse:collapse;font:13px system-ui;margin-bottom:16px">
        ${fila('CuentasFueraDelModelo','Cuentas fuera del modelo')}
        ${fila('DebeNoCuadra','&nbsp;&nbsp;deben y la deuda documentada no cuadra')}
        ${fila('DebeSinDocumento','&nbsp;&nbsp;deben sin documento (nadie facturó)')}
        ${fila('AFavor','&nbsp;&nbsp;a favor')}
        ${fila('AFavorConDeuda','&nbsp;&nbsp;a favor y con deuda viva (fantasma)')}
        ${fila('CargoDistintoTotal','Documentos con cargo ≠ total')}
        ${fila('DocsSinCargo','Documentos sin ningún cargo')}
        ${fila('ColumnaMal','CueSaldoActual distinto del libro')}
        ${fila('FalsosPositivos','&nbsp;&nbsp;falsos positivos (el cruce puede vaciarlas)')}
        ${fila('AjustesManuales24h','Ajustes a mano en las últimas 24 hs')}
        ${fila('DobleCobro','Cobro doble orden + documento')}
      </table>
      <h3>Ajustes a mano (24 hs)</h3>${tabla(detalle.ajustes, ['Cliente','Moneda','MovTipo','Importe','Usuario','Motivo'])}
      <h3>Cobro doble</h3>${tabla(detalle.dobleCobro, ['Cliente','Doc','Moneda','PagoOrden','PagoDoc'])}
      <h3>Cuentas fuera del modelo (top 40)</h3>${tabla(detalle.cuentas, ['Cliente','Tipo','Moneda','Situacion','Saldo','VivaDoc','Guardado'])}
      <h3>Cargo ≠ total (top 20)</h3>${tabla(detalle.cargoVsTotal, ['Cliente','Doc','CfeEstado','DocTotal','Cargo','Esperado'])}
      <h3>Sin cargo (top 20)</h3>${tabla(detalle.sinCargo, ['Cliente','Doc','CfeEstado','Moneda','DocTotal'])}
      <p style="color:#666;font-size:12px;margin-top:16px">Detalle completo: scripts/diag_revision_general_saldos.sql · foto guardada en dbo.CuadreSaldosDiario</p>
    </div>`;

  if (!cfg.emails.length) {
    logger.warn('[CUADRE-SALDOS] hay novedades pero no hay destinatario (ConfiguracionGlobal.CuadreSaldos_EmailAlertas o CUADRE_ALERTAS_EMAIL). Solo log.');
    return;
  }
  const subject = `[Cuadre de saldos] ${nuevos.length ? `${nuevos.length} indicador(es) empeoraron` : 'novedades'} — ${foto.CuentasFueraDelModelo} cuentas fuera del modelo`;
  await emailSvc.enviarEmail({ to: cfg.emails.join(','), subject, html, text: subject });
  logger.info(`[CUADRE-SALDOS] aviso enviado a ${cfg.emails.join(', ')}`);
}

// ─── Arranque ────────────────────────────────────────────────────────────────
// Se llama desde server.js (como los demás jobs). NO va por scheduler.startAutoSync:
// ese scheduler está desactivado a propósito (apaga la sincronización con el ERP) y
// todo lo que se agenda ahí nunca corre — por eso la tarjeta quedaba sin horario.
const HORA_CUADRE = 6, MINUTO_CUADRE = 30;

function startCuadreSaldosJob() {
  const reg = require('./jobRegistry');
  if (!reg.getAll().some(j => j.id === 'cuadre-saldos')) {
    reg.registrar('cuadre-saldos', {
      nombre:      'Cuadre Nocturno de Saldos',
      descripcion: 'Compara libro vs deuda documentada vs CueSaldoActual por cuenta, detecta cargos desalineados, documentos sin cargo, ajustes a mano y cobros dobles; guarda la foto en CuadreSaldosDiario y avisa por mail si algo empeoró respecto de ayer.',
      schedule:    `${String(HORA_CUADRE).padStart(2,'0')}:${String(MINUTO_CUADRE).padStart(2,'0')} hs diarios`,
    });
  }
  reg.setFn('cuadre-saldos', run);   // "Ejecutar" en /admin/cron → ejecutarManual → run()

  const ejecutar = async () => {
    reg.marcarInicio('cuadre-saldos');
    try {
      const resumen = await run();
      reg.marcarOk('cuadre-saldos', typeof resumen === 'string' && resumen.trim() ? resumen : undefined);
    } catch (e) {
      reg.marcarError('cuadre-saldos', e);
      logger.error('[CUADRE-SALDOS] ❌ Error:', e.message);
    }
  };

  function programar() {
    const ahora   = new Date();
    const proxima = new Date(ahora);
    proxima.setHours(HORA_CUADRE, MINUTO_CUADRE, 0, 0);
    if (proxima <= ahora) proxima.setDate(proxima.getDate() + 1);
    const ms = proxima - ahora;
    reg.setProximaEjecucion('cuadre-saldos', proxima);
    logger.info(`⏱️ [cuadre-saldos] Próxima corrida ${proxima.toLocaleString('es-UY')} (en ${Math.round(ms / 60000)} min).`);
    setTimeout(async () => { await ejecutar(); programar(); }, ms);
  }
  programar();
}

module.exports = {
  run,
  startCuadreSaldosJob,
  // Solo para pruebas de solo lectura (validar que las consultas corren en una base dada).
  _sql: { SQL_CUENTAS, SQL_CARGO_VS_TOTAL, SQL_SIN_CARGO, SQL_AJUSTES_24H, SQL_DOBLE_COBRO },
};
