/*
  Fix: bultos de VEN-2338, VEN-2341, VEN-2347, VEN-2348 (portal/tienda, area PRO)
  quedaron con UbicacionActual = 'PRO' en Logistica_Bultos a pesar de que la orden
  ya esta cargada en OrdenesDeposito (se pistoleo directo en "Carga de Codigos",
  sin pasar por el flujo de Control de Transporte / receiveDispatch que es el que
  normalmente actualiza la ubicacion del bulto a 'DEPOSITO').

  Mientras el bulto siga en 'PRO', el gate de bultos del job de WhatsApp
  (wspAvisos.job.js) bloquea el aviso a esas ordenes -> quedan "EN ESPERA" para
  siempre.

  Este script hace EXACTAMENTE lo mismo que hace receiveDispatch cuando se
  escanea un bulto en depósito:
    UPDATE Logistica_Bultos SET Estado='EN_STOCK', UbicacionActual='DEPOSITO'
  + un registro de auditoria en MovimientosLogistica.

  Alcance: SOLO los bultos PROD_TERMINADO de estos 4 codigos que hoy estan en 'PRO'.
  No toca ninguna otra orden ni bulto.

  Ejecutar contra produccion (SecureAppDB). Recomendado: correr primero el
  PASO 1 (preview) y confirmar que son exactamente los bultos esperados antes
  de correr el PASO 2 (update).
*/

DECLARE @Codigos TABLE (Codigo NVARCHAR(50));
INSERT INTO @Codigos (Codigo) VALUES ('VEN-2338'), ('VEN-2341'), ('VEN-2347'), ('VEN-2348');

-- ============================================================
-- PASO 1 (preview): confirmar qué bultos se van a tocar
-- ============================================================
SELECT
    B.BultoID,
    B.CodigoEtiqueta,
    O.CodigoOrden,
    O.NoDocERP,
    B.Tipocontenido,
    B.Estado AS EstadoActual,
    B.UbicacionActual AS UbicacionActualHoy
FROM dbo.Logistica_Bultos B WITH (NOLOCK)
JOIN dbo.Ordenes O WITH (NOLOCK) ON O.OrdenID = B.OrdenID
WHERE O.CodigoOrden IN (SELECT Codigo FROM @Codigos)
  AND B.Tipocontenido = 'PROD_TERMINADO'
  AND B.UbicacionActual <> 'DEPOSITO';

-- ============================================================
-- PASO 2 (fix): mover esos bultos a DEPOSITO + auditoría
--  Descomentar y ejecutar solo después de validar el PASO 1.
-- ============================================================
/*
BEGIN TRANSACTION;

UPDATE B
SET B.Estado = 'EN_STOCK',
    B.UbicacionActual = 'DEPOSITO'
FROM dbo.Logistica_Bultos B
JOIN dbo.Ordenes O ON O.OrdenID = B.OrdenID
WHERE O.CodigoOrden IN (SELECT Codigo FROM @Codigos)
  AND B.Tipocontenido = 'PROD_TERMINADO'
  AND B.UbicacionActual <> 'DEPOSITO';

INSERT INTO dbo.MovimientosLogistica (CodigoBulto, TipoMovimiento, AreaID, UsuarioID, Observaciones)
SELECT B.CodigoEtiqueta, 'RECEPCION', 'DEPOSITO', 1,
       'Ajuste manual: bulto pistoleado directo en Carga de Codigos, ubicacion desincronizada (ticket sin avisar 13/8/2026)'
FROM dbo.Logistica_Bultos B
JOIN dbo.Ordenes O ON O.OrdenID = B.OrdenID
WHERE O.CodigoOrden IN (SELECT Codigo FROM @Codigos)
  AND B.Tipocontenido = 'PROD_TERMINADO'
  AND B.UbicacionActual = 'DEPOSITO'
  AND B.Estado = 'EN_STOCK';

-- Revisar antes de COMMIT: debería mostrar las 4 órdenes con Ubicacion = 'DEPOSITO'
SELECT B.BultoID, O.CodigoOrden, B.Estado, B.UbicacionActual
FROM dbo.Logistica_Bultos B
JOIN dbo.Ordenes O ON O.OrdenID = B.OrdenID
WHERE O.CodigoOrden IN (SELECT Codigo FROM @Codigos)
  AND B.Tipocontenido = 'PROD_TERMINADO';

COMMIT TRANSACTION;
-- Si algo se ve mal antes del COMMIT, usar ROLLBACK TRANSACTION; en su lugar.
*/

-- ============================================================
-- PASO 3 (verificación opcional): el job corre cada 1 minuto
-- (ConfiguracionGlobal.IntervaloAviso = 1). Después del PASO 2,
-- esperar 1-2 minutos y volver a mirar "Carga de Códigos": las 4
-- órdenes deberían pasar de EN ESPERA a ENVIADO solas.
-- ============================================================
