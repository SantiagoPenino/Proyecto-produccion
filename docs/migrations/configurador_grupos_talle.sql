/* ══════════════════════════════════════════════════════════════════════════
   CONFIGURADOR DE PRODUCTOS — TALLES QUE SE VENDEN (15-oct-2026)
   ══════════════════════════════════════════════════════════════════════════
   El molde de TIZADA PRO puede traer muchos talles (niño 0–16, adulto XS–6XL, femenino XS–6XL…).
   El producto dice cuáles GRUPOS vende, para mostrar solo esos talles (avíos por talle, ficha):
     ProductoVentaConfig.GruposTalle = 'Niño,Adulto'   (NULL = todos los del molde, como antes)
   Grupos: Bebé, Niño, Adulto, Femenino, Otros (los arma la pantalla con los talles del molde).

   Qué hace (idempotente, no borra nada):
     A. ProductoVentaConfig.GruposTalle NVARCHAR(120) NULL
     B. Verificación.

   Orden de deploy: correr ESTE script ANTES del backend. Sin la columna la pantalla muestra
   todos los talles del molde, como hasta ahora.
   ══════════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
GO

IF COL_LENGTH('dbo.ProductoVentaConfig', 'GruposTalle') IS NULL
BEGIN
    ALTER TABLE dbo.ProductoVentaConfig ADD GruposTalle NVARCHAR(120) NULL;
    PRINT 'A. ProductoVentaConfig.GruposTalle creada.';
END
ELSE PRINT 'A. ProductoVentaConfig.GruposTalle ya existía.';
GO

SELECT CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'GruposTalle') IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS GruposTalle,
       (SELECT COUNT(*) FROM dbo.ProductoVentaConfig WHERE GruposTalle IS NOT NULL) AS ProductosConGrupos;
GO
