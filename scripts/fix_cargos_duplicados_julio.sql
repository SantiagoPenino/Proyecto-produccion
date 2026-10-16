-- ============================================================================
-- fix_cargos_duplicados_julio.sql
-- ----------------------------------------------------------------------------
-- Ventas de mostrador de julio-2026 en las que la caja asentó el CARGO DOS VECES:
-- dos movimientos idénticos (mismo importe, misma cuenta, mismo instante). El
-- cobro entró una sola vez, así que el cliente figura debiendo justo el importe
-- de una factura que ya pagó.
--
-- Al 01-09-2026 en producción son 19 documentos de 14 clientes, TODOS de tipo
-- Común y sin ciclo abierto, entre el 2 y el 17 de julio. Ninguno tiene
-- DeudaDocumento: el daño está solo en el saldo del libro mayor.
--
-- QUÉ HACE: anula (MovAnulado = 1, NO borra) el segundo de los dos cargos y deja
-- el motivo escrito en MovObservaciones. Después recalcula el saldo corrido y el
-- saldo guardado de las cuentas tocadas.
--
-- CÓMO ELIGE: por FORMA, no por una lista de números —
--   · el documento tiene EXACTAMENTE 2 cargos vivos
--   · los dos por el mismo importe y en la misma cuenta
--   · dentro del mismo minuto
--   · la cuenta es de la misma moneda que el documento
--   · el documento no está anulado y no tiene ninguna deuda viva
-- Cualquier documento que no cumpla las cinco condiciones NO se toca.
--
-- Es idempotente: una vez anulado el duplicado, el documento queda con un solo
-- cargo y deja de entrar en la selección. Correrlo de nuevo afecta 0 filas.
--
-- ABRIR DESDE EL DISCO en SSMS (File → Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

-- Los duplicados a anular: de cada par, el de MovIdMovimiento más alto.
DECLARE @Dups TABLE (MovIdMovimiento INT PRIMARY KEY, DocIdDocumento INT, CueIdCuenta INT, MovImporte DECIMAL(18,4));

;WITH Cargos AS (
    -- Nada de COUNT(DISTINCT ...) OVER: SQL Server no lo admite en ventana. "Todos
    -- iguales" se chequea con MIN = MAX sobre la misma partición.
    SELECT m.MovIdMovimiento, m.DocIdDocumento, m.CueIdCuenta, m.MovImporte, m.MovFecha,
           Cargos      = COUNT(*)         OVER (PARTITION BY m.DocIdDocumento),
           MinImporte  = MIN(m.MovImporte) OVER (PARTITION BY m.DocIdDocumento),
           MaxImporte  = MAX(m.MovImporte) OVER (PARTITION BY m.DocIdDocumento),
           MinCuenta   = MIN(m.CueIdCuenta) OVER (PARTITION BY m.DocIdDocumento),
           MaxCuenta   = MAX(m.CueIdCuenta) OVER (PARTITION BY m.DocIdDocumento),
           PrimeraFecha= MIN(m.MovFecha)   OVER (PARTITION BY m.DocIdDocumento),
           UltimaFecha = MAX(m.MovFecha)   OVER (PARTITION BY m.DocIdDocumento),
           Orden       = ROW_NUMBER()      OVER (PARTITION BY m.DocIdDocumento ORDER BY m.MovIdMovimiento)
    FROM dbo.MovimientosCuenta m
    JOIN dbo.DocumentosContables d  ON d.DocIdDocumento = m.DocIdDocumento
    JOIN dbo.CuentasCliente     cc  ON cc.CueIdCuenta   = m.CueIdCuenta
    WHERE m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO')
      AND m.MovImporte < 0
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND ISNULL(d.DocEstado,'') <> 'ANULADO'
      AND cc.MonIdMoneda = d.MonIdMoneda            -- misma moneda: sin conversiones de por medio
      AND NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento dd
                      WHERE dd.DocIdDocumento = d.DocIdDocumento
                        AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                        AND dd.DDeImportePendiente > 0.01)
)
INSERT INTO @Dups (MovIdMovimiento, DocIdDocumento, CueIdCuenta, MovImporte)
SELECT MovIdMovimiento, DocIdDocumento, CueIdCuenta, MovImporte
FROM Cargos
WHERE Cargos = 2
  AND MinImporte = MaxImporte          -- los dos por el mismo importe
  AND MinCuenta  = MaxCuenta           -- los dos en la misma cuenta
  AND DATEDIFF(SECOND, PrimeraFecha, UltimaFecha) <= 60
  AND Orden = 2;   -- se conserva el primero, se anula el segundo

-- ── BLOQUE 0: qué se va a tocar (correr solo esto la primera vez) ───────────
SELECT Momento = 'ANTES',
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Cliente   = RTRIM(cl.Nombre),
       d.DocFechaEmision,
       Moneda    = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       d.DocTotal,
       CargoDuplicadoQueSeAnula = x.MovImporte,
       x.MovIdMovimiento,
       SaldoCuentaAntes = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                  WHERE m.CueIdCuenta = x.CueIdCuenta
                                    AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                    AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)
FROM @Dups x
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = x.DocIdDocumento
JOIN dbo.Clientes cl           ON cl.CliIdCliente  = d.CliIdCliente
ORDER BY cl.Nombre, d.DocFechaEmision;
-- Esperado en producción al 01-09-2026: 19 filas, 14 clientes.

-- ── EL ARREGLO ──────────────────────────────────────────────────────────────
BEGIN TRANSACTION;

    UPDATE m
    SET m.MovAnulado = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') +
            ' FIX_CARGO_DUPLICADO_2026-09-01: la caja asentó este cargo DOS veces en el mismo' +
            ' instante (mismo importe y cuenta). Se conserva el primero; el cobro entró una' +
            ' sola vez, así que el cliente figuraba debiendo una factura que ya pagó.'), 500)
    FROM dbo.MovimientosCuenta m
    JOIN @Dups x ON x.MovIdMovimiento = m.MovIdMovimiento;
    -- Esperado: 19 filas afectadas

    -- Recalcular el saldo corrido y el guardado de las cuentas tocadas, con la
    -- misma fórmula que usa el backend (recomputarSaldoCuenta).
    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM @Dups)
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM @Dups);

COMMIT TRANSACTION;

-- ── DESPUÉS: el saldo de cada cliente tocado ────────────────────────────────
-- Esperado: el saldo sube exactamente el importe del cargo anulado. Los que
-- tenían el cobro completo quedan en 0; los cuatro sin cobro (andrea silva
-- ET-2433, Leticia83 ET-1031, Horacio Vaiz ET-1561 y Andres Perez PC-1678)
-- quedan debiendo el total del documento, que es el OTRO problema (les falta el
-- cobro) y se resuelve aparte.
SELECT Momento = 'DESPUES',
       Cliente = RTRIM(cl.Nombre),
       cc.CueIdCuenta,
       Moneda  = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       SaldoLibro = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                            WHERE m.CueIdCuenta = cc.CueIdCuenta
                              AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                              AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0),
       CargosAnulados = (SELECT COUNT(*) FROM @Dups x WHERE x.CueIdCuenta = cc.CueIdCuenta),
       ImporteDevuelto = (SELECT ISNULL(SUM(ABS(x.MovImporte)), 0) FROM @Dups x WHERE x.CueIdCuenta = cc.CueIdCuenta)
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
WHERE cc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM @Dups)
ORDER BY cl.Nombre;
