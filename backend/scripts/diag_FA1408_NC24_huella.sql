/* =====================================================================
   SOLO LECTURA — PROD (SecureAppDB)
   Huella completa de la FA-1408 (doc 11613) y de la NC-24 (doc 11624):
   qué creó cada una en cuenta corriente, deuda, caja y contabilidad.
   Sirve para saber qué tiene que revertir la NC.
   ===================================================================== */

/* 1) Cabezales, con las claves que enganchan el resto */
SELECT DocIdDocumento, DocSerie, DocNumero, DocTipo, DocEstado, CfeEstado,
       DocTotal, MonIdMoneda, DocPagado, CueIdCuenta, CliIdCliente,
       AsiIdAsiento, TcaIdTransaccion, CicIdCiclo, DocIdDocumentoRef
FROM dbo.DocumentosContables
WHERE DocIdDocumento IN (11613, 11624);

/* 2) Movimientos de cuenta corriente de cada documento */
SELECT DocIdDocumento, MovIdMovimiento, CueIdCuenta, MovTipo, MovImporte,
       MovSaldoPosterior, MovAnulado, MovFecha, MovConcepto
FROM dbo.MovimientosCuenta
WHERE DocIdDocumento IN (11613, 11624)
ORDER BY DocIdDocumento, MovIdMovimiento;

/* 3) Deuda */
SELECT * FROM dbo.DeudaDocumento WHERE DocIdDocumento IN (11613, 11624);

/* 4) Caja: transacción y su detalle (recursos, rollos, etc.) */
SELECT t.* FROM dbo.TransaccionesCaja t
WHERE t.TcaIdTransaccion IN (
    SELECT TcaIdTransaccion FROM dbo.DocumentosContables
    WHERE DocIdDocumento IN (11613, 11624) AND TcaIdTransaccion IS NOT NULL);

SELECT td.* FROM dbo.TransaccionDetalle td
WHERE td.TcaIdTransaccion IN (
    SELECT TcaIdTransaccion FROM dbo.DocumentosContables
    WHERE DocIdDocumento IN (11613, 11624) AND TcaIdTransaccion IS NOT NULL);

/* 5) Contabilidad: asiento de la factura (por AsiIdAsiento) */
SELECT 'FACTURA' AS Origen, ac.AsiId, ac.AsiFecha, ac.AsiEstado, ac.SysOrigen, ac.AsiConcepto,
       ad.CueId, pc.CueCodigo, pc.CueNombre, ad.DetDebeUYU, ad.DetHaberUYU, ad.DetEntidadId, ad.DetEntidadTipo
FROM dbo.Cont_AsientosCabecera ac
JOIN dbo.Cont_AsientosDetalle  ad ON ad.AsiId = ac.AsiId
LEFT JOIN dbo.Cont_PlanCuentas pc ON pc.CueId = ad.CueId
WHERE ac.AsiId IN (SELECT AsiIdAsiento FROM dbo.DocumentosContables
                   WHERE DocIdDocumento = 11613 AND AsiIdAsiento IS NOT NULL)
ORDER BY ac.AsiId, ad.DetId;

/* 6) Contabilidad: asiento de la NC (no se estampa en el doc, se busca por concepto) */
SELECT 'NC' AS Origen, ac.AsiId, ac.AsiFecha, ac.AsiEstado, ac.SysOrigen, ac.AsiConcepto,
       ad.CueId, pc.CueCodigo, pc.CueNombre, ad.DetDebeUYU, ad.DetHaberUYU, ad.DetEntidadId, ad.DetEntidadTipo
FROM dbo.Cont_AsientosCabecera ac
JOIN dbo.Cont_AsientosDetalle  ad ON ad.AsiId = ac.AsiId
LEFT JOIN dbo.Cont_PlanCuentas pc ON pc.CueId = ad.CueId
WHERE ac.SysOrigen = 'NOTA_CREDITO' AND ac.AsiConcepto LIKE '%NC-24%'
ORDER BY ac.AsiId, ad.DetId;

/* 7) Líneas de los dos documentos, para ver que la NC copia la factura */
SELECT DocIdDocumento, DcdNomItem, DcdCantidad, DcdPrecioUnitario,
       DcdSubtotal, DcdImpuestos, DcdTotal, OrdCodigoOrden
FROM dbo.DocumentosContablesDetalle
WHERE DocIdDocumento IN (11613, 11624)
ORDER BY DocIdDocumento;
