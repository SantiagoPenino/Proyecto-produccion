/* ══════════════════════════════════════════════════════════════════════════
   CONFIGURADOR DE PRODUCTOS — CÓMO ARMA TIZADA PRO LOS ARCHIVOS (14-oct-2026)
   ══════════════════════════════════════════════════════════════════════════
   Por producto, cómo pide la tizada (mesas.modo del pedido a TIZADA PRO):
     NULL           = automático: lo del .env (a medida: TIZADAPRO_MESAS_MODO_A_MEDIDA;
                      prendas: TIZADAPRO_MESAS_MODO)
     'normal'       = TIZADA acomoda todo: un archivo por mesa (las mesas iguales salen repetidas)
     'una_por_fila' = un archivo por fila de la lista (por diseño, en los productos a medida)
                      y la cantidad vuelve como COPIAS de ese archivo (ej. 1 archivo × 15)

   Qué hace (idempotente, no borra nada):
     A. ProductoVentaConfig.TizadaMesasModo VARCHAR(20) NULL
     B. Verificación.

   Orden de deploy: correr ESTE script ANTES del backend. Sin la columna el backend
   sigue con lo del .env y el configurador no muestra la opción.
   ══════════════════════════════════════════════════════════════════════════ */
SET NOCOUNT ON;
GO

IF COL_LENGTH('dbo.ProductoVentaConfig', 'TizadaMesasModo') IS NULL
BEGIN
    ALTER TABLE dbo.ProductoVentaConfig ADD TizadaMesasModo VARCHAR(20) NULL;
    PRINT 'A. ProductoVentaConfig.TizadaMesasModo creada.';
END
ELSE PRINT 'A. ProductoVentaConfig.TizadaMesasModo ya existía.';
GO

SELECT CASE WHEN COL_LENGTH('dbo.ProductoVentaConfig', 'TizadaMesasModo') IS NOT NULL THEN 'OK' ELSE 'FALTA' END AS TizadaMesasModo,
       (SELECT COUNT(*) FROM dbo.ProductoVentaConfig WHERE TizadaMesasModo IS NOT NULL) AS ProductosConModo;
GO
