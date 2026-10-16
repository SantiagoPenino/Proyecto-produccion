/* ============================================================================
   fix_deudas_duplicadas_por_documento.sql
   ----------------------------------------------------------------------------
   Cancela las DeudaDocumento FANTASMA: filas duplicadas para un mismo documento.

   EL PROBLEMA
   Un documento debe tener UNA sola deuda. Nada lo impedía: DeudaDocumento no
   tiene UNIQUE sobre DocIdDocumento y `crearDeudaDocumento` insertaba a ciegas
   (ej: el cierre de ciclo con cambio de precio dejaba 2 filas por el mismo doc).
   La duplicación es SOLO en DeudaDocumento (el registro de deudas); el libro
   mayor tiene el cargo una sola vez, así que NO hay asiento que revertir.

   TRES PATRONES (todos se cubren acá):
     A) las DOS filas siguen vivas (pendientes)  → se conserva una, se cancela la otra.
     B) una fila YA está pagada (COBRADA) y la otra quedó viva  → la viva es la
        fantasma (el doc ya está pagado por la otra). ESTE es el caso de PC-1982:
        los pagos entraron a #5438 (cobrada) y la #5439 quedó pendiente por el total.
        ⚠️ La versión anterior de este script NO lo agarraba (solo miraba docs con
        2+ deudas VIVAS). Ahora sí.
     C) las dos ya están pagadas  → no hay nada vivo que moleste; no se toca.

   CRITERIO — cuál se CONSERVA (keeper), en orden:
     1. La que recibió PAGOS (o está COBRADA). Nunca se cancela la que tiene la plata.
     2. Si ninguna tiene pagos, la que coincide con el total de la factura (±$2).
     3. A igualdad, la más vieja (menor DDeIdDocumento).
   Se CANCELAN las OTRAS filas que sigan VIVAS (pendiente>0). Pasan a
   DDeEstado='CANCELADA'. No se borra nada: queda la fila para auditar.

   ⚠️ AMBIGUOS (no se tocan, revisar a mano): cuando el keeper tiene pagos pero su
   importe NO coincide con el total de la factura, y otra fila SÍ coincide. Ahí no
   se sabe si el cliente debe el monto pagado o el de la factura (ej: PC-1361, PC-1367).
   ============================================================================ */

SET NOCOUNT ON;
GO

-- ── 0. Set de trabajo: TODAS las deudas no canceladas de docs con >1 fila ─────
IF OBJECT_ID('tempdb..#dupch') IS NOT NULL DROP TABLE #dupch;

;WITH dup AS (
    -- Docs con más de UNA deuda (contando pagadas + vivas, NO las ya canceladas).
    -- Contar solo las vivas dejaba afuera el patrón B (una pagada + una fantasma viva).
    SELECT DocIdDocumento
    FROM   dbo.DeudaDocumento
    WHERE  DocIdDocumento IS NOT NULL
      AND  DDeEstado NOT IN ('CANCELADA','ANULADA')
    GROUP  BY DocIdDocumento
    HAVING COUNT(*) > 1
)
SELECT
    d.DDeIdDocumento,
    d.DocIdDocumento,
    RTRIM(doc.DocSerie) + '-' + RTRIM(CAST(doc.DocNumero AS VARCHAR(20))) AS Doc,
    d.DDeImporteOriginal,
    d.DDeImportePendiente,
    doc.DocTotal,
    d.DDeEstado,
    TuvoPagos       = CAST(CASE WHEN d.DDeImportePendiente < d.DDeImporteOriginal - 0.01
                                  OR d.DDeEstado = 'COBRADO' THEN 1 ELSE 0 END AS BIT),
    CoincideFactura = CAST(CASE WHEN ABS(d.DDeImporteOriginal - doc.DocTotal) <= 2 THEN 1 ELSE 0 END AS BIT),
    Viva            = CAST(CASE WHEN d.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                                 AND d.DDeImportePendiente > 0.01 THEN 1 ELSE 0 END AS BIT),
    rn = ROW_NUMBER() OVER (
           PARTITION BY d.DocIdDocumento
           ORDER BY CASE WHEN d.DDeImportePendiente < d.DDeImporteOriginal - 0.01
                           OR d.DDeEstado = 'COBRADO' THEN 0 ELSE 1 END,   -- 1º la que cobró
                    ABS(d.DDeImporteOriginal - doc.DocTotal),               -- 2º la que = factura
                    d.DDeIdDocumento)                                       -- 3º la más vieja
INTO #dupch
FROM dbo.DeudaDocumento d
JOIN dup                        ON dup.DocIdDocumento = d.DocIdDocumento
JOIN dbo.DocumentosContables doc ON doc.DocIdDocumento = d.DocIdDocumento
WHERE d.DDeEstado NOT IN ('CANCELADA','ANULADA');

-- Ambiguos: el keeper (rn=1) tiene pagos pero NO coincide con el total de la factura.
IF OBJECT_ID('tempdb..#ambiguos') IS NOT NULL DROP TABLE #ambiguos;
SELECT DISTINCT DocIdDocumento
INTO   #ambiguos
FROM   #dupch
WHERE  rn = 1 AND TuvoPagos = 1 AND CoincideFactura = 0;
GO

-- ── 1. PREVIEW ──────────────────────────────────────────────────────────────
SELECT
    Doc, DDeIdDocumento AS DDeId, DDeImporteOriginal AS Original,
    DDeImportePendiente AS Pendiente, DocTotal, DDeEstado, TuvoPagos, Viva,
    Accion = CASE WHEN rn = 1 THEN 'CONSERVA'
                  WHEN Viva = 0 THEN '(ya pagada, no molesta)'
                  ELSE '>>> CANCELAR (fantasma viva)' END
FROM   #dupch
WHERE  DocIdDocumento NOT IN (SELECT DocIdDocumento FROM #ambiguos)
ORDER  BY Doc, rn;

SELECT FantasmasVivasACancelar = COUNT(*), TotalPendienteQueSeVa = SUM(DDeImportePendiente)
FROM   #dupch
WHERE  rn > 1 AND Viva = 1 AND DocIdDocumento NOT IN (SELECT DocIdDocumento FROM #ambiguos);
GO

-- ── 2. EL FIX — descomentar tras revisar el preview ─────────────────────────
/*
BEGIN TRANSACTION;

UPDATE d
SET d.DDeEstado         = 'CANCELADA',
    d.DDeImportePendiente = 0,
    d.DDeObservaciones  = LEFT(ISNULL(d.DDeObservaciones + ' | ', '')
                          + 'CANCELADA por duplicado: el doc ya tiene la deuda #'
                          + CAST(k.DDeIdDocumento AS VARCHAR(20)) + '. fix_deudas_duplicadas_por_documento.sql', 500)
FROM dbo.DeudaDocumento d
JOIN #dupch x ON x.DDeIdDocumento = d.DDeIdDocumento AND x.rn > 1 AND x.Viva = 1   -- solo fantasmas VIVAS
JOIN #dupch k ON k.DocIdDocumento = x.DocIdDocumento AND k.rn = 1                  -- la que se conserva
WHERE x.DocIdDocumento NOT IN (SELECT DocIdDocumento FROM #ambiguos);

PRINT '[OK] Deudas fantasma canceladas: ' + CAST(@@ROWCOUNT AS VARCHAR(10));

-- Verificar: no debe quedar ningún documento con una deuda VIVA duplicada
-- (salvo los ambiguos del paso 3).
SELECT dd.DocIdDocumento, DeudasVivas = COUNT(*)
FROM   dbo.DeudaDocumento dd
WHERE  dd.DocIdDocumento IS NOT NULL
  AND  dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND dd.DDeImportePendiente > 0.01
  AND  dd.DocIdDocumento IN (
        SELECT DocIdDocumento FROM dbo.DeudaDocumento
        WHERE DDeEstado NOT IN ('CANCELADA','ANULADA')
        GROUP BY DocIdDocumento HAVING COUNT(*) > 1)
GROUP  BY dd.DocIdDocumento HAVING COUNT(*) > 1;

--   COMMIT TRANSACTION;   -- o   ROLLBACK TRANSACTION;
*/
GO

-- ── 3. AMBIGUOS — decidir a mano, este script no los toca ────────────────────
SELECT
    Doc, DDeIdDocumento AS DDeId, DDeImporteOriginal AS Original,
    DDeImportePendiente AS Pendiente, DocTotal, TuvoPagos, CoincideFactura,
    Nota = CASE WHEN TuvoPagos = 1 THEN 'tiene los pagos, NO coincide con la factura'
                ELSE 'coincide con la factura, sin pagos' END
FROM   #dupch
WHERE  DocIdDocumento IN (SELECT DocIdDocumento FROM #ambiguos)
ORDER  BY Doc, rn;
GO

-- ── 4. RESOLVER LOS AMBIGUOS con "LA FACTURA MANDA" (opcional) ────────────────
-- DIAGNÓSTICO: en estos, el libro mayor Y la factura ya tienen el importe correcto
-- (DocTotal). Solo la DEUDA con pagos quedó con el importe VIEJO (más alto, de antes
-- de una baja de precio). El cliente pagó contra el precio viejo.
-- RESOLUCIÓN (regla del equipo, LA FACTURA MANDA): se ajusta la deuda con pagos al
-- total de la factura CONSERVANDO lo ya pagado, y se cancela la copia. Si pagó de más,
-- la deuda queda saldada; el excedente ya está reflejado como saldo a favor en el libro
-- mayor (no se crea ni destruye plata: solo se corrige el registro de la deuda).
-- ⚠️ Toca importes de deuda de clientes reales — revisá el preview antes de commitear.
--
-- CANDADO: esto SOLO ajusta hacia ABAJO (deuda con pagos MÁS ALTA que la factura →
-- baja a la factura). NUNCA crea deuda. Si la deuda con pagos es MENOR que la factura
-- (ej PC-1991 Francisco Viera: pagó 990+891 pero la factura dice 4.581), NO encaja en
-- este patrón y se deja para revisar a mano (ajustarla subiría la deuda = crearía plata
-- que el cliente no debe). Esos van en la Sección 5.
IF OBJECT_ID('tempdb..#ambiguosOK') IS NOT NULL DROP TABLE #ambiguosOK;
SELECT DISTINCT DocIdDocumento INTO #ambiguosOK
FROM   #dupch
WHERE  DocIdDocumento IN (SELECT DocIdDocumento FROM #ambiguos)
  AND  rn = 1 AND DDeImporteOriginal > DocTotal + 2;   -- solo sobre-cobro (ajuste hacia abajo)
GO

-- PREVIEW: cómo queda cada uno (solo los resolubles hacia abajo)
SELECT
    Doc, DDeIdDocumento AS DDeId,
    ImporteViejo   = CAST(DDeImporteOriginal AS DECIMAL(18,2)),
    Factura        = CAST(DocTotal AS DECIMAL(18,2)),
    YaPago         = CAST(DDeImporteOriginal - DDeImportePendiente AS DECIMAL(18,2)),
    NuevoPendiente = CAST(CASE WHEN DocTotal - (DDeImporteOriginal - DDeImportePendiente) < 0.01 THEN 0
                               ELSE DocTotal - (DDeImporteOriginal - DDeImportePendiente) END AS DECIMAL(18,2)),
    Accion = CASE WHEN rn = 1 THEN 'AJUSTAR a la factura (conserva los pagos)' ELSE 'CANCELAR (copia)' END
FROM   #dupch
WHERE  DocIdDocumento IN (SELECT DocIdDocumento FROM #ambiguosOK)
ORDER  BY Doc, rn;
GO

/*
BEGIN TRANSACTION;

-- 4a. Ajustar la deuda con pagos (keeper) al total de la factura, conservando lo pagado
UPDATE d
SET d.DDeImporteOriginal  = x.DocTotal,
    d.DDeImportePendiente = CASE WHEN x.DocTotal - (x.DDeImporteOriginal - x.DDeImportePendiente) < 0.01 THEN 0
                                 ELSE x.DocTotal - (x.DDeImporteOriginal - x.DDeImportePendiente) END,
    d.DDeEstado = CASE WHEN x.DocTotal - (x.DDeImporteOriginal - x.DDeImportePendiente) < 0.01 THEN 'COBRADO' ELSE d.DDeEstado END,
    d.DDeObservaciones = LEFT(ISNULL(d.DDeObservaciones + ' | ', '')
                         + 'Ajustada a la factura ' + CAST(CAST(x.DocTotal AS DECIMAL(18,2)) AS VARCHAR(20))
                         + ' (era ' + CAST(CAST(x.DDeImporteOriginal AS DECIMAL(18,2)) AS VARCHAR(20)) + '). fix_deudas_duplicadas', 500)
FROM dbo.DeudaDocumento d
JOIN #dupch x ON x.DDeIdDocumento = d.DDeIdDocumento AND x.rn = 1
WHERE x.DocIdDocumento IN (SELECT DocIdDocumento FROM #ambiguosOK);

-- 4b. Cancelar la copia (la que coincide con la factura pero no tiene pagos)
UPDATE d
SET d.DDeEstado = 'CANCELADA', d.DDeImportePendiente = 0,
    d.DDeObservaciones = LEFT(ISNULL(d.DDeObservaciones + ' | ', '')
                         + 'CANCELADA por duplicado (ambiguo resuelto s/ factura). fix_deudas_duplicadas', 500)
FROM dbo.DeudaDocumento d
JOIN #dupch x ON x.DDeIdDocumento = d.DDeIdDocumento AND x.rn > 1
WHERE x.DocIdDocumento IN (SELECT DocIdDocumento FROM #ambiguosOK);

PRINT '[OK] Ambiguos resueltos por factura.';
--   COMMIT TRANSACTION;   -- o   ROLLBACK TRANSACTION;
*/
GO

-- ── 5. AMBIGUOS QUE NO ENCAJAN — revisar 100% a mano (el script NO los toca) ──
-- La deuda con pagos es MENOR que la factura: ajustarla a la factura CREARÍA deuda.
-- Suele ser un doc con la factura mal (más alta que lo realmente cobrado) o cargos que
-- faltan. Ej: PC-1991 (Francisco Viera) pagó 990+891 pero la factura dice 4.581.
SELECT
    Doc, DDeIdDocumento AS DDeId, DDeImporteOriginal AS Original,
    DDeImportePendiente AS Pendiente, DocTotal, DDeEstado,
    Nota = 'La deuda pagada (' + CAST(CAST(DDeImporteOriginal AS DECIMAL(18,2)) AS VARCHAR(20))
         + ') es MENOR que la factura (' + CAST(CAST(DocTotal AS DECIMAL(18,2)) AS VARCHAR(20)) + ') — revisar el doc'
FROM   #dupch
WHERE  DocIdDocumento IN (SELECT DocIdDocumento FROM #ambiguos)
  AND  DocIdDocumento NOT IN (SELECT DocIdDocumento FROM #ambiguosOK)
ORDER  BY Doc, rn;
GO

DROP TABLE #dupch;
DROP TABLE #ambiguos;
IF OBJECT_ID('tempdb..#ambiguosOK') IS NOT NULL DROP TABLE #ambiguosOK;
GO
