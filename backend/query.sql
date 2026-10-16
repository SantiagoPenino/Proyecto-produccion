SELECT dc.DocIdDocumento, dc.DocNumero, dc.DocSerie, dc.DocTotal, dcd.DcdIdDetalle, dcd.DcdNomItem, dcd.DcdTotal, dcd.DcdSubtotal, dcd.DcdImpuestos, dcd.OrdCodigoOrden 
FROM dbo.DocumentosContables dc 
JOIN dbo.DocumentosContablesDetalle dcd ON dc.DocIdDocumento = dcd.DocIdDocumento 
WHERE dc.DocSerie = 'ET' AND dc.DocNumero = '4';
