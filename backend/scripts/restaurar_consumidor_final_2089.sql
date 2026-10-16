/* ============================================================================
   restaurar_consumidor_final_2089.sql
   ----------------------------------------------------------------------------
   QUÉ HACE
   Devuelve la ficha 2089 a lo que era: el "CONSUMIDOR FINAL" genérico del
   sistema. Alguien la sobrescribió con los datos de RFA SAS (un cliente real,
   RUC 160360060013), y el 2089 está clavado en el código como la bolsa genérica
   sin cuenta corriente (CONSUMIDOR_FINAL_ID = 2089 en cfeController.js,
   contabilidadController.js, cajaController.js y FacturacionManualModal.jsx).

   RESTAURA SOLO 5 CAMPOS (los únicos que difieren del original):
       Nombre            'RFA SAS'        ->  'CONSUMIDOR FINAL'
       NombreFantasia    'RFA SAS'        ->  'Consumidor final'
       IDCliente         'RFA SAS'        ->  'Consumidor final'
       CioRuc            '160360060013'   ->  '' (vacío)
       DireccionTrabajo  'Artigas 1851'   ->  '' (vacío)

   NO TOCA: CodCliente (366501), CodReferencia (3665), TelefonoTrabajo
   (98284114), Email, IDReact (3116), ESTADO, WebActive, Newsletter ni ninguna
   otra columna: se verificó que ya coinciden con el original.

   QUÉ **NO** RESUELVE ESTE SCRIPT
   La E-Factura a Crédito 4860 (21-jul-2026, $33.540, "26 Equipos Basquet
   CÍRCULO SPORTIVO", CAE 90262053670 Serie A 27503) se emitió a RFA SAS
   colgada de esta ficha y NO generó DeudaDocumento ni MovimientosCuenta,
   porque el genérico no tiene cuenta corriente. Esa deuda sigue sin existir
   después de correr esto. Hay que crear la ficha propia de RFA SAS y dar de
   alta la deuda por separado.

   El documento 4860 en sí NO se ve afectado: guarda su propio snapshot del
   receptor (DocCliNombre='RFA SAS', DocCliDocumento='160360060013'), así que
   el comprobante emitido ante DGI queda igual.

   CÓMO CORRERLO
   Ejecutar entero. Es transaccional e idempotente: si ya se corrió, no hace
   nada y avisa. Deja un respaldo de la fila en dbo.Backup_Cliente2089_20260729.
   ============================================================================ */

/* La base del sistema es SecureAppDB. En el mismo servidor hay bases viejas
   (importa, SecureAppDB2205, SecureAppDB_Vieja): si SSMS quedó apuntando a
   cualquiera de esas, el script falla entero con "Invalid object name". */
USE SecureAppDB;
GO

SET NOCOUNT ON;
SET XACT_ABORT ON;

/* ── 0) Respaldo de la fila actual (una sola vez) ────────────────────────── */
IF OBJECT_ID('dbo.Backup_Cliente2089_20260729', 'U') IS NULL
BEGIN
    SELECT * INTO dbo.Backup_Cliente2089_20260729
    FROM dbo.Clientes WHERE CliIdCliente = 2089;
    PRINT '[0] Respaldo creado en dbo.Backup_Cliente2089_20260729.';
END
ELSE
    PRINT '[0] El respaldo dbo.Backup_Cliente2089_20260729 ya existe: no se pisa.';

/* ── 1) Estado ANTES ─────────────────────────────────────────────────────── */
PRINT '';
PRINT '--- ANTES ---';
SELECT CliIdCliente,
       LTRIM(RTRIM(Nombre))           AS Nombre,
       LTRIM(RTRIM(NombreFantasia))   AS NombreFantasia,
       LTRIM(RTRIM(IDCliente))        AS IDCliente,
       LTRIM(RTRIM(ISNULL(CioRuc,''))) AS CioRuc,
       LTRIM(RTRIM(ISNULL(DireccionTrabajo,''))) AS DireccionTrabajo
FROM dbo.Clientes WHERE CliIdCliente = 2089;

/* ── 2) Restauración ─────────────────────────────────────────────────────── */
BEGIN TRY
    BEGIN TRANSACTION;

    UPDATE dbo.Clientes
       SET Nombre           = 'CONSUMIDOR FINAL',
           NombreFantasia   = 'Consumidor final',
           IDCliente        = 'Consumidor final',
           CioRuc           = '',
           DireccionTrabajo = ''
     WHERE CliIdCliente = 2089
       -- Candado: solo actúa si la ficha todavía tiene los datos de RFA SAS.
       -- Si ya fue restaurada (o alguien la cambió a otra cosa), no hace nada.
       AND LTRIM(RTRIM(ISNULL(CioRuc,''))) = '160360060013';

    IF @@ROWCOUNT = 0
        PRINT '[2] Sin cambios: la ficha 2089 ya no tiene el RUC de RFA SAS (¿ya se restauró?).';
    ELSE
        PRINT '[2] Ficha 2089 restaurada a CONSUMIDOR FINAL.';

    COMMIT TRANSACTION;
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION;
    PRINT '[X] ERROR: ' + ERROR_MESSAGE() + '  -> no se aplicó ningún cambio.';
    THROW;
END CATCH

/* ── 3) Estado DESPUÉS ───────────────────────────────────────────────────── */
PRINT '';
PRINT '--- DESPUES ---';
SELECT CliIdCliente,
       LTRIM(RTRIM(Nombre))           AS Nombre,
       LTRIM(RTRIM(NombreFantasia))   AS NombreFantasia,
       LTRIM(RTRIM(IDCliente))        AS IDCliente,
       LTRIM(RTRIM(ISNULL(CioRuc,''))) AS CioRuc,
       LTRIM(RTRIM(ISNULL(DireccionTrabajo,''))) AS DireccionTrabajo,
       CodCliente, CodReferencia, LTRIM(RTRIM(TelefonoTrabajo)) AS Telefono, IDReact
FROM dbo.Clientes WHERE CliIdCliente = 2089;

/* ── 4) Recordatorio: la deuda de RFA SAS sigue pendiente ────────────────── */
PRINT '';
PRINT '--- PENDIENTE: factura a credito sin deuda registrada ---';
SELECT d.DocIdDocumento, LTRIM(RTRIM(d.DocTipo)) AS Tipo, d.DocFechaEmision,
       d.DocTotal, d.DocPagado,
       LTRIM(RTRIM(ISNULL(d.DocCliNombre,'')))    AS ReceptorDelCFE,
       LTRIM(RTRIM(ISNULL(d.DocCliDocumento,''))) AS RutDelCFE,
       (SELECT COUNT(*) FROM dbo.DeudaDocumento dd
         WHERE dd.DocIdDocumento = d.DocIdDocumento) AS DeudasRegistradas
FROM dbo.DocumentosContables d
WHERE d.DocIdDocumento = 4860;

/* Para deshacer (si hiciera falta):
   UPDATE c SET c.Nombre = b.Nombre, c.NombreFantasia = b.NombreFantasia,
                c.IDCliente = b.IDCliente, c.CioRuc = b.CioRuc,
                c.DireccionTrabajo = b.DireccionTrabajo
     FROM dbo.Clientes c JOIN dbo.Backup_Cliente2089_20260729 b
       ON b.CliIdCliente = c.CliIdCliente
    WHERE c.CliIdCliente = 2089;
*/
