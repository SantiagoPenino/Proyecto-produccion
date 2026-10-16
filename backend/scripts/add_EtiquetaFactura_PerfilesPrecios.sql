/* =============================================================================
   add_EtiquetaFactura_PerfilesPrecios.sql
   -----------------------------------------------------------------------------
   Texto que ve el CLIENTE en la factura cuando un perfil de precios aplicó un
   descuento o un recargo (fase F0 del plan docs/motor-precios-transparencia-plan.md).

   El nombre interno del perfil ("Descuento Trabajadores 10%", "Recargo por Tinta")
   sigue siendo lo que ven las pantallas internas (cotización, bandeja). En el papel
   se imprime EtiquetaFactura y, si está vacía, el Nombre. Ejemplos sugeridos:
     perfil 2  "Recargo por Urgencias"      → 'Urgencia'
     perfil 3  "Recargo por Tinta"          → 'Tinta UV'
     perfil 13 "SUBLIMACION ESCALONADOS"    → 'Descuento por volumen'
     perfil 4  "Descuento Trabajadores 10%" → 'Precio especial'
   Los UPDATE quedan comentados: el texto lo decide administración.

   Aditivo e idempotente. Correr UNA vez en PRODUCCIÓN (SSMS).
   ============================================================================= */
SET NOCOUNT ON;

IF COL_LENGTH('dbo.PerfilesPrecios', 'EtiquetaFactura') IS NULL
    ALTER TABLE dbo.PerfilesPrecios ADD EtiquetaFactura NVARCHAR(60) NULL;
GO

/*
UPDATE dbo.PerfilesPrecios SET EtiquetaFactura = N'Urgencia'              WHERE ID = 2;
UPDATE dbo.PerfilesPrecios SET EtiquetaFactura = N'Tinta UV'              WHERE ID = 3;
UPDATE dbo.PerfilesPrecios SET EtiquetaFactura = N'Descuento por volumen' WHERE ID IN (1, 7, 12, 13, 14);
UPDATE dbo.PerfilesPrecios SET EtiquetaFactura = N'Precio especial'       WHERE ID IN (4, 5, 10);
*/

/* Verificación */
SELECT ID, Nombre, EsGlobal, Categoria, Activo, EtiquetaFactura
FROM dbo.PerfilesPrecios
ORDER BY ID;
GO
