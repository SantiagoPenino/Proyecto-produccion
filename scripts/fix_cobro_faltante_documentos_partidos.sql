-- ============================================================================
-- fix_cobro_faltante_documentos_partidos.sql
-- ----------------------------------------------------------------------------
-- Comprobantes que se repartieron entre las DOS cuentas del cliente (una parte en
-- pesos y otra en dólares) pero cuyo COBRO se asentó en una sola. La cuenta que
-- quedó sin el cobro muestra al cliente debiendo algo que ya pagó.
--
-- Es el caso de Micaela Tripicchio (ET-3564: cargo US$ 121,47 cobrado + cargo
-- $ 11.400 sin cobrar), generalizado. En producción al 01-09-2026: 50 documentos
-- de 37 clientes Comunes por $ 54.765,39 — de los cuales 43 tienen la transacción
-- de caja COMPLETADA por el total exacto del comprobante.
--
-- ALCANCE: clientes de tipo Común (1) y sin tipo. Y SOLO donde la caja confirma
-- que el cliente pagó todo. Los que no tengan esa confirmación quedan afuera y se
-- listan al final para mirarlos de a uno.
--
-- QUÉ HACE: por cada (documento, cuenta) que tiene CARGO y NO tiene cobro, registra
-- el movimiento de cobro faltante por el importe del cargo de esa cuenta, con la
-- fecha del cargo. NO toca documentos, ni cargos, ni deudas, ni las transacciones.
--
-- CANDADOS — solo entra lo que no admite interpretación:
--   · el documento no está anulado y es de un cliente Común o sin tipo
--   · tiene cargo en MÁS DE UNA cuenta (es un comprobante partido)
--   · en esa cuenta hay cargo y CERO cobros
--   · en alguna OTRA cuenta sí se cobró (prueba de que el cobro se hizo a medias)
--   · la transacción de caja está COMPLETADO/COBRADO y cobró el total del
--     comprobante (±1)
--
-- Idempotente: una vez repuesto el cobro, esa cuenta deja de entrar en la selección.
--
-- ABRIR DESDE EL DISCO en SSMS (File → Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Rep TABLE (
    DocIdDocumento INT, CueIdCuenta INT, Importe DECIMAL(18,4), Fecha DATETIME,
    Etiqueta VARCHAR(30), PRIMARY KEY (DocIdDocumento, CueIdCuenta)
);

;WITH Patas AS (
    -- Una fila por documento y cuenta: cuánto se cargó y cuánto se cobró ahí
    SELECT m.DocIdDocumento, m.CueIdCuenta,
           Cargo = SUM(CASE WHEN m.MovImporte < 0 AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') THEN -m.MovImporte ELSE 0 END),
           Cobro = SUM(CASE WHEN m.MovImporte > 0 AND m.MovTipo = 'PAGO' THEN m.MovImporte ELSE 0 END),
           FechaCargo = MIN(CASE WHEN m.MovImporte < 0 AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') THEN m.MovFecha END)
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND cc.CueTipo LIKE 'DINERO%'
      AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO','PAGO')
      AND m.DocIdDocumento IS NOT NULL
    GROUP BY m.DocIdDocumento, m.CueIdCuenta
),
Doc AS (
    SELECT DocIdDocumento,
           CtasConCargo = SUM(CASE WHEN Cargo > 0.005 THEN 1 ELSE 0 END),
           CtasConCobro = SUM(CASE WHEN Cobro > 0.005 THEN 1 ELSE 0 END)
    FROM Patas GROUP BY DocIdDocumento
)
INSERT INTO @Rep (DocIdDocumento, CueIdCuenta, Importe, Fecha, Etiqueta)
SELECT p.DocIdDocumento, p.CueIdCuenta, p.Cargo, ISNULL(p.FechaCargo, d.DocFechaEmision),
       RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero)
FROM Patas p
JOIN Doc  x ON x.DocIdDocumento = p.DocIdDocumento
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = p.DocIdDocumento
JOIN dbo.Clientes cl ON cl.CliIdCliente = d.CliIdCliente
JOIN dbo.TransaccionesCaja t ON t.TcaIdTransaccion = d.TcaIdTransaccion
WHERE p.Cargo > 0.005 AND p.Cobro <= 0.005      -- esta cuenta tiene cargo y no se cobró
  AND x.CtasConCargo > 1                        -- el comprobante está partido
  AND x.CtasConCobro > 0                        -- y en la otra cuenta SÍ se cobró
  AND ISNULL(d.DocEstado,'') <> 'ANULADO'
  AND (cl.TClIdTipoCliente = 1 OR cl.TClIdTipoCliente IS NULL)
  AND t.TcaEstado IN ('COMPLETADO','COBRADO')
  AND ABS(t.TcaTotalCobrado - d.DocTotal) <= 1; -- la caja cobró el total

-- ── CANDADO CLAVE: la cuenta tiene que DEBER lo que vamos a reponer ────────
-- Reponer un cobro sube el saldo. Si la cuenta ya está en cero o a favor, ese
-- cobro no es lo que le falta y meterlo la deja con plata que no existe (GSPORT
-- ya estaba +4.752 a favor y el lote le sumaba 8.118 más). Se saca de la lista
-- toda cuenta cuyo saldo no alcance a cubrir lo que se le repondría.
DELETE r
FROM @Rep r
JOIN (SELECT CueIdCuenta, ARepone = SUM(Importe) FROM @Rep GROUP BY CueIdCuenta) tot
     ON tot.CueIdCuenta = r.CueIdCuenta
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = r.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE s.Saldo > -tot.ARepone + 1;

-- ── BLOQUE 0: qué se va a reponer (correr solo esto la primera vez) ────────
SELECT Resumen = 'A REPONER', Cobros = COUNT(*), Documentos = COUNT(DISTINCT DocIdDocumento),
       Total = SUM(Importe) FROM @Rep;

SELECT Cliente = RTRIM(cl.Nombre), r.Etiqueta AS Documento,
       MonedaDoc = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END, d.DocTotal,
       CuentaSinCobro = r.CueIdCuenta,
       MonedaCuenta = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       CobroQueSeRepone = r.Importe, r.Fecha
FROM @Rep r
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = r.DocIdDocumento
JOIN dbo.Clientes cl ON cl.CliIdCliente = d.CliIdCliente
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = r.CueIdCuenta
ORDER BY r.Importe DESC;

-- ── EL ARREGLO ──────────────────────────────────────────────────────────────
BEGIN TRANSACTION;

    INSERT INTO dbo.MovimientosCuenta
        (CueIdCuenta, MovTipo, MovConcepto, MovImporte, MovSaldoPosterior,
         DocIdDocumento, MovFecha, MovUsuarioAlta, MovAnulado, MovObservaciones)
    SELECT r.CueIdCuenta, 'PAGO',
           LEFT('Pago: ' + r.Etiqueta + ' (repuesto: la parte de esta cuenta no estaba)', 500),
           r.Importe, 0, r.DocIdDocumento, r.Fecha, 1, 0,
           'FIX_COBRO_PARTIDO_2026-09-01: el comprobante se repartió entre dos cuentas y el cobro se asentó solo en una. La caja registró el cobro del total.'
    FROM @Rep r;

    -- Recalcular saldo corrido y guardado de las cuentas tocadas
    ;WITH ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM @Rep)
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM @Rep);

COMMIT TRANSACTION;

-- ── DESPUÉS: cómo quedaron las cuentas tocadas ─────────────────────────────
SELECT Estado = CASE WHEN ABS(s.Saldo) < 1 THEN '1 · en cero'
                     WHEN s.Saldo < -1     THEN '2 · sigue debiendo'
                     ELSE                       '3 · queda a favor' END,
       Cuentas = COUNT(*), Total = SUM(s.Saldo)
FROM dbo.CuentasCliente cc
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (SELECT DISTINCT CueIdCuenta FROM @Rep)
GROUP BY CASE WHEN ABS(s.Saldo) < 1 THEN '1 · en cero'
              WHEN s.Saldo < -1     THEN '2 · sigue debiendo'
              ELSE                       '3 · queda a favor' END
ORDER BY 1;

-- ── LOS QUE QUEDARON AFUERA: mismo síntoma, SIN confirmación de la caja ────
-- Estos hay que mirarlos de a uno: puede que el cliente realmente no haya pagado.
;WITH Patas AS (
    SELECT m.DocIdDocumento, m.CueIdCuenta,
           Cargo = SUM(CASE WHEN m.MovImporte < 0 AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') THEN -m.MovImporte ELSE 0 END),
           Cobro = SUM(CASE WHEN m.MovImporte > 0 AND m.MovTipo = 'PAGO' THEN m.MovImporte ELSE 0 END)
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND cc.CueTipo LIKE 'DINERO%'
      AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO','PAGO')
      AND m.DocIdDocumento IS NOT NULL
    GROUP BY m.DocIdDocumento, m.CueIdCuenta
),
Doc AS (
    SELECT DocIdDocumento,
           CtasConCargo = SUM(CASE WHEN Cargo > 0.005 THEN 1 ELSE 0 END),
           CtasConCobro = SUM(CASE WHEN Cobro > 0.005 THEN 1 ELSE 0 END)
    FROM Patas GROUP BY DocIdDocumento
)
SELECT Cliente = RTRIM(cl.Nombre), Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       d.DocTotal, CuentaSinCobro = p.CueIdCuenta, FaltaCobrar = p.Cargo,
       CajaEstado = ISNULL(t.TcaEstado, '(sin transacción)'), CajaCobro = t.TcaTotalCobrado
FROM Patas p
JOIN Doc x ON x.DocIdDocumento = p.DocIdDocumento
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = p.DocIdDocumento
JOIN dbo.Clientes cl ON cl.CliIdCliente = d.CliIdCliente
LEFT JOIN dbo.TransaccionesCaja t ON t.TcaIdTransaccion = d.TcaIdTransaccion
WHERE p.Cargo > 0.005 AND p.Cobro <= 0.005
  AND x.CtasConCargo > 1 AND x.CtasConCobro > 0
  AND ISNULL(d.DocEstado,'') <> 'ANULADO'
  AND NOT EXISTS (SELECT 1 FROM @Rep r WHERE r.DocIdDocumento = p.DocIdDocumento AND r.CueIdCuenta = p.CueIdCuenta)
ORDER BY p.Cargo DESC;
