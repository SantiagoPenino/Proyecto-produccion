-- ============================================================================
-- LIMPIEZA DE CAJA: sacar del listado los retiros que nunca se van a cobrar ahí
-- Fecha: 2026-07-24
--
-- QUÉ HACE: estampa PagIdPago = 0 (centinela "cubierto sin efectivo", el mismo
-- que usa el crearRetiro deployado) en OrdenesRetiro. La caja lista solo
-- PagIdPago IS NULL, así que estos retiros DEJAN DE APARECER en la caja.
-- NO toca estados, NO toca OrdenesDeposito, NO toca contabilidad ni deudas.
-- Las órdenes siguen apareciendo si se las busca (mostrador/buscar).
--
-- BLOQUE 1 → retiros de clientes SEMANAL (tipo 2) y ROLLO POR ADELANTADO (tipo 3)
--            SOLO los YA ENTREGADOS (estado 5): se cubrieron por ciclo semanal /
--            plan de metros y la mercadería ya salió. (~2.392 retiros según
--            réplica local del 24-07)
-- BLOQUE 2 → retiros de comunes/otros YA ENTREGADOS (estado 5): la mercadería
--            ya salió hace meses; nadie va a pasar por caja a pagarlos.
--            (~290 retiros)
-- QUEDAN EN CAJA: todos los retiros NO entregados (Ingresado / Empaquetado sin
--            abonar / En viaje), comunes y semanales/rollos vivos (~26).
--
-- Correr cada bloque por separado. Cada uno guarda respaldo antes de tocar nada.
-- ============================================================================

------------------------------------------------------------------------------
-- PASO 0: VERIFICACIÓN PREVIA — cuántos retiros muestra hoy la caja
------------------------------------------------------------------------------
SELECT COUNT(DISTINCT r.OReIdOrdenRetiro) AS RetirosEnCajaHoy
FROM OrdenesRetiro r
WHERE r.OReEstadoActual NOT IN (6)
  AND r.PagIdPago IS NULL
  AND EXISTS (SELECT 1 FROM OrdenesDeposito od
              WHERE od.OReIdOrdenRetiro = r.OReIdOrdenRetiro AND od.PagIdPago IS NULL);

------------------------------------------------------------------------------
-- BLOQUE 1: SEMANALES Y ROLLOS POR ADELANTADO
------------------------------------------------------------------------------
BEGIN TRAN;

-- 1a. Respaldo de los afectados (tabla nueva con fecha)
SELECT r.OReIdOrdenRetiro, r.PagIdPago AS PagIdPago_Anterior, r.OReEstadoActual,
       'BLOQUE1_SEMANAL_ROLLO' AS Motivo, GETDATE() AS FechaLimpieza
INTO   dbo.OrdenesRetiro_backup_limpieza_caja_20260724
FROM   OrdenesRetiro r
WHERE  r.OReEstadoActual = 5          -- SOLO los YA ENTREGADOS
  AND  r.PagIdPago IS NULL
  AND  EXISTS (SELECT 1 FROM OrdenesDeposito od
               WHERE od.OReIdOrdenRetiro = r.OReIdOrdenRetiro AND od.PagIdPago IS NULL)
  AND  EXISTS (   -- cliente Semanal (2) o Rollo (3), mismo COALESCE que usa la caja
        SELECT 1
        FROM OrdenesDeposito o
        LEFT JOIN Clientes c        ON c.CliIdCliente = o.CliIdCliente
        LEFT JOIN TiposClientes tc  ON tc.TClIdTipoCliente = c.TClIdTipoCliente
        LEFT JOIN Clientes cr       ON cr.CodCliente = r.CodCliente
        LEFT JOIN TiposClientes tcr ON tcr.TClIdTipoCliente = cr.TClIdTipoCliente
        WHERE o.OReIdOrdenRetiro = r.OReIdOrdenRetiro
          AND COALESCE(tc.TClIdTipoCliente, tcr.TClIdTipoCliente) IN (2, 3)
       );

-- 1b. Cuántos respaldó (debe rondar 2.392)
SELECT COUNT(*) AS RespaldadosBloque1 FROM dbo.OrdenesRetiro_backup_limpieza_caja_20260724;

-- 1c. Estampar el centinela "cubierto sin efectivo"
UPDATE r
SET    r.PagIdPago = 0
FROM   OrdenesRetiro r
JOIN   dbo.OrdenesRetiro_backup_limpieza_caja_20260724 b
       ON b.OReIdOrdenRetiro = r.OReIdOrdenRetiro
WHERE  b.Motivo = 'BLOQUE1_SEMANAL_ROLLO'
  AND  r.PagIdPago IS NULL
  AND  r.OReEstadoActual = 5;   -- re-verifica: SOLO entregados

-- 1d. Verificar: filas actualizadas = respaldadas → COMMIT; si no cierra → ROLLBACK
SELECT @@ROWCOUNT AS ActualizadosBloque1;

COMMIT TRAN;
-- ROLLBACK TRAN;   -- (usar en lugar del COMMIT si algo no cierra)

------------------------------------------------------------------------------
-- BLOQUE 2: COMUNES / OTROS YA ENTREGADOS (estado 5)
-- Correr DESPUÉS del bloque 1. Solo si querés sacar también los entregados viejos.
------------------------------------------------------------------------------
BEGIN TRAN;

-- 2a. Respaldo (misma tabla, otro motivo)
INSERT INTO dbo.OrdenesRetiro_backup_limpieza_caja_20260724
    (OReIdOrdenRetiro, PagIdPago_Anterior, OReEstadoActual, Motivo, FechaLimpieza)
SELECT r.OReIdOrdenRetiro, r.PagIdPago, r.OReEstadoActual,
       'BLOQUE2_ENTREGADOS', GETDATE()
FROM   OrdenesRetiro r
WHERE  r.OReEstadoActual = 5          -- ya ENTREGADO
  AND  r.PagIdPago IS NULL
  AND  EXISTS (SELECT 1 FROM OrdenesDeposito od
               WHERE od.OReIdOrdenRetiro = r.OReIdOrdenRetiro AND od.PagIdPago IS NULL)
  AND  NOT EXISTS (SELECT 1 FROM dbo.OrdenesRetiro_backup_limpieza_caja_20260724 b
                   WHERE b.OReIdOrdenRetiro = r.OReIdOrdenRetiro);  -- no repetir los del bloque 1

-- 2b. Cuántos respaldó (debe rondar 290)
SELECT COUNT(*) AS RespaldadosBloque2
FROM dbo.OrdenesRetiro_backup_limpieza_caja_20260724 WHERE Motivo = 'BLOQUE2_ENTREGADOS';

-- 2c. Estampar el centinela
UPDATE r
SET    r.PagIdPago = 0
FROM   OrdenesRetiro r
JOIN   dbo.OrdenesRetiro_backup_limpieza_caja_20260724 b
       ON b.OReIdOrdenRetiro = r.OReIdOrdenRetiro
WHERE  b.Motivo = 'BLOQUE2_ENTREGADOS'
  AND  r.PagIdPago IS NULL
  AND  r.OReEstadoActual = 5;   -- re-verifica: SOLO entregados

SELECT @@ROWCOUNT AS ActualizadosBloque2;

COMMIT TRAN;
-- ROLLBACK TRAN;

------------------------------------------------------------------------------
-- PASO FINAL: VERIFICACIÓN — qué queda en la caja (deben ser los ~26 vivos)
------------------------------------------------------------------------------
SELECT r.FormaRetiro + '-' + CAST(r.OReIdOrdenRetiro AS VARCHAR) AS Retiro,
       er.EORNombreEstado AS Estado,
       CONVERT(varchar(10), r.OReFechaAlta, 23) AS FechaAlta
FROM   OrdenesRetiro r
LEFT JOIN EstadosOrdenesRetiro er ON er.EORIdEstadoOrden = r.OReEstadoActual
WHERE  r.OReEstadoActual NOT IN (6)
  AND  r.PagIdPago IS NULL
  AND  EXISTS (SELECT 1 FROM OrdenesDeposito od
               WHERE od.OReIdOrdenRetiro = r.OReIdOrdenRetiro AND od.PagIdPago IS NULL)
ORDER BY r.OReFechaAlta;

------------------------------------------------------------------------------
-- REVERSA (si hiciera falta deshacer TODO):
--   UPDATE r SET r.PagIdPago = NULL
--   FROM OrdenesRetiro r
--   JOIN dbo.OrdenesRetiro_backup_limpieza_caja_20260724 b
--        ON b.OReIdOrdenRetiro = r.OReIdOrdenRetiro
--   WHERE r.PagIdPago = 0;
-- (el respaldo guarda el valor anterior, que era NULL en todos)
------------------------------------------------------------------------------
