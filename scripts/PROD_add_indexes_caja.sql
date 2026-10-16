-- ============================================================================
-- INDICES DE PERFORMANCE - CAJA (TransaccionesCaja)
-- 14-sep-2026. Idempotente: se puede correr mas de una vez sin efecto.
-- ----------------------------------------------------------------------------
-- TransaccionesCaja no tiene NINGUN indice fuera de su clave primaria, asi que
-- toda busqueda por cliente o por rango de fechas la recorre entera.
--
-- Donde duele hoy:
--
--   1) El candado anti doble cobro (cajaController, procesarPagoDeudaInterno)
--      corre en CADA cobro de deuda: busca si ese mismo cliente ya cobro el
--      mismo importe en los ultimos 90 segundos. Hoy eso es un recorrido
--      completo de la tabla en el camino critico de cada pago.
--
--   2) Los cobros de un cliente (cajaService, ORDER BY TcaFecha DESC), que es
--      lo que alimenta el Panel 360 y el Estado de Cuenta.
--
--   3) El arqueo del dia y el reporte Caja Central vs Administrativa, que
--      filtran por rango de TcaFecha.
--
-- Al momento de escribir esto la tabla ronda las 11.000 filas: cada CREATE
-- tarda menos de un segundo y no bloquea nada apreciable. Conviene igual
-- correrlo fuera del horario de mostrador.
--
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

SET NOCOUNT ON;

-- (1) Por cliente, ordenado por fecha descendente.
--     Cubre el candado anti doble cobro y el listado de cobros del cliente.
--     Las columnas incluidas hacen que las dos consultas salgan enteras del
--     indice, sin volver a la tabla.
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_TransaccionesCaja_Cliente_Fecha'
                 AND object_id = OBJECT_ID('dbo.TransaccionesCaja'))
    CREATE NONCLUSTERED INDEX IX_TransaccionesCaja_Cliente_Fecha
        ON dbo.TransaccionesCaja (TcaClienteId, TcaFecha DESC)
        INCLUDE (TcaEstado, TcaTotalCobrado, TcaMonedaBase,
                 TcaSerieDoc, TcaNumeroDoc, TcaTipoDocumento,
                 TcaTotalBruto, TcaTotalAjuste, TcaTotalNeto);

-- (2) Por fecha sola. Cubre el arqueo del dia, el cierre de caja y el reporte
--     Caja Central vs Administrativa, que barren por rango de fechas sin
--     cliente.
IF NOT EXISTS (SELECT 1 FROM sys.indexes
               WHERE name = 'IX_TransaccionesCaja_Fecha'
                 AND object_id = OBJECT_ID('dbo.TransaccionesCaja'))
    CREATE NONCLUSTERED INDEX IX_TransaccionesCaja_Fecha
        ON dbo.TransaccionesCaja (TcaFecha)
        INCLUDE (TcaClienteId, TcaEstado, EsCajaAdmin, StuIdSesion,
                 TcaTotalNeto, TcaTotalCobrado, TcaMonedaBase);

-- ── Verificacion ──────────────────────────────────────────────────────────
SELECT Tabla = OBJECT_NAME(i.object_id), Indice = i.name, i.type_desc,
       Columnas = STUFF((SELECT ', ' + c.name
                         FROM sys.index_columns ic
                         JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                         WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                           AND ic.is_included_column = 0
                         ORDER BY ic.key_ordinal
                         FOR XML PATH('')), 1, 2, '')
FROM sys.indexes i
WHERE i.object_id = OBJECT_ID('dbo.TransaccionesCaja') AND i.type > 0
ORDER BY i.index_id;
