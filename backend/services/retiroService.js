/**
 * retiroService.js — Servicio unificado para crear órdenes de retiro.
 * Centraliza la lógica compartida entre ordenesRetiroController (local)
 * y webOrdersController (web), eliminando duplicación de código.
 */
const { sql, getPool } = require('../config/db');
const logger = require('../utils/logger');
const { marcarCobranzaPagada } = require('./cobranzaService');

/**
 * resolverEstadoPorTipoCliente
 * SOLO como fallback cuando no hay datos de contabilidad disponibles.
 * La lógica real usa verificarRecursoCliente() para cada retiro.
 */
function resolverEstadoPorTipoCliente(tipoCliente) {
    return (tipoCliente === 2 || tipoCliente === 3) ? 4 : 1;
}

/**
 * verificarRecursoCliente
 * Chequea si el cliente tiene un plan de recursos activo para el producto dado.
 * Funciona para CUALQUIER tipo de cliente (no solo tipo 2 o 3).
 *
 * @returns {Promise<{tieneRecurso, planId, saldoDisponible, motivo}>}
 */
async function verificarRecursoCliente(transaction, { CliIdCliente, ProIdProducto }) {
    if (!CliIdCliente || !ProIdProducto) {
        return { tieneRecurso: false, motivo: 'sin_datos' };
    }

    try {
        const planRes = await transaction.request()
            .input('CliIdCliente',  sql.Int, CliIdCliente)
            .input('ProIdProducto', sql.Int, ProIdProducto)
            .query(`
                SELECT TOP 1
                    PlaIdPlan,
                    PlaCantidadTotal - PlaCantidadUsada AS SaldoDisponible
                FROM dbo.PlanesMetros WITH(NOLOCK)
                WHERE CliIdCliente  = @CliIdCliente
                  AND PlaActivo     = 1
                  AND (PlaFechaVencimiento IS NULL
                    OR PlaFechaVencimiento >= CAST(GETDATE() AS DATE))
                  AND (
                    ProIdProducto = @ProIdProducto
                    OR EXISTS (
                      SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WITH(NOLOCK)
                      WHERE pap.PlaIdPlan = PlanesMetros.PlaIdPlan
                        AND pap.ProIdProducto = @ProIdProducto
                    )
                  )
                ORDER BY PlaFechaAlta DESC
            `);

        if (!planRes.recordset.length) {
            return { tieneRecurso: false, motivo: 'sin_plan' };
        }

        const plan = planRes.recordset[0];
        return {
            tieneRecurso:    true,
            planId:          plan.PlaIdPlan,
            saldoDisponible: Number(plan.SaldoDisponible),
            motivo:          `plan_${plan.PlaIdPlan}`,
        };
    } catch (err) {
        logger.warn(`[RECURSO] Error verificando plan CliId=${CliIdCliente}: ${err.message}. Sin recurso.`);
        return { tieneRecurso: false, motivo: 'error_verificacion' };
    }
}

/**
 * verificarCicloSemanal
 * Solo para clientes tipo 2 (Semanal): verifica ciclo de crédito abierto.
 */
async function verificarCicloSemanal(transaction, CliIdCliente) {
    try {
        const cicloRes = await transaction.request()
            .input('CliIdCliente', sql.Int, CliIdCliente)
            .query(`
                SELECT TOP 1 cc.CicIdCiclo, cc.CicFechaCierre
                FROM   dbo.CiclosCredito  cc WITH(NOLOCK)
                JOIN   dbo.CuentasCliente cu WITH(NOLOCK) ON cu.CueIdCuenta = cc.CueIdCuenta
                WHERE  cu.CliIdCliente = @CliIdCliente
                  AND  cc.CicEstado    = 'ABIERTO'
                  AND  cc.CicFechaCierre >= CAST(GETDATE() AS DATE)
            `);

        if (!cicloRes.recordset.length) {
            logger.warn(`[RECURSO] Semanal CliId=${CliIdCliente} → sin ciclo activo.`);
            return false;
        }
        return true;
    } catch (err) {
        logger.warn(`[RECURSO] Error verificando ciclo CliId=${CliIdCliente}: ${err.message}.`);
        return false;
    }
}

/**
 * calcularAdelantoLimpio
 * Saldo de adelanto REAL del cliente en su cuenta de dinero de la moneda dada.
 * Suma los movimientos por su importe CRUDO (que sí es confiable), EXCLUYENDO
 * VTA_CAJA/CIERRE_CICLO (capa fiscal que DUPLICA el débito de las órdenes) y los
 * anulados. NO usa CueSaldoActual (que arrastra descalces históricos y doble conteo).
 *
 * @returns {{ adelanto:number, tieneAnticipo:boolean }}
 *   adelanto >= 0 con tieneAnticipo=true → adelanto solvente → órdenes cubiertas.
 *   adelanto < 0 o sin anticipo          → sobre-consumió / no tiene adelanto → caja.
 */
async function calcularAdelantoLimpio(transaction, CliIdCliente, moneda) {
    const cueTipo = (moneda && String(moneda).toUpperCase() === 'USD') ? 'DINERO_USD' : 'DINERO_UYU';
    const r = await transaction.request()
        .input('Cli',  sql.Int,         CliIdCliente)
        .input('Tipo', sql.VarChar(20), cueTipo)
        .query(`
            SELECT
                ISNULL(SUM(m.MovImporte), 0) AS Adelanto,
                ISNULL(SUM(CASE WHEN m.MovTipo = 'ANTICIPO' THEN m.MovImporte ELSE 0 END), 0) AS TotalAnticipos
            FROM   dbo.MovimientosCuenta m  WITH(NOLOCK)
            JOIN   dbo.CuentasCliente    cc WITH(NOLOCK) ON cc.CueIdCuenta = m.CueIdCuenta
            WHERE  cc.CliIdCliente = @Cli
              AND  cc.CueTipo      = @Tipo
              AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
              AND  m.MovTipo NOT IN ('VTA_CAJA', 'CIERRE_CICLO')
        `);
    const row = r.recordset[0] || {};
    return {
        adelanto:      parseFloat(row.Adelanto) || 0,
        tieneAnticipo: (parseFloat(row.TotalAnticipos) || 0) > 0.01,
    };
}

/**
 * tienePlanHistorico
 * ¿El cliente tuvo ALGUNA VEZ un plan de metros (rollo) para el producto — activo
 * O CERRADO? Se usa para dejar pasar el ROLLO NEGATIVO: cuando el plan se consumió
 * y quedó en negativo (o se cerró), la orden se cubrió en metros (no en plata) y el
 * saldo negativo se compensa con el próximo rollo. Mientras exista historia de rollo
 * para ese producto, el retiro pasa (Abonado). Sin ninguna historia → no es rollo real.
 * Espeja la condición de hookOrdenCreada (ultimoPlanRes, sin filtro PlaActivo).
 */
async function tienePlanHistorico(transaction, CliIdCliente, ProIdProducto) {
    if (!CliIdCliente || !ProIdProducto) return false;
    const r = await transaction.request()
        .input('Cli', sql.Int, CliIdCliente)
        .input('Pro', sql.Int, ProIdProducto)
        .query(`
            SELECT TOP 1 pm.PlaIdPlan
            FROM   dbo.PlanesMetros pm WITH(NOLOCK)
            WHERE  pm.CliIdCliente = @Cli
              AND  (
                pm.ProIdProducto = @Pro
                OR EXISTS (
                  SELECT 1 FROM dbo.PlanesMetrosArticulosPermitidos pap WITH(NOLOCK)
                  WHERE pap.PlaIdPlan = pm.PlaIdPlan AND pap.ProIdProducto = @Pro
                )
              )
        `);
    return r.recordset.length > 0;
}

/**
 * Crea una orden de retiro completa dentro de una transacción existente.
 *
 * @param {Transaction} transaction — transacción SQL ya iniciada
 * @param {Object} params
 * @param {number[]} params.ordIds — IDs numéricos de OrdenesDeposito a incluir en el retiro
 * @param {number} params.totalCost — costo total del retiro
 * @param {number} params.lugarRetiro — ID del lugar de retiro
 * @param {number} params.usuarioAlta — ID del usuario que crea el retiro
 * @param {string} params.formaRetiro — 'RL' (Retiro Local) o 'RW' (Retiro Web)
 * @param {number} [params.codCliente] — código del cliente
 * @param {string} [params.moneda] — moneda del retiro ('UYU' o 'USD')
 * @returns {number} OReIdOrdenRetiro — ID del retiro creado
 */
async function crearRetiro(transaction, { ordIds, totalCost, lugarRetiro, usuarioAlta, formaRetiro, codCliente, moneda, direccion, departamento, localidad, agenciaId }) {
    if (!ordIds || ordIds.length === 0) {
        throw new Error('No se proporcionaron órdenes válidas para el retiro.');
    }

    // ── VALIDACIÓN: excluir órdenes que ya pertenecen a un retiro activo ──
    // Un retiro se considera "activo" si su estado NO es cancelado (6) ni anulado (10).
    // NO excluimos estado 9 de OrdenesDeposito porque ese estado se usa también para
    // marcar entregas, y excluirlo permitía pisar órdenes ya entregadas (bug RW13394).
    const checkParams = ordIds.map((_, i) => `@dup${i}`).join(',');
    const dupReq = transaction.request();
    ordIds.forEach((id, i) => dupReq.input(`dup${i}`, sql.Int, id));
    const dupRes = await dupReq.query(`
        SELECT od.OrdIdOrden FROM OrdenesDeposito od WITH(NOLOCK)
        JOIN OrdenesRetiro r WITH(NOLOCK) ON r.OReIdOrdenRetiro = od.OReIdOrdenRetiro
        WHERE od.OrdIdOrden IN (${checkParams})
          AND od.OReIdOrdenRetiro IS NOT NULL
          AND od.OrdEstadoActual NOT IN (6)
          AND r.OReEstadoActual NOT IN (6)
    `);
    const yaAsignadas = new Set(dupRes.recordset.map(r => r.OrdIdOrden));
    const ordIdsLibres = ordIds.filter(id => !yaAsignadas.has(id));
    if (ordIdsLibres.length === 0) {
        throw new Error('Todas las órdenes seleccionadas ya pertenecen a un retiro activo.');
    }
    if (yaAsignadas.size > 0) {
        logger.warn(`[crearRetiro] ${yaAsignadas.size} orden(es) ya asignadas a otro retiro, se excluyen: ${[...yaAsignadas].join(', ')}`);
    }
    ordIds = ordIdsLibres;

    // Datos del cliente (iguales para todas las órdenes del retiro)
    const tipoRes = await transaction.request()
        .input('OrdId', sql.Int, ordIds[0])
        .query(`
        SELECT c.TClIdTipoCliente, c.CodCliente, o.CliIdCliente, tc.TClDescripcion
            FROM OrdenesDeposito o WITH(NOLOCK)
            JOIN Clientes c WITH(NOLOCK) ON c.CliIdCliente = o.CliIdCliente
            LEFT JOIN TiposClientes tc WITH(NOLOCK) ON tc.TClIdTipoCliente = c.TClIdTipoCliente
            WHERE o.OrdIdOrden = @OrdId
        `);
    const tipoCliente     = tipoRes.recordset[0]?.TClIdTipoCliente || 1;
    const tipoClienteDesc = tipoRes.recordset[0]?.TClDescripcion   || '';
    const CliIdCliente    = tipoRes.recordset[0]?.CliIdCliente     || null;
    const finalCodCliente = codCliente || tipoRes.recordset[0]?.CodCliente || null;

    // Datos de CADA orden: producto, cantidad y si ya tiene pago
    const ordParamsClause = ordIds.map((_, i) => `@ord${i}`).join(',');
    const ordDataReq = transaction.request();
    ordIds.forEach((id, i) => ordDataReq.input(`ord${i}`, sql.Int, id));
    const ordDataRes = await ordDataReq.query(`
        SELECT OrdIdOrden, ProIdProducto, OrdCantidad, PagIdPago, MonIdMoneda, OrdCostoFinal
        FROM   dbo.OrdenesDeposito WITH(NOLOCK)
        WHERE  OrdIdOrden IN (${ordParamsClause})
    `);
    const ordenesData  = ordDataRes.recordset;
    const pagoExistenteId = ordenesData.find(o => o.PagIdPago)?.PagIdPago || null;

    // ── AUTO-DETECCIÓN DE MONEDA REAL DESDE LAS ÓRDENES ─────────────────────
    // Si ALGUNA orden hija es USD (MonIdMoneda=2), el retiro entero es en USD.
    // Las órdenes hijas son fuente de verdad: usan FK entero a Monedas (1=UYU, 2=USD).
    // El parámetro `moneda` del frontend es solo sugerencia y puede estar equivocado.
    const tieneOrdenUSD = ordenesData.some(o => o.MonIdMoneda === 2);
    // Lógica con paréntesis explícitos para evitar bugs de precedencia de operadores:
    // USD si → alguna orden hija es USD, O el caller envió explícitamente 'USD'
    // UYU en cualquier otro caso
    const monedaFinal = (tieneOrdenUSD || (moneda && moneda.toUpperCase() === 'USD')) ? 'USD' : (moneda || 'UYU');
    if (monedaFinal !== moneda) {
        logger.warn(`[crearRetiro] Moneda corregida: parámetro='${moneda}' → detectada='${monedaFinal}' (tieneOrdenUSD=${tieneOrdenUSD})`);
    }

    // ── CONTROL DE ENTREGA: estado inicial del retiro según COBERTURA ────────────
    //
    //  El retiro nace CUBIERTO (no pasa por caja) solo si TODAS sus órdenes están
    //  cubiertas. Si queda alguna sin cobertura verificable → estado 1 (FRENA, caja).
    //  Reemplaza el viejo bypass ciego de tipo 2/3 (que autorizaba sin verificar nada).
    //
    //  Cobertura y estado resultante:
    //    ABONADO (3)    — pago previo, plan de metros activo, o ROLLO con la orden a costo 0.
    //                     ROLLO: la cobertura la define el COSTO de cada orden — costo 0 = la
    //                     cubrió el rollo → pasa; costo > 0 = fuera del rollo → debe pagar.
    //    AUTORIZADO (9) — crédito: ciclo semanal abierto, o PLATA adelantada (anticipo) con
    //                     saldo LIMPIO >= 0 (ver calcularAdelantoLimpio; NO usa el CueSaldoActual
    //                     roto). El débito ORDEN ya corrió al INGRESO → el chequeo es
    //                     "adelanto >= 0", no ">= costo".
    //    FRENA (1)      — sin ninguna cobertura → pasa por caja.

    const esRollo = /ROLLO/i.test(tipoClienteDesc || '');

    // Semanal (tipo 2) O rollo que ADEMÁS opera a crédito (ciclo abierto): se le fía y se
    // cobra al cierre del ciclo → NO frena aunque la orden tenga costo. Hay clientes tipo 3
    // (rollo) con ciclo de crédito abierto: sus órdenes con costo son CRÉDITO, no fuga.
    let tieneCicloSemanal = false;
    if (tipoCliente === 2 || esRollo) {
        tieneCicloSemanal = await verificarCicloSemanal(transaction, CliIdCliente);
    }

    // Las cubiertas por pago/plan/rollo dejan el retiro ABONADO; las que quedan necesitan
    // CRÉDITO (ciclo o plata) → AUTORIZADO. Si a alguna no la cubre nada → FRENA.
    const ordenesQueNecesitanCredito = [];
    for (const orden of ordenesData) {
        if (orden.PagIdPago) continue; // ya pagada

        // ── ROLLO POR ADELANTADO: la cobertura la define el COSTO de la orden ──
        // El motor de contabilización (check-in a DEPOSITO) deja OrdCostoFinal = 0
        // cuando el rollo/plan de metros cubrió la orden, y OrdCostoFinal > 0 cuando
        // NO la cubrió (rollo agotado, sin recurso comprado, o producto fuera del plan).
        // Por eso el costo es la señal fiable: costo 0 = cubierta por el rollo → pasa;
        // costo > 0 = fuera del rollo → debe pagar (NO se autoriza por ser tipo rollo).
        // Antes 'tienePlanHistorico' dejaba pasar TODA orden del rollo, tuviera costo o no.
        if (esRollo) {
            const costoOrden = parseFloat(orden.OrdCostoFinal) || 0;
            if (costoOrden <= 0) {
                logger.info(`[RETIRO] Orden ${orden.OrdIdOrden} cubierta por rollo (costo 0) → pasa.`);
                continue;
            }
            logger.warn(`[RETIRO] Orden ${orden.OrdIdOrden} de rollo con costo ${costoOrden} (fuera del rollo) → requiere pago o crédito (ciclo abierto).`);
            ordenesQueNecesitanCredito.push(orden);
            continue;
        }

        if (orden.ProIdProducto) {
            // plan de metros ACTIVO → rollo positivo
            const recurso = await verificarRecursoCliente(transaction, { CliIdCliente, ProIdProducto: orden.ProIdProducto });
            if (recurso.tieneRecurso) {
                logger.info(`[RETIRO] Orden ${orden.OrdIdOrden} cubierta por plan activo #${recurso.planId}`);
                continue;
            }
        }

        ordenesQueNecesitanCredito.push(orden);
    }

    let estadoOrdenRetiro;

    if (ordenesQueNecesitanCredito.length === 0) {
        estadoOrdenRetiro = 3; // todo cubierto por pago / plan / rollo → Abonado

    } else {
        // ¿Las cubre el CRÉDITO? Ciclo semanal, o plata adelantada (saldo limpio >= 0).
        let cubiertoPorCredito = tieneCicloSemanal;
        let detalle = 'ciclo semanal';
        if (!cubiertoPorCredito) {
            const { adelanto, tieneAnticipo } = await calcularAdelantoLimpio(transaction, CliIdCliente, monedaFinal);
            cubiertoPorCredito = tieneAnticipo && adelanto >= -0.01;
            detalle = `adelanto ${monedaFinal}=${adelanto.toFixed(2)} (tieneAnticipo=${tieneAnticipo})`;
        }

        if (cubiertoPorCredito) {
            estadoOrdenRetiro = 9; // Autorizado (crédito: ciclo semanal o plata adelantada)
            logger.info(`[RETIRO] Cli ${CliIdCliente}: ${ordenesQueNecesitanCredito.length} orden(es) cubiertas por crédito (${detalle}) → Autorizado.`);
        } else {
            estadoOrdenRetiro = 1; // sin plan, sin rollo, sin crédito → FRENA a caja
            logger.warn(`[RETIRO] Cli ${CliIdCliente}: ${ordenesQueNecesitanCredito.length} orden(es) sin cobertura (${detalle}) → estado 1 (FRENA a caja).`);
        }
    }

    // Estados "cubiertos" (NO pasan por caja): 3 Abonado, 4 Abonado de antemano, 9 Autorizado.
    // Los cubiertos dejan PagIdPago = 0 (centinela "cubierto sin efectivo"); estado 1 → NULL (aparece en caja).
    const retiroCubierto = [3, 4, 9].includes(estadoOrdenRetiro);

    // 1. Generar ID para OrdenesRetiro con UPDLOCK (previene race condition)
    const maxIdRes = await transaction.request().query(
        'SELECT ISNULL(MAX(OReIdOrdenRetiro), 0) + 1 AS NextId FROM OrdenesRetiro WITH (UPDLOCK)'
    );
    const OReIdOrdenRetiro = maxIdRes.recordset[0].NextId;

    // 2. INSERT OrdenesRetiro (con CodCliente, MonIdMoneda, FormaRetiro, PagIdPago si ya está pago)
    await transaction.request()
        .input('OReId', sql.Int, OReIdOrdenRetiro)
        .input('Costo', sql.Float, totalCost || 0)
        .input('Lugar', sql.Int, lugarRetiro)
        .input('Estado', sql.Int, estadoOrdenRetiro)
        .input('Usr', sql.Int, usuarioAlta)
        .input('FormaRetiro', sql.VarChar(2), formaRetiro || 'RL')
        .input('CodCliente', sql.Int, finalCodCliente)
        .input('Moneda', sql.VarChar(10), monedaFinal)
        .input('Dir', sql.NVarChar(500), direccion || null)
        .input('Depto', sql.NVarChar(200), departamento || null)
        .input('Loc', sql.NVarChar(200), localidad || null)
        .input('AgenciaId', sql.Int, agenciaId ? parseInt(agenciaId, 10) : null)
        .input('PagIdExistente', sql.Int, retiroCubierto ? (pagoExistenteId || 0) : pagoExistenteId)
        .query(`
            INSERT INTO OrdenesRetiro 
                (OReIdOrdenRetiro, OReCostoTotalOrden, LReIdLugarRetiro, OReFechaAlta, OReUsuarioAlta, OReEstadoActual, OReFechaEstadoActual, FormaRetiro, CodCliente, MonIdMoneda, DireccionEnvio, DepartamentoEnvio, LocalidadEnvio, AgenciaEnvio, PagIdPago)
            VALUES 
                (@OReId, @Costo, @Lugar, GETDATE(), @Usr, @Estado, GETDATE(), @FormaRetiro, @CodCliente, @Moneda, @Dir, @Depto, @Loc, @AgenciaId, @PagIdExistente)
        `);


    // 3. INSERT HistoricoEstadosOrdenesRetiro (estado inicial)
    await transaction.request()
        .input('OReId', sql.Int, OReIdOrdenRetiro)
        .input('Estado', sql.Int, estadoOrdenRetiro)
        .input('Usr', sql.Int, usuarioAlta)
        .query(`
            INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
            VALUES (@OReId, @Estado, GETDATE(), @Usr)
        `);

    // 4. Generar IDs para RelOrdenesRetiroOrdenes con UPDLOCK
    const maxRelRes = await transaction.request().query(
        'SELECT ISNULL(MAX(RORIdOrdenRetiroOrden), 0) AS MaxId FROM RelOrdenesRetiroOrdenes WITH (UPDLOCK)'
    );
    let nextRelId = maxRelRes.recordset[0].MaxId;

    for (const ordId of ordIds) {
        nextRelId++;
        await transaction.request()
            .input('RelId', sql.Int, nextRelId)
            .input('RetiroId', sql.Int, OReIdOrdenRetiro)
            .input('OrdenId', sql.Int, ordId)
            .query(`
                INSERT INTO RelOrdenesRetiroOrdenes (RORIdOrdenRetiroOrden, OReIdOrdenRetiro, OrdIdOrden)
                VALUES (@RelId, @RetiroId, @OrdenId)
            `);
    }

    // 5. UPDATE OrdenesDeposito (estado=4, asignar lugar y retiroId)
    //    + INSERT HistoricoEstadosOrdenes
    for (const ordId of ordIds) {
        await transaction.request()
            .input('OrdId', sql.Int, ordId)
            .input('Lugar', sql.Int, lugarRetiro)
            .input('RetiroId', sql.Int, OReIdOrdenRetiro)
            .input('Usr', sql.Int, usuarioAlta)
            .input('PagId', sql.Int, retiroCubierto ? 0 : null)
            .query(`
                UPDATE OrdenesDeposito SET 
                    LReIdLugarRetiro = @Lugar, 
                    OReIdOrdenRetiro = @RetiroId,
                    OrdEstadoActual = 9, 
                    OrdFechaEstadoActual = GETDATE(),
                    PagIdPago = ISNULL(PagIdPago, @PagId)
                WHERE OrdIdOrden = @OrdId;

                INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                VALUES (@OrdId, 9, GETDATE(), @Usr);
            `);
    }

    return OReIdOrdenRetiro;
}

/**
 * Marca un retiro y todas sus órdenes hijas como entregadas.
 * Centraliza la lógica que estaba duplicada en 4 funciones distintas.
 *
 * @param {Transaction|Request} transactionOrReq — transacción SQL o request
 * @param {number} OReIdOrdenRetiro — ID numérico del retiro
 * @param {Date} fecha — fecha de entrega
 * @param {number} usuarioId — ID del usuario que entrega
 */
async function marcarEntregado(transactionOrReq, OReIdOrdenRetiro, fecha, usuarioId) {
    // Soportar tanto transaction.request() como new sql.Request(transaction)
    const request = typeof transactionOrReq.request === 'function'
        ? transactionOrReq.request()
        : new sql.Request(transactionOrReq);

    await request
        .input('ID', sql.Int, OReIdOrdenRetiro)
        .input('Fec', sql.DateTime, fecha)
        .input('Usr', sql.Int, usuarioId)
        .query(`
            INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
            SELECT OrdIdOrden, 9, @Fec, @Usr FROM OrdenesDeposito WHERE OReIdOrdenRetiro = @ID;

            UPDATE OrdenesDeposito SET OrdEstadoActual = 9, OrdFechaEstadoActual = @Fec WHERE OReIdOrdenRetiro = @ID;

            UPDATE OrdenesRetiro SET OReEstadoActual = 5, ORePasarPorCaja = 0, OReFechaEstadoActual = @Fec WHERE OReIdOrdenRetiro = @ID;

            INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta) 
            VALUES (@ID, 5, @Fec, @Usr);

            -- Liberar estante automáticamente al entregar
            DELETE FROM OcupacionEstantes
            WHERE OrdenRetiro = COALESCE(
                (SELECT FormaRetiro FROM OrdenesRetiro WITH(NOLOCK) WHERE OReIdOrdenRetiro = @ID),
                'R'
            ) + '-' + CAST(@ID AS VARCHAR);
        `);

    // Sincronización global con stateManagerService
    try {
        const { changeOrderState } = require('./stateManagerService');
        // Make sure to reuse the same request or create a new one safely
        const syncReq = typeof transactionOrReq.request === 'function' ? transactionOrReq.request() : new (require('mssql')).Request(transactionOrReq);
        // El JOIN con OR (od.OrdCodigoOrden = o.NoDocERP OR = o.CodigoOrden) obligaba a recorrer casi
        // todo Ordenes × OrdenesDeposito: ningún índice sirve para un OR en el ON, y esto corre UNA VEZ
        // POR RETIRO — era el grueso de los 75s que tardaba la entrega múltiple (y el bloqueo que
        // tumbaba Caja/CFE/estantes). Partido en dos ramas UNION, cada una sí usa índice.
        // UNION (no ALL) deduplica, así que el resultado es el mismo.
        const mainOrdersRes = await syncReq
            .input('RetiroID', require('mssql').Int, OReIdOrdenRetiro)
            .query(`
                SELECT o.OrdenID
                FROM OrdenesDeposito od WITH(NOLOCK)
                INNER JOIN Ordenes o WITH(NOLOCK) ON o.NoDocERP = od.OrdCodigoOrden
                WHERE od.OReIdOrdenRetiro = @RetiroID
                UNION
                SELECT o.OrdenID
                FROM OrdenesDeposito od WITH(NOLOCK)
                INNER JOIN Ordenes o WITH(NOLOCK) ON o.CodigoOrden = od.OrdCodigoOrden
                WHERE od.OReIdOrdenRetiro = @RetiroID
            `);
            
        for (const row of mainOrdersRes.recordset) {
            await changeOrderState(transactionOrReq, {
                target: { type: 'ORDER', id: row.OrdenID },
                estado: 'Entregado',
                userObj: usuarioId || 'Sistema',
                detalle: 'Estado global sincronizado (Retiro Entregado)'
            });
        }
    } catch (syncErr) {
        console.error('Error sincronizando estado global a Entregado en marcarEntregado:', syncErr);
    }
}

/**
 * Registra un pago para un retiro, actualiza estados y hace auto-cierre si corresponde.
 * Centraliza la lógica que estaba duplicada en pagosController y webRetirosController.
 *
 * @param {Transaction} transaction — transacción SQL ya iniciada
 * @param {Object} params
 * @param {number} params.ordenRetiroId — ID numérico del retiro
 * @param {number} params.metodoPagoId — ID del método de pago
 * @param {number} params.monedaId — ID de la moneda
 * @param {number} params.monto — monto del pago
 * @param {number[]} [params.orderNumbers] — IDs de OrdenesDeposito a actualizar
 * @param {number} params.usuarioId — ID del usuario que registra el pago
 * @param {number} params.nuevoEstado — estado nuevo del retiro (3=Abonado, 8=Empaquetado y abonado)
 * @returns {{ pagoId: number }} — ID del pago creado
 */
async function registrarPago(transaction, { ordenRetiroId, metodoPagoId, monedaId, monto, orderNumbers, usuarioId, nuevoEstado }) {
    // 1. INSERT Pagos
    const createReq = typeof transaction.request === 'function'
        ? transaction.request()
        : new sql.Request(transaction);

    const pagoResult = await createReq
        .input('metodoPagoId', sql.Int, metodoPagoId)
        .input('monedaId', sql.Int, monedaId)
        .input('monto', sql.Float, monto)
        .input('fecha', sql.DateTime, new Date())
        .input('usuarioId', sql.Int, usuarioId)
        .query(`
            INSERT INTO Pagos (MPaIdMetodoPago, PagIdMonedaPago, PagMontoPago, PagFechaPago, PagUsuarioAlta)
            OUTPUT INSERTED.PagIdPago
            VALUES (@metodoPagoId, @monedaId, @monto, @fecha, @usuarioId)
        `);

    const pagoId = pagoResult.recordset[0].PagIdPago;

    // 2. UPDATE OrdenesRetiro (estado + PagIdPago)
    const updateRetReq = typeof transaction.request === 'function'
        ? transaction.request()
        : new sql.Request(transaction);

    await updateRetReq
        .input('ordenRetiroId', sql.Int, ordenRetiroId)
        .input('nuevoEstado', sql.Int, nuevoEstado)
        .input('pagoId', sql.Int, pagoId)
        .query(`
            UPDATE OrdenesRetiro 
            SET PagIdPago = @pagoId, 
                OReEstadoActual = CASE WHEN OReEstadoActual = 5 THEN 5 ELSE @nuevoEstado END,
                OReFechaEstadoActual = GETDATE(), ORePasarPorCaja = 0
            WHERE OReIdOrdenRetiro = @ordenRetiroId;
        `);

    // 3. INSERT Histórico retiro
    const histRetReq = typeof transaction.request === 'function'
        ? transaction.request()
        : new sql.Request(transaction);

    await histRetReq
        .input('ordenRetiroId', sql.Int, ordenRetiroId)
        .input('nuevoEstado', sql.Int, nuevoEstado)
        .input('usuarioId', sql.Int, usuarioId)
        .query(`
            INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
            VALUES (@ordenRetiroId, @nuevoEstado, GETDATE(), @usuarioId);
        `);

    // 4. UPDATE OrdenesDeposito + Histórico (si hay orderNumbers)
    if (orderNumbers && orderNumbers.length > 0) {
        const updateReq = typeof transaction.request === 'function'
            ? transaction.request()
            : new sql.Request(transaction);

        updateReq.input('pagoId', sql.Int, pagoId);
        updateReq.input('Usr', sql.Int, usuarioId);
        orderNumbers.forEach((oid, i) => updateReq.input(`oid${i}`, sql.Int, parseInt(oid, 10)));
        const inClause = orderNumbers.map((_, i) => `@oid${i}`).join(',');

        // El pago vincula PagIdPago SIEMPRE, pero solo promueve a 7 si la orden no está resuelta:
        // un pago tardío NO debe "des-entregar" una orden ya retirada (9) ni revivir una
        // cancelada/perdida (10/11). Historial solo si el estado cambió.
        await updateReq.query(`
            DECLARE @cambios TABLE (OrdIdOrden INT, EstadoViejo INT, EstadoNuevo INT);

            UPDATE OrdenesDeposito
            SET PagIdPago = @pagoId,
                OrdEstadoActual      = CASE WHEN OrdEstadoActual IN (9,10,11) THEN OrdEstadoActual ELSE 7 END,
                OrdFechaEstadoActual = CASE WHEN OrdEstadoActual IN (9,10,11) THEN OrdFechaEstadoActual ELSE GETDATE() END
            OUTPUT inserted.OrdIdOrden, deleted.OrdEstadoActual, inserted.OrdEstadoActual INTO @cambios
            WHERE OrdIdOrden IN (${inClause});

            INSERT INTO HistoricoEstadosOrdenes (OrdIdOrden, EOrIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
            SELECT OrdIdOrden, EstadoNuevo, GETDATE(), @Usr
            FROM @cambios WHERE EstadoViejo <> EstadoNuevo;
        `);

        // Sincronizar la vista de cobranza (Caja/portal/tótem la leen por EstadoCobro)
        await marcarCobranzaPagada(transaction, orderNumbers);
    }

    // 5. AUTO-CIERRE: si todas las órdenes hijas están pagas → estado 4 (Abonado)
    const checkReq = typeof transaction.request === 'function'
        ? transaction.request()
        : new sql.Request(transaction);

    const todasPagasRes = await checkReq
        .input('ordenRetiroId', sql.Int, ordenRetiroId)
        .query(`
            SELECT 
                COUNT(*) AS total,
                SUM(CASE WHEN od.PagIdPago IS NOT NULL THEN 1 ELSE 0 END) AS pagas
            FROM OrdenesDeposito od WITH(NOLOCK)
            WHERE od.OReIdOrdenRetiro = @ordenRetiroId
              AND od.OrdEstadoActual NOT IN (6, 9)
        `);

    const { total, pagas } = todasPagasRes.recordset[0];

    if (total > 0 && total === pagas) {
        const cierreReq = typeof transaction.request === 'function'
            ? transaction.request()
            : new sql.Request(transaction);

        await cierreReq
            .input('ordenRetiroId', sql.Int, ordenRetiroId)
            .input('pagoId', sql.Int, pagoId)
            .input('usuarioId', sql.Int, usuarioId)
            .query(`
                UPDATE OrdenesRetiro 
                SET PagIdPago = @pagoId, 
                    OReEstadoActual = CASE WHEN OReEstadoActual = 5 THEN 5 ELSE 4 END,
                    OReFechaEstadoActual = GETDATE(), ORePasarPorCaja = 0
                WHERE OReIdOrdenRetiro = @ordenRetiroId
                  AND (PagIdPago IS NULL OR PagIdPago = 0 OR OReEstadoActual = 5);

                INSERT INTO HistoricoEstadosOrdenesRetiro (OReIdOrdenRetiro, EORIdEstadoOrden, HEOFechaEstado, HEOUsuarioAlta)
                VALUES (@ordenRetiroId, 4, GETDATE(), @usuarioId);
            `);

        logger.info(`[AUTO-PAGO] OrdenRetiro R-${ordenRetiroId} marcada como Abonada automáticamente.`);
    }

    return { pagoId };
}

module.exports = { crearRetiro, marcarEntregado, registrarPago };
