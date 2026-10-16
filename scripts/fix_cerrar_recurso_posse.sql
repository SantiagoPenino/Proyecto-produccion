/* ============================================================================
   CERRAR EL CONSUMO DE RECURSO — Posse Gutierrez Santiago (51814799).

   Decisión de negocio (09-sep-2026), no un bug: Posse (Semanal) tiene el
   plan #82 en negativo (~-52,26 metros) por la regla "el plan nunca se
   cierra" que rige para Rollo/Semanal. Se decidió que a este cliente
   puntual se le va a cobrar esa deuda por otra vía (fuera del sistema de
   metros), y que sus pedidos NUEVOS deben empezar a facturarse en plata
   normal en vez de seguir descontando metros en negativo.

   Qué hace: desactiva el plan #82 (PlaActivo = 0). NO toca
   PlaCantidadUsada/PlaCantidadTotal (el número negativo queda de
   registro histórico, es la prueba de la deuda) ni CueSaldoActual.

   Por qué alcanza con esto: sin plan activo, el motor de precios
   (erpSyncService, logisticsController, contabilidadService) deja de
   tratarlo como cliente con cobertura — sus pedidos nuevos caen en la
   rama normal de "sin plan = cobra el precio completo", sea Semanal o
   no. Es la misma regla que ya usa el sistema para cualquier cliente sin
   plan activo, no hace falta tocar nada más.

   OJO: si en algún momento se le vuelve a cargar un rollo/recarga a
   Posse, el flujo normal de venta (cajaService, crearPlan/recargarPlan)
   va a REACTIVAR un plan nuevo — eso es esperado. Si se quiere que
   directamente no se le pueda vender más rollo, esa es una decisión
   aparte, no la resuelve este script.

   Verificar el PlaIdPlan/CueIdCuenta correctos ANTES de aplicar (PASO 1)
   — están tomados de lo diagnosticado hoy, pueden haber cambiado.

   Correr en PRODUCCIÓN, en SSMS. Revisar el PASO 1 y el PASO 3.
   ============================================================================ */

SET NOCOUNT ON;

-- ── PASO 1 · ANTES (confirmar que es el plan correcto) ─────────────────────
SELECT 'ANTES' AS Paso,
       p.PlaIdPlan, p.CueIdCuenta, p.PlaActivo, p.PlaCantidadTotal, p.PlaCantidadUsada,
       p.PlaCantidadTotal - p.PlaCantidadUsada AS Restante,
       cc.CueSaldoActual
FROM PlanesMetros p
JOIN CuentasCliente cc ON cc.CueIdCuenta = p.CueIdCuenta
JOIN Clientes c ON c.CliIdCliente = p.CliIdCliente
WHERE RTRIM(c.IDCliente) = '51814799' AND p.PlaActivo = 1;

-- ── PASO 2 · APLICAR ────────────────────────────────────────────────────────
BEGIN TRANSACTION;

UPDATE p
SET p.PlaActivo = 0,
    p.PlaObservaciones = LEFT(ISNULL(p.PlaObservaciones + ' | ', '')
        + 'Cerrado a pedido 09-sep-2026: la deuda de metros (negativo) se '
        + 'cobra por otra vía — pedidos nuevos pasan a facturar en plata.', 500)
FROM PlanesMetros p
JOIN Clientes c ON c.CliIdCliente = p.CliIdCliente
WHERE RTRIM(c.IDCliente) = '51814799' AND p.PlaActivo = 1;

/* Revisar el PASO 3. Si algo no cuadra: ROLLBACK TRANSACTION; */
COMMIT TRANSACTION;

-- ── PASO 3 · DESPUÉS ─────────────────────────────────────────────────────────
SELECT 'DESPUES' AS Paso,
       p.PlaIdPlan, p.CueIdCuenta, p.PlaActivo, p.PlaCantidadTotal, p.PlaCantidadUsada,
       p.PlaCantidadTotal - p.PlaCantidadUsada AS Restante, p.PlaObservaciones
FROM PlanesMetros p
JOIN Clientes c ON c.CliIdCliente = p.CliIdCliente
WHERE RTRIM(c.IDCliente) = '51814799';
