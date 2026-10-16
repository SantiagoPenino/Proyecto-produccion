-- =====================================================================
-- FIX: "Recargo por Tinta" aplicaba a TODA orden de ECOUV (01/08/2026)
--
-- El perfil 3 estaba con EsGlobal = 1 y Categoria = 'ECOUV': el motor de
-- precios aplica los perfiles globales por área SIN mirar la tinta, así
-- que el recargo pegaba también a las órdenes Ecosolvente.
--
-- La lógica correcta ya existe en el código (erpSyncService): el perfil 3
-- se inyecta SOLO cuando la tinta de la orden contiene UV o LATEX.
-- Con EsGlobal = 0 el perfil queda únicamente por esa vía — igual que el
-- "Recargo por Urgencias" (perfil 2), que ya funciona así.
--
-- SOLO DATOS: no requiere deploy. Idempotente.
-- =====================================================================

-- Antes
SELECT ID, Nombre, Activo, EsGlobal, Categoria FROM PerfilesPrecios WHERE ID = 3;
GO

UPDATE PerfilesPrecios
SET EsGlobal = 0
WHERE ID = 3 AND EsGlobal = 1;
PRINT CONCAT('Perfil Recargo por Tinta pasado a no-global: ', @@ROWCOUNT);
GO

-- Después (EsGlobal debe quedar en 0)
SELECT ID, Nombre, Activo, EsGlobal, Categoria FROM PerfilesPrecios WHERE ID = 3;
GO

-- =====================================================================
-- DESPUÉS DE CORRER: las cotizaciones ya calculadas con el recargo de más
-- NO se corrigen solas. Para regenerarlas: abrir la orden → Cotizar
-- Productos → "Recargar Precios" (solo las que no estén facturadas).
-- Este diagnóstico lista las órdenes ECOUV Ecosolvente vivas cuya
-- cotización menciona el recargo:
-- =====================================================================
SELECT DISTINCT LTRIM(RTRIM(O.CodigoOrden)) AS Orden, PC.NoDocERP,
       O.Tinta, PCD.PerfilAplicado, PC.EstadoCobro
FROM PedidosCobranzaDetalle PCD
JOIN PedidosCobranza PC ON PC.ID = PCD.PedidoCobranzaID
JOIN Ordenes O ON O.OrdenID = PCD.OrdenID
WHERE O.AreaID = 'ECOUV'
  AND ISNULL(O.Tinta, '') NOT LIKE '%UV%' AND ISNULL(O.Tinta, '') NOT LIKE '%LATEX%'
  AND PCD.PerfilAplicado LIKE '%Tinta%'
  AND O.Estado NOT IN ('CANCELADO', 'Entregado')
ORDER BY PC.NoDocERP DESC;
GO
