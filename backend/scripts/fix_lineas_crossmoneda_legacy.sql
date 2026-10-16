/* ============================================================================
   FIX LÍNEAS CROSS-MONEDA (legacy pre-fix) — variante C
   ----------------------------------------------------------------------------
   QUÉ ARREGLA
     Documentos que consolidan órdenes de DINERO_UYU y DINERO_USD en una sola
     moneda. Antes del fix del resolver (aplicarCotizacion, commit d669f4e del
     2026-07-03) las líneas de las órdenes en la OTRA moneda quedaron con su
     precio nativo (ej: pesos) guardado como si fuera la moneda del documento
     (ej: US$), infladas ~40×. El HEADER (DocTotal) y el LEDGER quedaron BIEN.

   QUÉ HACE
     Detecta la moneda de CADA línea por su OrdCodigoOrden (OrdenesDeposito.
     MonIdMoneda, si no PedidosCobranza.Moneda) — la misma lógica que el resolver.
     A las líneas cuya moneda != moneda del documento les aplica un factor de
     conversión DERIVADO DEL PROPIO DOCUMENTO, de modo que la suma de líneas
     cierre EXACTO contra el DocTotal (la factura manda):

         Factor = (DocTotal - Σ líneas ya correctas) / Σ líneas de otra moneda

     Solo toca dbo.DocumentosContablesDetalle (las líneas). NO toca DocTotal,
     NI MovimientosCuenta, NI DeudaDocumento, NI el saldo del cliente.

   BLINDAJES (deja afuera y lista aparte lo dudoso)
     · Solo docs con DocFechaEmision < 2026-07-04 (pre/for-deploy del fix).
     · Excluye recibos (serie RC): su DocTotal es el efectivo cobrado, no la deuda.
     · Exige que TODAS las líneas del doc clasifiquen a USD o UYU (sin '?').
     · Exige que exista al menos una línea de OTRA moneda (X > 0) — cross-moneda real.
     · Exige que la cotización IMPLÍCITA caiga en [30, 55]. Si no, NO toca el doc
       y lo lista en "REVISIÓN MANUAL" (así no corrige sobre-conteos como ET-1518,
       que no son cross-moneda).

   Por defecto ROLLBACK. Revisá el control + la verificación y cambiá a COMMIT.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;
BEGIN TRANSACTION;

/* Opcional: para probar UN solo documento primero, poné p.ej. 'PC-1274'.
   Dejalo en NULL para procesar TODOS los elegibles.                        */
DECLARE @FiltroDoc VARCHAR(30) = NULL;   -- ej: 'PC-1274'

/* ---- 1) Clasificar cada línea de los docs candidatos con su moneda ---- */
IF OBJECT_ID('tempdb..#lineas') IS NOT NULL DROP TABLE #lineas;

SELECT
    d.DcdIdDetalle,
    d.DocIdDocumento,
    d.DcdPrecioUnitario, d.DcdSubtotal, d.DcdImpuestos, d.DcdTotal,
    dc.DocTotal,
    dc.MonIdMoneda AS DocMon,
    CASE
        WHEN odx.MonIdMoneda = 2 THEN 'USD'
        WHEN odx.MonIdMoneda = 1 THEN 'UYU'
        WHEN UPPER(LTRIM(RTRIM(pcx.Moneda))) IN ('USD','US$','U$S','DOLAR','DÓLAR') THEN 'USD'
        WHEN UPPER(LTRIM(RTRIM(pcx.Moneda))) IN ('UYU','$','$U','PESOS','PESO')      THEN 'UYU'
        ELSE '?'
    END AS MonedaLinea
INTO #lineas
FROM dbo.DocumentosContables dc
JOIN dbo.DocumentosContablesDetalle d ON d.DocIdDocumento = dc.DocIdDocumento
OUTER APPLY (
    SELECT TOP 1 od.MonIdMoneda
    FROM dbo.OrdenesDeposito od
    WHERE od.OrdCodigoOrden = d.OrdCodigoOrden
) odx
OUTER APPLY (
    SELECT TOP 1 pc.Moneda
    FROM dbo.PedidosCobranza pc
    WHERE CAST(pc.NoDocERP AS VARCHAR(100)) =
          LEFT(d.OrdCodigoOrden,
               CASE WHEN CHARINDEX(' ', d.OrdCodigoOrden) > 0
                    THEN CHARINDEX(' ', d.OrdCodigoOrden) - 1
                    ELSE LEN(ISNULL(d.OrdCodigoOrden, '')) END)
) pcx
WHERE dc.DocFechaEmision < '2026-07-04'
  AND (dc.DocEstado IS NULL OR dc.DocEstado NOT LIKE '%ANULAD%')
  AND RTRIM(dc.DocSerie) <> 'RC'
  AND (@FiltroDoc IS NULL OR RTRIM(dc.DocSerie) + '-' + RTRIM(dc.DocNumero) = @FiltroDoc);

/* ---- 2) Agregar por documento: correctas (U), de otra moneda (X), indefinidas ---- */
IF OBJECT_ID('tempdb..#docs') IS NOT NULL DROP TABLE #docs;

SELECT
    l.DocIdDocumento,
    MAX(l.DocTotal) AS DocTotal,
    MAX(l.DocMon)   AS DocMon,
    SUM(CASE WHEN l.MonedaLinea = CASE WHEN l.DocMon = 2 THEN 'USD' ELSE 'UYU' END
             THEN l.DcdTotal ELSE 0 END) AS U_correcto,
    SUM(CASE WHEN l.MonedaLinea IN ('USD','UYU')
              AND l.MonedaLinea <> CASE WHEN l.DocMon = 2 THEN 'USD' ELSE 'UYU' END
             THEN l.DcdTotal ELSE 0 END) AS X_mismon,
    SUM(CASE WHEN l.MonedaLinea NOT IN ('USD','UYU') THEN 1 ELSE 0 END) AS N_indef,
    SUM(l.DcdTotal) AS SumaAntes,
    COUNT(*)        AS NLineas
INTO #docs
FROM #lineas l
GROUP BY l.DocIdDocumento;

/* ---- 3) Calcular factor + cotización implícita y filtrar los ELEGIBLES ---- */
IF OBJECT_ID('tempdb..#fix') IS NOT NULL DROP TABLE #fix;

SELECT
    dd.*,
    CAST( (dd.DocTotal - dd.U_correcto) / NULLIF(dd.X_mismon, 0) AS DECIMAL(18,8)) AS Factor,
    CASE WHEN dd.DocMon = 2
         THEN CAST( dd.X_mismon / NULLIF(dd.DocTotal - dd.U_correcto, 0) AS DECIMAL(18,4))  -- doc USD: cot = X/(DocTotal-U)
         ELSE CAST( (dd.DocTotal - dd.U_correcto) / NULLIF(dd.X_mismon, 0) AS DECIMAL(18,4)) -- doc UYU: cot = (DocTotal-U)/X
    END AS ImpliedCot
INTO #fix
FROM #docs dd
WHERE dd.N_indef = 0                                 -- todas las líneas clasificadas
  AND dd.X_mismon > 0                                -- hay líneas de otra moneda (cross-moneda)
  AND ABS(dd.SumaAntes - dd.DocTotal) > 2.0          -- está desfasado
  AND (dd.DocTotal - dd.U_correcto) > 0.01;          -- remanente a distribuir es positivo

/* Guard FX: la cotización implícita debe ser plausible (entre 30 y 55) */
IF OBJECT_ID('tempdb..#manual') IS NOT NULL DROP TABLE #manual;
SELECT * INTO #manual FROM #fix WHERE ImpliedCot IS NULL OR ImpliedCot < 30 OR ImpliedCot > 55;
DELETE FROM #fix WHERE ImpliedCot IS NULL OR ImpliedCot < 30 OR ImpliedCot > 55;

/* ---- 4) CONTROL — documentos que se van a corregir (revisar antes del COMMIT) ---- */
SELECT
    RTRIM(cli.NombreFantasia) AS Cliente,
    RTRIM(doc.DocSerie) + '-' + RTRIM(doc.DocNumero) AS Comprobante,
    CASE WHEN f.DocMon = 2 THEN 'USD' ELSE 'UYU' END AS DocMoneda,
    f.NLineas,
    CAST(f.DocTotal    AS DECIMAL(18,2)) AS DocTotal,
    CAST(f.U_correcto  AS DECIMAL(18,2)) AS LineasCorrectas,
    CAST(f.X_mismon    AS DECIMAL(18,2)) AS LineasOtraMoneda_Antes,
    f.ImpliedCot,
    CAST(f.SumaAntes                              AS DECIMAL(18,2)) AS SumaLineas_Antes,
    CAST(f.U_correcto + f.X_mismon * f.Factor     AS DECIMAL(18,2)) AS SumaLineas_Despues  -- ≈ DocTotal
FROM #fix f
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = f.DocIdDocumento
LEFT JOIN dbo.Clientes cli ON cli.CliIdCliente = doc.CliIdCliente
ORDER BY Cliente, Comprobante;

DECLARE @nFix INT = (SELECT COUNT(*) FROM #fix);
DECLARE @nMan INT = (SELECT COUNT(*) FROM #manual);
PRINT CONCAT('Documentos a corregir: ', @nFix, ' | En revisión manual (cot fuera de [30,55]): ', @nMan);

/* ---- 4b) REVISIÓN MANUAL — detectados como desfasados pero NO son cross-moneda limpio ---- */
SELECT
    RTRIM(doc.DocSerie) + '-' + RTRIM(doc.DocNumero) AS Comprobante,
    CASE WHEN m.DocMon = 2 THEN 'USD' ELSE 'UYU' END AS DocMoneda,
    CAST(m.DocTotal   AS DECIMAL(18,2)) AS DocTotal,
    CAST(m.SumaAntes  AS DECIMAL(18,2)) AS SumaLineas,
    CAST(m.U_correcto AS DECIMAL(18,2)) AS LineasMismaMoneda,
    CAST(m.X_mismon   AS DECIMAL(18,2)) AS LineasOtraMoneda,
    m.ImpliedCot,
    'NO se toca — revisar a mano (no es conversión de moneda limpia)' AS Nota
FROM #manual m
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = m.DocIdDocumento
ORDER BY Comprobante;

/* ---- 5) CORREGIR — escalar solo las líneas de OTRA moneda por el factor del doc ---- */
UPDATE d
SET d.DcdPrecioUnitario = ROUND(d.DcdPrecioUnitario * f.Factor, 4),
    d.DcdSubtotal       = ROUND(d.DcdSubtotal       * f.Factor, 4),
    d.DcdImpuestos      = ROUND(d.DcdImpuestos      * f.Factor, 4),
    d.DcdTotal          = ROUND(d.DcdTotal          * f.Factor, 4)
FROM dbo.DocumentosContablesDetalle d
JOIN #lineas l ON l.DcdIdDetalle    = d.DcdIdDetalle
JOIN #fix    f ON f.DocIdDocumento  = d.DocIdDocumento
WHERE l.MonedaLinea IN ('USD','UYU')
  AND l.MonedaLinea <> CASE WHEN f.DocMon = 2 THEN 'USD' ELSE 'UYU' END;

/* ---- 6) VERIFICACIÓN — suma de líneas (después) vs DocTotal por doc corregido ---- */
SELECT
    RTRIM(doc.DocSerie) + '-' + RTRIM(doc.DocNumero) AS Comprobante,
    CAST(f.DocTotal AS DECIMAL(18,2)) AS DocTotal,
    CAST((SELECT SUM(x.DcdTotal) FROM dbo.DocumentosContablesDetalle x
          WHERE x.DocIdDocumento = f.DocIdDocumento) AS DECIMAL(18,2)) AS SumaLineas_Ahora,
    CAST(ABS(f.DocTotal - (SELECT SUM(x.DcdTotal) FROM dbo.DocumentosContablesDetalle x
          WHERE x.DocIdDocumento = f.DocIdDocumento)) AS DECIMAL(18,2)) AS Diferencia
FROM #fix f
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = f.DocIdDocumento
ORDER BY Diferencia DESC, Comprobante;

DROP TABLE #lineas; DROP TABLE #docs; DROP TABLE #fix; DROP TABLE #manual;

/* Revisá CONTROL + VERIFICACIÓN (Diferencia debe ser ~0). Si está OK, cambiá abajo a COMMIT. */
ROLLBACK TRANSACTION;   -- <<<< cambiar a COMMIT TRANSACTION; para aplicar
