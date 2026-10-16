/* ============================================================================
   backfill_ordcodigoorden_detalle.sql
   ----------------------------------------------------------------------------
   Recupera DocumentosContablesDetalle.OrdCodigoOrden cuando está NULL/vacío,
   parseando el código de orden desde el texto libre de DcdDscItem/DcdNomItem
   (ej. 'Orden: DTF-4761 (javier)...' o 'DF-102059 - LOBAS').

   Verificado contra la base local: recupera el 95.9% de los casos vacíos
   (3379 de 3522 líneas de Factura/Ticket/Pedidos Caja no anuladas).

   SQL Server no tiene regex nativo, así que la extracción se hace con una
   función escalar que busca la primera corrida "LETRAS-DIGITOS" (2-7 letras,
   guión, 2-7 dígitos) — equivalente a /\b([A-Z]{2,7}-\d{2,7})\b/ en JS.

   CÓMO USARLO:
   1) Corré todo el script tal cual: primero solo hace un SELECT de vista previa
      (PASO 2) — no escribe nada todavía.
   2) Revisá el resultado. Si te convence, descomentá el bloque "PASO 3 — UPDATE
      REAL" (quitar el /* y el */) y volvé a correr desde ahí.
   3) El script limpia la función temporal al final (PASO 4), no deja nada
      permanente en el esquema.
   ============================================================================ */

-- ─── PASO 1: función de extracción (temporal, se borra al final) ─────────────
CREATE OR ALTER FUNCTION dbo.fn_ExtraerCodigoOrden (@texto NVARCHAR(1000))
RETURNS VARCHAR(50)
AS
BEGIN
    IF @texto IS NULL OR LTRIM(RTRIM(@texto)) = '' RETURN NULL;

    -- Primera posición donde aparece LETRA-DIGITO (ancla del patrón)
    DECLARE @pos INT = PATINDEX('%[A-Z][-][0-9]%', @texto);
    IF @pos = 0 RETURN NULL;

    -- Retroceder para encontrar el inicio de la corrida de letras mayúsculas
    DECLARE @inicio INT = @pos;
    WHILE @inicio > 1 AND SUBSTRING(@texto, @inicio - 1, 1) LIKE '[A-Z]'
        SET @inicio = @inicio - 1;

    DECLARE @guion INT = @pos + 1;

    -- Avanzar desde el primer dígito para encontrar el final de la corrida de dígitos
    DECLARE @finDigitos INT = @guion + 1;
    WHILE @finDigitos <= LEN(@texto) AND SUBSTRING(@texto, @finDigitos, 1) LIKE '[0-9]'
        SET @finDigitos = @finDigitos + 1;

    DECLARE @codigo VARCHAR(50) = SUBSTRING(@texto, @inicio, @finDigitos - @inicio);

    -- Validar longitudes razonables (letras 2-7, dígitos 2-7) para evitar falsos positivos
    DECLARE @guionPos INT = CHARINDEX('-', @codigo);
    IF @guionPos < 3 OR @guionPos > 8 RETURN NULL;
    DECLARE @digitos INT = LEN(@codigo) - @guionPos;
    IF @digitos < 2 OR @digitos > 7 RETURN NULL;

    RETURN @codigo;
END
GO

-- ─── PASO 2: vista previa (SOLO LECTURA — no escribe nada) ───────────────────
SELECT
    dcd.DcdIdDetalle,
    RTRIM(dc.DocTipo)                                                    AS DocTipo,
    dcd.DcdNomItem,
    dcd.DcdDscItem,
    dbo.fn_ExtraerCodigoOrden(dcd.DcdDscItem)                            AS CodigoDesdeDescripcion,
    dbo.fn_ExtraerCodigoOrden(dcd.DcdNomItem)                            AS CodigoDesdeNombre,
    ISNULL(dbo.fn_ExtraerCodigoOrden(dcd.DcdDscItem), dbo.fn_ExtraerCodigoOrden(dcd.DcdNomItem)) AS CodigoFinal
FROM dbo.DocumentosContablesDetalle dcd WITH(NOLOCK)
JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = dcd.DocIdDocumento
WHERE (dcd.OrdCodigoOrden IS NULL OR LTRIM(RTRIM(dcd.OrdCodigoOrden)) = '')
  AND (
        (dc.DocTipo LIKE '%Factura%' OR dc.DocTipo LIKE '%Ticket%') AND dc.DocTipo NOT LIKE '%Nota%'
        OR RTRIM(dc.DocTipo) = 'Pedidos Caja'
      )
  AND dc.DocEstado <> 'ANULADO';

-- Resumen de cobertura esperada:
SELECT
    COUNT(*) AS TotalSinCodigo,
    SUM(CASE WHEN ISNULL(dbo.fn_ExtraerCodigoOrden(dcd.DcdDscItem), dbo.fn_ExtraerCodigoOrden(dcd.DcdNomItem)) IS NOT NULL THEN 1 ELSE 0 END) AS Recuperables
FROM dbo.DocumentosContablesDetalle dcd WITH(NOLOCK)
JOIN dbo.DocumentosContables dc WITH(NOLOCK) ON dc.DocIdDocumento = dcd.DocIdDocumento
WHERE (dcd.OrdCodigoOrden IS NULL OR LTRIM(RTRIM(dcd.OrdCodigoOrden)) = '')
  AND (
        (dc.DocTipo LIKE '%Factura%' OR dc.DocTipo LIKE '%Ticket%') AND dc.DocTipo NOT LIKE '%Nota%'
        OR RTRIM(dc.DocTipo) = 'Pedidos Caja'
      )
  AND dc.DocEstado <> 'ANULADO';
GO


/* ─── PASO 3: UPDATE REAL — descomentar este bloque para ejecutarlo ───────────

UPDATE dcd
SET dcd.OrdCodigoOrden = ISNULL(dbo.fn_ExtraerCodigoOrden(dcd.DcdDscItem), dbo.fn_ExtraerCodigoOrden(dcd.DcdNomItem))
FROM dbo.DocumentosContablesDetalle dcd
JOIN dbo.DocumentosContables dc ON dc.DocIdDocumento = dcd.DocIdDocumento
WHERE (dcd.OrdCodigoOrden IS NULL OR LTRIM(RTRIM(dcd.OrdCodigoOrden)) = '')
  AND (
        (dc.DocTipo LIKE '%Factura%' OR dc.DocTipo LIKE '%Ticket%') AND dc.DocTipo NOT LIKE '%Nota%'
        OR RTRIM(dc.DocTipo) = 'Pedidos Caja'
      )
  AND dc.DocEstado <> 'ANULADO'
  AND ISNULL(dbo.fn_ExtraerCodigoOrden(dcd.DcdDscItem), dbo.fn_ExtraerCodigoOrden(dcd.DcdNomItem)) IS NOT NULL;

PRINT CONCAT('Filas actualizadas: ', @@ROWCOUNT);
GO

──────────────────────────────────────────────────────────────────────────── */


-- ─── PASO 4: limpieza — borra la función temporal (correr al final, cuando ya
--     no la necesites más; si vas a volver a correr el script de vista previa,
--     dejala y saltate este paso) ────────────────────────────────────────────
-- DROP FUNCTION IF EXISTS dbo.fn_ExtraerCodigoOrden;
-- GO
