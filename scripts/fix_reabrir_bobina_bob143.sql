-- =============================================================================
-- FIX PRODUCCIÓN: reabrir bobina BOB-143 (PRE-123, "modal peletizado", Lady2025)
-- Base: SecureAppDB
--
-- QUÉ PASÓ:
--   09/08 el Consumo Orden 14128 (bailarinaAGOSTO, -13.44m) dejó el saldo en
--   0.38m; como 0.38 <= 0.5m el sistema la marcó 'Agotado' (regla del consumo:
--   un remanente de medio metro se considera inutilizable). Correcto entonces.
--   12/08 un Ajuste Manual (+14.42m, "Producción") devolvió metros → saldo
--   14.80m, pero adjustBobina NO recalculaba el Estado → quedó 'Agotado'
--   con 14.80m disponibles. (El fix de código ya hace que el ajuste manual
--   reabra/agote según el saldo, igual que la devolución por cancelación.)
--
-- QUÉ HACE ESTE SCRIPT:
--   Pone la bobina BOB-143 en 'Disponible' (solo si sigue 'Agotado' con saldo
--   usable > 0.5m). No toca metros ni movimientos: el ledger ya está bien
--   (20 - 6.18 - 13.44 + 14.42 = 14.80).
-- =============================================================================

-- 1) ANTES — esperado: Estado='Agotado', MetrosRestantes=14.80, FechaAgotado NULL
SELECT BobinaID, CodigoEtiqueta, Referencia, DescripcionTela, Estado,
       MetrosIniciales, MetrosRestantes, FechaAgotado, ClienteID, NombreCliente
FROM InventarioBobinas
WHERE CodigoEtiqueta = 'BOB-143';

-- 2) FIX — reabrir SOLO si sigue Agotada con saldo usable
UPDATE InventarioBobinas
SET Estado = 'Disponible',
    FechaAgotado = NULL
WHERE CodigoEtiqueta = 'BOB-143'
  AND Estado = 'Agotado'
  AND MetrosRestantes > 0.5;
-- Esperado: 1 fila afectada

-- 3) DESPUÉS — esperado: Estado='Disponible', MetrosRestantes=14.80, FechaAgotado NULL
SELECT BobinaID, CodigoEtiqueta, Estado, MetrosRestantes, FechaAgotado
FROM InventarioBobinas
WHERE CodigoEtiqueta = 'BOB-143';

-- =============================================================================
-- 4) DIAGNÓSTICO (solo lectura, NO corrige): otras telas de cliente 'Agotado'
--    con saldo usable. OJO: FechaAgotado con valor = cierre manual con
--    "Finalizar" (merma final intencional, closeBobina) — esas suelen ser
--    legítimas. Las sospechosas del MISMO bug son las que ADEMÁS tienen un
--    AJUSTE_MANUAL positivo posterior (columna UltimoAjustePositivo).
-- =============================================================================
SELECT ib.BobinaID, ib.CodigoEtiqueta, ib.Referencia, ib.DescripcionTela,
       ib.Estado, ib.MetrosRestantes, ib.FechaAgotado,
       ISNULL(NULLIF(LTRIM(RTRIM(ib.NombreCliente)), ''), c.Nombre) AS Cliente,
       (SELECT MAX(m.FechaMovimiento)
        FROM MovimientosInsumos m
        WHERE m.BobinaID = ib.BobinaID
          AND m.TipoMovimiento = 'AJUSTE_MANUAL'
          AND m.Cantidad > 0) AS UltimoAjustePositivo
FROM InventarioBobinas ib
LEFT JOIN Clientes c ON c.CliIdCliente = TRY_CAST(ib.ClienteID AS INT)
WHERE ib.ClienteID IS NOT NULL
  AND ib.Estado IN ('Agotado', 'Cerrado')
  AND ib.MetrosRestantes > 0.5
ORDER BY ib.MetrosRestantes DESC;
