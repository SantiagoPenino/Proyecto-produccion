/* ===========================================================================
   fix-concepto-cobertura-nombre-trabajo.sql
   ---------------------------------------------------------------------------
   Reemplaza el texto "Cobertura retroactiva" del MovConcepto de las ENTREGAS
   de cobertura sobre cuentas de recurso (MTS / KG) por:

       <CODIGO ORDEN>: <NOMBRE DEL TRABAJO>

   El estado de cuenta parsea el concepto:
       "Cobertura retroactiva: DTF-1165"
        └─ resto ─┘            └ codigo ┘  -> DOCUMENTO = DTF-1165
   El concepto nuevo queda:
       "DTF-1165: Remeras Gonzalo Garcia"
        └ codigo ┘ └── nombre trabajo ──┘  -> DOCUMENTO = DTF-1165 (intacto)
                                              CONCEPTO  = Remeras Gonzalo Garcia
   (el front extrae el codigo /[A-Z]{2,5}-\d+/i este donde este, asi que la
    columna DOCUMENTO sigue funcionando).

   Nombre del trabajo (misma resolucion que usa el backend):
       COALESCE(Ordenes.DescripcionTrabajo, OrdenesDeposito.OrdNombreTrabajo)
   via m.OrdIdOrden.

   NO cambia ningun saldo. Solo cambia el texto del concepto.

   >>> USO:
   1) Corre primero el PASO 1 (preview) y revisa la columna ConceptoNuevo.
   2) Si esta OK, corre el PASO 2 (transaccion). Deja el COMMIT comentado la
      primera vez: revisa @@ROWCOUNT y recien despues descomenta el COMMIT.
   =========================================================================== */

SET NOCOUNT ON;

/* Filtro opcional por cliente (dejar NULL = todos los clientes) */
DECLARE @CliFiltro INT = NULL;

/* Prefijo a reemplazar */
DECLARE @Prefijo NVARCHAR(50) = N'Cobertura retroactiva';


/* ===========================================================================
   PASO 1 — PREVIEW (no escribe nada)
   =========================================================================== */
SELECT
    m.MovIdMovimiento,
    cc.CliIdCliente,
    CONVERT(varchar(19), m.MovFecha, 120)                    AS Fecha,
    m.MovConcepto                                            AS ConceptoActual,
    cod.Codigo                                               AS CodigoOrden,
    LTRIM(RTRIM(oa.NombreTrabajo))                           AS NombreTrabajo,
    CASE WHEN cod.Codigo = ''
         THEN LTRIM(RTRIM(oa.NombreTrabajo))
         ELSE cod.Codigo + N': ' + LTRIM(RTRIM(oa.NombreTrabajo))
    END                                                      AS ConceptoNuevo
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
OUTER APPLY (
    SELECT COALESCE(
        (SELECT TOP 1 DescripcionTrabajo FROM dbo.Ordenes         WITH(NOLOCK) WHERE OrdenID    = m.OrdIdOrden),
        (SELECT TOP 1 OrdNombreTrabajo   FROM dbo.OrdenesDeposito WITH(NOLOCK) WHERE OrdIdOrden = m.OrdIdOrden)
    ) AS NombreTrabajo
) oa
CROSS APPLY (
    -- codigo embebido en el concepto (lo que hoy va despues del prefijo)
    SELECT LTRIM(RTRIM(REPLACE(
              SUBSTRING(m.MovConcepto, LEN(@Prefijo) + 1, 4000), ':', ''))) AS Codigo
) cod
WHERE cc.ProIdProducto IS NOT NULL                       -- cuenta de recurso (MTS/KG)
  AND m.MovTipo = 'ENTREGA'
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovConcepto LIKE @Prefijo + N'%'
  AND oa.NombreTrabajo IS NOT NULL
  AND LTRIM(RTRIM(oa.NombreTrabajo)) <> ''
  AND LTRIM(RTRIM(oa.NombreTrabajo)) <> 'S/N'
  AND (@CliFiltro IS NULL OR cc.CliIdCliente = @CliFiltro)
ORDER BY m.MovFecha DESC;


/* ===========================================================================
   PASO 2 — APLICAR (transaccional). Descomentar para ejecutar.
   =========================================================================== */
/*
BEGIN TRAN;

UPDATE m
SET m.MovConcepto = CASE WHEN cod.Codigo = ''
                         THEN LTRIM(RTRIM(oa.NombreTrabajo))
                         ELSE cod.Codigo + N': ' + LTRIM(RTRIM(oa.NombreTrabajo))
                    END
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
OUTER APPLY (
    SELECT COALESCE(
        (SELECT TOP 1 DescripcionTrabajo FROM dbo.Ordenes         WITH(NOLOCK) WHERE OrdenID    = m.OrdIdOrden),
        (SELECT TOP 1 OrdNombreTrabajo   FROM dbo.OrdenesDeposito WITH(NOLOCK) WHERE OrdIdOrden = m.OrdIdOrden)
    ) AS NombreTrabajo
) oa
CROSS APPLY (
    SELECT LTRIM(RTRIM(REPLACE(
              SUBSTRING(m.MovConcepto, LEN(@Prefijo) + 1, 4000), ':', ''))) AS Codigo
) cod
WHERE cc.ProIdProducto IS NOT NULL
  AND m.MovTipo = 'ENTREGA'
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
  AND m.MovConcepto LIKE @Prefijo + N'%'
  AND oa.NombreTrabajo IS NOT NULL
  AND LTRIM(RTRIM(oa.NombreTrabajo)) <> ''
  AND LTRIM(RTRIM(oa.NombreTrabajo)) <> 'S/N'
  AND (@CliFiltro IS NULL OR cc.CliIdCliente = @CliFiltro);

PRINT 'Filas actualizadas: ' + CAST(@@ROWCOUNT AS varchar(10));

-- Revisa el numero de filas. Si esta OK:
-- COMMIT TRAN;
-- Si algo no cuadra:
-- ROLLBACK TRAN;
*/
