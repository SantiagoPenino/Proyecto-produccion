/* ============================================================================
   fix_saldo_real_palmero.sql
   ----------------------------------------------------------------------------
   AJUSTE PRAGMÁTICO del saldo cacheado (CueSaldoActual) de Palmero (CliId 998)
   a lo que el negocio confirma que es la realidad: NO tiene saldo a favor,
   solo tiene las 2 deudas vivas de hoy. NO es un fix de la causa raíz.

   ESTADO CONFIRMADO HOY (20/7/2026), después de arreglar en esta misma sesión:
     - Deuda duplicada de PC-1982 (fantasma) → cancelada.
     - Pago de $19.583,46 que había caído mal en PC-1982 → reclasificado a PC-2220.
     - Cross-moneda de PC-1451 (pago US$ en cuenta USD que era de un doc en $) → corregido.
     - Reconciliación documento por documento (diag_reconciliacion_cliente.sql) →
       limpia, sin pagos huérfanos, sin duplicados vivos (solo una diferencia
       menor de $449,69 en PC-1982, sin relación con esto).
   A pesar de eso, el saldo cacheado sigue mostrando un "saldo a favor" grande
   que el cliente NO tiene. Es un síntoma de un bug MÁS GRANDE y ya conocido
   (ver el resumen para la próxima sesión, más abajo en el repo): doble conteo
   en CueSaldoActual + documentos anulados que no revierten su movimiento.
   Ese bug se arregla aparte — esto NO lo soluciona, solo pone HOY el número al
   día con la realidad, para que caja/cobranza no se confunda mientras tanto.

   VALORES DESTINO (= exactamente lo que debe, ni un peso más):
     - Cuenta USD (90):  -154.00   (deuda viva PC-2074, DDe #6225, VENCIDO)
     - Cuenta UYU (1115): -13896.15 (deuda viva PC-2220, DDe #6846, PARCIAL —
       el cheque de $6.600 todavía NO está aplicado; cuando se aplique, el
       pendiente de PC-2220 baja solo, vía el flujo normal de caja)

   Guarda: solo ajusta si las deudas vivas de Palmero siguen siendo EXACTAMENTE
   esas dos, por esos importes — si algo cambió (se cobró algo, apareció otra
   deuda), aborta sin tocar nada.
   ============================================================================ */

SET NOCOUNT ON;
GO

-- ── 1. PREVIEW ───────────────────────────────────────────────────────────
SELECT cc.CueIdCuenta, cc.CueTipo, cc.CueSaldoActual AS Guardado_ACTUAL
FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = 998 AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');

SELECT dd.DDeIdDocumento, cc.CueTipo, dd.DDeImportePendiente, dd.DDeEstado
FROM dbo.DeudaDocumento dd
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
WHERE cc.CliIdCliente = 998 AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND dd.DDeImportePendiente > 0.01;

-- Si la segunda consulta no muestra EXACTAMENTE 2 filas (USD 154.00 y UYU
-- 13896.15), algo cambió desde el diagnóstico — no seguir sin revisar por qué.
GO

-- ── 2. EL FIX — descomentar tras confirmar el preview ───────────────────
/*
BEGIN TRANSACTION;

DECLARE @OK BIT = 1;
IF (SELECT COUNT(*) FROM dbo.DeudaDocumento dd JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
    WHERE cc.CliIdCliente = 998 AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND dd.DDeImportePendiente > 0.01) <> 2
    SET @OK = 0;
IF NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento dd JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
    WHERE cc.CliIdCliente = 998 AND cc.CueTipo = 'DINERO_USD' AND dd.DDeImportePendiente = 154.00 AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO'))
    SET @OK = 0;
IF NOT EXISTS (SELECT 1 FROM dbo.DeudaDocumento dd JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
    WHERE cc.CliIdCliente = 998 AND cc.CueTipo = 'DINERO_UYU' AND dd.DDeImportePendiente = 13896.15 AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO'))
    SET @OK = 0;

IF @OK = 0
BEGIN
    PRINT '[ABORTA] Las deudas vivas de Palmero ya no son exactamente las esperadas. No se tocó nada.';
    ROLLBACK TRANSACTION;
END
ELSE
BEGIN
    UPDATE dbo.CuentasCliente SET CueSaldoActual = -154.00
    WHERE CliIdCliente = 998 AND CueTipo = 'DINERO_USD';

    UPDATE dbo.CuentasCliente SET CueSaldoActual = -13896.15
    WHERE CliIdCliente = 998 AND CueTipo = 'DINERO_UYU';

    PRINT '[OK] Saldo de Palmero ajustado: USD -154.00 / UYU -13896.15 (sin saldo a favor, sin el cheque aun sin aplicar).';

    SELECT cc.CueIdCuenta, cc.CueTipo, cc.CueSaldoActual AS Guardado_DESPUES
    FROM dbo.CuentasCliente cc WHERE cc.CliIdCliente = 998 AND cc.CueTipo IN ('DINERO_UYU','DINERO_USD');

    --   COMMIT TRANSACTION;   -- o   ROLLBACK TRANSACTION;
END
*/
GO
