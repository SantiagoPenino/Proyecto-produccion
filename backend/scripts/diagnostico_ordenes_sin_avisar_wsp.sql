/*
  Diagnóstico: órdenes en "Carga de Códigos" (Depósito) que quedaron
  RECHAZADO (teléfono inválido/vacío) o EN ESPERA (gate pedido completo / gate bultos)
  sin enviar el WhatsApp de aviso al cliente.

  Códigos vistos en pantalla (13/8/2026):
  RECHAZADO: SUB-4926-R1, DTF-8767, DTF-8769, DTF-13732, TPU-12366, DTF-14179
  EN ESPERA: VEN-2338, VEN-2341, EUV-13831, EUV-13759, VEN-2347, VEN-2348

  Solo SELECT, no modifica nada. Ejecutar contra producción (SecureAppDB).
*/

DECLARE @Codigos TABLE (Codigo NVARCHAR(50));
INSERT INTO @Codigos (Codigo) VALUES
('SUB-4926-R1'), ('DTF-8767'), ('DTF-8769'), ('DTF-13732'), ('TPU-12366'), ('DTF-14179'),
('VEN-2338'), ('VEN-2341'), ('EUV-13831'), ('EUV-13759'), ('VEN-2347'), ('VEN-2348');

-- ============================================================
-- 1) Estado base de cada fila en OrdenesDeposito + teléfono del cliente
--    (explica el RECHAZADO: TelefonoTrabajo NULL/vacío)
-- ============================================================
SELECT
    Ord.OrdIdOrden,
    Ord.OrdCodigoOrden,
    Ord.OrdEstadoActual,
    Ord.OrdAvisoWsp,
    Ord.OrdFechaAvisoWsp,
    Ord.BultosEsperados,
    Ord.BultosRecibidos,
    Cli.CliIdCliente,
    Cli.Nombre AS NombreCliente,
    Cli.TelefonoTrabajo AS TelefonoRaw,
    CASE
        WHEN Cli.TelefonoTrabajo IS NULL OR LTRIM(RTRIM(Cli.TelefonoTrabajo)) = '' THEN 'SIN TELEFONO'
        WHEN LEN(REPLACE(REPLACE(REPLACE(Cli.TelefonoTrabajo,' ',''),'-',''),'.','')) < 8 THEN 'TELEFONO CORTO/INVALIDO'
        ELSE 'OK (revisar formato exacto en normalizePhone)'
    END AS DiagnosticoTelefono
FROM OrdenesDeposito Ord WITH (NOLOCK)
LEFT JOIN Clientes Cli WITH (NOLOCK) ON Cli.CliIdCliente = Ord.CliIdCliente
WHERE Ord.OrdCodigoOrden IN (SELECT Codigo FROM @Codigos)
ORDER BY Ord.OrdIdOrden DESC;

-- ============================================================
-- 2) Pedido (NoDocERP) y estado de TODAS las órdenes hermanas
--    (explica el EN ESPERA por "gate pedido completo": si alguna
--     hermana de otra área todavía no llegó a depósito, no se avisa ninguna)
-- ============================================================
SELECT
    O.CodigoOrden,
    O.NoDocERP,
    O.OrdenID,
    O.Estado,
    O.EstadoenArea,
    O.AreaID
FROM dbo.Ordenes O WITH (NOLOCK)
WHERE O.NoDocERP IN (
    SELECT DISTINCT O2.NoDocERP
    FROM dbo.Ordenes O2 WITH (NOLOCK)
    WHERE O2.CodigoOrden IN (SELECT Codigo FROM @Codigos)
)
ORDER BY O.NoDocERP, O.CodigoOrden;

-- ============================================================
-- 3) Bultos físicos abiertos del pedido (explica el EN ESPERA por
--    "gate bultos": si hay bultos PROD_TERMINADO que no llegaron
--    a DEPOSITO todavía, no se avisa aunque la orden ya esté en depósito)
-- ============================================================
SELECT
    B.BultoID,
    B.OrdenID,
    O.CodigoOrden,
    O.NoDocERP,
    B.Tipocontenido,
    B.Estado AS EstadoBulto,
    B.UbicacionActual
FROM dbo.Logistica_Bultos B WITH (NOLOCK)
JOIN dbo.Ordenes O WITH (NOLOCK) ON O.OrdenID = B.OrdenID
WHERE O.NoDocERP IN (
    SELECT DISTINCT O2.NoDocERP
    FROM dbo.Ordenes O2 WITH (NOLOCK)
    WHERE O2.CodigoOrden IN (SELECT Codigo FROM @Codigos)
)
AND B.Tipocontenido = 'PROD_TERMINADO'
ORDER BY O.NoDocERP, B.BultoID;

-- ============================================================
-- 4) Config global del job de WhatsApp: ¿está activado? ¿cada cuántos minutos corre?
-- ============================================================
SELECT Clave, Valor
FROM ConfiguracionGlobal WITH (NOLOCK)
WHERE Clave IN ('ActivarAvisosWSP', 'IntervaloAviso');
