/* =====================================================================================
   DocCliCiudad con el ID del departamento ("10") en vez del nombre ("Montevideo").
   Caso e-Factura A 29314 (Montevideo Uniformes, 08-oct-2026): el PDF decía "CIUDAD: 10"
   y a DGI viajó "ciudad: 10".

   Origen: la pantalla de cierre de ciclo (CierreCicloPreviewModal) tiene un select de
   departamentos cuyo valor es el ID de dbo.Departamentos, y cerrarCicloCompleto lo guardaba
   tal cual en DocumentosContables.DocCliCiudad. El código ya guarda el nombre (falta deploy)
   y sisnetService lo traduce al enviar, pero los documentos ya creados siguen con el número.

   Qué hace: DocCliCiudad = dbo.Departamentos.Nombre en los documentos cuyo DocCliCiudad
   es SOLO dígitos y corresponde a un ID de Departamentos. Nada más (ni Clientes ni líneas).
     - Los PENDIENTES de envío: igual quedan bien con el deploy; esto los deja prolijos.
     - Los ya ACEPTADO_DGI: en DGI quedan con "10" (eso no se puede cambiar); acá se corrige
       solo la copia nuestra, para que el PDF reimpreso diga el nombre.
   Idempotente: una segunda corrida no encuentra nada.

   @Aplicar = 0 → muestra qué haría y hace ROLLBACK.   @Aplicar = 1 → COMMIT.
   ===================================================================================== */
USE [SecureAppDB];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Aplicar BIT = 0;

IF OBJECT_ID('tempdb..#Cand') IS NOT NULL DROP TABLE #Cand;

SELECT d.DocIdDocumento, d.DocTipo, d.DocSerie, d.DocNumero, d.CfeEstado, d.DocFechaEmision,
       LTRIM(RTRIM(d.DocCliCiudad)) AS CiudadAntes, dep.Nombre AS CiudadDespues
INTO #Cand
FROM dbo.DocumentosContables d
JOIN dbo.Departamentos dep ON CAST(dep.ID AS NVARCHAR(20)) = LTRIM(RTRIM(d.DocCliCiudad))
WHERE d.DocCliCiudad IS NOT NULL
  AND LTRIM(RTRIM(d.DocCliCiudad)) <> ''
  AND LTRIM(RTRIM(d.DocCliCiudad)) NOT LIKE '%[^0-9]%';

-- Resumen por departamento y estado CFE
SELECT 'RESUMEN' AS Bloque, CiudadAntes, CiudadDespues, ISNULL(CfeEstado, '(sin estado)') AS CfeEstado, COUNT(*) AS Documentos
FROM #Cand
GROUP BY CiudadAntes, CiudadDespues, CfeEstado
ORDER BY COUNT(*) DESC;

-- Números que NO son un departamento: no se tocan (para revisar a mano si aparece alguno)
SELECT 'NO_SE_TOCAN' AS Bloque, LTRIM(RTRIM(d.DocCliCiudad)) AS Valor, COUNT(*) AS Documentos
FROM dbo.DocumentosContables d
WHERE d.DocCliCiudad IS NOT NULL
  AND LTRIM(RTRIM(d.DocCliCiudad)) <> ''
  AND LTRIM(RTRIM(d.DocCliCiudad)) NOT LIKE '%[^0-9]%'
  AND NOT EXISTS (SELECT 1 FROM #Cand c WHERE c.DocIdDocumento = d.DocIdDocumento)
GROUP BY LTRIM(RTRIM(d.DocCliCiudad));

BEGIN TRY
    BEGIN TRAN;

    UPDATE d SET d.DocCliCiudad = c.CiudadDespues
    FROM dbo.DocumentosContables d
    JOIN #Cand c ON c.DocIdDocumento = d.DocIdDocumento;
    DECLARE @Filas INT = @@ROWCOUNT;

    SELECT 'DESPUES' AS Bloque, @Filas AS DocumentosActualizados,
           (SELECT COUNT(*) FROM dbo.DocumentosContables
             WHERE LTRIM(RTRIM(DocCliCiudad)) <> '' AND LTRIM(RTRIM(DocCliCiudad)) NOT LIKE '%[^0-9]%') AS QuedanConNumero;

    IF @Aplicar = 1
    BEGIN
        COMMIT;
        PRINT CONCAT('APLICADO: ', @Filas, ' documentos.');
    END
    ELSE
    BEGIN
        ROLLBACK;
        PRINT CONCAT('PRUEBA (ROLLBACK): se actualizarían ', @Filas, ' documentos. Poné @Aplicar = 1 para aplicar.');
    END
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK;
    THROW;
END CATCH;
