/* ============================================================================
   DIAGNÓSTICO (SOLO LECTURA) — NC mal emitidas a convertir en venta
   ----------------------------------------------------------------------------
   NO modifica NADA. No hay UPDATE, no hay transacción. Corré todo tranquilo.
   Solo te muestra:
     1) Cada NC aceptada por DGI en ESTA base, con su CAE y el tipo de venta
        que le corresponde (111 e-Factura / 101 e-Ticket), y de dónde se dedujo.
     2) Los movimientos contables (NOTA_CREDITO) que quedarían para revisar.

   Cuando esta lista te cierre, recién ahí corrés el script de conversión:
   convertir_nc_malemitidas_a_venta_LOCAL.sql
   ============================================================================ */

SET NOCOUNT ON;

/* ---- 1) NC aceptadas + tipo derivado por CAE ------------------------------ */
;WITH Acept AS (
    SELECT d.DocIdDocumento, d.DocSerie, d.DocNumero, d.DocTipo, d.DocTotal,
           d.MonIdMoneda, d.CliIdCliente, d.CfeNumeroOficial,
           CASE WHEN CHARINDEX('CAE', d.CfeNumeroOficial) > 0
                THEN LTRIM(SUBSTRING(d.CfeNumeroOficial, CHARINDEX('CAE', d.CfeNumeroOficial) + 3, 20))
                ELSE '' END AS CaeRaw
    FROM dbo.DocumentosContables d
    WHERE d.CfeEstado = 'ACEPTADO_DGI' AND d.CfeNumeroOficial IS NOT NULL
),
AceptCae AS (
    SELECT *, LEFT(LTRIM(CaeRaw), PATINDEX('%[^0-9]%', LTRIM(CaeRaw) + ' ') - 1) AS Cae
    FROM Acept
),
Ventas AS (   -- CAE -> tipo, tomado de los documentos de VENTA (no-NC)
    SELECT Cae, MAX(CASE WHEN DocTipo LIKE '%actura%' THEN 111 ELSE 101 END) AS TipoVenta
    FROM AceptCae WHERE DocSerie <> 'NC' AND Cae <> '' GROUP BY Cae
)
SELECT
    ac.DocIdDocumento,
    ac.DocSerie + '-' + ac.DocNumero            AS NC_local,
    ac.DocTotal,
    CASE ac.MonIdMoneda WHEN 2 THEN 'USD' ELSE 'UYU' END AS Moneda,
    c.Nombre                                     AS Cliente,
    c.CioRuc                                     AS ClienteDoc,
    ac.CfeNumeroOficial                          AS CAE_en_DGI,
    CASE
      WHEN v.TipoVenta IS NOT NULL THEN v.TipoVenta
      WHEN ac.CfeNumeroOficial LIKE '%Serie A%' THEN 111
      ELSE 101
    END                                          AS TipoDerivado,
    CASE
      WHEN v.TipoVenta IS NOT NULL THEN 'seguro (venta con el mismo CAE)'
      ELSE 'estimado por serie — CONFIRMAR en DGI'
    END                                          AS ComoSeDedujo,
    CASE
      WHEN (CASE WHEN v.TipoVenta IS NOT NULL THEN v.TipoVenta
                 WHEN ac.CfeNumeroOficial LIKE '%Serie A%' THEN 111 ELSE 101 END) = 111
      THEN 'E-Factura Contado' ELSE 'E-Ticket Contado'
    END                                          AS QuedariaComo
FROM AceptCae ac
LEFT JOIN Ventas v ON v.Cae = ac.Cae
LEFT JOIN dbo.Clientes c ON c.CliIdCliente = ac.CliIdCliente
WHERE ac.DocSerie = 'NC'
ORDER BY ac.DocIdDocumento;

/* ---- 2) Movimientos contables que quedarían para revisar con el contador --- */
SELECT
    mv.DocIdDocumento,
    d.DocSerie + '-' + d.DocNumero AS NC_local,
    mv.MovTipo, mv.MovImporte, mv.CueIdCuenta, mv.MovConcepto, mv.MovFecha
FROM dbo.MovimientosCuenta mv
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = mv.DocIdDocumento
WHERE d.DocSerie = 'NC' AND d.CfeEstado = 'ACEPTADO_DGI'
  AND mv.MovTipo = 'NOTA_CREDITO' AND ISNULL(mv.MovAnulado,0) = 0
ORDER BY mv.DocIdDocumento;
