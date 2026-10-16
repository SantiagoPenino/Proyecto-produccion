-- ============================================================================
-- ÍNDICES DE PERFORMANCE — LIBRO DIARIO / MAYOR (Cont_Asientos*)
-- 21-ago-2026. Idempotente: se puede correr más de una vez sin efecto.
--
-- Las dos tablas del motor contable no tenían NINGÚN índice fuera de su PK
-- clustered, así que el listado del libro escaneaba las dos enteras en cada
-- carga de la pantalla.
--
-- Van junto con el paginado de erpContabilidadController.getLibroMayor.
-- Tamaño al momento de escribir esto (local): 21.601 cabeceras / 53.433
-- detalles. Cada CREATE tarda <1s y no bloquea nada apreciable.
-- ============================================================================

-- Cabecera: cubre el ORDER BY AsiFecha DESC, AsiId DESC del paginado y los
-- filtros por fecha y por origen. El INCLUDE hace que la página de 50 asientos
-- salga entera del índice, sin tocar la tabla.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ContAsiCab_Fecha' AND object_id = OBJECT_ID('dbo.Cont_AsientosCabecera'))
    CREATE NONCLUSTERED INDEX IX_ContAsiCab_Fecha
        ON dbo.Cont_AsientosCabecera (AsiFecha DESC, AsiId DESC)
        INCLUDE (AsiConcepto, TcaIdTransaccion, SysOrigen);

-- Detalle: el JOIN por AsiId es el acceso de siempre (totales del asiento,
-- detalle al expandir, búsqueda por cuenta). Sin esto era un scan de las 53k
-- líneas cada vez.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ContAsiDet_AsiId' AND object_id = OBJECT_ID('dbo.Cont_AsientosDetalle'))
    CREATE NONCLUSTERED INDEX IX_ContAsiDet_AsiId
        ON dbo.Cont_AsientosDetalle (AsiId)
        INCLUDE (CueId, DetDebeUYU, DetHaberUYU, DetImporteOriginal, DetMonedaId, DetCotizacion);
GO

-- Verificación
SELECT OBJECT_NAME(i.object_id) AS Tabla, i.name AS Indice, i.type_desc
FROM sys.indexes i
WHERE i.object_id IN (OBJECT_ID('dbo.Cont_AsientosCabecera'), OBJECT_ID('dbo.Cont_AsientosDetalle'))
  AND i.name IS NOT NULL
ORDER BY Tabla, i.name;
