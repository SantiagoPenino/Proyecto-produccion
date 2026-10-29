// ── Historial de precios (plan INF-SIS-2026-12, punto 2.1) ──────────────────────────────────────────
// Dos historiales, cada uno con lo suyo:
//   · PreciosEspecialesHistorial: las excepciones propias de UN cliente («Guardar tarifa», «Quitar cliente»).
//   · PerfilesPreciosHistorial:  todo lo que le pasa a un PERFIL (sus reglas, área, baja, a qué clientes se
//     asigna). Va aparte porque un perfil lo tienen muchos clientes: cambiarlo es una fila, no una por cliente.
// Antes no quedaba registro de nada de esto: el 28-oct hubo que deducir los % originales con cuentas y
// pedidos viejos. Si una tabla todavía no existe (deploy antes que el SQL), se avisa en el log y la
// operación sigue igual; un error al registrar tampoco frena la operación.
const { sql } = require('../config/db');
const logger = require('../utils/logger');

const tablaExiste = async (conn, tabla) =>
    !!(await new sql.Request(conn).query(`SELECT OBJECT_ID('dbo.${tabla}') AS Id`)).recordset[0].Id;

const corto = (s, n) => (s == null ? null : String(s).slice(0, n));
const r4 = v => Math.round(Number(v || 0) * 10000);

// Misma regla = mismo producto (TOTAL es el producto 0), misma familia o, si no tiene ninguno de los dos,
// mismo código de artículo (hay reglas de perfil cargadas solo con el código), y mismo escalón de cantidad.
// Las excepciones del cliente llaman al escalón MinCantidad y las reglas de perfil, CantidadMinima.
const claveRegla = r => {
    const que = r.ProIdProducto != null ? `P${r.ProIdProducto}`
        : (r.CodGrupo || '').trim() ? `G${r.CodGrupo.trim()}`
        : `C${String(r.CodArticulo || '').trim()}`;
    return `${que}|${Number(r.MinCantidad ?? r.CantidadMinima ?? 0)}`;
};

const resumirCambios = (antes, despues) => {
    const a = new Map(antes.map(r => [claveRegla(r), r]));
    const d = new Map(despues.map(r => [claveRegla(r), r]));
    let nuevas = 0, borradas = 0, cambiadas = 0;
    d.forEach((r, k) => {
        const v = a.get(k);
        if (!v) nuevas++;
        else if (v.TipoRegla !== r.TipoRegla || r4(v.Valor) !== r4(r.Valor) || Number(v.MonIdMoneda) !== Number(r.MonIdMoneda)) cambiadas++;
    });
    a.forEach((_, k) => { if (!d.has(k)) borradas++; });
    return (nuevas + borradas + cambiadas) === 0 ? 'Sin cambios' : `${cambiadas} cambiadas, ${nuevas} nuevas, ${borradas} borradas`;
};

const idsDeLista = lista => String(lista || '').split(',').map(x => parseInt(x.trim(), 10)).filter(n => Number.isInteger(n) && n > 0);

// ── Cliente ────────────────────────────────────────────────────────────────────────────────────────

const leerReglasCliente = async (conn, cliId, codCli) => (await new sql.Request(conn)
    .input('CliId', sql.Int, cliId)
    .input('CodCli', sql.Int, codCli)
    .query(`
        SELECT ItemID, LTRIM(RTRIM(CodArticulo)) AS CodArticulo, ProIdProducto, CodGrupo, TipoRegla, Valor, MonIdMoneda, MinCantidad
        FROM PreciosEspecialesItems
        WHERE CliIdCliente IN (@CliId, @CodCli) OR ClienteID IN (@CliId, @CodCli)
    `)).recordset;

const leerPerfilesCliente = async (conn, cliId, codCli) => (await new sql.Request(conn)
    .input('CliId', sql.Int, cliId)
    .input('CodCli', sql.Int, codCli)
    .query(`
        SELECT DISTINCT PerfilesIDs FROM PreciosEspeciales
        WHERE CliIdCliente IN (@CliId, @CodCli) OR ClienteID IN (@CliId, @CodCli)
    `)).recordset.map(r => r.PerfilesIDs).filter(Boolean).join(',') || null;

const guardarHistorialCliente = async (conn, { cliId, origen, user, antes, despues, perfilesAntes, perfilesDespues }) => {
    try {
        if (!(await tablaExiste(conn, 'PreciosEspecialesHistorial'))) {
            logger.warn(`[PRECIOS-ESP] Falta la tabla PreciosEspecialesHistorial: no quedó registro del cambio del cliente ${cliId} (${origen}). Correr scripts/PROD_crear_PreciosEspecialesHistorial.sql`);
            return;
        }
        await new sql.Request(conn)
            .input('CliId', sql.Int, cliId)
            .input('Origen', sql.VarChar(30), origen)
            .input('UsuarioId', sql.Int, Number.isInteger(user?.id) ? user.id : null)
            .input('Usuario', sql.NVarChar(150), corto(user?.username, 150))
            .input('CantAntes', sql.Int, antes.length)
            .input('CantDespues', sql.Int, despues.length)
            .input('Resumen', sql.NVarChar(500), resumirCambios(antes, despues))
            .input('PerfAntes', sql.NVarChar(500), corto(perfilesAntes, 500))
            .input('PerfDespues', sql.NVarChar(500), corto(perfilesDespues, 500))
            .input('Antes', sql.NVarChar(sql.MAX), JSON.stringify(antes))
            .input('Despues', sql.NVarChar(sql.MAX), JSON.stringify(despues))
            .query(`
                INSERT INTO dbo.PreciosEspecialesHistorial
                    (CliIdCliente, Origen, UsuarioId, Usuario, CantAntes, CantDespues, Resumen, PerfilesAntes, PerfilesDespues, ReglasAntes, ReglasDespues)
                VALUES (@CliId, @Origen, @UsuarioId, @Usuario, @CantAntes, @CantDespues, @Resumen, @PerfAntes, @PerfDespues, @Antes, @Despues)
            `);
    } catch (e) {
        logger.warn(`[PRECIOS-ESP] No se pudo registrar el historial del cliente ${cliId} (${origen}): ${e.message}`);
    }
};

// ── Perfiles ───────────────────────────────────────────────────────────────────────────────────────

// Cómo está un perfil ahora: su cabecera y sus reglas (o solo las de un producto, para las escalas)
const leerPerfil = async (conn, perfilId, proId = null) => {
    const cab = (await new sql.Request(conn).input('P', sql.Int, perfilId)
        .query('SELECT ID, Nombre, Descripcion, Activo, EsGlobal, Categoria FROM dbo.PerfilesPrecios WHERE ID = @P')).recordset[0] || null;
    const req = new sql.Request(conn).input('P', sql.Int, perfilId);
    if (proId != null) req.input('Pro', sql.Int, proId);
    const reglas = (await req.query(`
        SELECT ID, ProIdProducto, LTRIM(RTRIM(CodArticulo)) AS CodArticulo, CodGrupo, TipoRegla, Valor, MonIdMoneda, CantidadMinima
        FROM dbo.PerfilesItems WHERE PerfilID = @P ${proId != null ? 'AND ProIdProducto = @Pro' : ''}
        ORDER BY ProIdProducto, CodGrupo, CantidadMinima`)).recordset;
    return { cabecera: cab, reglas };
};

const insertarHistorialPerfil = async (conn, { perfilId, nombrePerfil, origen, user, cliId = null, proId = null, resumen, antes = null, despues = null }) => {
    if (!(await tablaExiste(conn, 'PerfilesPreciosHistorial'))) {
        logger.warn(`[PERFILES] Falta la tabla PerfilesPreciosHistorial: no quedó registro del cambio del perfil ${perfilId} (${origen}). Correr scripts/PROD_crear_PerfilesPreciosHistorial.sql`);
        return;
    }
    await new sql.Request(conn)
        .input('P', sql.Int, perfilId)
        .input('Nom', sql.NVarChar(150), corto(nombrePerfil, 150))
        .input('Origen', sql.VarChar(30), origen)
        .input('Cli', sql.Int, cliId)
        .input('Pro', sql.Int, proId)
        .input('UsuarioId', sql.Int, Number.isInteger(user?.id) ? user.id : null)
        .input('Usuario', sql.NVarChar(150), corto(user?.username, 150))
        .input('Resumen', sql.NVarChar(500), corto(resumen, 500))
        .input('Antes', sql.NVarChar(sql.MAX), antes == null ? null : JSON.stringify(antes))
        .input('Despues', sql.NVarChar(sql.MAX), despues == null ? null : JSON.stringify(despues))
        .query(`
            INSERT INTO dbo.PerfilesPreciosHistorial (PerfilID, NombrePerfil, Origen, CliIdCliente, ProIdProducto, UsuarioId, Usuario, Resumen, Antes, Despues)
            VALUES (@P, @Nom, @Origen, @Cli, @Pro, @UsuarioId, @Usuario, @Resumen, @Antes, @Despues)
        `);
};

// Registra un cambio en el contenido de un perfil: `antes` es lo que devolvió leerPerfil antes de tocarlo;
// lo de después lo lee acá. Las escalas, los beneficios y las ediciones sueltas que no cambian nada no
// dejan fila (se guardan seguido sin cambios); guardar el perfil a mano sí, aunque no haya cambios.
const registrarCambioPerfil = async (conn, { perfilId, origen, user, antes, proId = null }) => {
    try {
        const despues = await leerPerfil(conn, perfilId, proId);
        const cabA = antes?.cabecera || null, cabD = despues.cabecera;
        const camposCab = ['Nombre', 'Descripcion', 'Activo', 'EsGlobal', 'Categoria'];
        const cambiosCab = cabA && cabD ? camposCab.filter(c => String(cabA[c] ?? '') !== String(cabD[c] ?? '')) : [];
        const reglasRes = resumirCambios(antes?.reglas || [], despues.reglas);
        const partes = [];
        if (!cabA && cabD) partes.push('Perfil nuevo');
        if (cambiosCab.length) partes.push(`Cambió: ${cambiosCab.join(', ')}`);
        if (reglasRes !== 'Sin cambios' || !partes.length) partes.push(`Reglas: ${reglasRes}`);
        const sinCambios = !cambiosCab.length && cabA && reglasRes === 'Sin cambios';
        if (sinCambios && ['ESCALAS', 'BENEFICIO', 'EDITAR_REGLAS'].includes(origen)) return;
        await insertarHistorialPerfil(conn, {
            perfilId, nombrePerfil: cabD?.Nombre || cabA?.Nombre, origen, user, proId,
            resumen: partes.join(' · '), antes, despues
        });
    } catch (e) {
        logger.warn(`[PERFILES] No se pudo registrar el historial del perfil ${perfilId} (${origen}): ${e.message}`);
    }
};

// Asignaciones: compara la lista de perfiles del cliente antes y después y deja una fila por cada
// perfil que se le agregó o se le quitó. `tipo`: 'ASIGNACION' (Gestión de precios) o 'RRHH'.
const registrarAsignaciones = async (conn, { cliId, perfilesAntes, perfilesDespues, tipo = 'ASIGNACION', user, desde = null }) => {
    try {
        const a = new Set(idsDeLista(perfilesAntes)), d = new Set(idsDeLista(perfilesDespues));
        const agregados = [...d].filter(x => !a.has(x)), quitados = [...a].filter(x => !d.has(x));
        if (!agregados.length && !quitados.length) return;
        const ids = [...agregados, ...quitados];
        const nombres = {};
        (await new sql.Request(conn).query(`SELECT ID, LTRIM(RTRIM(Nombre)) AS Nombre FROM dbo.PerfilesPrecios WHERE ID IN (${ids.join(',')})`))
            .recordset.forEach(r => { nombres[r.ID] = r.Nombre; });
        const sufijo = desde ? ` (desde ${desde})` : '';
        const lista = { antes: perfilesAntes || null, despues: perfilesDespues || null };
        for (const p of agregados) {
            await insertarHistorialPerfil(conn, {
                perfilId: p, nombrePerfil: nombres[p], origen: tipo === 'RRHH' ? 'RRHH_APLICAR' : 'ASIGNAR_A_CLIENTE', user, cliId,
                resumen: `Asignado al cliente ${cliId}${sufijo}`, antes: lista.antes, despues: lista.despues
            });
        }
        for (const p of quitados) {
            await insertarHistorialPerfil(conn, {
                perfilId: p, nombrePerfil: nombres[p], origen: tipo === 'RRHH' ? 'RRHH_QUITAR' : 'QUITAR_DE_CLIENTE', user, cliId,
                resumen: `Quitado del cliente ${cliId}${sufijo}`, antes: lista.antes, despues: lista.despues
            });
        }
    } catch (e) {
        logger.warn(`[PERFILES] No se pudo registrar la asignación de perfiles del cliente ${cliId}: ${e.message}`);
    }
};

module.exports = {
    resumirCambios,
    leerReglasCliente, leerPerfilesCliente, guardarHistorialCliente,
    leerPerfil, registrarCambioPerfil, registrarAsignaciones
};
