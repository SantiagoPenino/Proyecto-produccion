-- ============================================================================
-- FIX PROD: OrdenTerminaciones apuntando a la MADRE -> la bandeja no lista la XEUV
--
-- La bandeja de Terminaciones exige EXISTS(OrdenTerminaciones OT WHERE
-- OT.OrdenID = hermana). El intake NUEVO re-apunta esas filas a la hermana al
-- crearla, pero las ordenes nacidas con el codigo viejo quedaron con las filas
-- apuntando a la EUV madre: la hermana no aparece en la bandeja aunque este en
-- 'Material Recibido' (el modal si las ve porque tambien busca por archivo).
--
-- QUE HACE: re-apunta a la hermana TERMINAC las filas de OrdenTerminaciones
-- cuyos archivos son de una EUV madre con hermana viva. Idempotente y general
-- (arregla las 7 de hoy y cualquier otra vieja). El ArchivoID no se toca:
-- siempre queda apuntando al archivo de la madre, que es lo correcto.
-- ============================================================================

-- ---------- 1) DIAGNOSTICO (solo lectura) ----------
-- Hermanas TERMINAC sin ninguna fila propia en OrdenTerminaciones
SELECT H.OrdenID, H.CodigoOrden, H.EstadoenArea,
       (SELECT COUNT(*) FROM OrdenTerminaciones OT WHERE OT.OrdenID = H.OrdenID) AS TermsPropias
FROM Ordenes H
WHERE H.AreaID = 'TERMINAC'
  AND H.Estado NOT IN ('Cancelado','CANCELADO')
  AND NOT EXISTS (SELECT 1 FROM OrdenTerminaciones OT WHERE OT.OrdenID = H.OrdenID);

-- ---------- 2) CORRECCION ----------
BEGIN TRAN;

UPDATE OT
SET OT.OrdenID = H.OrdenID
FROM OrdenTerminaciones OT
JOIN ArchivosOrden A ON A.ArchivoID = OT.ArchivoID
JOIN Ordenes M ON M.OrdenID = A.OrdenID AND M.AreaID = 'ECOUV'   -- duena del archivo (madre)
JOIN Ordenes H ON H.AreaID = 'TERMINAC'
              AND H.Estado NOT IN ('Cancelado','CANCELADO')
              -- mismo vinculo que usa el sistema: la nota de la hermana
              -- (corchetes escapados: [] es clase de caracteres en LIKE)
              AND H.Nota LIKE '%![TERMINACIONES DE ' + LTRIM(RTRIM(M.CodigoOrden)) + '!]%' ESCAPE '!'
WHERE OT.OrdenID <> H.OrdenID;

SELECT @@ROWCOUNT AS FilasReapuntadas;

COMMIT;

-- ---------- 3) VERIFICACION ----------
-- Debe devolver 0 filas (toda hermana viva con al menos una terminacion propia)
SELECT H.CodigoOrden
FROM Ordenes H
WHERE H.AreaID = 'TERMINAC'
  AND H.Estado NOT IN ('Cancelado','CANCELADO')
  AND NOT EXISTS (SELECT 1 FROM OrdenTerminaciones OT WHERE OT.OrdenID = H.OrdenID);

-- Y el estado de las 7 recuperadas de extraviados (deben estar Material Recibido;
-- si alguna sigue Pendiente, re-corre fix_prod_xeuv_extraviadas_material_recibido.sql)
SELECT CodigoOrden, Estado, EstadoenArea FROM Ordenes
WHERE CodigoOrden IN ('XEUV-11794','XEUV-11846','XEUV-11896','XEUV-11982',
                      'XEUV-11986','XEUV-12265','XEUV-12267');
