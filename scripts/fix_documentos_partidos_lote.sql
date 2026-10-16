-- ============================================================================
-- fix_documentos_partidos_lote.sql
-- ----------------------------------------------------------------------------
-- LA MISMA ENFERMEDAD DE PALMERO, EN LOTE.
--
-- Un documento "partido" es el que tiene el CARGO en la cuenta de una moneda y
-- el COBRO en la de la otra. Ninguna de las dos cuentas dice la verdad: una
-- muestra plata a favor que no existe, la otra una deuda que ya se pago.
-- El caso testigo fue Palmero PC-3551 (cargo US$ 3.485,80 / cobro $ 119.878,26).
--
-- QUE HACE: le pasa el CARGO a la cuenta de la moneda del documento - que es
-- donde ya esta el cobro - con el importe del documento. Nada mas.
--   . No anula ni crea movimientos.
--   . No toca ningun cobro.
--   . No toca las ordenes.
--
-- CANDADOS - solo entra lo que no admite duda:
--   . el documento esta vivo y su cobro cubre el total (+-5 centesimos): o sea
--     el cliente YA pago, solo esta mal asentado
--   . hay UN solo movimiento de cargo, y vive en una cuenta de OTRA moneda
--   . el cliente tiene cuenta DINERO en la moneda del documento y el cobro esta ahi
--   . LA CUENTA DESTINO NO TIENE COBERTURAS "ANTICIPO_APLICADO" sin caja.
--     Este es el candado que aprendimos con el PC-3853: si otros documentos ya
--     se pagaron comiendose el saldo a favor falso, mover el cargo los deja
--     figurando cobrados contra plata que se evapora. Esas cuentas (Martina
--     Berriel 1121, Yesusport 613) quedan AFUERA y se tratan una por una.
--
-- Idempotente: una vez movido el cargo, el documento deja de estar partido.
--
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Par TABLE (
    DocIdDocumento INT PRIMARY KEY, MovCargo INT, CueOrigen INT, CueDestino INT,
    ImporteViejo DECIMAL(18,4), ImporteNuevo DECIMAL(18,4)
);

;WITH PorCuenta AS (
    SELECT m.DocIdDocumento, m.CueIdCuenta,
           Cargo  = ABS(SUM(CASE WHEN m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') AND m.MovImporte < 0 THEN m.MovImporte ELSE 0 END)),
           Cobro  = SUM(CASE WHEN m.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO') AND m.MovImporte > 0 THEN m.MovImporte ELSE 0 END),
           NCargo = SUM(CASE WHEN m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') AND m.MovImporte < 0 THEN 1 ELSE 0 END)
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND m.DocIdDocumento IS NOT NULL
      AND cc.CueTipo LIKE 'DINERO%'
      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
    GROUP BY m.DocIdDocumento, m.CueIdCuenta
)
INSERT INTO @Par (DocIdDocumento, MovCargo, CueOrigen, CueDestino, ImporteViejo, ImporteNuevo)
SELECT d.DocIdDocumento, mc.MovIdMovimiento, cg.CueIdCuenta, cb.CueIdCuenta,
       mc.MovImporte, -d.DocTotal
FROM dbo.DocumentosContables d
-- la pata del cargo, varada en una cuenta de OTRA moneda
CROSS APPLY (SELECT TOP 1 * FROM PorCuenta x
             WHERE x.DocIdDocumento = d.DocIdDocumento AND x.Cargo > 0.01 AND x.Cobro <= 0.01
             ORDER BY x.Cargo DESC) cg
-- la pata del cobro, en la cuenta de la moneda del documento
CROSS APPLY (SELECT TOP 1 * FROM PorCuenta x
             WHERE x.DocIdDocumento = d.DocIdDocumento AND x.Cobro > 0.01 AND x.Cargo <= 0.01
             ORDER BY x.Cobro DESC) cb
JOIN dbo.CuentasCliente c1 ON c1.CueIdCuenta = cg.CueIdCuenta
JOIN dbo.CuentasCliente c2 ON c2.CueIdCuenta = cb.CueIdCuenta
-- el unico movimiento de cargo del documento
CROSS APPLY (SELECT TOP 1 m.MovIdMovimiento, m.MovImporte FROM dbo.MovimientosCuenta m
             WHERE m.DocIdDocumento = d.DocIdDocumento AND m.CueIdCuenta = cg.CueIdCuenta
               AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
               AND m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') AND m.MovImporte < 0
             ORDER BY ABS(m.MovImporte) DESC) mc
WHERE ISNULL(d.DocEstado,'') <> 'ANULADO'
  AND cg.NCargo = 1                                              -- un solo cargo
  AND c1.CliIdCliente = d.CliIdCliente
  AND c2.CliIdCliente = d.CliIdCliente
  AND ISNULL(c1.MonIdMoneda, 1) <> ISNULL(c2.MonIdMoneda, 1)     -- monedas distintas
  AND ISNULL(c2.MonIdMoneda, 1) = ISNULL(d.MonIdMoneda, 1)       -- el destino es la moneda del doc
  AND ABS(cb.Cobro - d.DocTotal) <= 0.05                         -- el cobro cubre el documento
  AND d.DocTotal > 0
  -- CANDADO CLAVE: la cuenta destino no puede tener documentos pagados contra
  -- el saldo a favor (se irian a deber sin que nadie se entere). Ver PC-3853.
  AND NOT EXISTS (
        SELECT 1 FROM dbo.ImputacionPago ip
        JOIN dbo.Pagos p ON p.PagIdPago = ip.PagIdPago
        WHERE ip.CueIdCuenta = cb.CueIdCuenta
          AND p.PagTipoMovimiento = 'ANTICIPO_APLICADO'
          AND p.PagTcaIdTransaccion IS NULL
          AND ip.ImpImporte > 0.01);

-- ══ BLOQUE 0: que se va a mover (correr SOLO hasta aca la primera vez) ══════
SELECT Resumen = 'A CORREGIR', Documentos = COUNT(*), Cuentas = COUNT(DISTINCT CueDestino) FROM @Par;

SELECT Cliente = LEFT(RTRIM(cl.Nombre), 22),
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero),
       Total = CAST(d.DocTotal AS DECIMAL(18,2)),
       MonedaDoc = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       DesdeCuenta = p.CueOrigen, EnMoneda = CASE WHEN c1.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       CargoViejo = CAST(p.ImporteViejo AS DECIMAL(18,2)),
       HaciaCuenta = p.CueDestino, CargoNuevo = CAST(p.ImporteNuevo AS DECIMAL(18,2)),
       DestinoHoy = CAST(sd.Saldo AS DECIMAL(18,2)),
       DestinoDespues = CAST(sd.Saldo + p.ImporteNuevo AS DECIMAL(18,2)),
       OrigenHoy = CAST(so.Saldo AS DECIMAL(18,2)),
       OrigenDespues = CAST(so.Saldo - p.ImporteViejo AS DECIMAL(18,2))
FROM @Par p
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = p.DocIdDocumento
JOIN dbo.Clientes cl ON cl.CliIdCliente = d.CliIdCliente
JOIN dbo.CuentasCliente c1 ON c1.CueIdCuenta = p.CueOrigen
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = p.CueDestino
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) sd
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = p.CueOrigen
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) so
ORDER BY d.DocTotal DESC;

-- ══ EL ARREGLO ═════════════════════════════════════════════════════════════
BEGIN TRANSACTION;

    UPDATE m
    SET m.CueIdCuenta = p.CueDestino,
        m.MovImporte  = p.ImporteNuevo,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones,'') +
            ' FIX_PARTIDO_2026-09-02: documento partido en dos monedas (el cargo quedo' +
            ' en la cuenta de una moneda y el cobro en la de la otra). Se muda el cargo' +
            ' a la cuenta de la moneda del documento, con el importe del documento.'), 500)
    FROM dbo.MovimientosCuenta m
    JOIN @Par p ON p.MovCargo = m.MovIdMovimiento;

    -- El documento esta cobrado: la deuda que haya quedado viva se salda.
    UPDATE dd
    SET dd.DDeImportePendiente = 0,
        dd.DDeEstado = 'COBRADO',
        dd.DDeFechaCobro = ISNULL(dd.DDeFechaCobro, GETDATE()),
        dd.DDeObservaciones = LEFT(LTRIM(ISNULL(dd.DDeObservaciones,'') +
            ' FIX_PARTIDO_2026-09-02: el cobro cubre el documento; estaba asentado en la' +
            ' cuenta de la otra moneda.'), 500)
    FROM dbo.DeudaDocumento dd
    JOIN @Par p ON p.DocIdDocumento = dd.DocIdDocumento
    WHERE dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO');

    UPDATE d SET d.DocPagado = 1
    FROM dbo.DocumentosContables d JOIN @Par p ON p.DocIdDocumento = d.DocIdDocumento;

    -- Recalcular saldo corrido y saldo de cuenta (convencion de la casa).
    ;WITH Tocadas AS (
        SELECT CueOrigen AS Cue FROM @Par UNION SELECT CueDestino FROM @Par
    ), ord AS (
        SELECT m.MovIdMovimiento,
               run = SUM(m.MovImporte) OVER (PARTITION BY m.CueIdCuenta ORDER BY m.MovFecha, m.MovIdMovimiento ROWS UNBOUNDED PRECEDING)
        FROM dbo.MovimientosCuenta m
        WHERE m.CueIdCuenta IN (SELECT Cue FROM Tocadas)
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
    )
    UPDATE m SET m.MovSaldoPosterior = ord.run
    FROM dbo.MovimientosCuenta m JOIN ord ON ord.MovIdMovimiento = m.MovIdMovimiento;

    UPDATE cc
    SET cc.CueSaldoActual = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueIdCuenta IN (SELECT CueOrigen FROM @Par UNION SELECT CueDestino FROM @Par);

COMMIT TRANSACTION;

-- ══ DESPUES ════════════════════════════════════════════════════════════════
SELECT Momento = 'DESPUES', Cliente = LEFT(RTRIM(cl.Nombre), 22), cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo = CAST(s.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (SELECT CueOrigen FROM @Par UNION SELECT CueDestino FROM @Par)
ORDER BY cl.Nombre, cc.MonIdMoneda DESC;

-- ══ LOS QUE QUEDARON AFUERA: hay que mirarlos de a uno ══════════════════════
-- Documentos partidos que el lote NO toca. El motivo mas comun es que su cuenta
-- ya tiene documentos pagados contra el saldo a favor (candado del PC-3853).
;WITH PorCuenta AS (
    SELECT m.DocIdDocumento, m.CueIdCuenta,
           Cargo = ABS(SUM(CASE WHEN m.MovTipo IN ('VTA_CAJA','VENTA','CARGO','CIERRE_CICLO') AND m.MovImporte < 0 THEN m.MovImporte ELSE 0 END)),
           Cobro = SUM(CASE WHEN m.MovTipo IN ('PAGO','PAGO_CRUZADO','ANTICIPO') AND m.MovImporte > 0 THEN m.MovImporte ELSE 0 END)
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND m.DocIdDocumento IS NOT NULL
      AND cc.CueTipo LIKE 'DINERO%' AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
    GROUP BY m.DocIdDocumento, m.CueIdCuenta
), Doc AS (
    SELECT p.DocIdDocumento,
           CtasCargo = SUM(CASE WHEN p.Cargo > 0.01 THEN 1 ELSE 0 END),
           CtasCobro = SUM(CASE WHEN p.Cobro > 0.01 THEN 1 ELSE 0 END),
           CtasAmbos = SUM(CASE WHEN p.Cargo > 0.01 AND p.Cobro > 0.01 THEN 1 ELSE 0 END)
    FROM PorCuenta p GROUP BY p.DocIdDocumento
)
SELECT Pendiente = 'MIRAR A MANO', Cliente = LEFT(RTRIM(cl.Nombre), 22),
       Documento = RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero), d.DocIdDocumento,
       Total = CAST(d.DocTotal AS DECIMAL(18,2)),
       MonedaDoc = CASE WHEN d.MonIdMoneda = 2 THEN 'US$' ELSE '$' END
FROM Doc q
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = q.DocIdDocumento
JOIN dbo.Clientes cl ON cl.CliIdCliente = d.CliIdCliente
WHERE ISNULL(d.DocEstado,'') <> 'ANULADO'
  AND q.CtasCargo > 0 AND q.CtasCobro > 0 AND q.CtasAmbos = 0
ORDER BY d.DocTotal DESC;
