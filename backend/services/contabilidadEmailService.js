/**
 * contabilidadEmailService.js
 * ────────────────────────────────────────────────────────────────────────────
 * Envío de estados de cuenta vía Nodemailer + Brevo SMTP.
 * Independiente del emailService.js existente (Resend).
 *
 * Variables de entorno requeridas (.env):
 *   BREVO_SMTP_HOST     → smtp-relay.brevo.com
 *   BREVO_SMTP_PORT     → 587
 *   BREVO_SMTP_USER     → tu email de cuenta Brevo
 *   BREVO_SMTP_PASS     → SMTP Key (Settings → SMTP & API en Brevo)
 *   EMAIL_FROM_NAME     → Nombre remitente  (ej: "Producción User")
 *   EMAIL_FROM_ADDRESS  → Email remitente   (ej: notificaciones@user.com.uy)
 * ────────────────────────────────────────────────────────────────────────────
 */

'use strict';

const nodemailer = require('nodemailer');
const logger     = require('../utils/logger');

// ============================================================
// SECCIÓN 1: TRANSPORTER (singleton lazy)
// ============================================================

let _transporter = null;

function getTransporter() {
  if (_transporter) return _transporter;

  const host = process.env.BREVO_SMTP_HOST || 'smtp-relay.brevo.com';
  const port = parseInt(process.env.BREVO_SMTP_PORT || '587', 10);
  const user = process.env.BREVO_SMTP_USER;
  const pass = process.env.BREVO_SMTP_PASS;

  if (!user || !pass) {
    logger.warn('[CONT-EMAIL] BREVO_SMTP_USER o BREVO_SMTP_PASS no configurados. Modo simulado activo.');
    return null;
  }

  _transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false },
  });

  logger.info(`[CONT-EMAIL] Transporter Brevo configurado: ${host}:${port}`);
  return _transporter;
}

// ============================================================
// SECCIÓN 2: FUNCIONES BASE
// ============================================================

const FROM_NAME    = process.env.EMAIL_FROM_NAME    || 'Sistema de Producción';
const FROM_ADDRESS = process.env.EMAIL_FROM_ADDRESS || 'no-reply@macrosoft.local';

/**
 * enviarEmail — función base genérica
 */
async function enviarEmail({ to, subject, html, text = '', attachments = [] }) {
  const transporter = getTransporter();

  if (!transporter) {
    logger.warn(`[CONT-EMAIL] SIMULADO → Para: ${to} | Asunto: "${subject}"`);
    return { messageId: 'sim-' + Date.now(), simulado: true };
  }

  const info = await transporter.sendMail({
    from: `"${FROM_NAME}" <${FROM_ADDRESS}>`,
    to,
    subject,
    html,
    text,
    attachments,
  });

  logger.info(`[CONT-EMAIL] ✅ Enviado a ${to} | MessageId: ${info.messageId}`);
  return { messageId: info.messageId, simulado: false };
}

// ============================================================
// SECCIÓN 3: ENVÍO DE ESTADO DE CUENTA DESDE LA COLA
// ============================================================

const { generarPDFDesdeHTML } = require('../utils/pdfPuppeteerGenerator');

/**
 * enviarDesdeCola
 * Envía un estado de cuenta y actualiza el estado en ColaEstadosCuenta.
 *
 * @param {object} params
 *   @param {number}  ColIdCola     ID registro en ColaEstadosCuenta
 *   @param {string}  destinatario  Email del cliente
 *   @param {string}  asunto        Asunto del email (viene de ColAsunto)
 *   @param {object}  datos         Objeto parseado de ColContenidoJSON
 *   @param {object}  pool          SQL pool (para actualizar cola)
 *   @param {object}  sql           mssql sql types
 */
async function enviarDesdeCola({ ColIdCola, destinatario, asunto, datos, pool, sql }) {
  const html = generarHTMLEstadoCuenta(datos);
  let attachments = [];

  try {
    // Generar PDF y adjuntarlo
    const filename = `Estado_de_Cuenta_${datos.cliente?.Nombre ? datos.cliente.Nombre.replace(/[^a-zA-Z0-9]/g, '_') : 'Cliente'}_${Date.now()}.pdf`;
    const { filePath } = await generarPDFDesdeHTML(html, filename);

    attachments.push({
      filename: filename,
      path: filePath,
      contentType: 'application/pdf'
    });

    // Enviar correo
    await enviarEmail({ to: destinatario, subject: asunto, html, attachments });

    await pool.request()
      .input('ColIdCola', sql.Int, ColIdCola)
      .input('ColRutaPDF', sql.NVarChar(500), filePath)
      .query(`
        UPDATE dbo.ColaEstadosCuenta
        SET ColEstado     = 'ENVIADO',
            ColFechaEnvio = GETDATE(),
            ColRutaPDF    = @ColRutaPDF
        WHERE ColIdCola = @ColIdCola
      `);

    logger.info(`[CONT-EMAIL] Cola ${ColIdCola} → ENVIADO a ${destinatario}`);
    return { ok: true };

  } catch (err) {
    await pool.request()
      .input('ColIdCola', sql.Int, ColIdCola)
      .input('Error',     sql.NVarChar(490), err.message.substring(0, 490))
      .query(`
        UPDATE dbo.ColaEstadosCuenta
        SET ColEstado     = 'ERROR',
            ColErrorEnvio = @Error
        WHERE ColIdCola = @ColIdCola
      `);

    logger.error(`[CONT-EMAIL] Cola ${ColIdCola} → ERROR: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ============================================================
// SECCIÓN 4: TEMPLATE HTML ESTADO DE CUENTA — DISEÑO ELEGANTE
// ============================================================

/**
 * obtenerDatosEmpresa
 * Lee las claves de empresa desde ConfiguracionGlobal.
 * Fallback a defaults si no existen.
 */
async function obtenerDatosEmpresa() {
  try {
    const { getPool } = require('../config/db');
    const pool = await getPool();
    const res  = await pool.request().query(`
      SELECT Clave, Valor
      FROM   ConfiguracionGlobal WITH(NOLOCK)
      WHERE  Clave IN (
        'EMPRESA_NOMBRE','EMPRESA_SLOGAN','EMPRESA_DIRECCION',
        'EMPRESA_CIUDAD','EMPRESA_PAIS','EMPRESA_RUC',
        'EMPRESA_TEL','EMPRESA_EMAIL','EMPRESA_WEB',
        'EMPRESA_COLOR_PRIMARIO'
      )
    `);
    const m = {};
    for (const row of res.recordset) m[row.Clave] = row.Valor;
    return {
      nombre:   m.EMPRESA_NOMBRE          || 'User Impresión & Sublimación',
      slogan:   m.EMPRESA_SLOGAN          || 'impresión & sublimación / DTF',
      dir:      m.EMPRESA_DIRECCION       || '',
      ciudad:   m.EMPRESA_CIUDAD          || '',
      pais:     m.EMPRESA_PAIS            || 'Uruguay',
      ruc:      m.EMPRESA_RUC             || '',
      tel:      m.EMPRESA_TEL             || '',
      email:    m.EMPRESA_EMAIL           || '',
      web:      m.EMPRESA_WEB             || '',
      color:    m.EMPRESA_COLOR_PRIMARIO  || '#0d47a1',
    };
  } catch {
    return {
      nombre: 'User Impresión & Sublimación', slogan: 'impresión & sublimación / DTF',
      dir: '', ciudad: '', pais: 'Uruguay', ruc: '', tel: '', email: '', web: '',
      color: '#0d47a1',
    };
  }
}

/**
 * generarHTMLEstadoCuenta
 * Genera el HTML del estado de cuenta con diseño elegante.
 * Si se pasa `empresa`, la usa; si no, usa defaults.
 */
function generarHTMLEstadoCuenta(datos, empresa = {}) {
  const { cliente = {}, cuentas = [], generadoEn } = datos;

  const emp = {
    nombre: empresa.nombre || 'User Impresión & Sublimación',
    slogan: empresa.slogan || 'impresión & sublimación / DTF',
    dir:    empresa.dir    || '',
    ciudad: empresa.ciudad || '',
    pais:   empresa.pais   || 'Uruguay',
    ruc:    empresa.ruc    || '',
    tel:    empresa.tel    || '',
    email:  empresa.email  || '',
    web:    empresa.web    || '',
    color:  empresa.color  || '#0d47a1',
  };

  const colorOsc  = emp.color;
  const colorSec  = '#e8f0fe';

  const fecha = generadoEn
    ? new Date(generadoEn).toLocaleDateString('es-UY', {
        day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Montevideo',
      })
    : new Date().toLocaleDateString('es-UY');

  const fmt = (n) => new Intl.NumberFormat('es-UY', { minimumFractionDigits: 2 }).format(Number(n ?? 0));

  // Resumen de totales globales
  const totalPendiente = cuentas.reduce((s, c) =>
    s + (c.deudas ?? []).reduce((a, d) => a + Number(d.DDeImportePendiente || 0), 0), 0);
  const totalVencido = cuentas.reduce((s, c) =>
    s + (c.deudas ?? []).filter(d => Number(d.DiasVencido) > 0)
        .reduce((a, d) => a + Number(d.DDeImportePendiente || 0), 0), 0);
  const totalAlDia = totalPendiente - totalVencido;
  const simboloGlobal = cuentas[0]?.MonSimbolo || '$';

  const bloquesCuentas = cuentas.map(c => {
    const simbolo = c.MonSimbolo || '$';
    const saldoNeg = Number(c.CueSaldoActual) < 0;

    const filasDeuda = (c.deudas ?? []).map((d, idx) => {
      const vencido = Number(d.DiasVencido) > 0;
      return `
        <tr style="background:${idx % 2 === 1 ? '#fafafa' : '#fff'};">
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px;color:#555;">
            ${d.CodigoOrden || d.OrdIdOrden || '-'}
            ${d.NombreTrabajo ? `<div style="font-size:10px;color:#888;margin-top:2px;">${d.NombreTrabajo}</div>` : ''}
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px;color:#555;">${d.DDeFechaEmision ? new Date(d.DDeFechaEmision).toLocaleDateString('es-UY') : '-'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px;color:#555;">${d.DDeFechaVencimiento ? new Date(d.DDeFechaVencimiento).toLocaleDateString('es-UY') : '-'}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px;">
            <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;
              background:${vencido ? '#fdecea' : '#e8f5e9'};color:${vencido ? '#c62828' : '#2e7d32'};">
              ${vencido ? `Vencido ${d.DiasVencido}d` : 'Al día'}
            </span>
          </td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px;text-align:right;color:#333;">${simbolo} ${fmt(d.DDeImporteOriginal)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;font-size:12px;text-align:right;font-weight:700;color:${vencido ? '#c62828' : '#333'};">${simbolo} ${fmt(d.DDeImportePendiente)}</td>
        </tr>`;
    }).join('');

    const totalCuenta = (c.deudas ?? []).reduce((a, d) => a + Number(d.DDeImportePendiente || 0), 0);

    const tablaDeudas = c.deudas?.length
      ? `<table style="width:100%;border-collapse:collapse;">
           <thead>
             <tr style="background:${colorOsc};color:#fff;">
               <th style="padding:9px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Orden</th>
               <th style="padding:9px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Emisión</th>
               <th style="padding:9px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Vencimiento</th>
               <th style="padding:9px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Estado</th>
               <th style="padding:9px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Total</th>
               <th style="padding:9px 12px;text-align:right;font-size:11px;text-transform:uppercase;letter-spacing:.5px;">Pendiente</th>
             </tr>
           </thead>
           <tbody>${filasDeuda}</tbody>
           <tfoot>
             <tr style="background:#f0f4ff;">
               <td colspan="5" style="padding:10px 12px;font-size:13px;font-weight:600;color:${colorOsc};text-align:right;">Total pendiente</td>
               <td style="padding:10px 12px;font-size:14px;font-weight:700;color:${colorOsc};text-align:right;">${simbolo} ${fmt(totalCuenta)}</td>
             </tr>
           </tfoot>
         </table>`
      : `<p style="padding:14px 16px;color:#888;font-size:13px;margin:0;">✅ Sin deudas pendientes en esta cuenta.</p>`;

    return `
      <div style="margin-bottom:24px;border:1px solid #e0e0e0;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.06);">
        <div style="background:${colorSec};padding:10px 16px;display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid ${colorOsc};">
          <span style="font-weight:700;font-size:13px;color:${colorOsc};">
            ${c.CueTipo}${c.NombreArticulo ? ' · ' + c.NombreArticulo : ''}
            ${c.CondicionPago ? ' — ' + c.CondicionPago : ''}
          </span>
          <span style="font-size:15px;font-weight:700;color:${saldoNeg ? '#c62828' : '#2e7d32'};">
            ${simbolo} ${fmt(c.CueSaldoActual)}
          </span>
        </div>
        ${tablaDeudas}
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Estado de Cuenta — ${cliente.Nombre ?? ''}</title>
</head>
<body style="margin:0;padding:0;background:#f0f2f5;font-family:'Helvetica Neue',Arial,sans-serif;">
<div style="max-width:700px;margin:28px auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.12);">

  <!-- ═══ CABECERA EMPRESA ═══ -->
  <div style="padding:28px 36px;display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid ${colorOsc};background:#fff;">
    <!-- Logo / nombre empresa -->
    <div>
      <div style="font-size:28px;font-weight:900;color:${colorOsc};letter-spacing:-1px;line-height:1;">${emp.nombre}</div>
      <div style="margin-top:4px;">
        <span style="display:inline-block;width:20px;height:3px;background:#e53935;margin-right:3px;border-radius:2px;"></span>
        <span style="display:inline-block;width:20px;height:3px;background:#1565c0;margin-right:3px;border-radius:2px;"></span>
        <span style="display:inline-block;width:20px;height:3px;background:#f9a825;border-radius:2px;"></span>
      </div>
      <div style="margin-top:6px;font-size:12px;color:#888;font-style:italic;">${emp.slogan}</div>
    </div>
    <!-- Datos empresa -->
    <div style="text-align:right;font-size:12px;color:#555;line-height:1.7;">
      ${emp.dir    ? `<div>${emp.dir}</div>` : ''}
      ${emp.ciudad ? `<div>${emp.ciudad}${emp.pais ? ', ' + emp.pais : ''}</div>` : ''}
      ${emp.ruc    ? `<div>RUC: ${emp.ruc}</div>` : ''}
      ${emp.tel    ? `<div>Tel: ${emp.tel}</div>` : ''}
      ${emp.web    ? `<div style="color:${colorOsc};">${emp.web}</div>` : ''}
    </div>
  </div>

  <!-- ═══ TÍTULO DEL DOCUMENTO ═══ -->
  <div style="background:${colorOsc};padding:16px 36px;display:flex;justify-content:space-between;align-items:center;">
    <h1 style="margin:0;font-size:20px;font-weight:700;color:#fff;letter-spacing:.3px;">Estado de Cuenta</h1>
    <div style="text-align:right;">
      <div style="font-size:11px;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:1px;">Fecha</div>
      <div style="font-size:14px;font-weight:600;color:#fff;">${fecha}</div>
    </div>
  </div>

  <!-- ═══ DATOS DEL CLIENTE ═══ -->
  <div style="padding:20px 36px 16px;border-bottom:1px solid #e8eaed;background:#fafbfc;">
    <div style="font-size:11px;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:6px;">Cliente</div>
    <div style="font-size:20px;font-weight:700;color:#1a237e;">${cliente.Nombre ?? ''}</div>
    ${cliente.NombreFantasia ? `<div style="font-size:14px;color:#555;margin-top:2px;">${cliente.NombreFantasia}</div>` : ''}
    ${cliente.Direccion ? `<div style="font-size:12px;color:#888;margin-top:2px;">${cliente.Direccion}</div>` : ''}
    ${cliente.CioRuc ? `<div style="font-size:12px;color:#888;margin-top:2px;">Identificación fiscal: <strong>${cliente.CioRuc}</strong></div>` : ''}
  </div>

  <!-- ═══ RESUMEN KPIs ═══ -->
  <div style="display:flex;padding:16px 36px;gap:12px;background:#fff;border-bottom:1px solid #e8eaed;">
    <div style="flex:1;text-align:center;padding:12px;border-radius:8px;background:${colorSec};">
      <div style="font-size:10px;text-transform:uppercase;color:#666;letter-spacing:.5px;">Total Pendiente</div>
      <div style="font-size:18px;font-weight:800;color:${colorOsc};margin-top:2px;">${simboloGlobal} ${fmt(totalPendiente)}</div>
    </div>
    <div style="flex:1;text-align:center;padding:12px;border-radius:8px;background:#fdecea;">
      <div style="font-size:10px;text-transform:uppercase;color:#666;letter-spacing:.5px;">Vencido</div>
      <div style="font-size:18px;font-weight:800;color:#c62828;margin-top:2px;">${simboloGlobal} ${fmt(totalVencido)}</div>
    </div>
    <div style="flex:1;text-align:center;padding:12px;border-radius:8px;background:#e8f5e9;">
      <div style="font-size:10px;text-transform:uppercase;color:#666;letter-spacing:.5px;">Al Día</div>
      <div style="font-size:18px;font-weight:800;color:#2e7d32;margin-top:2px;">${simboloGlobal} ${fmt(totalAlDia)}</div>
    </div>
  </div>

  <!-- ═══ DETALLE DE CUENTAS ═══ -->
  <div style="padding:24px 36px;">
    ${bloquesCuentas || '<p style="color:#bbb;text-align:center;padding:20px 0;">Sin cuentas activas.</p>'}
  </div>

  <!-- ═══ PIE DE PÁGINA ═══ -->
  <div style="background:#f5f5f5;padding:16px 36px;border-top:1px solid #e0e0e0;display:flex;justify-content:space-between;align-items:center;">
    <div style="font-size:10px;color:#aaa;">Mensaje automático — no responder este correo</div>
    <div style="font-size:10px;color:#aaa;">Para consultas: ${emp.email || 'comuníquese con su ejecutivo de cuenta'}</div>
  </div>
</div>
</body></html>`;
}

// ============================================================
// SECCIÓN 5: VERIFICACIÓN DE CONEXIÓN
// ============================================================

async function verificarConexion() {
  const t = getTransporter();
  if (!t) return { ok: false, motivo: 'sin_credenciales' };
  try {
    await t.verify();
    logger.info('[CONT-EMAIL] ✅ Conexión SMTP Brevo OK');
    return { ok: true };
  } catch (err) {
    logger.warn(`[CONT-EMAIL] ⚠️ SMTP fallo: ${err.message}`);
    return { ok: false, motivo: err.message };
  }
}

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  enviarEmail,
  enviarDesdeCola,
  generarHTMLEstadoCuenta,
  obtenerDatosEmpresa,
  verificarConexion,
};
