-- ============================================================================
-- fix_vincular_cobros_sueltos.sql
-- ----------------------------------------------------------------------------
-- DEPURACIÓN SIN MOVER PLATA.
--
-- Muchas cuentas tienen, al mismo tiempo, documentos con cargo y SIN cobro, y
-- cobros sueltos (sin documento) por EXACTAMENTE el mismo importe. El cobro está:
-- lo que falta es el vínculo. Ejemplo verificado — GSPORT:
--     ET-2474 cargo 7.326  ↔  PAGO suelto 7.326
--     ET-4849 cargo 4.257  ↔  cobertura   4.257
--     ET-6297 cargo 3.861  ↔  cobertura   3.861
--     PC-3808 cargo   990  ↔  cobertura     990
--     ET-5193 cargo   198  ↔  cobertura     198
--
-- QUÉ HACE: le estampa el DocIdDocumento al cobro suelto. NADA MÁS.
--   · No cambia ningún importe.
--   · No anula ni crea movimientos.
--   · El saldo de la cuenta queda EXACTAMENTE IGUAL (se verifica al final).
-- Lo que cambia es que el documento pasa a verse cobrado y el sobrante real de
-- cada cuenta queda a la vista, sin ruido.
--
-- CANDADOS — solo vincula lo que no admite duda:
--   · el cobro es positivo, vivo, sin documento, y está en la misma cuenta
--   · el documento tiene cargo vivo en esa cuenta y CERO cobros
--   · los importes coinciden dentro de 2 centavos
--   · el emparejamiento es ÚNICO: un solo cobro y un solo documento con ese
--     importe en esa cuenta. Si hay dos iguales, no se toca ninguno.
--   · el cobro no puede ser anterior al cargo (no se paga antes de que exista)
--
-- Idempotente: una vez vinculado, el cobro deja de estar suelto y no vuelve a entrar.
--
-- ABRIR DESDE EL DISCO en SSMS (File → Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Par TABLE (
    MovCobro INT PRIMARY KEY, CueIdCuenta INT, DocIdDocumento INT, Importe DECIMAL(18,4)
);

;WITH Sueltos AS (
    -- Cobros sin documento, uno por fila
    SELECT m.MovIdMovimiento, m.CueIdCuenta, m.MovImporte, m.MovFecha,
           Cuantos = COUNT(*) OVER (PARTITION BY m.CueIdCuenta, m.MovImporte)
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND m.DocIdDocumento IS NULL
      AND m.MovImporte > 0
      AND m.MovTipo IN ('PAGO','PAGO_CRUZADO','COBRO')
      AND cc.CueTipo LIKE 'DINERO%'
),
DocsSinCobro AS (
    -- Documentos con cargo vivo en la cuenta y sin ningún cobro ahí
    SELECT q.CueIdCuenta, q.DocIdDocumento, q.Cargo, q.FechaCargo,
           Cuantos = COUNT(*) OVER (PARTITION BY q.CueIdCuenta, q.Cargo)
    FROM (
        SELECT m.CueIdCuenta, m.DocIdDocumento,
               Cargo = ABS(SUM(CASE WHEN m.MovImporte < 0 AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') THEN m.MovImporte ELSE 0 END)),
               Cobro = SUM(CASE WHEN m.MovImporte > 0 AND m.MovTipo = 'PAGO' THEN m.MovImporte ELSE 0 END),
               FechaCargo = MIN(CASE WHEN m.MovImporte < 0 THEN m.MovFecha END)
        FROM dbo.MovimientosCuenta m
        JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
        JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
        WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0)
          AND ISNULL(d.DocEstado,'') <> 'ANULADO'
          AND cc.CueTipo LIKE 'DINERO%'
          AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO','PAGO')
        GROUP BY m.CueIdCuenta, m.DocIdDocumento
    ) q
    WHERE q.Cargo > 0.005 AND q.Cobro <= 0.005
)
INSERT INTO @Par (MovCobro, CueIdCuenta, DocIdDocumento, Importe)
SELECT s.MovIdMovimiento, s.CueIdCuenta, d.DocIdDocumento, s.MovImporte
FROM Sueltos s
JOIN DocsSinCobro d
     ON d.CueIdCuenta = s.CueIdCuenta
    AND ABS(d.Cargo - s.MovImporte) <= 0.02
WHERE s.Cuantos = 1 AND d.Cuantos = 1          -- emparejamiento único de los dos lados
  AND s.MovFecha >= DATEADD(DAY, -1, d.FechaCargo);  -- el cobro no puede ser anterior al cargo

-- ── BLOQUE 0: qué se va a vincular (correr solo esto la primera vez) ───────
SELECT Resumen = 'A VINCULAR', Cobros = COUNT(*), Cuentas = COUNT(DISTINCT CueIdCuenta),
       Importe = SUM(Importe) FROM @Par;

SELECT TOP 40 Cliente = RTRIM(cl.Nombre), p.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Importe = p.Importe, MovCobro = p.MovCobro,
       Concepto = LEFT(ISNULL(m.MovConcepto,''), 50)
FROM @Par p
JOIN dbo.MovimientosCuenta m ON m.MovIdMovimiento = p.MovCobro
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = p.DocIdDocumento
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = p.CueIdCuenta
JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
ORDER BY p.Importe DESC;

-- ── EL VÍNCULO ──────────────────────────────────────────────────────────────
DECLARE @SaldoAntes TABLE (CueIdCuenta INT PRIMARY KEY, Saldo DECIMAL(18,4));
INSERT INTO @SaldoAntes
SELECT DISTINCT p.CueIdCuenta,
       ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
               WHERE m.CueIdCuenta = p.CueIdCuenta
                 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)
FROM @Par p;

BEGIN TRANSACTION;

    UPDATE m
    SET m.DocIdDocumento = p.DocIdDocumento,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') +
            ' FIX_VINCULO_2026-09-01: cobro que estaba suelto, vinculado al documento que' +
            ' cubre por importe exacto. No se movió ningún importe.'), 500)
    FROM dbo.MovimientosCuenta m
    JOIN @Par p ON p.MovCobro = m.MovIdMovimiento;

COMMIT TRANSACTION;

-- ── VERIFICACIÓN: ningún saldo se puede haber movido ───────────────────────
-- Esta consulta TIENE que salir vacía. Si sale algo, algo se movió y hay que mirarlo.
SELECT Alerta = 'EL SALDO SE MOVIO — REVISAR', a.CueIdCuenta, SaldoAntes = a.Saldo,
       SaldoAhora = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                            WHERE m.CueIdCuenta = a.CueIdCuenta
                              AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                              AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)
FROM @SaldoAntes a
WHERE ABS(a.Saldo - ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                            WHERE m.CueIdCuenta = a.CueIdCuenta
                              AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                              AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) > 0.005;

-- ── DESPUÉS: cuántos documentos quedan sin cobro ───────────────────────────
SELECT Resumen = 'DOCUMENTOS SIN COBRO QUE QUEDAN',
       Documentos = COUNT(*), Importe = SUM(q.Cargo)
FROM (
    SELECT m.CueIdCuenta, m.DocIdDocumento,
           Cargo = ABS(SUM(CASE WHEN m.MovImporte < 0 AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') THEN m.MovImporte ELSE 0 END)),
           Cobro = SUM(CASE WHEN m.MovImporte > 0 AND m.MovTipo = 'PAGO' THEN m.MovImporte ELSE 0 END)
    FROM dbo.MovimientosCuenta m
    JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
    WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND ISNULL(d.DocEstado,'') <> 'ANULADO'
      AND cc.CueTipo LIKE 'DINERO%' AND cl.TClIdTipoCliente = 1
      AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO','PAGO')
    GROUP BY m.CueIdCuenta, m.DocIdDocumento
) q
WHERE q.Cargo > 0.005 AND q.Cobro <= 0.005;
