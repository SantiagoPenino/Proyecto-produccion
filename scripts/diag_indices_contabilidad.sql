-- ============================================================================
-- diag_indices_contabilidad.sql        SOLO LECTURA - no crea nada
-- ----------------------------------------------------------------------------
-- Dice QUE INDICES HAY de verdad en la base donde lo corras, y cuales de los
-- que ya escribimos siguen faltando. Sirve para saber si las migraciones de
-- performance que quedaron pendientes llegaron o no a produccion.
--
-- Correlo en PRODUCCION. No toca nada.
--
-- ABRIR DESDE EL DISCO en SSMS (File -> Open). No copiar/pegar desde el chat.
-- ============================================================================

SET NOCOUNT ON;
SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;

SELECT Panel = '0 - DONDE ESTOY', BaseDeDatos = DB_NAME(), Servidor = @@SERVERNAME,
       Fecha = CONVERT(VARCHAR(19), GETDATE(), 120);

-- ── 1 · Todos los indices de las tablas calientes de contabilidad ────────
DECLARE @Tablas TABLE (Tabla SYSNAME PRIMARY KEY);
INSERT INTO @Tablas (Tabla) VALUES
    ('TransaccionesCaja'), ('TransaccionDetalle'), ('MovimientosCuenta'),
    ('DocumentosContables'), ('DeudaDocumento'), ('ImputacionPago'),
    ('Pagos'), ('CuentasCliente'), ('PedidosCobranzaDetalle'),
    ('Cont_AsientosCabecera'), ('Cont_AsientosDetalle');

SELECT Panel = '1 - INDICES QUE HAY',
       Tabla = t.Tabla,
       Filas = p.Filas,
       Indice = ISNULL(i.name, '(monton sin indice)'),
       Tipo = i.type_desc,
       Columnas = STUFF((SELECT ', ' + c.name
                         FROM sys.index_columns ic
                         JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                         WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                           AND ic.is_included_column = 0
                         ORDER BY ic.key_ordinal
                         FOR XML PATH('')), 1, 2, ''),
       Incluidas = ISNULL(STUFF((SELECT ', ' + c.name
                         FROM sys.index_columns ic
                         JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id
                         WHERE ic.object_id = i.object_id AND ic.index_id = i.index_id
                           AND ic.is_included_column = 1
                         ORDER BY ic.index_column_id
                         FOR XML PATH('')), 1, 2, ''), '')
FROM @Tablas t
CROSS APPLY (SELECT Filas = ISNULL((SELECT SUM(pa.rows) FROM sys.partitions pa
                                    WHERE pa.object_id = OBJECT_ID('dbo.' + t.Tabla)
                                      AND pa.index_id IN (0,1)), 0)) p
LEFT JOIN sys.indexes i ON i.object_id = OBJECT_ID('dbo.' + t.Tabla) AND i.type > 0
ORDER BY t.Tabla, i.index_id;

-- ── 2 · Cuantos indices tiene cada tabla (las de 1 solo tienen la PK) ────
SELECT Panel = '2 - RESUMEN', Tabla = t.Tabla,
       Filas = ISNULL((SELECT SUM(pa.rows) FROM sys.partitions pa
                       WHERE pa.object_id = OBJECT_ID('dbo.' + t.Tabla) AND pa.index_id IN (0,1)), 0),
       CantIndices = ISNULL((SELECT COUNT(*) FROM sys.indexes i
                             WHERE i.object_id = OBJECT_ID('dbo.' + t.Tabla) AND i.type > 0), 0),
       Lectura = CASE WHEN ISNULL((SELECT COUNT(*) FROM sys.indexes i
                                   WHERE i.object_id = OBJECT_ID('dbo.' + t.Tabla) AND i.type > 0), 0) <= 1
                      THEN 'SOLO LA CLAVE PRIMARIA - se recorre entera'
                      ELSE 'tiene indices' END
FROM @Tablas t
ORDER BY t.Tabla;

-- ── 3 · Los que ya escribimos: llegaron o no ─────────────────────────────
-- Si alguno dice FALTA, la migracion correspondiente nunca se corrio aca.
DECLARE @Esperados TABLE (Indice SYSNAME, Tabla SYSNAME, Migracion VARCHAR(80));
INSERT INTO @Esperados (Indice, Tabla, Migracion) VALUES
 ('IX_MovimientosCuenta_CueIdCuenta',           'MovimientosCuenta',       'add_indexes_contabilidad_perf.sql'),
 ('IX_MovimientosCuenta_CicIdCiclo',            'MovimientosCuenta',       'add_indexes_contabilidad_perf.sql'),
 ('IX_MovimientosCuenta_OrdIdOrden',            'MovimientosCuenta',       'add_indexes_contabilidad_perf.sql'),
 ('IX_PedidosCobranzaDetalle_PedidoCobranzaID', 'PedidosCobranzaDetalle',  'add_indexes_contabilidad_perf.sql'),
 ('IX_PedidosCobranzaDetalle_OrdenID',          'PedidosCobranzaDetalle',  'add_indexes_contabilidad_perf.sql'),
 ('IX_TransaccionDetalle_TcaIdTransaccion',     'TransaccionDetalle',      'add_indexes_contabilidad_perf.sql'),
 ('IX_DeudaDocumento_DocIdDocumento',           'DeudaDocumento',          'add_indexes_contabilidad_perf.sql'),
 ('IX_DeudaDocumento_CueIdCuenta',              'DeudaDocumento',          'add_indexes_contabilidad_perf.sql'),
 ('IX_DocumentosContables_DocFechaEmision',     'DocumentosContables',     'add_indexes_contabilidad_perf.sql'),
 ('IX_ContAsiCab_Fecha',                        'Cont_AsientosCabecera',   'add_indexes_libro_mayor.sql'),
 ('IX_ContAsiDet_AsiId',                        'Cont_AsientosDetalle',    'add_indexes_libro_mayor.sql'),
 ('IX_TransaccionesCaja_Cliente_Fecha',         'TransaccionesCaja',       'PROD_add_indexes_caja.sql (nuevo)'),
 ('IX_TransaccionesCaja_Fecha',                 'TransaccionesCaja',       'PROD_add_indexes_caja.sql (nuevo)');

SELECT Panel = '3 - QUE FALTA', e.Migracion, e.Tabla, e.Indice,
       Estado = CASE WHEN EXISTS (SELECT 1 FROM sys.indexes i
                                  WHERE i.name = e.Indice
                                    AND i.object_id = OBJECT_ID('dbo.' + e.Tabla))
                     THEN 'esta' ELSE 'FALTA' END
FROM @Esperados e
ORDER BY CASE WHEN EXISTS (SELECT 1 FROM sys.indexes i
                           WHERE i.name = e.Indice AND i.object_id = OBJECT_ID('dbo.' + e.Tabla))
              THEN 1 ELSE 0 END, e.Migracion, e.Indice;

-- ── 4 · Veredicto en una linea ───────────────────────────────────
SELECT Panel = '4 - VEREDICTO',
       Faltan = SUM(x.Falta),
       DeUnTotalDe = COUNT(*)
FROM (SELECT Falta = CASE WHEN EXISTS (SELECT 1 FROM sys.indexes i
                                       WHERE i.name = e.Indice
                                         AND i.object_id = OBJECT_ID('dbo.' + e.Tabla))
                          THEN 0 ELSE 1 END
      FROM @Esperados e) x;
