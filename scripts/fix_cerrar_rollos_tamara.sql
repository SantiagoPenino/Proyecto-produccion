/* ============================================================================
   CERRAR ROLLOS — Támara flores / TF SPORT (CliIdCliente 5216).

   Decisión de negocio (16-sep-2026), no un bug: Támara (Semanal) tiene dos
   planes activos, ambos justo en el límite (100% usado, 0 disponible):
   Plan #145 (Dry Microporoso lado poroso, cuenta 1035) y Plan #147
   (NeoStretch, cuenta 1036). Por la regla "el plan nunca se cierra" para
   Rollo/Semanal, si sigue consumiendo, van a empezar a irse en negativo
   solos, sin que nadie lo note hasta que sea grande.

   Se pidió cerrarlos AHORA, antes de que arranque el negativo, para que
   sus pedidos nuevos empiecen a facturarse en plata normal en vez de
   seguir descontando metros.

   OJO (corregido 16-sep-2026 tras ver el PASO 1 en prod): Támara tiene
   un TERCER plan activo, el #150 (cuenta 2862), con 230,77 metros
   disponibles DE VERDAD — sano, no está en el límite. Ese NO se toca.
   Por eso este script ya no cierra "todo lo que esté activo" — apunta
   puntual a los PlaIdPlan de las cuentas 1035 y 1036 (Dry Microporoso
   lado poroso y NeoStretch), que son los dos materiales ya agotados.

   Qué hace: desactiva el/los plan(es) activo(s) de las cuentas 1035 y
   1036 (PlaActivo = 0). NO toca el plan #150 ni PlaCantidadUsada/Total
   ni CueSaldoActual — no hay negativo que limpiar, están exactos en 0.

   Por qué alcanza con esto: sin plan activo, el motor de precios deja de
   tratarla como cliente con cobertura — sus pedidos nuevos caen en la
   rama normal de "sin plan = cobra el precio completo".

   OJO: si en algún momento se le vuelve a cargar un rollo/recarga, el
   flujo normal de venta va a REACTIVAR un plan nuevo — eso es esperado.

   Verificar en el PASO 1 que son justo estos 2 planes (pueden haber
   cambiado desde el 16-sep) antes de aplicar.

   Correr en PRODUCCIÓN, en SSMS. Revisar el PASO 1 y el PASO 3.
   ============================================================================ */

SET NOCOUNT ON;

-- ── PASO 1 · ANTES (confirmar que son los planes correctos) ────────────────
SELECT 'ANTES' AS Paso,
       p.PlaIdPlan, p.CueIdCuenta, p.PlaActivo, p.PlaCantidadTotal, p.PlaCantidadUsada,
       p.PlaCantidadTotal - p.PlaCantidadUsada AS Restante,
       cc.CueSaldoActual
FROM PlanesMetros p
JOIN CuentasCliente cc ON cc.CueIdCuenta = p.CueIdCuenta
JOIN Clientes c ON c.CliIdCliente = p.CliIdCliente
WHERE RTRIM(c.IDCliente) = 'TF SPORT' AND p.PlaActivo = 1
  AND p.CueIdCuenta IN (1035, 1036);   -- Dry Microporoso lado poroso y NeoStretch, NO el #150 (cuenta 2862)

-- ── PASO 2 · APLICAR ────────────────────────────────────────────────────────
BEGIN TRANSACTION;

UPDATE p
SET p.PlaActivo = 0,
    p.PlaObservaciones = LEFT(ISNULL(p.PlaObservaciones + ' | ', '')
        + 'Cerrado a pedido 16-sep-2026: se decide que a partir de ahora '
        + 'facture en plata en vez de consumir en negativo.', 500)
FROM PlanesMetros p
JOIN Clientes c ON c.CliIdCliente = p.CliIdCliente
WHERE RTRIM(c.IDCliente) = 'TF SPORT' AND p.PlaActivo = 1
  AND p.CueIdCuenta IN (1035, 1036);   -- Dry Microporoso lado poroso y NeoStretch, NO el #150 (cuenta 2862)

/* Revisar el PASO 3. Si algo no cuadra: ROLLBACK TRANSACTION; */
COMMIT TRANSACTION;

-- ── PASO 3 · DESPUÉS ─────────────────────────────────────────────────────────
SELECT 'DESPUES' AS Paso,
       p.PlaIdPlan, p.CueIdCuenta, p.PlaActivo, p.PlaCantidadTotal, p.PlaCantidadUsada,
       p.PlaCantidadTotal - p.PlaCantidadUsada AS Restante, p.PlaObservaciones
FROM PlanesMetros p
JOIN Clientes c ON c.CliIdCliente = p.CliIdCliente
WHERE RTRIM(c.IDCliente) = 'TF SPORT'
ORDER BY p.PlaIdPlan DESC;
