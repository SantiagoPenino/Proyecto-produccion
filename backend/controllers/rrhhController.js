'use strict';
// /api/rrhh — Recursos Humanos.
//
// Descuento a trabajadores: quién tiene aplicado el perfil de precios "Descuento Trabajadores 10%"
// y aplicarlo / quitarlo de a un cliente. Es la misma asignación que hace Gestión de Precios →
// Asignación a Clientes (PreciosEspeciales.PerfilesIDs), pero tocando SOLO este perfil: los otros
// perfiles que tenga el cliente quedan como estaban.
//
// Cómo lo lee el cotizador (pricingService): un perfil está aplicado si su ID está en la lista
// PerfilesIDs (texto '4,5') O en la columna vieja PerfilID, en una fila de PreciosEspeciales cuyo
// CliIdCliente sea el CliIdCliente o el CodCliente del cliente. Por eso quitar limpia las dos
// columnas en todas esas filas: si queda en PerfilID, el descuento se sigue aplicando.
//
// Trabajador ↔ cuenta de cliente: un trabajador de la planilla (Trabajadores) corresponde a una
// cuenta si está VINCULADO a mano (dbo.TrabajadoresClientes) o si la cédula coincide con el
// CI/RUT de la cuenta (Clientes.CioRuc). El vínculo a mano sirve aunque la cuenta tenga otro
// documento (el RUT de su empresa, por ejemplo).
const { getPool, sql } = require('../config/db');
const logger = require('../utils/logger');

const RUTA_DESCUENTO = '/rrhh/descuento-trabajadores';
const SQL_MENU = 'backend/scripts/menu_rrhh_descuento_trabajadores.sql';

// El perfil se identifica por ID guardado en ConfiguracionGlobal (lo carga SQL_MENU): los ID de
// local y producción no coinciden y el nombre se puede cambiar. Sin la clave, se busca por nombre.
const CLAVE_PERFIL = 'RRHH_PERFIL_DESCUENTO_TRABAJADORES';

const conStatus = (status, mensaje) => { const e = new Error(mensaje); e.status = status; return e; };
const responderError = (res, e, contexto) => {
    if (!e.status || e.status >= 500) logger.error(`[RRHH] ${contexto}:`, e);
    res.status(e.status || 500).json({ error: e.message });
};

// La tabla de vínculos la crea SQL_MENU. Una vez que existe no se vuelve a mirar.
let hayTablaVinculos = false;
const exigirTablaVinculos = async (pool) => {
    if (hayTablaVinculos) return;
    const r = await pool.request().query("SELECT OBJECT_ID('dbo.TrabajadoresClientes') AS O");
    if (r.recordset[0].O == null) throw conStatus(503, `Falta la tabla TrabajadoresClientes: hay que correr ${SQL_MENU}.`);
    hayTablaVinculos = true;
};

// ── Cédulas ──────────────────────────────────────────────────────────────────
// Cédula del cliente en número, para cruzarla con Trabajadores.Cedula (int). CioRuc es CHAR y
// viene de muchas formas: '53637682', '5.413.264-9', con espacios de padding o vacío.
const CEDULA_CLIENTE = (alias) =>
    `TRY_CAST(REPLACE(REPLACE(REPLACE(LTRIM(RTRIM(${alias}.CioRuc)), '.', ''), '-', ''), ' ', '') AS BIGINT)`;

const soloDigitos = (s) => String(s ?? '').replace(/[.\-\s]/g, '');

// Dígito verificador de la cédula uruguaya: los 7 primeros dígitos (con ceros a la izquierda)
// por 2,9,8,7,6,3,4; el verificador es lo que le falta a la suma para llegar a la decena.
const ciValida = (digitos) => {
    if (!/^\d{6,8}$/.test(digitos)) return false;
    const base = digitos.slice(0, -1).padStart(7, '0');
    const suma = [...base].reduce((s, d, i) => s + Number(d) * [2, 9, 8, 7, 6, 3, 4][i], 0);
    return (10 - (suma % 10)) % 10 === Number(digitos.slice(-1));
};

// Ficha del trabajador de una cuenta: primero el vinculado a mano, si no por cédula. TOP 1: hay
// cédulas repetidas en Trabajadores y no pueden duplicar al cliente. La columna es [Área] con Á
// mayúscula (U+00C1).
const FICHA_TRABAJADOR = (aliasCliente) => `
    OUTER APPLY (
        SELECT TOP 1 t.Cedula AS TrabajadorCedula, t.Nombre AS TrabajadorNombre, t.[Área] AS TrabajadorArea,
               t.Puesto AS TrabajadorPuesto, CASE WHEN v.Cedula IS NOT NULL THEN 1 ELSE 0 END AS TrabajadorPorVinculo
        FROM dbo.Trabajadores t WITH(NOLOCK)
        LEFT JOIN dbo.TrabajadoresClientes v WITH(NOLOCK) ON v.Cedula = t.Cedula AND v.CliIdCliente = ${aliasCliente}.CliIdCliente
        WHERE v.Cedula IS NOT NULL OR t.Cedula = ${CEDULA_CLIENTE(aliasCliente)}
        ORDER BY CASE WHEN v.Cedula IS NOT NULL THEN 0 ELSE 1 END,
                 CASE WHEN NULLIF(LTRIM(RTRIM(t.[Área])), '') IS NULL THEN 1 ELSE 0 END
    ) ft`;

const fichaDe = (f) => (f.TrabajadorCedula == null ? null : {
    cedula: f.TrabajadorCedula,
    nombre: (f.TrabajadorNombre || '').trim(),
    area: (f.TrabajadorArea || '').trim(),
    puesto: (f.TrabajadorPuesto || '').trim(),
    porVinculo: f.TrabajadorPorVinculo === 1
});

// ¿La cuenta (alias con CliIdCliente y CodCliente) tiene el perfil @PID / @PIDTxt?
const TIENE_PERFIL = (alias) => `
    EXISTS (SELECT 1 FROM dbo.PreciosEspeciales PE WITH(NOLOCK)
            WHERE PE.CliIdCliente IN (${alias}.CliIdCliente, ${alias}.CodCliente)
              AND (PE.PerfilID = @PID
                   OR EXISTS (SELECT 1 FROM STRING_SPLIT(CAST(PE.PerfilesIDs AS VARCHAR(MAX)), ',') s
                              WHERE LTRIM(RTRIM(s.value)) = @PIDTxt)))`;

// ── Perfiles ─────────────────────────────────────────────────────────────────
// Lista de perfiles de una fila de PreciosEspeciales: PerfilesIDs, o la columna vieja PerfilID
// si la lista está vacía (mismo criterio que la pantalla de Asignación a Clientes).
const idsDeFila = (fila) => {
    const lista = String(fila.PerfilesIDs ?? '')
        .split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isInteger(n));
    if (lista.length === 0 && Number.isInteger(fila.PerfilID)) lista.push(fila.PerfilID);
    return [...new Set(lista)];
};

const resolverPerfil = async (pool) => {
    const porClave = await pool.request()
        .input('K', sql.VarChar(100), CLAVE_PERFIL)
        .query(`SELECT TOP 1 PP.ID, PP.Nombre, PP.Categoria
                FROM dbo.PerfilesPrecios PP
                WHERE PP.Activo = 1
                  AND PP.ID = (SELECT TOP 1 TRY_CAST(Valor AS INT) FROM dbo.ConfiguracionGlobal WHERE Clave = @K)`);
    if (porClave.recordset[0]) return porClave.recordset[0];

    const porNombre = await pool.request().query(`
        SELECT TOP 1 ID, Nombre, Categoria
        FROM dbo.PerfilesPrecios
        WHERE Activo = 1 AND LTRIM(Nombre) LIKE 'Descuento Trabajadores%'
        ORDER BY ID`);
    return porNombre.recordset[0] || null;
};

const exigirPerfil = async (pool) => {
    const perfil = await resolverPerfil(pool);
    if (!perfil) throw conStatus(409, 'No se encontró el perfil "Descuento Trabajadores".');
    return perfil;
};

// ── Acceso y auditoría ───────────────────────────────────────────────────────
// El token interno no siempre trae idRol: Admin también por nombre de rol (mismo criterio que
// servicioTecnicoComun y wmsInternoController).
const esAdmin = (u) => Number(u?.idRol) === 1 || String(u?.role || '').trim().toLowerCase() === 'admin';

// Admin siempre; el resto, si tiene la entrada en su menú. Se resuelve por el usuario, igual que
// arma el menú menuController.getByUser (Usuarios → PermisosRoles → Modulos), y por Ruta: los
// IdModulo de local y producción no coinciden.
const exigirAcceso = async (req, res, next) => {
    try {
        const u = req.user;
        if (esAdmin(u)) return next();
        const idUsuario = Number(u?.id);
        if (Number.isInteger(idUsuario)) {
            const pool = await getPool();
            const r = await pool.request()
                .input('UID', sql.Int, idUsuario)
                .input('Ruta', sql.NVarChar(200), RUTA_DESCUENTO)
                .query(`SELECT TOP 1 1 AS Si
                        FROM dbo.Usuarios us
                        JOIN dbo.PermisosRoles pr ON pr.IdRol = us.IdRol
                        JOIN dbo.Modulos m ON m.IdModulo = pr.IdModulo
                        WHERE us.IdUsuario = @UID AND LTRIM(RTRIM(m.Ruta)) = @Ruta`);
            if (r.recordset.length > 0) return next();
        }
        // 403 y no 401: el 401 hace que el front cierre la sesión (apiClient.js).
        return res.status(403).json({ error: 'Tu rol no tiene acceso a Descuento a Trabajadores.' });
    } catch (e) {
        responderError(res, e, 'Error verificando acceso');
    }
};

const auditar = async (pool, req, accion, detalles) => {
    try {
        await pool.request()
            .input('UID', sql.Int, Number(req.user?.id) || null)
            .input('Accion', sql.NVarChar(100), accion)
            .input('Detalles', sql.NVarChar(sql.MAX), detalles)
            .input('IP', sql.NVarChar(50), String(req.ip || '').slice(0, 50))
            .query(`INSERT INTO dbo.Auditoria (IdUsuario, Accion, Detalles, DireccionIP, FechaHora)
                    VALUES (@UID, @Accion, @Detalles, @IP, GETDATE())`);
    } catch (e) {
        logger.warn(`[RRHH] No se pudo registrar la auditoría (${accion}): ${e.message}`);
    }
};

// Para los textos de auditoría: el ID de cliente es lo que la gente reconoce.
const describirCliente = (c) =>
    `${(c.IDCliente || c.NombreFantasia || c.Nombre || '').trim() || 'cliente'} (CliIdCliente ${c.CliIdCliente}, Cod ${c.CodCliente})`;

// Búsqueda por palabras, sin importar acentos ni orden: "yoania rodriguez" encuentra
// "Yoania Yamiles Rodríguez Ricardo". Carga los parámetros en el request y devuelve la condición.
const todasLasPalabras = (request, termino, expresion) => {
    const palabras = termino.split(/\s+/).filter(Boolean).slice(0, 6);
    palabras.forEach((p, i) => request.input(`w${i}`, sql.NVarChar(200), `%${p}%`));
    return palabras.map((_, i) => `${expresion} COLLATE Latin1_General_CI_AI LIKE @w${i}`).join(' AND ');
};

// ── Lectura ──────────────────────────────────────────────────────────────────
// GET /descuento-trabajadores
// { perfil, clientes: [quienes lo tienen], sugeridos: [cuentas de trabajadores sin el descuento],
//   sinCuenta: [trabajadores sin cuenta vinculada ni con su cédula] }
const listar = async (req, res) => {
    try {
        const pool = await getPool();
        await exigirTablaVinculos(pool);
        const perfil = await resolverPerfil(pool);
        if (!perfil) {
            return res.json({ perfil: null, clientes: [], sugeridos: [], sinCuenta: [] });
        }

        const [conPerfil, perfiles, planilla] = await Promise.all([
            pool.request()
                .input('PID', sql.Int, perfil.ID)
                .input('PIDTxt', sql.VarChar(10), String(perfil.ID))
                .query(`
                    SELECT PE.CliIdCliente AS CliIdFila, PE.PerfilID, PE.PerfilesIDs, PE.UltimaActualizacion,
                           c.CliIdCliente, c.CodCliente, RTRIM(c.Nombre) AS Nombre, RTRIM(c.NombreFantasia) AS NombreFantasia,
                           RTRIM(c.IDCliente) AS IDCliente, RTRIM(c.CioRuc) AS CioRuc, RTRIM(c.Email) AS Email,
                           RTRIM(c.TelefonoTrabajo) AS Telefono, c.ESTADO AS Estado,
                           ft.TrabajadorCedula, ft.TrabajadorNombre, ft.TrabajadorArea, ft.TrabajadorPuesto, ft.TrabajadorPorVinculo
                    FROM dbo.PreciosEspeciales PE WITH(NOLOCK)
                    OUTER APPLY (
                        SELECT TOP 1 * FROM dbo.Clientes cc WITH(NOLOCK)
                        WHERE cc.CliIdCliente = PE.CliIdCliente OR cc.CodCliente = PE.CliIdCliente
                        ORDER BY CASE WHEN cc.CliIdCliente = PE.CliIdCliente THEN 0 ELSE 1 END
                    ) c
                    ${FICHA_TRABAJADOR('c')}
                    WHERE PE.PerfilID = @PID
                       OR EXISTS (SELECT 1 FROM STRING_SPLIT(CAST(PE.PerfilesIDs AS VARCHAR(MAX)), ',') s
                                  WHERE LTRIM(RTRIM(s.value)) = @PIDTxt)`),
            pool.request().query(`SELECT ID, Nombre FROM dbo.PerfilesPrecios WITH(NOLOCK)`),
            pool.request()
                .input('PID', sql.Int, perfil.ID)
                .input('PIDTxt', sql.VarChar(10), String(perfil.ID))
                .query(`
                    -- Una fila por cédula: hay cédulas repetidas en Trabajadores (se prefiere la que tiene área).
                    WITH Trab AS (
                        SELECT t.Cedula, t.Nombre, t.[Área] AS Area, t.Puesto,
                               ROW_NUMBER() OVER (PARTITION BY t.Cedula
                                                  ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(t.[Área])), '') IS NULL THEN 1 ELSE 0 END) AS rn
                        FROM dbo.Trabajadores t WITH(NOLOCK)
                        WHERE t.Cedula IS NOT NULL
                    ),
                    CliCed AS (
                        SELECT c.CliIdCliente, ${CEDULA_CLIENTE('c')} AS Ced
                        FROM dbo.Clientes c WITH(NOLOCK)
                        WHERE NULLIF(LTRIM(RTRIM(c.CioRuc)), '') IS NOT NULL
                    ),
                    -- Cuentas de cada trabajador: por cédula y vinculadas a mano (PorVinculo = 1)
                    Pares AS (
                        SELECT Cedula, CliIdCliente, MAX(PorVinculo) AS PorVinculo
                        FROM (
                            SELECT t.Cedula, cc.CliIdCliente, 0 AS PorVinculo
                            FROM Trab t JOIN CliCed cc ON cc.Ced = t.Cedula
                            WHERE t.rn = 1
                            UNION ALL
                            SELECT v.Cedula, v.CliIdCliente, 1 FROM dbo.TrabajadoresClientes v WITH(NOLOCK)
                        ) x
                        GROUP BY Cedula, CliIdCliente
                    )
                    SELECT t.Cedula AS TrabajadorCedula, t.Nombre AS TrabajadorNombre, t.Area AS TrabajadorArea,
                           t.Puesto AS TrabajadorPuesto, p.PorVinculo AS TrabajadorPorVinculo,
                           c.CliIdCliente, c.CodCliente, RTRIM(c.Nombre) AS Nombre, RTRIM(c.NombreFantasia) AS NombreFantasia,
                           RTRIM(c.IDCliente) AS IDCliente, RTRIM(c.CioRuc) AS CioRuc,
                           CASE WHEN c.CliIdCliente IS NOT NULL AND ${TIENE_PERFIL('c')} THEN 1 ELSE 0 END AS TieneDescuento
                    FROM Trab t
                    LEFT JOIN Pares p ON p.Cedula = t.Cedula
                    LEFT JOIN dbo.Clientes c WITH(NOLOCK) ON c.CliIdCliente = p.CliIdCliente
                    WHERE t.rn = 1
                    ORDER BY t.Nombre, c.CliIdCliente DESC`)
        ]);

        const nombresPerfil = new Map(perfiles.recordset.map(p => [p.ID, (p.Nombre || '').trim()]));
        const nombrePerfil = (id) => nombresPerfil.get(id) || `Perfil ${id}`;

        // Un cliente puede tener dos filas (una por CliIdCliente y otra vieja por CodCliente): una sola entrada.
        const porCliente = new Map();
        for (const f of conPerfil.recordset) {
            const clave = f.CliIdCliente ?? `fila-${f.CliIdFila}`;
            const otros = idsDeFila(f).filter(id => id !== perfil.ID).map(nombrePerfil);
            const previo = porCliente.get(clave);
            if (previo) {
                previo.otrosPerfiles = [...new Set([...previo.otrosPerfiles, ...otros])];
                if (f.UltimaActualizacion > previo.ultimaActualizacion) previo.ultimaActualizacion = f.UltimaActualizacion;
                continue;
            }
            porCliente.set(clave, {
                cliIdCliente: f.CliIdCliente ?? f.CliIdFila,
                existeCliente: f.CliIdCliente != null,
                codCliente: f.CodCliente,
                idCliente: f.IDCliente,
                nombre: f.Nombre,
                nombreFantasia: f.NombreFantasia,
                cioRuc: f.CioRuc,
                email: f.Email,
                telefono: f.Telefono,
                estado: f.Estado,
                trabajador: fichaDe(f),
                otrosPerfiles: otros,
                ultimaActualizacion: f.UltimaActualizacion
            });
        }
        const titulo = (c) => (c.idCliente || c.nombreFantasia || c.nombre || '').trim();
        const clientes = [...porCliente.values()].sort((a, b) => titulo(a).localeCompare(titulo(b), 'es'));

        // Planilla contra cuentas:
        //  - sugeridos: cuentas de un trabajador (vinculadas o con su cédula) que no tienen el descuento.
        //  - sinCuenta: trabajadores sin ninguna cuenta. No se les puede aplicar hasta vincularles una.
        const porCedula = new Map();
        for (const f of planilla.recordset) {
            if (!porCedula.has(f.TrabajadorCedula)) porCedula.set(f.TrabajadorCedula, { fila: f, cuentas: [] });
            if (f.CliIdCliente != null) porCedula.get(f.TrabajadorCedula).cuentas.push(f);
        }
        const sugeridos = [];
        const sinCuenta = [];
        for (const { fila, cuentas } of porCedula.values()) {
            if (cuentas.length === 0) {
                sinCuenta.push({ cedula: fila.TrabajadorCedula, trabajador: { ...fichaDe(fila), porVinculo: false } });
                continue;
            }
            const conDescuento = cuentas.find(c => c.TieneDescuento === 1);
            for (const s of cuentas.filter(c => c.TieneDescuento !== 1)) {
                sugeridos.push({
                    cliIdCliente: s.CliIdCliente,
                    codCliente: s.CodCliente,
                    idCliente: s.IDCliente,
                    nombre: s.Nombre,
                    nombreFantasia: s.NombreFantasia,
                    cioRuc: s.CioRuc,
                    trabajador: fichaDe(s),
                    // Ya lo tiene en otra cuenta del mismo trabajador
                    otraCuentaConDescuento: conDescuento ? titulo({ idCliente: conDescuento.IDCliente, nombreFantasia: conDescuento.NombreFantasia, nombre: conDescuento.Nombre }) : null
                });
            }
        }

        res.json({
            perfil: { id: perfil.ID, nombre: (perfil.Nombre || '').trim(), categoria: (perfil.Categoria || '').trim() || 'Todos' },
            clientes,
            sugeridos,
            sinCuenta
        });
    } catch (e) {
        responderError(res, e, 'Error listando descuento a trabajadores');
    }
};

// GET /descuento-trabajadores/buscar?q=  — clientes por nombre, fantasía, ID, código o cédula.
const buscar = async (req, res) => {
    // Recortado y acotado: los nombres salen de columnas CHAR con padding (ver clientsController.searchClients).
    const termino = String(req.query.q ?? '').trim().slice(0, 100);
    if (termino.length < 2) return res.json([]);
    try {
        const pool = await getPool();
        await exigirTablaVinculos(pool);
        const perfil = await resolverPerfil(pool);
        const digitos = soloDigitos(termino);
        const cedula = /^\d{6,9}$/.test(digitos) ? Number(digitos) : null;

        const r = pool.request()
            .input('exacto', sql.NVarChar(100), termino)
            .input('ced', sql.BigInt, cedula)
            .input('PID', sql.Int, perfil?.ID ?? -1)
            .input('PIDTxt', sql.VarChar(10), String(perfil?.ID ?? -1));
        const todas = todasLasPalabras(r, termino, `CONCAT(c.Nombre, ' ', c.NombreFantasia, ' ', c.IDCliente)`);
        const resultado = await r.query(`
                SELECT TOP 15 c.CliIdCliente, c.CodCliente, RTRIM(c.Nombre) AS Nombre, RTRIM(c.NombreFantasia) AS NombreFantasia,
                       RTRIM(c.IDCliente) AS IDCliente, RTRIM(c.CioRuc) AS CioRuc, c.ESTADO AS Estado,
                       ft.TrabajadorCedula, ft.TrabajadorNombre, ft.TrabajadorArea, ft.TrabajadorPuesto, ft.TrabajadorPorVinculo,
                       CASE WHEN ${TIENE_PERFIL('c')} THEN 1 ELSE 0 END AS TieneDescuento
                FROM dbo.Clientes c WITH(NOLOCK)
                ${FICHA_TRABAJADOR('c')}
                WHERE (${todas})
                   OR CAST(c.CodCliente AS VARCHAR(20)) = @exacto
                   OR (@ced IS NOT NULL AND ${CEDULA_CLIENTE('c')} = @ced)
                ORDER BY
                    CASE
                        WHEN @ced IS NOT NULL AND ${CEDULA_CLIENTE('c')} = @ced THEN 0
                        WHEN LTRIM(RTRIM(c.IDCliente)) = @exacto THEN 1
                        WHEN CAST(c.CodCliente AS VARCHAR(20)) = @exacto THEN 2
                        ELSE 3
                    END,
                    LTRIM(RTRIM(c.IDCliente))`);

        res.json(resultado.recordset.map(c => ({
            cliIdCliente: c.CliIdCliente,
            codCliente: c.CodCliente,
            idCliente: c.IDCliente,
            nombre: c.Nombre,
            nombreFantasia: c.NombreFantasia,
            cioRuc: c.CioRuc,
            estado: c.Estado,
            tieneDescuento: c.TieneDescuento === 1,
            trabajador: fichaDe(c)
        })));
    } catch (e) {
        responderError(res, e, `Error buscando clientes "${termino}"`);
    }
};

// GET /descuento-trabajadores/trabajadores?q=  — la planilla, por nombre o cédula (para vincular).
const buscarTrabajadores = async (req, res) => {
    const termino = String(req.query.q ?? '').trim().slice(0, 100);
    if (termino.length < 2) return res.json([]);
    try {
        const pool = await getPool();
        const digitos = soloDigitos(termino);
        const r = pool.request()
            .input('ced', sql.BigInt, /^\d{4,9}$/.test(digitos) ? Number(digitos) : null)
            .input('cedTxt', sql.VarChar(20), /^\d{4,9}$/.test(digitos) ? `${digitos}%` : null);
        const todas = todasLasPalabras(r, termino, 'Nombre');
        const resultado = await r.query(`
                WITH Trab AS (
                    SELECT t.Cedula, t.Nombre, t.[Área] AS Area, t.Puesto,
                           ROW_NUMBER() OVER (PARTITION BY t.Cedula
                                              ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM(t.[Área])), '') IS NULL THEN 1 ELSE 0 END) AS rn
                    FROM dbo.Trabajadores t WITH(NOLOCK)
                    WHERE t.Cedula IS NOT NULL
                )
                SELECT TOP 15 Cedula, Nombre, Area, Puesto
                FROM Trab
                WHERE rn = 1
                  AND ((${todas}) OR (@cedTxt IS NOT NULL AND CAST(Cedula AS VARCHAR(20)) LIKE @cedTxt))
                ORDER BY CASE WHEN Cedula = @ced THEN 0 ELSE 1 END, Nombre`);
        res.json(resultado.recordset.map(t => ({
            cedula: t.Cedula,
            trabajador: { cedula: t.Cedula, nombre: (t.Nombre || '').trim(), area: (t.Area || '').trim(), puesto: (t.Puesto || '').trim(), porVinculo: false }
        })));
    } catch (e) {
        responderError(res, e, `Error buscando trabajadores "${termino}"`);
    }
};

// ── Aplicar / quitar ─────────────────────────────────────────────────────────
// Cliente por CliIdCliente (o CodCliente, como la asignación de Gestión de Precios).
const leerCliente = async (txReq, id) => {
    const r = await txReq
        .input('CID', sql.Int, id)
        .query(`SELECT TOP 1 CliIdCliente, CodCliente, RTRIM(Nombre) AS Nombre, RTRIM(NombreFantasia) AS NombreFantasia,
                       RTRIM(IDCliente) AS IDCliente, RTRIM(CioRuc) AS CioRuc
                FROM dbo.Clientes WHERE CliIdCliente = @CID OR CodCliente = @CID
                ORDER BY CASE WHEN CliIdCliente = @CID THEN 0 ELSE 1 END`);
    return r.recordset[0] || null;
};

// Agrega el perfil a la fila del cliente (la que escribe Asignación a Clientes: CliIdCliente
// interno), bloqueada hasta el commit para que dos cambios simultáneos no se pisen la lista.
const aplicarEnTx = async (tx, cliente, perfil) => {
    const filas = await new sql.Request(tx)
        .input('CID', sql.Int, cliente.CliIdCliente)
        .query(`SELECT ID, PerfilID, PerfilesIDs FROM dbo.PreciosEspeciales WITH (UPDLOCK, HOLDLOCK)
                WHERE CliIdCliente = @CID`);

    if (filas.recordset.length === 0) {
        await new sql.Request(tx)
            .input('CID', sql.Int, cliente.CliIdCliente)
            .input('CodCli', sql.Int, cliente.CodCliente ?? cliente.CliIdCliente)
            .input('PIDs', sql.NVarChar(sql.MAX), String(perfil.ID))
            .query(`INSERT INTO dbo.PreciosEspeciales (CliIdCliente, ClienteID, PerfilesIDs, UltimaActualizacion)
                    VALUES (@CID, @CodCli, @PIDs, GETDATE())`);
        return;
    }
    const fila = filas.recordset[0];
    const ids = idsDeFila(fila);
    if (!ids.includes(perfil.ID)) ids.push(perfil.ID);
    await new sql.Request(tx)
        .input('ID', sql.Int, fila.ID)
        .input('PIDs', sql.NVarChar(sql.MAX), ids.join(','))
        .query(`UPDATE dbo.PreciosEspeciales SET PerfilesIDs = @PIDs, UltimaActualizacion = GETDATE() WHERE ID = @ID`);
};

const idValido = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n > 0 ? n : null; };

// POST /descuento-trabajadores/:cliId — aplica el perfil sin tocar los otros que tenga el cliente.
const aplicar = async (req, res) => {
    const id = idValido(req.params.cliId);
    if (!id) return res.status(400).json({ error: 'Cliente inválido.' });

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
        const perfil = await exigirPerfil(pool);
        await tx.begin();
        const cliente = await leerCliente(new sql.Request(tx), id);
        if (!cliente) throw conStatus(404, 'El cliente no existe.');
        await aplicarEnTx(tx, cliente, perfil);
        await tx.commit();

        await auditar(pool, req, 'RRHH_DESCUENTO_APLICAR',
            `Perfil "${(perfil.Nombre || '').trim()}" (${perfil.ID}) aplicado a ${describirCliente(cliente)}`);
        logger.info(`[RRHH] Descuento trabajadores aplicado a CliIdCliente ${cliente.CliIdCliente} por usuario ${req.user?.id}`);
        res.json({ success: true });
    } catch (e) {
        try { await tx.rollback(); } catch (_) { /* no había empezado o ya estaba cerrada */ }
        responderError(res, e, 'Error aplicando descuento');
    }
};

// DELETE /descuento-trabajadores/:cliId — quita el perfil y deja los otros que tenga el cliente.
const quitar = async (req, res) => {
    const id = idValido(req.params.cliId);
    if (!id) return res.status(400).json({ error: 'Cliente inválido.' });

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
        const perfil = await exigirPerfil(pool);
        await tx.begin();
        const cliente = await leerCliente(new sql.Request(tx), id);
        // Un cliente borrado puede haber quedado con fila en PreciosEspeciales: se limpia por el ID que llegó.
        const cliIds = cliente ? [cliente.CliIdCliente, cliente.CodCliente].filter(v => v != null) : [id];

        // Todas las filas que el cotizador le aplica al cliente (por CliIdCliente o por CodCliente).
        const req1 = new sql.Request(tx);
        cliIds.forEach((v, i) => req1.input(`C${i}`, sql.Int, v));
        const filas = await req1.query(`
            SELECT ID, PerfilID, PerfilesIDs FROM dbo.PreciosEspeciales WITH (UPDLOCK, HOLDLOCK)
            WHERE CliIdCliente IN (${cliIds.map((_, i) => `@C${i}`).join(', ')})`);

        let cambiadas = 0;
        for (const fila of filas.recordset) {
            const ids = idsDeFila(fila);
            if (!ids.includes(perfil.ID) && fila.PerfilID !== perfil.ID) continue;
            const restantes = ids.filter(x => x !== perfil.ID);
            await new sql.Request(tx)
                .input('ID', sql.Int, fila.ID)
                .input('PIDs', sql.NVarChar(sql.MAX), restantes.length ? restantes.join(',') : null)
                .input('PID', sql.Int, perfil.ID)
                .query(`UPDATE dbo.PreciosEspeciales
                        SET PerfilesIDs = @PIDs,
                            PerfilID = CASE WHEN PerfilID = @PID THEN NULL ELSE PerfilID END,
                            UltimaActualizacion = GETDATE()
                        WHERE ID = @ID`);
            cambiadas++;
        }
        await tx.commit();

        if (cambiadas > 0) {
            const quien = cliente ? describirCliente(cliente) : `CliIdCliente ${id}`;
            await auditar(pool, req, 'RRHH_DESCUENTO_QUITAR', `Perfil "${(perfil.Nombre || '').trim()}" (${perfil.ID}) quitado a ${quien}`);
            logger.info(`[RRHH] Descuento trabajadores quitado a ${quien} por usuario ${req.user?.id}`);
        }
        res.json({ success: true, filasActualizadas: cambiadas });
    } catch (e) {
        try { await tx.rollback(); } catch (_) { /* no había empezado o ya estaba cerrada */ }
        responderError(res, e, 'Error quitando descuento');
    }
};

// ── Vínculos trabajador ↔ cuenta ─────────────────────────────────────────────
const leerTrabajador = async (txReq, cedula) => {
    const r = await txReq
        .input('Ced', sql.Int, cedula)
        .query(`SELECT TOP 1 Cedula, RTRIM(Nombre) AS Nombre FROM dbo.Trabajadores WHERE Cedula = @Ced
                ORDER BY CASE WHEN NULLIF(LTRIM(RTRIM([Área])), '') IS NULL THEN 1 ELSE 0 END`);
    return r.recordset[0] || null;
};

// POST /descuento-trabajadores/vinculos { cedula, cliIdCliente, cargarCi, aplicarDescuento }
// Vincula un trabajador de la planilla con una cuenta de cliente. Opcional, en el mismo paso:
// cargar la cédula del trabajador en el CI/RUT de la cuenta y aplicarle el descuento.
const vincular = async (req, res) => {
    const cedula = idValido(req.body?.cedula);
    const cliId = idValido(req.body?.cliIdCliente);
    if (!cedula || !cliId) return res.status(400).json({ error: 'Faltan el trabajador o la cuenta.' });
    const cargarCi = req.body?.cargarCi === true;
    const aplicarDescuento = req.body?.aplicarDescuento === true;

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
        await exigirTablaVinculos(pool);
        const perfil = aplicarDescuento ? await exigirPerfil(pool) : null;
        await tx.begin();
        const trabajador = await leerTrabajador(new sql.Request(tx), cedula);
        if (!trabajador) throw conStatus(404, 'El trabajador no está en la planilla.');
        const cliente = await leerCliente(new sql.Request(tx), cliId);
        if (!cliente) throw conStatus(404, 'La cuenta de cliente no existe.');

        await new sql.Request(tx)
            .input('Ced', sql.Int, cedula)
            .input('CID', sql.Int, cliente.CliIdCliente)
            .input('UID', sql.Int, Number(req.user?.id) || null)
            .query(`IF NOT EXISTS (SELECT 1 FROM dbo.TrabajadoresClientes WITH (UPDLOCK, HOLDLOCK) WHERE Cedula = @Ced AND CliIdCliente = @CID)
                        INSERT INTO dbo.TrabajadoresClientes (Cedula, CliIdCliente, IdUsuario) VALUES (@Ced, @CID, @UID)`);

        const ciAnterior = (cliente.CioRuc || '').trim();
        const ciCambia = cargarCi && soloDigitos(ciAnterior) !== String(cedula);
        if (ciCambia) {
            await new sql.Request(tx)
                .input('CID', sql.Int, cliente.CliIdCliente)
                .input('Ci', sql.NVarChar(20), String(cedula))
                .query(`UPDATE dbo.Clientes SET CioRuc = @Ci WHERE CliIdCliente = @CID`);
        }
        if (perfil) await aplicarEnTx(tx, cliente, perfil);
        await tx.commit();

        const partes = [`Trabajador ${trabajador.Nombre} (CI ${cedula}) vinculado a ${describirCliente(cliente)}`];
        if (ciCambia) partes.push(`CI/RUT de la cuenta: "${ciAnterior || 'vacío'}" → "${cedula}"`);
        if (perfil) partes.push(`perfil "${(perfil.Nombre || '').trim()}" (${perfil.ID}) aplicado`);
        await auditar(pool, req, 'RRHH_TRABAJADOR_VINCULAR', partes.join('; '));
        logger.info(`[RRHH] ${partes.join('; ')} — usuario ${req.user?.id}`);
        res.json({ success: true, ciActualizada: ciCambia });
    } catch (e) {
        try { await tx.rollback(); } catch (_) { /* no había empezado o ya estaba cerrada */ }
        responderError(res, e, 'Error vinculando trabajador');
    }
};

// DELETE /descuento-trabajadores/vinculos/:cedula/:cliId — solo el vínculo a mano. El cruce por
// cédula no se puede "desvincular": se corrige cambiando la CI.
const desvincular = async (req, res) => {
    const cedula = idValido(req.params.cedula);
    const cliId = idValido(req.params.cliId);
    if (!cedula || !cliId) return res.status(400).json({ error: 'Vínculo inválido.' });
    try {
        const pool = await getPool();
        await exigirTablaVinculos(pool);
        const r = await pool.request()
            .input('Ced', sql.Int, cedula)
            .input('CID', sql.Int, cliId)
            .query(`DELETE FROM dbo.TrabajadoresClientes WHERE Cedula = @Ced AND CliIdCliente = @CID`);
        if (r.rowsAffected[0] > 0) {
            await auditar(pool, req, 'RRHH_TRABAJADOR_DESVINCULAR', `Trabajador CI ${cedula} desvinculado de CliIdCliente ${cliId}`);
        }
        res.json({ success: true, eliminados: r.rowsAffected[0] });
    } catch (e) {
        responderError(res, e, 'Error desvinculando trabajador');
    }
};

// ── Corregir cédulas ─────────────────────────────────────────────────────────
// PUT /descuento-trabajadores/clientes/:cliId/ci { ci } — CI/RUT de la cuenta (Clientes.CioRuc).
// Es el documento que va en las facturas del cliente: CI (6 a 8 dígitos) o RUT (12). Se guarda
// solo con dígitos, como la mayoría de las fichas.
const actualizarCiCliente = async (req, res) => {
    const cliId = idValido(req.params.cliId);
    const ci = soloDigitos(req.body?.ci);
    if (!cliId) return res.status(400).json({ error: 'Cliente inválido.' });
    if (!/^(\d{6,8}|\d{12})$/.test(ci)) return res.status(400).json({ error: 'Ingresá una CI (6 a 8 dígitos) o un RUT (12 dígitos).' });
    try {
        const pool = await getPool();
        const cliente = await leerCliente(pool.request(), cliId);
        if (!cliente) return res.status(404).json({ error: 'La cuenta de cliente no existe.' });
        await pool.request()
            .input('CID', sql.Int, cliente.CliIdCliente)
            .input('Ci', sql.NVarChar(20), ci)
            .query(`UPDATE dbo.Clientes SET CioRuc = @Ci WHERE CliIdCliente = @CID`);
        await auditar(pool, req, 'RRHH_CLIENTE_CI',
            `CI/RUT de ${describirCliente(cliente)}: "${(cliente.CioRuc || '').trim() || 'vacío'}" → "${ci}"`);
        res.json({ success: true, ci });
    } catch (e) {
        responderError(res, e, 'Error actualizando CI del cliente');
    }
};

// PUT /descuento-trabajadores/trabajadores/:cedula/ci { ci } — cédula en la planilla (Trabajadores).
// La cédula es también la clave del VENDEDOR: Clientes.VendedorID la guarda y la foto del asesor
// se llama así (public/assets/images/asesores/<cedula>.webp). Cambiársela a un vendedor le
// sacaría sus clientes, así que eso no se hace desde acá. Los vínculos a mano se mudan con ella.
const actualizarCiTrabajador = async (req, res) => {
    const anterior = idValido(req.params.cedula);
    const nueva = soloDigitos(req.body?.ci);
    if (!anterior) return res.status(400).json({ error: 'Trabajador inválido.' });
    if (!ciValida(nueva)) return res.status(400).json({ error: 'La cédula no es válida: revisá los dígitos y el verificador.' });
    if (Number(nueva) === anterior) return res.json({ success: true, ci: nueva });

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    try {
        await exigirTablaVinculos(pool);
        await tx.begin();
        const trabajador = await leerTrabajador(new sql.Request(tx), anterior);
        if (!trabajador) throw conStatus(404, 'El trabajador no está en la planilla.');

        const vendedor = await new sql.Request(tx)
            .input('Ant', sql.NVarChar(20), String(anterior))
            .query(`SELECT COUNT(*) AS N FROM dbo.Clientes WITH(NOLOCK) WHERE LTRIM(RTRIM(VendedorID)) = @Ant`);
        if (vendedor.recordset[0].N > 0) {
            throw conStatus(409, `${trabajador.Nombre} es vendedor (${vendedor.recordset[0].N} clientes lo tienen asignado por su cédula). Su cédula no se cambia desde acá: pedíselo a Sistemas.`);
        }
        const ocupada = await leerTrabajador(new sql.Request(tx), Number(nueva));
        if (ocupada) throw conStatus(409, `La cédula ${nueva} ya es de ${ocupada.Nombre} en la planilla.`);

        await new sql.Request(tx)
            .input('Ant', sql.Int, anterior)
            .input('Nueva', sql.Int, Number(nueva))
            .query(`UPDATE dbo.Trabajadores SET Cedula = @Nueva WHERE Cedula = @Ant;
                    UPDATE dbo.TrabajadoresClientes SET Cedula = @Nueva WHERE Cedula = @Ant;`);
        await tx.commit();

        await auditar(pool, req, 'RRHH_TRABAJADOR_CI', `Cédula de ${trabajador.Nombre} en la planilla: ${anterior} → ${nueva}`);
        res.json({ success: true, ci: nueva });
    } catch (e) {
        try { await tx.rollback(); } catch (_) { /* no había empezado o ya estaba cerrada */ }
        responderError(res, e, 'Error actualizando cédula del trabajador');
    }
};

module.exports = {
    exigirAcceso, listar, buscar, buscarTrabajadores, aplicar, quitar,
    vincular, desvincular, actualizarCiCliente, actualizarCiTrabajador
};
