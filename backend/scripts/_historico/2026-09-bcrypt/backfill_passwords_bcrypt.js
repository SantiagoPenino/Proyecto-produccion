/**
 * backfill_passwords_bcrypt.js — hashea las contraseñas que todavía están en texto plano.
 *
 * CORRER RECIÉN DESPUÉS de tener deployado el código que verifica con utils/password.js:
 * ese código entiende los dos formatos, así que si el backfill se corta a la mitad nadie
 * queda sin poder entrar.
 *
 * Es IDEMPOTENTE: solo toca las filas que no arrancan con `$2`. Se puede cortar y retomar.
 *
 * Uso:
 *   node backend/scripts/backfill_passwords_bcrypt.js            → simulacro (no escribe)
 *   node backend/scripts/backfill_passwords_bcrypt.js --aplicar  → escribe
 *   node backend/scripts/backfill_passwords_bcrypt.js --aplicar --tabla usuarios
 *
 * ANTES de correr con --aplicar, el backup (única vuelta atrás):
 *   SELECT IdUsuario, ContrasenaHash   INTO dbo._bk_Usuarios_pass_20260910    FROM dbo.Usuarios;
 *   SELECT CodCliente, WebPasswordHash INTO dbo._bk_Clientes_pass_20260910    FROM dbo.Clientes;
 *   SELECT DisenadorID, WebPasswordHash INTO dbo._bk_Disenadores_pass_20260910 FROM dbo.Disenadores;
 */
const { getPool, sql } = require('../config/db');
const { hashear, esHash } = require('../utils/password');

const APLICAR = process.argv.includes('--aplicar');
const soloTabla = (() => {
    const i = process.argv.indexOf('--tabla');
    return i >= 0 ? String(process.argv[i + 1] || '').toLowerCase() : null;
})();

// Una tabla por vez, empezando por Usuarios: son pocos y están a mano para probar.
const TABLAS = [
    { clave: 'usuarios',    tabla: 'dbo.Usuarios',    id: 'IdUsuario',   col: 'ContrasenaHash',   etiqueta: 'Usuario' },
    { clave: 'disenadores', tabla: 'dbo.Disenadores', id: 'DisenadorID', col: 'WebPasswordHash',  etiqueta: 'Email' },
    { clave: 'clientes',    tabla: 'dbo.Clientes',    id: 'CodCliente',  col: 'WebPasswordHash',  etiqueta: 'IDCliente' },
];

const LOTE = 200;

async function migrar(pool, def) {
    const { tabla, id, col, etiqueta } = def;
    let migradas = 0, vacias = 0, yaHash = 0, errores = 0;

    const r = await pool.request().query(
        `SELECT ${id} AS Id, ${col} AS Pass, ${etiqueta} AS Etiqueta
         FROM ${tabla} WITH(NOLOCK)
         WHERE ${col} IS NOT NULL AND LTRIM(RTRIM(${col})) <> ''`
    );

    const pendientes = [];
    for (const fila of r.recordset) {
        if (esHash(fila.Pass)) { yaHash++; continue; }
        pendientes.push(fila);
    }
    const totalVacias = await pool.request().query(
        `SELECT COUNT(*) AS N FROM ${tabla} WITH(NOLOCK)
         WHERE ${col} IS NULL OR LTRIM(RTRIM(${col})) = ''`);
    vacias = totalVacias.recordset[0].N;

    console.log(`\n${tabla}`);
    console.log(`  ya hasheadas : ${yaHash}`);
    console.log(`  sin password : ${vacias}   (se dejan como están: son el flujo de "primer login define la clave")`);
    console.log(`  a migrar     : ${pendientes.length}`);

    if (!APLICAR || !pendientes.length) return { migradas: 0, pendientes: pendientes.length };

    for (let i = 0; i < pendientes.length; i += LOTE) {
        const lote = pendientes.slice(i, i + LOTE);
        for (const fila of lote) {
            try {
                const hash = await hashear(fila.Pass);
                // El WHERE repite la condición de "todavía en plano": si alguien se logueó
                // entremedio y ya se migró solo, este UPDATE no pisa nada.
                const up = await pool.request()
                    .input('Id', sql.Int, fila.Id)
                    .input('Hash', sql.NVarChar(300), hash)
                    .query(`UPDATE ${tabla} SET ${col} = @Hash
                            WHERE ${id} = @Id AND ${col} NOT LIKE '$2%'`);
                if (up.rowsAffected[0]) migradas++;
            } catch (e) {
                errores++;
                console.error(`  ERROR en ${id}=${fila.Id} (${fila.Etiqueta}): ${e.message}`);
            }
        }
        console.log(`  ... ${Math.min(i + LOTE, pendientes.length)}/${pendientes.length}`);
    }
    console.log(`  migradas: ${migradas}${errores ? `   errores: ${errores}` : ''}`);
    return { migradas, pendientes: pendientes.length };
}

(async () => {
    if (!APLICAR) {
        console.log('=== SIMULACRO (sin --aplicar no se escribe nada) ===');
    } else {
        console.log('=== APLICANDO — asegurate de tener el backup hecho ===');
    }
    const pool = await getPool();
    let total = 0;
    for (const def of TABLAS) {
        if (soloTabla && def.clave !== soloTabla) continue;
        const r = await migrar(pool, def);
        total += r.migradas;
    }
    console.log(`\nTotal migradas: ${total}`);
    if (!APLICAR) console.log('Volvé a correrlo con --aplicar para escribir.');
    process.exit(0);
})().catch(e => {
    console.error('FALLO:', e.message);
    process.exit(1);
});
