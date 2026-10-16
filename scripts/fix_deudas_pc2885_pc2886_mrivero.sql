-- ============================================================================
-- fix_deudas_pc2885_pc2886_mrivero.sql
-- ----------------------------------------------------------------------------
-- PC-2885 (83,77 US$) y PC-2886 (412,97 US$) de Mrivero-745 (cliente 101) no
-- aparecen en "pendiente para cobrar": sus DeudaDocumento nacieron con
-- DDeEstado='PAGADO' y DDeImportePendiente=0 sin que exista ningún pago.
--
-- CAUSA: el cierre de ciclo calculaba el pendiente leyendo CueSaldoActual,
-- que está corrompido por el doble conteo de ORDEN (cuenta 310: +5.392,93
-- guardado vs -1.245,62 real). Al dar positivo, asumió "cubierto por saldo a
-- favor" y creó la deuda ya paga. Fix de código: contabilidadService.js
-- (cierre) ahora recalcula el saldo con la fórmula estándar sin ORDEN.
--
-- Este script repara la DATA: revive las dos deudas y corrige el encabezado
-- de los documentos, que quedó apuntando a la cuenta 119 (Valeria San Martin,
-- cliente 417) por el hardcode 118/119, en vez de la cuenta USD de Mrivero.
--
-- Todo keyed por serie+número+cliente (no por IDs locales).
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1) VERIFICACIÓN PREVIA: estado actual y cantidad de pagos asociados.
--    Esperado: DDeEstado='PAGADO', DDeImportePendiente=0, PagosAsociados=0,
--    CueDoc=119 (o distinta de la cuenta USD del cliente), CueDeuda=cuenta real.
-- ────────────────────────────────────────────────────────────────────────────
SELECT d.DocIdDocumento,
       RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero) AS Documento,
       d.DocTotal,
       d.CueIdCuenta                                AS CueDoc,
       dd.DDeIdDocumento,
       dd.CueIdCuenta                               AS CueDeuda,
       dd.DDeEstado,
       dd.DDeImporteOriginal,
       dd.DDeImportePendiente,
       (SELECT COUNT(*)
        FROM dbo.MovimientosCuenta m
        WHERE m.DocIdDocumento = d.DocIdDocumento
          AND m.MovTipo IN ('PAGO','COBRO','PAGO_CRUZADO','ANTICIPO')
          AND (m.MovAnulado IS NULL OR m.MovAnulado = 0))  AS PagosAsociados
FROM dbo.DocumentosContables d
JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = d.DocIdDocumento
WHERE d.CliIdCliente = 101
  AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('2885','2886');

-- ────────────────────────────────────────────────────────────────────────────
-- 2) REVIVIR LAS DEUDAS. Solo toca deudas PAGADO/pendiente 0 de esos dos
--    documentos y SOLO si el documento no tiene ningún pago real asociado
--    (si alguien las cobró entre medio, no hace nada).
-- ────────────────────────────────────────────────────────────────────────────
UPDATE dd
SET dd.DDeEstado           = 'PENDIENTE',
    dd.DDeImportePendiente = dd.DDeImporteOriginal
FROM dbo.DeudaDocumento dd
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = dd.DocIdDocumento
WHERE d.CliIdCliente = 101
  AND RTRIM(d.DocSerie)  = 'PC'
  AND RTRIM(d.DocNumero) IN ('2885','2886')
  AND dd.DDeEstado = 'PAGADO'
  AND dd.DDeImportePendiente = 0
  AND NOT EXISTS (SELECT 1
                  FROM dbo.MovimientosCuenta m
                  WHERE m.DocIdDocumento = d.DocIdDocumento
                    AND m.MovTipo IN ('PAGO','COBRO','PAGO_CRUZADO','ANTICIPO')
                    AND (m.MovAnulado IS NULL OR m.MovAnulado = 0));
-- Esperado: 2 filas afectadas

-- ────────────────────────────────────────────────────────────────────────────
-- 3) ENCABEZADO: apuntar los documentos a la cuenta USD real de Mrivero
--    (hoy dicen 119 = cuenta de otro cliente).
-- ────────────────────────────────────────────────────────────────────────────
UPDATE d
SET d.CueIdCuenta = cc.CueIdCuenta
FROM dbo.DocumentosContables d
CROSS APPLY (SELECT TOP 1 CueIdCuenta
             FROM dbo.CuentasCliente
             WHERE CliIdCliente = d.CliIdCliente
               AND CueTipo = 'DINERO_USD'
               AND CueActiva = 1) cc
WHERE d.CliIdCliente = 101
  AND RTRIM(d.DocSerie)  = 'PC'
  AND RTRIM(d.DocNumero) IN ('2885','2886')
  AND d.CueIdCuenta <> cc.CueIdCuenta;
-- Esperado: 2 filas afectadas

-- ────────────────────────────────────────────────────────────────────────────
-- 4) VERIFICACIÓN POSTERIOR: mismas columnas que (1).
--    Esperado: DDeEstado='PENDIENTE', pendiente=original, CueDoc=cuenta USD real.
-- ────────────────────────────────────────────────────────────────────────────
SELECT d.DocIdDocumento,
       RTRIM(d.DocSerie) + '-' + RTRIM(d.DocNumero) AS Documento,
       d.DocTotal,
       d.CueIdCuenta                                AS CueDoc,
       dd.DDeIdDocumento,
       dd.CueIdCuenta                               AS CueDeuda,
       dd.DDeEstado,
       dd.DDeImporteOriginal,
       dd.DDeImportePendiente
FROM dbo.DocumentosContables d
JOIN dbo.DeudaDocumento dd ON dd.DocIdDocumento = d.DocIdDocumento
WHERE d.CliIdCliente = 101
  AND RTRIM(d.DocSerie) = 'PC'
  AND RTRIM(d.DocNumero) IN ('2885','2886');
