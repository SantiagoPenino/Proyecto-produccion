// Estado en memoria del aviso de mantenimiento activo. Sirve para reenviarlo a los
// clientes que se conectan DESPUÉS de que se disparó (el evento socket 'server:maintenance'
// es one-shot: quien no estaba conectado al emitirse no lo recibiría sin esto).
let active = null; // { mensaje, endsAt } | null

module.exports = {
    set(mensaje, segundos) {
        active = { mensaje, endsAt: Date.now() + (segundos * 1000) };
    },
    clear() {
        active = null;
    },
    // Devuelve { mensaje, segundos } con el tiempo RESTANTE, o null si no hay o ya expiró.
    getActive() {
        if (!active) return null;
        const segundos = Math.ceil((active.endsAt - Date.now()) / 1000);
        if (segundos <= 0) { active = null; return null; }
        return { mensaje: active.mensaje, segundos };
    }
};
