/**
 * password.js — hasheo y verificación de contraseñas (bcrypt).
 *
 * Contexto (10/09/2026): hasta hoy las tres tablas de credenciales guardaban la
 * contraseña EN TEXTO PLANO — `Usuarios.ContrasenaHash`, `Clientes.WebPasswordHash`
 * y `Disenadores.WebPasswordHash` dicen "hash" en el nombre pero el login comparaba
 * cadena contra cadena.
 *
 * La migración es PEREZOSA a propósito: `verificar()` entiende los dos formatos, así
 * que se puede deployar sin tocar la base y sin dejar a nadie afuera. Cuando alguien
 * entra con una contraseña vieja, se devuelve `rehash` y el llamador la guarda ya
 * hasheada; el backfill se corre después, tranquilo, y es idempotente.
 *
 * Cuando no queden filas sin `$2` se borra la rama legacy de `verificar()` y recién
 * ahí la contraseña en plano deja de existir en el sistema.
 */
const bcrypt = require('bcryptjs');

// Costo 10: ~50-80 ms por hash en el VPS. Subirlo encarece el login de todos.
const ROUNDS = 10;

/** ¿El valor guardado ya es un hash de bcrypt? ($2a$ / $2b$ / $2y$) */
const esHash = (v) => /^\$2[aby]?\$\d{2}\$/.test(String(v || ''));

/** Hashea una contraseña en claro. Siempre devuelve 60 caracteres. */
async function hashear(plano) {
    return bcrypt.hash(String(plano), ROUNDS);
}

/**
 * Verifica una contraseña contra lo que hay guardado en la base.
 *
 * @returns {Promise<{ok: boolean, rehash?: string}>}
 *   `ok`     — si la contraseña es correcta.
 *   `rehash` — solo cuando acertó contra una contraseña vieja en texto plano: es el
 *              hash que hay que guardar en la columna. Si no viene, no hay nada que hacer.
 */
async function verificar(plano, guardado) {
    if (plano === undefined || plano === null || plano === '') return { ok: false };
    if (guardado === undefined || guardado === null || guardado === '') return { ok: false };

    if (esHash(guardado)) {
        // bcrypt.compare no tira con hashes malformados, devuelve false.
        return { ok: await bcrypt.compare(String(plano), String(guardado)) };
    }

    // Legacy: la columna tiene la contraseña en claro. Se compara como antes y, si
    // acierta, se aprovecha el login para migrarla.
    if (String(guardado) === String(plano)) {
        return { ok: true, rehash: await hashear(plano) };
    }
    return { ok: false };
}

module.exports = { hashear, verificar, esHash, ROUNDS };
