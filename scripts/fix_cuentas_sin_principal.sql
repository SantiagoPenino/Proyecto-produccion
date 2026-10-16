-- ============================================================================
-- fix_cuentas_sin_principal.sql
-- ============================================================================
-- QUÉ ARREGLA
-- El 2 y el 3 de septiembre de 2026 las órdenes y cobros de algunos clientes se
-- asentaron DENTRO de su billetera prepaga en vez de su cuenta corriente. La
-- billetera estaba en cero, así que quedó en rojo sin que nadie hubiera gastado
-- plata.
--
-- Pasó porque las billeteras se crearon el 1-sep y el deploy con el arreglo
-- subió el 4-sep. Esos dos días, la búsqueda previa de obtenerOCrearCuenta
-- preguntaba "¿hay ALGUNA cuenta de esta moneda?" en vez de "¿hay una cuenta
-- PRINCIPAL de esta moneda?": encontraba la billetera y no abría la principal.
-- Ya está corregido en el código; esto repara lo que quedó mal.
--
-- ----------------------------------------------------------------------------
-- CÓMO CORRERLO — hay UN SOLO interruptor, abajo: @Aplicar
--
--   @Aplicar = 0  → SIMULACIÓN. Corre todo, te muestra exactamente qué haría y
--                   cómo quedaría la verificación final, y al terminar revierte
--                   TODO. La base no cambia ni un byte.
--   @Aplicar = 1  → APLICA de verdad.
--
-- Los tres pasos van en UNA sola transacción: o entran los tres o no entra
-- ninguno. No queda a medio camino.
--
-- Orden sugerido:
--   1. En LOCAL con @Aplicar = 0  → mirás los listados.
--   2. En LOCAL con @Aplicar = 1  → aplicás y revisás el 360 de los clientes.
--   3. En PRODUCCIÓN con @Aplicar = 0 → comparás los números con los de local.
--   4. En PRODUCCIÓN con @Aplicar = 1.
--
-- ----------------------------------------------------------------------------
-- Medido en la réplica del 4-sep-2026 (en producción dieron los mismos números):
--   PASO 1 → 26 cuentas se marcan como principal
--   PASO 2 →  9 cuentas principales creadas, 19 movimientos mudados
--   PASO 3 → 28 billeteras vuelven a su saldo real (cero)
--   Verificación final: 0, 0 y 0.
--
-- ⚠️ NO USAR UN TRIGGER en dbo.CuentasCliente. Está probado: ROMPE la
-- aplicación. Hay 9 INSERT en el backend que usan "OUTPUT INSERTED.CueIdCuenta"
-- sin cláusula INTO, y SQL Server prohíbe esa forma sobre una tabla con triggers
-- habilitados (error 334). Con un trigger puesto el sistema no puede crear
-- ninguna cuenta de cliente.
-- ============================================================================

SET NOCOUNT ON;
SET XACT_ABORT ON;

-- ┌──────────────────────────────────────────────────────────────────────────┐
-- │  EL INTERRUPTOR                                                          │
-- └──────────────────────────────────────────────────────────────────────────┘
DECLARE @Aplicar BIT = 0;   -- 0 = simulación (no cambia nada) · 1 = aplica

BEGIN TRAN;

-- ============================================================================
-- PASO 1 — LAS CUENTAS QUE DEBERÍAN HABER NACIDO PRINCIPALES
-- ----------------------------------------------------------------------------
-- Cuentas de dinero, sin nombre (o sea que NO son una BILLETERA), no
-- restringidas, marcadas como secundarias, y cuyo dueño no tiene cuenta
-- principal de esa misma moneda. Para esos clientes, esa cuenta ES su cuenta
-- corriente: marcarla como principal la pone en su lugar.
-- ============================================================================
    SELECT   cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente, RTRIM(c.IDCliente) AS IDCliente,
             cc.CueTipo, CONVERT(varchar(10), cc.CueFechaAlta, 120) AS Alta,
             CAST(cc.CueSaldoActual AS DECIMAL(18,2)) AS Saldo
    INTO     #Promover
    FROM     dbo.CuentasCliente cc
    JOIN     dbo.Clientes       c ON c.CliIdCliente = cc.CliIdCliente
    WHERE    cc.CueActiva = 1
      AND    cc.CueTipo LIKE 'DINERO%'
      AND    ISNULL(cc.CueEsPrincipal, 0) = 0
      AND    cc.CueNombre IS NULL
      AND    ISNULL(cc.CueRestringida, 0) = 0
      AND    NOT EXISTS (SELECT 1 FROM dbo.CuentasCliente p
                         WHERE p.CliIdCliente = cc.CliIdCliente
                           AND p.CueIdCuenta <> cc.CueIdCuenta
                           AND p.CueActiva    = 1
                           AND p.CueTipo      = cc.CueTipo
                           AND ISNULL(p.CueEsPrincipal, 0) = 1);

    SELECT 'PASO 1 — estas cuentas pasan a ser la cuenta principal del cliente' AS Detalle,
           * FROM #Promover ORDER BY Alta DESC, CueIdCuenta;

    UPDATE cc SET cc.CueEsPrincipal = 1
    FROM   dbo.CuentasCliente cc
    JOIN   #Promover p ON p.CueIdCuenta = cc.CueIdCuenta;

    SELECT 'PASO 1' AS Paso, @@ROWCOUNT AS CuentasPromovidas;   -- esperado 26


-- ============================================================================
-- PASO 2 — SACAR LOS MOVIMIENTOS DE ADENTRO DE LAS BILLETERAS
-- ----------------------------------------------------------------------------
-- Las billeteras no se usan todavía: tienen que estar todas en cero. Lo que
-- quedó adentro se asentó por el automático y pertenece a la cuenta corriente.
-- Son movimientos REALES (facturas emitidas, ventas de mostrador cobradas,
-- pagos recibidos): no se borran, se ponen donde van.
--
-- Como estos clientes no tienen cuenta principal de esa moneda, primero se les
-- crea con la misma forma que usa la aplicación, y después se mudan.
-- ============================================================================
    SELECT   cc.CueIdCuenta                                        AS BilleteraId,
             cc.CliIdCliente,
             cc.CueTipo,
             CASE WHEN cc.CueTipo = 'DINERO_USD' THEN 2 ELSE 1 END AS MonIdMoneda,
             mm.Cant                                               AS Movimientos,
             CAST(mm.Suma AS DECIMAL(18,2))                        AS SaldoQueSeMuda,
             CAST(NULL AS INT)                                     AS PrincipalId
    INTO     #Mudar
    FROM     dbo.CuentasCliente cc
    CROSS APPLY (SELECT COUNT(*) AS Cant, ISNULL(SUM(m.MovImporte), 0) AS Suma
                 FROM   dbo.MovimientosCuenta m
                 WHERE  m.CueIdCuenta = cc.CueIdCuenta
                   AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)) mm
    WHERE    cc.CueActiva = 1
      AND    RTRIM(ISNULL(cc.CueNombre, '')) IN ('BILLETERA UY', 'BILLETERA USD')
      AND    mm.Cant > 0;

    -- el detalle movimiento por movimiento, para poder mirarlo antes
    SELECT 'PASO 2 — movimientos que se mudan' AS Detalle,
           RTRIM(c.Nombre) AS Cliente, d.BilleteraId AS Billetera,
           CONVERT(varchar(10), m.MovFecha, 120) AS Fecha, m.MovTipo AS Tipo,
           CAST(m.MovImporte AS DECIMAL(18,2)) AS Importe,
           LEFT(ISNULL(m.MovConcepto, ''), 50) AS Concepto
    FROM   #Mudar d
    JOIN   dbo.MovimientosCuenta m ON m.CueIdCuenta = d.BilleteraId
    JOIN   dbo.Clientes          c ON c.CliIdCliente = d.CliIdCliente
    WHERE  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    ORDER BY c.Nombre, m.MovFecha, m.MovIdMovimiento;

    -- si la cuenta principal ya existe, se usa esa
    UPDATE   d SET d.PrincipalId = p.CueIdCuenta
    FROM     #Mudar d
    CROSS APPLY (SELECT TOP 1 p2.CueIdCuenta FROM dbo.CuentasCliente p2
                 WHERE p2.CliIdCliente = d.CliIdCliente AND p2.CueActiva = 1
                   AND p2.CueTipo = d.CueTipo AND ISNULL(p2.CueEsPrincipal, 0) = 1
                 ORDER BY p2.CueIdCuenta) p;

    -- crear la principal que falte
    DECLARE @Creadas TABLE (CueIdCuenta INT, CliIdCliente INT, CueTipo VARCHAR(20));

    INSERT INTO dbo.CuentasCliente
        (CliIdCliente, CueTipo, ProIdProducto, MonIdMoneda, CPaIdCondicion,
         CueSaldoActual, CueLimiteCredito, CuePuedeNegativo, CueCicloActivo,
         CueActiva, CueFechaAlta, CueUsuarioAlta, CueEsPrincipal)
    OUTPUT INSERTED.CueIdCuenta, INSERTED.CliIdCliente, INSERTED.CueTipo INTO @Creadas
    SELECT d.CliIdCliente, d.CueTipo, NULL, d.MonIdMoneda, 1,
           0, 0, 0, 0,
           1, GETDATE(), 999, 1
    FROM   #Mudar d
    WHERE  d.PrincipalId IS NULL;

    SELECT 'PASO 2' AS Paso, @@ROWCOUNT AS PrincipalesCreadas;   -- esperado 9

    UPDATE d SET d.PrincipalId = cr.CueIdCuenta
    FROM   #Mudar d JOIN @Creadas cr
      ON   cr.CliIdCliente = d.CliIdCliente AND cr.CueTipo = d.CueTipo;

    SELECT 'PASO 2 — de qué billetera a qué cuenta principal' AS Detalle,
           d.BilleteraId AS Billetera, RTRIM(c.Nombre) AS Cliente, d.CueTipo,
           d.Movimientos, d.SaldoQueSeMuda, d.PrincipalId AS CuentaDestino
    FROM   #Mudar d JOIN dbo.Clientes c ON c.CliIdCliente = d.CliIdCliente
    ORDER BY d.Movimientos DESC;

    UPDATE mv SET mv.CueIdCuenta = d.PrincipalId
    FROM   dbo.MovimientosCuenta mv
    JOIN   #Mudar d ON d.BilleteraId = mv.CueIdCuenta;

    SELECT 'PASO 2' AS Paso, @@ROWCOUNT AS MovimientosMudados;   -- esperado 19

    -- la billetera queda en cero, que es como tiene que estar
    UPDATE cc SET cc.CueSaldoActual = 0
    FROM   dbo.CuentasCliente cc JOIN #Mudar d ON d.BilleteraId = cc.CueIdCuenta;


-- ============================================================================
-- PASO 3 — PONER LA COLUMNA DE ACUERDO CON EL LIBRO
-- ----------------------------------------------------------------------------
-- CueSaldoActual quedó con números que ningún movimiento respalda (billeteras
-- con saldo negativo y el libro vacío). Se reescribe con la suma real del libro
-- y se recalcula el saldo corrido de cada movimiento, igual que hace
-- recomputarSaldoCuenta() en el código.
--
-- ALCANCE A PROPÓSITO: SOLO cuentas de dinero NO principales (las billeteras).
-- Las principales tienen su propio descuadre conocido —el movimiento ORDEN que
-- se cuenta dos veces cuando ya está facturado— y NO se tocan acá.
-- ============================================================================
    SELECT   cc.CueIdCuenta,
             CAST(cc.CueSaldoActual AS DECIMAL(18,2))  AS Antes,
             CAST(ISNULL(mm.Suma, 0) AS DECIMAL(18,2)) AS Despues
    INTO     #Resync
    FROM     dbo.CuentasCliente cc
    OUTER APPLY (SELECT SUM(m.MovImporte) AS Suma FROM dbo.MovimientosCuenta m
                 WHERE m.CueIdCuenta = cc.CueIdCuenta
                   AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)) mm
    WHERE    cc.CueActiva = 1
      AND    cc.CueTipo LIKE 'DINERO%'
      AND    ISNULL(cc.CueEsPrincipal, 0) = 0
      AND    ABS(cc.CueSaldoActual - ISNULL(mm.Suma, 0)) > 0.009;

    SELECT 'PASO 3 — billeteras cuya columna no coincide con su libro' AS Detalle,
           r.CueIdCuenta AS Cuenta, RTRIM(c.Nombre) AS Cliente, r.Antes, r.Despues
    FROM   #Resync r
    JOIN   dbo.CuentasCliente cc ON cc.CueIdCuenta = r.CueIdCuenta
    JOIN   dbo.Clientes       c  ON c.CliIdCliente = cc.CliIdCliente
    ORDER BY ABS(r.Antes) DESC;

    UPDATE cc SET cc.CueSaldoActual = r.Despues
    FROM   dbo.CuentasCliente cc JOIN #Resync r ON r.CueIdCuenta = cc.CueIdCuenta;

    SELECT 'PASO 3' AS Paso, @@ROWCOUNT AS CuentasResincronizadas;   -- esperado 28

    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta
                                       ORDER BY m.MovFecha, m.MovIdMovimiento
                                       ROWS UNBOUNDED PRECEDING) AS run
        FROM   dbo.MovimientosCuenta m
        JOIN   #Resync r ON r.CueIdCuenta = m.CueIdCuenta
        WHERE  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM   dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;


-- ============================================================================
-- VERIFICACIÓN — las tres tienen que dar 0
-- ============================================================================
    SELECT 'Billeteras con saldo distinto de cero' AS Control, COUNT(*) AS Debe_Ser_0
    FROM   dbo.CuentasCliente cc
    WHERE  cc.CueActiva = 1
      AND  RTRIM(ISNULL(cc.CueNombre, '')) IN ('BILLETERA UY', 'BILLETERA USD')
      AND  ABS(cc.CueSaldoActual) > 0.009
    UNION ALL
    SELECT 'Billeteras con movimientos adentro', COUNT(DISTINCT m.CueIdCuenta)
    FROM   dbo.MovimientosCuenta m
    JOIN   dbo.CuentasCliente   cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE  cc.CueActiva = 1
      AND  RTRIM(ISNULL(cc.CueNombre, '')) IN ('BILLETERA UY', 'BILLETERA USD')
      AND  (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    UNION ALL
    SELECT 'Cuentas de dinero sin nombre que siguen siendo secundarias', COUNT(*)
    FROM   dbo.CuentasCliente cc
    WHERE  cc.CueActiva = 1 AND cc.CueTipo LIKE 'DINERO%'
      AND  ISNULL(cc.CueEsPrincipal, 0) = 0 AND cc.CueNombre IS NULL
      AND  ISNULL(cc.CueRestringida, 0) = 0
      AND  NOT EXISTS (SELECT 1 FROM dbo.CuentasCliente p
                       WHERE p.CliIdCliente = cc.CliIdCliente AND p.CueIdCuenta <> cc.CueIdCuenta
                         AND p.CueActiva = 1 AND p.CueTipo = cc.CueTipo
                         AND ISNULL(p.CueEsPrincipal, 0) = 1);

    DROP TABLE #Promover;
    DROP TABLE #Mudar;
    DROP TABLE #Resync;

IF @Aplicar = 1
BEGIN
    COMMIT TRAN;
    PRINT '>>> APLICADO. Los cambios quedaron guardados.';
END
ELSE
BEGIN
    ROLLBACK TRAN;
    PRINT '>>> SIMULACION: no se cambio nada. Para aplicar, poner @Aplicar = 1 arriba.';
END
