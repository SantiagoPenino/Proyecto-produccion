-- ============================================================================
-- diag_deuda_viva_vs_saldo_afavor.sql   (SOLO LECTURA — no cambia nada)
-- ----------------------------------------------------------------------------
-- Detecta el descuadre "deuda y saldo a favor conviviendo": el libro mayor de
-- la cuenta ya está neteado (el anticipo y el cargo suman), pero la
-- DeudaDocumento sigue viva por el TOTAL de la factura porque el saldo a favor
-- nunca se le imputó.
--
--   Síntoma en el Panel 360: "PENDIENTE US$ 3.006,46" y "A favor US$ 2.957,36"
--   al mismo tiempo, con el saldo corriente del estado de cuenta en -49,10.
--
-- CAUSA (código, corregida el 01-09-2026 en crearDeudaDocumento): el auto-consumo
-- del saldo a favor medía el saldo de la cuenta CON el cargo del propio documento
-- ya asentado. Con 2.957 a favor y una factura de 3.006 el saldo daba -49 → no se
-- disparaba y la deuda nacía entera. Pasa sobre todo al editar un documento de
-- Contado a Crédito (cfeController.editarFactura).
--
-- Correr en PRODUCCIÓN. Guardar el output antes de aplicar el fix de datos.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) BARRIDO GLOBAL: cuentas de dinero donde hay deuda viva Y saldo a favor.
--    SaldoReal = fórmula estándar del sistema (todo menos ORDEN/ORDEN_ANTICIPO).
--    Descuadre  = plata a favor que debería estar aplicada a las deudas y no lo está.
-- ────────────────────────────────────────────────────────────────────────────
;WITH Cta AS (
    SELECT cc.CueIdCuenta,
           cc.CliIdCliente,
           cc.CueTipo,
           cc.CueNombre,
           cc.MonIdMoneda,
           SaldoReal = ISNULL((SELECT SUM(m.MovImporte)
                               FROM dbo.MovimientosCuenta m
                               WHERE m.CueIdCuenta = cc.CueIdCuenta
                                 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0),
           DeudaViva = ISNULL((SELECT SUM(dd.DDeImportePendiente)
                               FROM dbo.DeudaDocumento dd
                               WHERE dd.CueIdCuenta = cc.CueIdCuenta
                                 AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CueTipo LIKE 'DINERO%'
      AND cc.CueActiva = 1
)
SELECT TOP 100
       c.CueIdCuenta,
       c.CliIdCliente,
       RTRIM(cl.Nombre)                                   AS Cliente,
       CASE WHEN c.MonIdMoneda = 2 THEN 'US$' ELSE '$' END AS Moneda,
       ISNULL(c.CueNombre, 'PRINCIPAL')                   AS Cuenta,
       c.SaldoReal,                -- plata a favor según el libro mayor
       c.DeudaViva,                -- lo que las DeudaDocumento dicen que debe
       -- Lo que habría que imputarle a las deudas para que las dos verdades cierren:
       AplicableAhora = CASE WHEN c.SaldoReal < c.DeudaViva THEN c.SaldoReal ELSE c.DeudaViva END
FROM Cta c
JOIN dbo.Clientes cl ON cl.CliIdCliente = c.CliIdCliente
-- La firma del bug es PLATA A FAVOR (SaldoReal > 0) conviviendo con deuda viva:
-- el cliente tiene el dinero en la cuenta y la deuda sigue entera al lado.
-- (Cuentas con SaldoReal = 0 y deuda viva son OTRA cosa — deudas sin movimiento
--  en el libro — y por eso quedan fuera de este barrido.)
WHERE c.DeudaViva > 0.01
  AND c.SaldoReal > 0.01
ORDER BY CASE WHEN c.SaldoReal < c.DeudaViva THEN c.SaldoReal ELSE c.DeudaViva END DESC;

-- ────────────────────────────────────────────────────────────────────────────
-- 2) DETALLE DE UN CLIENTE (poner el CliIdCliente que salga arriba).
--    Cuentas, saldo guardado vs saldo real, y deudas vivas documento por documento.
-- ────────────────────────────────────────────────────────────────────────────
DECLARE @Cli INT = 0;   -- ← CliIdCliente a mirar (0 = saltear este bloque)

IF @Cli > 0
BEGIN
    SELECT cc.CueIdCuenta,
           ISNULL(cc.CueNombre,'PRINCIPAL')                    AS Cuenta,
           cc.CueEsPrincipal,
           CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END AS Moneda,
           cc.CueSaldoActual                                    AS SaldoGuardado_NoConfiable,
           SaldoReal = ISNULL((SELECT SUM(m.MovImporte)
                               FROM dbo.MovimientosCuenta m
                               WHERE m.CueIdCuenta = cc.CueIdCuenta
                                 AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                                 AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0)
    FROM dbo.CuentasCliente cc
    WHERE cc.CliIdCliente = @Cli
    ORDER BY cc.CueEsPrincipal DESC, cc.CueIdCuenta;

    SELECT dd.DDeIdDocumento,
           dd.CueIdCuenta,
           RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero) AS Documento,
           RTRIM(d.DocTipo)                             AS DocTipo,
           d.DocTotal,
           d.DocPagado,
           dd.DDeImporteOriginal,
           dd.DDeImportePendiente,
           dd.DDeEstado,
           dd.DDeFechaEmision,
           Imputado = ISNULL((SELECT SUM(ip.ImpImporte)
                              FROM dbo.ImputacionPago ip
                              WHERE ip.DDeIdDocumento = dd.DDeIdDocumento), 0)
    FROM dbo.DeudaDocumento dd
    LEFT JOIN dbo.DocumentosContables d ON d.DocIdDocumento = dd.DocIdDocumento
    WHERE dd.CueIdCuenta IN (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli)
      AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
    ORDER BY dd.DDeIdDocumento DESC;

    SELECT TOP 40
           m.MovIdMovimiento, m.CueIdCuenta, m.MovTipo, m.MovImporte, m.MovFecha,
           m.DocIdDocumento, m.MovAnulado, LEFT(m.MovConcepto, 80) AS Concepto
    FROM dbo.MovimientosCuenta m
    WHERE m.CueIdCuenta IN (SELECT CueIdCuenta FROM dbo.CuentasCliente WHERE CliIdCliente = @Cli)
      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
    ORDER BY m.MovIdMovimiento DESC;
END
