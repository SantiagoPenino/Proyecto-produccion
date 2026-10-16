/**
 * contabilidadEmailService.js
 * ────────────────────────────────────────────────────────────────────────────
 * Envío de emails vía Nodemailer + Brevo SMTP (facturas CFE desde la bandeja y aviso del
 * job de cuadre de saldos). Independiente del emailService.js existente (Resend).
 * (El envío de estados de cuenta por la cola se sacó el 16/10: la cola nunca se usó.)
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
// EXPORTS
// ============================================================

module.exports = {
  enviarEmail,
};
