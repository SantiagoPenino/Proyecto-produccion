/* =====================================================================
   Agregar PRO a AREAS_CADENA_REPOSICION (14-sep-2026)
   ---------------------------------------------------------------------
   Motivo: una falla propia reportada en Producción (la prenda ya armada
   se rompió/perdió) ahora arma la cadena completa hacia atrás
   (Sublimación->Corte->Costura->Bordado), igual que Bordado/Corte/Costura
   — porque en Producción tampoco hay prenda de repuesto en stock. El
   código ya lo hace por defecto (ver libroEntregasService.js,
   areasFallaPropiaRequiereCadena), pero ese mecanismo también respeta el
   interruptor maestro AREAS_CADENA_REPOSICION — si PRO no está ahí, cae
   al comportamiento viejo (una orden nueva en la misma área PRO).

   Local: ya aplicado a mano en la sesión de prueba. Este script es para
   correr en PRODUCCIÓN. Es aditivo e idempotente — solo agrega 'PRO' si
   no está ya en la lista.
   ===================================================================== */
SET NOCOUNT ON;

DECLARE @Actual NVARCHAR(200) = (
    SELECT Valor FROM ConfiguracionGlobal WHERE Clave = 'AREAS_CADENA_REPOSICION' AND AreaID = 'ADMIN'
);

IF @Actual IS NULL
    PRINT 'No existe la fila AREAS_CADENA_REPOSICION/ADMIN — revisar antes de correr esto (no se esperaba vacío).';
ELSE IF ',' + @Actual + ',' LIKE '%,PRO,%'
    PRINT 'PRO ya está en AREAS_CADENA_REPOSICION — nada que hacer.';
ELSE
BEGIN
    UPDATE ConfiguracionGlobal
    SET Valor = @Actual + ',PRO'
    WHERE Clave = 'AREAS_CADENA_REPOSICION' AND AreaID = 'ADMIN';
    PRINT 'PRO agregado a AREAS_CADENA_REPOSICION.';
END

-- Verificación
SELECT * FROM ConfiguracionGlobal WHERE Clave = 'AREAS_CADENA_REPOSICION';
