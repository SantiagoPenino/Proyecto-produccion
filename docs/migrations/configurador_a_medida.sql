/* ══════════════════════════════════════════════════════════════════════════
   CONFIGURADOR DE PRODUCTOS — PRODUCTOS A MEDIDA DE TIZADA PRO (13-oct-2026)
   ══════════════════════════════════════════════════════════════════════════
   Pañuelos, toallas, banderas, banderines: UNA pieza sin talles cuya medida la
   dice cada pedido. TIZADA PRO arma el molde con esa medida (le suma el margen
   para coser) y marca dónde van las tiras.

   El producto queda vinculado a una VARIABLE a medida de TIZADA (GET /variables
   la trae con el bloque "a_medida") y guarda qué ofrece de ella:
     formas permitidas y por defecto, punta del triángulo, terminación del borde,
     medida libre (mínimo/máximo) o medidas fijas, telas, tiras por defecto.

   Qué hace (idempotente, no borra nada):
     A. ProductoVentaConfig.AMedidaJson  NVARCHAR(MAX) NULL  (NULL = no es a medida)
     B. Verificación.

   Orden de deploy: correr ESTE script ANTES del backend. El backend tolera que
   falte: sin la columna no muestra la sección "A medida".
   ══════════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
GO

/* A. Columna */
IF COL_LENGTH('dbo.ProductoVentaConfig', 'AMedidaJson') IS NULL
BEGIN
    ALTER TABLE dbo.ProductoVentaConfig ADD AMedidaJson NVARCHAR(MAX) NULL;
    PRINT 'A. ProductoVentaConfig.AMedidaJson creada.';
END
ELSE PRINT 'A. ProductoVentaConfig.AMedidaJson ya existía.';
GO

/* B. Verificación */
SELECT CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'AMedidaJson') IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS AMedidaJson,
       (SELECT COUNT(*) FROM dbo.ProductoVentaConfig WHERE AMedidaJson IS NOT NULL) AS ProductosAMedida;
GO
