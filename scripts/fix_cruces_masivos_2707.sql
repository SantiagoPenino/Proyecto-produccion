-- ============================================================================
-- fix_cruces_masivos_2707.sql
-- ----------------------------------------------------------------------------
-- El 27/07/2026 a las 19:40:09 —todos en el mismo segundo— corrió algo que tomó
-- el "saldo a favor" en dólares de una veintena de clientes y lo pasó a pesos
-- (PAGO_CRUZADO, "Cobertura desde DINERO_USD (cruce de saldo a favor US$ x)").
-- Tapó el descuadre en pesos que generaban los CARGOS DUPLICADOS de julio, usando
-- dólares que en su mayoría eran fantasma.
--
-- Los cargos duplicados ya se anularon (fix_cargos_duplicados_julio.sql), así que
-- esa cobertura quedó sin nada que cubrir: es el saldo a favor en pesos que hoy
-- muestran Marcos Mendez, Ziba, Santiago Rocha, Mauge Regina y compañía.
--
-- QUÉ HACE: anula (MovAnulado = 1, NO borra) LOS DOS lados del cruce — el crédito
-- en pesos y el débito en dólares — y recalcula el saldo de las dos cuentas.
--
-- CANDADO: solo entran los cruces donde, al sacar el crédito, la cuenta en pesos
-- NO queda debiendo. Si el crédito es mayor que el saldo a favor de hoy, esa
-- cuenta tiene además otros problemas y el cruce no se puede sacar sin mirarla
-- (caso andrea silva: cruce de 55.778 contra 27.306 a favor → quedaría debiendo
-- 28.472). Esos quedan listados al final.
--
-- OJO CON EL EFECTO EN DÓLARES: al revertir, la cuenta en dólares recupera lo que
-- le sacaron. Si esos dólares eran fantasma, el saldo a favor no desaparece: se
-- MUEVE de pesos a dólares y queda a la vista para tratarlo aparte (Marcos Mendez:
-- pesos 3.529 → 29,99 y dólares 68,39 → 154,23). Es el estado que habría existido
-- si el cruce nunca se hubiera disparado.
--
-- Idempotente: los cruces ya anulados no vuelven a entrar.
--
-- ABRIR DESDE EL DISCO en SSMS (File → Open). No copiar/pegar desde el chat.
-- ============================================================================

SET XACT_ABORT ON;

DECLARE @Cruces TABLE (
    CliIdCliente INT, MovDestino INT, CueDestino INT, ImporteDestino DECIMAL(18,4),
    MovOrigen INT, CueOrigen INT, ImporteOrigen DECIMAL(18,4)
);

;WITH C AS (
    SELECT m.MovIdMovimiento, m.CueIdCuenta, m.MovImporte, cc.CliIdCliente,
           Lado = CASE WHEN m.MovImporte > 0 THEN 'D' ELSE 'O' END
    FROM dbo.MovimientosCuenta m
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
    WHERE m.MovTipo = 'PAGO_CRUZADO'
      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND CAST(m.MovFecha AS DATE) = '2026-07-27'
      AND m.OrdIdOrden IS NULL          -- el lote masivo, no las coberturas por orden
      -- Mismo alcance que todo lo demás: Común y sin tipo. Los semanales (CR SPORT,
      -- Tdh Sports) tienen saldo a favor legítimo y su cruce va al revés —les sacaron
      -- PESOS para cubrir dólares—, así que se miran aparte.
      AND (cl.TClIdTipoCliente = 1 OR cl.TClIdTipoCliente IS NULL)
)
INSERT INTO @Cruces (CliIdCliente, MovDestino, CueDestino, ImporteDestino, MovOrigen, CueOrigen, ImporteOrigen)
SELECT d.CliIdCliente, d.MovIdMovimiento, d.CueIdCuenta, d.MovImporte,
       o.MovIdMovimiento, o.CueIdCuenta, o.MovImporte
FROM C d
JOIN C o ON o.CliIdCliente = d.CliIdCliente AND o.Lado = 'O'
WHERE d.Lado = 'D';

-- ── CANDADO: sacar el crédito no puede dejar la cuenta en pesos debiendo ──
DELETE c
FROM @Cruces c
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = c.CueDestino
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE s.Saldo - c.ImporteDestino < -1;

-- ── BLOQUE 0: qué se va a revertir (correr solo esto la primera vez) ───────
SELECT Cliente = RTRIM(cl.Nombre), c.CliIdCliente,
       CuentaDestino = c.CueDestino, CreditoQueSeSaca = c.ImporteDestino,
       DestinoHoy = CAST(sd.Saldo AS DECIMAL(18,2)),
       DestinoDespues = CAST(sd.Saldo - c.ImporteDestino AS DECIMAL(18,2)),
       CuentaOrigen = c.CueOrigen, DebitoQueSeDevuelve = c.ImporteOrigen,
       OrigenHoy = CAST(so.Saldo AS DECIMAL(18,2)),
       OrigenDespues = CAST(so.Saldo - c.ImporteOrigen AS DECIMAL(18,2))
FROM @Cruces c
JOIN dbo.Clientes cl ON cl.CliIdCliente = c.CliIdCliente
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = c.CueDestino
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) sd
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = c.CueOrigen
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) so
ORDER BY c.ImporteDestino DESC;

-- ── EL ARREGLO ──────────────────────────────────────────────────────────────
BEGIN TRANSACTION;

    UPDATE m
    SET m.MovAnulado = 1,
        m.MovObservaciones = LEFT(LTRIM(ISNULL(m.MovObservaciones, '') +
            ' FIX_CRUCE_2707_2026-09-01: cruce masivo del 27/07 que tapaba los cargos' +
            ' duplicados de julio (ya anulados). Se revierten los dos lados.'), 500)
    FROM dbo.MovimientosCuenta m
    WHERE m.MovIdMovimiento IN (SELECT MovDestino FROM @Cruces)
       OR m.MovIdMovimiento IN (SELECT MovOrigen  FROM @Cruces);

    ;WITH Tocadas AS (
        SELECT CueDestino AS Cue FROM @Cruces UNION SELECT CueOrigen FROM @Cruces
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
    WHERE cc.CueIdCuenta IN (SELECT CueDestino FROM @Cruces UNION SELECT CueOrigen FROM @Cruces);

COMMIT TRANSACTION;

-- ── DESPUÉS ─────────────────────────────────────────────────────────────────
SELECT Momento = 'DESPUES', Cliente = RTRIM(cl.Nombre),
       cc.CueIdCuenta,
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Saldo  = CAST(s.Saldo AS DECIMAL(18,2))
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                                    WHERE m.CueIdCuenta = cc.CueIdCuenta
                                      AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE cc.CueIdCuenta IN (SELECT CueDestino FROM @Cruces UNION SELECT CueOrigen FROM @Cruces)
ORDER BY cl.Nombre, cc.MonIdMoneda DESC;

-- ── LOS QUE QUEDARON AFUERA: sacar el cruce los dejaría debiendo ───────────
-- Estos tienen ADEMÁS otro problema en la cuenta en pesos (típicamente un
-- documento con cargo y sin cobro). Hay que mirarlos de a uno.
SELECT Cliente = RTRIM(cl.Nombre), cc.CliIdCliente, Cuenta = m.CueIdCuenta,
       Credito = m.MovImporte, SaldoHoy = CAST(s.Saldo AS DECIMAL(18,2)),
       QuedariaEn = CAST(s.Saldo - m.MovImporte AS DECIMAL(18,2))
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.Clientes cl ON cl.CliIdCliente = cc.CliIdCliente
CROSS APPLY (SELECT Saldo = ISNULL((SELECT SUM(x.MovImporte) FROM dbo.MovimientosCuenta x
                                    WHERE x.CueIdCuenta = m.CueIdCuenta
                                      AND (x.MovAnulado IS NULL OR x.MovAnulado = 0)
                                      AND x.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)) s
WHERE m.MovTipo = 'PAGO_CRUZADO' AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND CAST(m.MovFecha AS DATE) = '2026-07-27' AND m.OrdIdOrden IS NULL
  AND m.MovImporte > 0
  AND m.MovIdMovimiento NOT IN (SELECT MovDestino FROM @Cruces)
ORDER BY m.MovImporte DESC;
