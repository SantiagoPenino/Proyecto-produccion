const { Resend } = require("resend");
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const resend = new Resend(process.env.RESEND_API_KEY);
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('JWT_SECRET is not defined in environment variables');
const BASE_URL = process.env.BASE_URL || 'https://localhost:5173';

const FROM_EMAIL = 'User <notificaciones@user.com.uy>';

exports.sendMail = async (to, subject, html, attachments = []) => {
    // Clientes.Email es CHAR: llega con relleno de espacios ("mail@x.com      ") y Resend
    // rechaza la dirección. Se limpia acá, así cubre a todos los que mandan (activación,
    // recuperación de contraseña, confirmación de pedido).
    const dest = Array.isArray(to) ? to.map(t => String(t ?? '').trim()) : String(to ?? '').trim();
    try {
        const { data, error } = await resend.emails.send({
            from: FROM_EMAIL,
            to: dest,
            subject,
            html,
            ...(attachments.length > 0 && { attachments })
        });
        if (error) {
            logger.error(`[Email] ❌ RESEND ERROR enviando a ${dest}: ${JSON.stringify(error)}`);
            return false;
        }
        logger.info(`[Email] ✅ Enviado a ${dest}: ${subject}`);
        return true;

    } catch (err) {
        logger.error('[Email] Exception:', err.message);
        return false;
    }
};

exports.sendRegistrationMail = async (to, clientName, codCliente) => {
    // Generar token de activación (expira en 7 días)
    const activationToken = jwt.sign({ codCliente }, JWT_SECRET, { expiresIn: '7d' });
    const activationUrl = `${BASE_URL}/api/web-auth/activate?token=${activationToken}`;

    const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#ffffff;">
        <div style="text-align:center;padding:20px 0;border-bottom:2px solid #f0f0f0;">
            <h1 style="color:#0f172a;margin:0;font-size:24px;">User</h1>
        </div>
        <div style="padding:30px 0;">
            <h2 style="color:#1a1a1a;margin-bottom:8px;">¡Bienvenido/a, ${clientName}!</h2>
            <p style="color:#555;font-size:15px;line-height:1.6;">Tu cuenta ha sido creada exitosamente. Para activarla, hacé clic en el siguiente botón:</p>
            <div style="text-align:center;margin:30px 0;">
                <a href="${activationUrl}" style="display:inline-block;padding:14px 40px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">
                    Activar mi cuenta
                </a>
            </div>
            <p style="color:#888;font-size:13px;">Si no podés hacer clic en el botón, copiá y pegá este enlace en tu navegador:</p>
            <p style="font-size:12px;word-break:break-all;"><a href="${activationUrl}" style="color:#0f172a;text-decoration:underline;">${activationUrl}</a></p>
            <p style="color:#888;font-size:13px;margin-top:20px;">Este enlace expira en 7 días.</p>
        </div>
        <hr style="border:none;border-top:1px solid #eee;">
        <p style="color:#aaa;font-size:11px;text-align:center;margin-top:16px;">User - Sistema de Producción</p>
    </div>
    `;
    return exports.sendMail(to, "Activá tu cuenta", html);
};

exports.sendOrderConfirmation = async (to, clientName, orderNumber, orderDetails) => {
    const html = `<div style="font-family:Arial, sans-serif; max-width:600px; margin: 0 auto; padding: 20px;">
    <h2>Detalles del pedido</h2>
    <p>Hola ${clientName}, tu pedido <strong>#${orderNumber}</strong> fue recibido.</p>
    <p>${orderDetails || 'Pronto nos pondremos en contacto.'}</p>
    <hr>
    <p style="color: #888; font-size: 12px;">User - Sistema de Producción</p>
    </div>`;
    return exports.sendMail(to, `Pedido #${orderNumber} confirmado`, html);
};

// Legacy: code-based reset (kept for compatibility, unused)
exports.sendPasswordResetMail = async (to, resetCode) => {
    const html = `
    <div style="font-family:Arial, sans-serif; max-width:600px; margin: 0 auto; padding: 20px;">
    <h2> Restablecer contraseña </h2>
    <p>Tu código de verificación es:</p>
    <div style="background: #f0f0f0; padding: 20px; text-align:center; font-size:32px; font-weight:bold; letter-spacing:5px; margin:20px 0;">
    ${resetCode}
    </div>
    <p>Este código expira en <strong>15 minutos</strong>.</p>
    <p>Si no solicitaste esto, ignorá este mensaje.</p>
    <hr>
    <p style="color: #888; font-size: 12px;">User - Sistema de Producción</p>
    </div>
    `;
    return exports.sendMail(to, "Código de recuperación de contraseña", html);
};

// New: link-based reset (used by forgotPassword endpoint)
exports.sendPasswordResetLinkMail = async (to, clientName, resetToken) => {
    const resetUrl = `${BASE_URL}/reset-password?token=${resetToken}`;

    const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#ffffff;">
        <div style="text-align:center;padding:20px 0;border-bottom:2px solid #f0f0f0;">
            <h1 style="color:#0f172a;margin:0;font-size:24px;">User</h1>
        </div>
        <div style="padding:30px 0;">
            <h2 style="color:#1a1a1a;margin-bottom:8px;">Recuperar contraseña</h2>
            <p style="color:#555;font-size:15px;line-height:1.6;">
                Hola ${clientName}, recibimos una solicitud para restablecer la contraseña de tu cuenta.
                Hacé clic en el botón de abajo para elegir una nueva contraseña:
            </p>
            <div style="text-align:center;margin:30px 0;">
                <a href="${resetUrl}" style="display:inline-block;padding:14px 40px;background:#0f172a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:16px;">
                    Restablecer contraseña
                </a>
            </div>
            <p style="color:#888;font-size:13px;">Si no podés hacer clic en el botón, copiá y pegá este enlace en tu navegador:</p>
            <p style="font-size:12px;word-break:break-all;"><a href="${resetUrl}" style="color:#0f172a;text-decoration:underline;">${resetUrl}</a></p>
            <p style="color:#888;font-size:13px;margin-top:20px;">
                Este enlace expira en <strong>15 minutos</strong>.<br>
                Si no solicitaste restablecer tu contraseña, podés ignorar este mensaje.
            </p>
        </div>
        <hr style="border:none;border-top:1px solid #eee;">
        <p style="color:#aaa;font-size:11px;text-align:center;margin-top:16px;">User - Sistema de Producción</p>
    </div>
    `;
    return exports.sendMail(to, "Restablecer tu contraseña", html);
};