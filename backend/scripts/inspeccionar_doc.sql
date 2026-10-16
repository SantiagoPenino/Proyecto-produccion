/* ============================================================================
   INSPECCIONAR UN DOCUMENTO (SOLO LECTURA) — para categorizar un descuadre
   Poné el comprobante abajo y corré. Dice si es reposición, over-count, o parcial.
   ============================================================================ */
SET NOCOUNT ON;
DECLARE @Comprobante varchar(30) = 'ET-1860';   -- <<<< cambiá acá (ej: 'ET-1971')

DECLARE @DocId int, @DocTotal decimal(18,2), @Mon int, @Tca int;
SELECT @DocId = dc.DocIdDocumento, @DocTotal = dc.DocTotal, @Mon = dc.MonIdMoneda, @Tca = dc.TcaIdTransaccion
FROM dbo.DocumentosContables dc
WHERE RTRIM(dc.DocSerie) + '-' + RTRIM(dc.DocNumero) = @Comprobante;

PRINT @Comprobante + '  DocTotal=' + CAST(@DocTotal AS varchar(20))
    + '  Moneda=' + CASE WHEN @Mon=2 THEN 'USD' ELSE 'UYU' END
    + '  TcaId=' + ISNULL(CAST(@Tca AS varchar(20)),'NULL');

/* ── 1) Líneas actuales, con costo real de la orden y si es reposición ── */
SELECT
    RTRIM(ISNULL(d.OrdCodigoOrden,'(null)')) AS Orden,
    LEFT(RTRIM(d.DcdNomItem),30) AS Item,
    CAST(d.DcdTotal AS decimal(18,2)) AS TotalLinea,
    od.MonIdMoneda AS OrdMon,
    CAST(od.OrdCostoFinal AS decimal(18,2)) AS CostoRealOrden,
    CASE WHEN d.OrdCodigoOrden LIKE '%-R[0-9]%' THEN 'REPOSICION' ELSE '' END AS EsRepo,
    CASE WHEN ABS(d.DcdTotal - @DocTotal) < 0.5 THEN '<-- = DocTotal (sobre-conteo)' ELSE '' END AS Flag
FROM dbo.DocumentosContablesDetalle d
OUTER APPLY (SELECT TOP 1 o.MonIdMoneda, o.OrdCostoFinal FROM dbo.OrdenesDeposito o WHERE o.OrdCodigoOrden = d.OrdCodigoOrden) od
WHERE d.DocIdDocumento = @DocId
ORDER BY d.DcdIdDetalle;

/* ── 2) Órdenes de la transacción y su costo real (para ver si es multi-orden parcial) ── */
SELECT DISTINCT
    RTRIM(od.OrdCodigoOrden) AS Orden,
    CAST(od.OrdCostoFinal AS decimal(18,2)) AS CostoReal,
    od.OrdEstadoActual AS Estado
FROM dbo.TransaccionDetalle td
LEFT JOIN dbo.RelOrdenesRetiroOrdenes rel ON rel.OReIdOrdenRetiro = td.TdeReferenciaId AND td.TdeTipoReferencia = 'ORDEN_RETIRO'
LEFT JOIN dbo.OrdenesDeposito od ON (
      (td.TdeTipoReferencia='ORDEN_RETIRO'   AND rel.OrdIdOrden IS NOT NULL AND od.OrdIdOrden = rel.OrdIdOrden)
   OR (td.TdeTipoReferencia='ORDEN_RETIRO'   AND rel.OrdIdOrden IS NULL     AND od.OReIdOrdenRetiro = td.TdeReferenciaId)
   OR (td.TdeTipoReferencia='ORDEN_DEPOSITO' AND od.OrdIdOrden = td.TdeReferenciaId))
WHERE td.TcaIdTransaccion = @Tca AND od.OrdIdOrden IS NOT NULL;

/* Interpretación:
   · Hay línea 'REPOSICION' con Total = DocTotal  -> lo tapa el deploy de contabilidadCore.js.
   · Grilla 2: si SUM(CostoReal) = DocTotal pero las líneas suman más -> cobertura de plan (single).
   · Grilla 2: si SUM(CostoReal) <> DocTotal (se cobró un subconjunto) -> multi-orden parcial (XSB legacy). */
