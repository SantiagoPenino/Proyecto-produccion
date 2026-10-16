/* ============================================================================
   CONVERTIR NC MAL EMITIDAS -> VENTA  (para BASE LOCAL)
   ----------------------------------------------------------------------------
   CONTEXTO
   Estas "Notas de Crédito" (DocSerie='NC', CfeEstado='ACEPTADO_DGI') NO llegaron
   a DGI como notas de crédito: por el bug del DocTipo truncado a varchar(20), DGI
   las registró como VENTA (e-Factura 111 / e-Ticket 101), con su CAE real.
   Este script hace que el local COINCIDA con DGI: las pasa a la VENTA que son.

   NO hay que tocar DocId a mano: el script toma TODAS las NC aceptadas de la
   base donde se corre y les deriva el tipo. Así funciona igual en cualquier base
   (los DocId cambian de una base a otra; esto no depende de ellos).

   El tipo (111 e-Factura / 101 e-Ticket) se deriva del CAE:
     1) si hay una VENTA (no-NC) con el mismo CAE, usa SU tipo (lo más confiable);
     2) si no, cae a la letra de la serie del CAE (A -> 111, B -> 101).
   REVISÁ la grilla "ANTES" y, si algún tipo está mal, forzalo en @override.

   NO toca DGI (ya existen con su CAE) ni la cuenta corriente (tema contable, ver
   el diagnóstico al final). Usa CfeTipoCFE si la columna existe.
   ============================================================================ */

SET NOCOUNT ON;
SET XACT_ABORT ON;

/* ============================================================================
   OVERRIDE (opcional) — solo si la grilla ANTES muestra un tipo mal derivado.
   Poné acá el DocId (de ESTA base) y el tipo correcto. Si no hace falta, dejalo vacío.
   ============================================================================ */
DECLARE @override TABLE (DocIdDocumento INT PRIMARY KEY, TipoCFE INT);
-- INSERT INTO @override VALUES (1234, 101);   -- ejemplo: forzar el 1234 a e-Ticket

/* -- Se arma @mapa directo desde un CTE (sin tablas temporales #): extrae el CAE
      del texto oficial y cruza cada NC con las ventas del mismo CAE -- */
DECLARE @mapa TABLE (DocIdDocumento INT PRIMARY KEY, TipoCFE INT);

;WITH Acept AS (
    SELECT d.DocIdDocumento, d.DocSerie, d.DocTipo, d.CfeNumeroOficial,
           CASE WHEN CHARINDEX('CAE', d.CfeNumeroOficial) > 0
                THEN LTRIM(SUBSTRING(d.CfeNumeroOficial, CHARINDEX('CAE', d.CfeNumeroOficial) + 3, 20))
                ELSE '' END AS CaeRaw
    FROM dbo.DocumentosContables d
    WHERE d.CfeEstado = 'ACEPTADO_DGI' AND d.CfeNumeroOficial IS NOT NULL
),
AceptCae AS (
    SELECT *, LEFT(LTRIM(CaeRaw), PATINDEX('%[^0-9]%', LTRIM(CaeRaw) + ' ') - 1) AS Cae
    FROM Acept
),
Ventas AS (   -- CAE -> tipo, tomado de los documentos de VENTA (no-NC)
    SELECT Cae, MAX(CASE WHEN DocTipo LIKE '%actura%' THEN 111 ELSE 101 END) AS TipoVenta
    FROM AceptCae WHERE DocSerie <> 'NC' AND Cae <> '' GROUP BY Cae
)
INSERT INTO @mapa (DocIdDocumento, TipoCFE)
SELECT ac.DocIdDocumento,
       CASE
         WHEN ov.TipoCFE IS NOT NULL THEN ov.TipoCFE                 -- 1) override manual
         WHEN v.TipoVenta IS NOT NULL THEN v.TipoVenta               -- 2) venta con el mismo CAE
         WHEN ac.CfeNumeroOficial LIKE '%Serie A%' THEN 111          -- 3) fallback por serie
         ELSE 101
       END
FROM AceptCae ac
LEFT JOIN Ventas v ON v.Cae = ac.Cae
LEFT JOIN @override ov ON ov.DocIdDocumento = ac.DocIdDocumento
WHERE ac.DocSerie = 'NC';

IF NOT EXISTS (SELECT 1 FROM @mapa)
BEGIN
    PRINT 'No hay Notas de Crédito aceptadas por DGI en esta base. Nada para convertir.';
    RETURN;
END

/* -- ANTES: REVISÁ que el tipo derivado sea el que figura en DGI -- */
SELECT 'ANTES / A CONVERTIR' AS Momento,
       d.DocIdDocumento, d.DocSerie + '-' + d.DocNumero AS DocLocal, d.DocTotal,
       d.CfeNumeroOficial AS CAE_en_DGI, m.TipoCFE,
       CASE m.TipoCFE WHEN 111 THEN 'E-Factura Contado' ELSE 'E-Ticket Contado' END AS NuevoDocTipo
FROM @mapa m
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
ORDER BY d.DocIdDocumento;

BEGIN TRANSACTION;

    UPDATE d
       SET d.DocTipo          = CASE m.TipoCFE WHEN 111 THEN 'E-Factura Contado' ELSE 'E-Ticket Contado' END,
           d.DocIdDocumentoRef = NULL,   -- ya no es NC contra otro doc: es la venta espuria en sí
           d.DocMotivoRef      = NULL
    FROM dbo.DocumentosContables d
    JOIN @mapa m ON m.DocIdDocumento = d.DocIdDocumento;

    PRINT CONCAT(@@ROWCOUNT, ' documento(s) convertido(s) de NC a venta.');

    /* CfeTipoCFE solo si la columna existe (SQL dinámico + valores inyectados) */
    IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_SCHEMA='dbo' AND TABLE_NAME='DocumentosContables' AND COLUMN_NAME='CfeTipoCFE')
    BEGIN
        DECLARE @vals NVARCHAR(MAX) = '';
        SELECT @vals = @vals + CASE WHEN @vals='' THEN '' ELSE ',' END
                     + '(' + CAST(DocIdDocumento AS VARCHAR(12)) + ',' + CAST(TipoCFE AS VARCHAR(3)) + ')'
        FROM @mapa;
        DECLARE @sql NVARCHAR(MAX) =
            'UPDATE d SET d.CfeTipoCFE = v.T FROM dbo.DocumentosContables d
             JOIN (VALUES ' + @vals + ') v(D, T) ON v.D = d.DocIdDocumento';
        EXEC sp_executesql @sql;
        PRINT 'CfeTipoCFE actualizado.';
    END

/* -- DESPUÉS -- */
SELECT 'DESPUES' AS Momento,
       d.DocIdDocumento, d.DocSerie + '-' + d.DocNumero AS DocLocal,
       d.DocTipo, d.CfeNumeroOficial AS CAE_en_DGI, d.DocIdDocumentoRef
FROM @mapa m
JOIN dbo.DocumentosContables d ON d.DocIdDocumento = m.DocIdDocumento
ORDER BY d.DocIdDocumento;

-- Revisá los SELECT. Si está OK:  COMMIT TRANSACTION;   si no:  ROLLBACK TRANSACTION;
-- (la transacción queda ABIERTA a propósito para que decidas)


/* ============================================================================
   APARTE — TEMA CONTABLE (NO lo resuelve este script)
   Las NC internas dejaron un movimiento NOTA_CREDITO que ACREDITÓ al cliente. Al
   volverlas venta ese crédito queda al revés, y la NC correctiva generará OTRO
   crédito -> doble acreditación. Este SELECT los lista para tratarlos con el
   contador; no ejecuta ningún cambio.
   ============================================================================ */
SELECT mv.MovIdMovimiento, mv.DocIdDocumento, mv.MovTipo, mv.MovImporte,
       mv.CueIdCuenta, mv.MovConcepto, mv.MovFecha
FROM dbo.MovimientosCuenta mv
JOIN @mapa m ON m.DocIdDocumento = mv.DocIdDocumento
WHERE mv.MovTipo = 'NOTA_CREDITO' AND ISNULL(mv.MovAnulado,0) = 0
ORDER BY mv.DocIdDocumento;
