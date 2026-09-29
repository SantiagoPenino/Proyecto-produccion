// ─────────────────────────────────────────────────────────────────────────────
// Salas de socket por usuario INTERNO: `usuario:<IdUsuario>`.
//
// Hasta ahora todos los avisos internos se mandaban con io.emit (les llegan a todos). Para
// avisarle a UNA persona (servicio técnico: encargado, técnico al que se le deriva) el front se
// suscribe con su token (`usuario:suscribir`, al conectar y al reconectar) y el backend emite
// solo a su sala. Mismo criterio que la sala del portal (avisosOrdenesPortal.js): sin un token
// interno válido no se entra a ninguna sala.
// ─────────────────────────────────────────────────────────────────────────────
const jwt = require('jsonwebtoken');

const PREFIJO = 'usuario:';
const salaUsuario = (id) => `${PREFIJO}${id}`;

function suscribir(socket, datos, ack) {
    let id = null;
    try {
        const u = jwt.verify(String(datos?.token || ''), process.env.JWT_SECRET);
        const n = Number(u?.id);
        if (u?.userType === 'INTERNAL' && Number.isInteger(n) && n > 0) id = n;
    } catch (_) { /* token inválido o vencido: sin sala */ }

    // Si en la misma pestaña entró otro usuario, se va de la sala anterior.
    for (const sala of socket.rooms) {
        if (sala.startsWith(PREFIJO) && (!id || sala !== salaUsuario(id))) socket.leave(sala);
    }
    if (id) socket.join(salaUsuario(id));
    if (typeof ack === 'function') ack({ ok: !!id });
}

function emitirAUsuarios(io, usuarioIds, evento, datos) {
    if (!io) return;
    const ids = [...new Set((usuarioIds || []).map(Number).filter(n => Number.isInteger(n) && n > 0))];
    for (const id of ids) io.to(salaUsuario(id)).emit(evento, datos);
}

module.exports = { suscribir, emitirAUsuarios, salaUsuario };
