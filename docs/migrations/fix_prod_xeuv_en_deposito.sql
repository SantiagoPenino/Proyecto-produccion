-- ============================================================================
-- FIX PROD: hermanas XEUV metidas en OrdenesDeposito por el codigo viejo
-- Caso visto: XEUV-12044 con fila propia en deposito (estado Avisado) y
-- EUV-12044 con OrdCantidad 23.15 (magnitud contaminada: 3.15 m2 + 20 ojales).
--
-- CAUSA: el deploy pendiente trae las exclusiones (la hermana TERMINAC no debe
-- crear fila en OrdenesDeposito ni avisar; y la magnitud no debe sumar servicios
-- con los m2). Hasta que suba, cada check-in de un pedido ECOUV con terminaciones
-- vuelve a crear la fila fantasma -> este script es RE-EJECUTABLE.
--
-- ORDEN SUGERIDO: correr ANTES fix_magnitud_contaminada_servicios.sql (corrige
-- Ordenes.Magnitud); este script alinea OrdenesDeposito con esa magnitud.
--
-- NOTA: el aviso de WhatsApp duplicado que ya salio no se puede deshacer.
-- ============================================================================

-- ---------- 1) DIAGNOSTICO (solo lectura, correr primero) ----------
-- Hermanas XEUV en deposito ('XEUV-%' NO matchea los codigos viejos 'XECOUV-')
SELECT OrdIdOrden, OrdCodigoOrden, OrdCantidad, OrdCostoFinal, OrdEstadoActual,
       OReIdOrdenRetiro, OrdFechaIngresoOrden
FROM OrdenesDeposito
WHERE OrdCodigoOrden LIKE 'XEUV-%';

-- Madres ECOUV cuya cantidad en deposito no coincide con la magnitud de la orden
SELECT od.OrdIdOrden, od.OrdCodigoOrden, od.OrdCantidad,
       TRY_CAST(o.Magnitud AS FLOAT) AS MagnitudOrden, od.OReIdOrdenRetiro
FROM OrdenesDeposito od
JOIN Ordenes o ON LTRIM(RTRIM(o.CodigoOrden)) = LTRIM(RTRIM(od.OrdCodigoOrden))
WHERE o.AreaID = 'ECOUV'
  AND TRY_CAST(o.Magnitud AS FLOAT) IS NOT NULL
  AND ABS(od.OrdCantidad - TRY_CAST(o.Magnitud AS FLOAT)) > 0.01;

-- ---------- 2) BORRAR LAS FILAS FANTASMA DE LAS XEUV ----------
-- Solo las que NO estan enganchadas a un retiro (si alguna ya tiene retiro,
-- aparece en el diagnostico: avisame antes de tocarla).
BEGIN TRAN;

DELETE FROM OrdenesDeposito
WHERE OrdCodigoOrden LIKE 'XEUV-%'
  AND OReIdOrdenRetiro IS NULL;

SELECT @@ROWCOUNT AS FantasmasBorradas;

-- ---------- 3) CORREGIR LA CANTIDAD DE LAS MADRES ECOUV ----------
-- Alinea OrdCantidad con la magnitud REAL de la orden (correr despues del
-- script de magnitud contaminada). Solo filas sin retiro asignado.
UPDATE od
SET od.OrdCantidad = TRY_CAST(o.Magnitud AS FLOAT)
FROM OrdenesDeposito od
JOIN Ordenes o ON LTRIM(RTRIM(o.CodigoOrden)) = LTRIM(RTRIM(od.OrdCodigoOrden))
WHERE o.AreaID = 'ECOUV'
  AND od.OReIdOrdenRetiro IS NULL
  AND TRY_CAST(o.Magnitud AS FLOAT) IS NOT NULL
  AND ABS(od.OrdCantidad - TRY_CAST(o.Magnitud AS FLOAT)) > 0.01;

SELECT @@ROWCOUNT AS CantidadesCorregidas;

COMMIT;

-- ---------- 4) VERIFICACION ----------
SELECT OrdIdOrden, OrdCodigoOrden, OrdCantidad, OrdCostoFinal, OReIdOrdenRetiro
FROM OrdenesDeposito
WHERE OrdCodigoOrden LIKE 'XEUV-%' OR OrdCodigoOrden LIKE 'EUV-%'
ORDER BY OrdFechaIngresoOrden DESC;
