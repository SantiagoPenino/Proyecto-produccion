/* ============================================================================
   diag_revision_general_saldos.sql        SOLO LECTURA — no escribe nada
   ----------------------------------------------------------------------------
   Revisión de TODOS los clientes contra el modelo de negocio:
     · Común y Deudor  -> tienen que estar en CERO (o diferencias muy chicas).
     · Semanal y Rollo -> pueden deber, y ese debe tiene que ser IGUAL a la deuda
                          documentada que tengan activa.
     · A favor          -> son la excepción; cada uno tiene que tener explicación.

   La verdad es el LIBRO: SUM(MovimientosCuenta.MovImporte) excluyendo ORDEN y
   ORDEN_ANTICIPO (esas se cobran al facturar el ciclo, no mueven el saldo).
   NO se usa CuentasCliente.CueSaldoActual: esa columna está contaminada porque
   SP_RegistrarMovimiento le resta también las ORDEN (bloque 6 lo mide).

   6 bloques. Correr todo y mirar en orden.
   ABRIR DESDE EL DISCO en SSMS (File -> Open).
   ============================================================================ */

SET NOCOUNT ON;
DECLARE @Tol DECIMAL(18,4) = 1.00;   -- "diferencia muy chica"

SELECT Servidor = @@SERVERNAME, Base = DB_NAME(), Momento = GETDATE();

IF OBJECT_ID('tempdb..#cta') IS NOT NULL DROP TABLE #cta;
SELECT cc.CueIdCuenta, cc.CliIdCliente,
       Cliente = RTRIM(c.Nombre),
       Tipo    = CASE c.TClIdTipoCliente WHEN 1 THEN 'Comun' WHEN 2 THEN 'Semanal'
                      WHEN 3 THEN 'Rollo' WHEN 4 THEN 'Deudor' ELSE 'sin tipo' END,
       Moneda  = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       Guardado = cc.CueSaldoActual,
       Saldo = ISNULL((SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                WHERE m.CueIdCuenta = cc.CueIdCuenta AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                  AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')), 0),
       -- Deuda documentada: SOLO la que apunta a un documento. La deuda por ORDEN
       -- no se compara: su cargo es un movimiento ORDEN, que el saldo excluye.
       VivaDoc = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
                WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DocIdDocumento IS NOT NULL
                  AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                  AND dd.DDeImportePendiente > 0.01), 0),
       VivaOrd = ISNULL((SELECT SUM(dd.DDeImportePendiente) FROM dbo.DeudaDocumento dd
                WHERE dd.CueIdCuenta = cc.CueIdCuenta AND dd.DocIdDocumento IS NULL
                  AND dd.OrdIdOrden IS NOT NULL
                  AND dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
                  AND dd.DDeImportePendiente > 0.01), 0),
       Movs = (SELECT COUNT(*) FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta)
INTO #cta
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
WHERE cc.CueTipo LIKE 'DINERO%';

ALTER TABLE #cta ADD Situacion VARCHAR(40), Diferencia DECIMAL(18,4);
UPDATE #cta SET
  Diferencia = VivaDoc - CASE WHEN Saldo < 0 THEN -Saldo ELSE 0 END,
  Situacion = CASE
    WHEN ABS(Saldo) <= @Tol AND VivaDoc <= @Tol            THEN '1 EN CERO'
    WHEN ABS(Saldo) <= @Tol AND VivaDoc >  @Tol            THEN '2 SALDO CERO CON DEUDA VIVA'
    WHEN Saldo < -@Tol AND ABS(VivaDoc + Saldo) <= @Tol    THEN '3 DEBE Y CUADRA'
    WHEN Saldo < -@Tol AND VivaDoc > @Tol                  THEN '4 DEBE Y NO CUADRA'
    WHEN Saldo < -@Tol                                     THEN '5 DEBE SIN DOCUMENTO'
    WHEN Saldo >  @Tol AND VivaDoc > @Tol                  THEN '6 A FAVOR Y CON DEUDA VIVA'
    WHEN Saldo >  @Tol                                     THEN '7 A FAVOR'
    ELSE '8 revisar' END;

/* ── 1 · PANORAMA: lo que se espera contra lo que hay ────────────────────── */
SELECT Bloque = '1 PANORAMA', Tipo, Situacion,
       Cuentas = COUNT(*), Clientes = COUNT(DISTINCT CliIdCliente),
       EnPesos   = CAST(SUM(CASE WHEN Moneda = '$'   THEN ABS(Saldo) ELSE 0 END) AS DECIMAL(18,2)),
       EnDolares = CAST(SUM(CASE WHEN Moneda = 'US$' THEN ABS(Saldo) ELSE 0 END) AS DECIMAL(18,2))
FROM #cta WHERE Movs > 0
GROUP BY Tipo, Situacion ORDER BY Tipo, Situacion;

/* ── 2 · LO QUE NO CUMPLE EL MODELO, cuenta por cuenta ───────────────────── */
-- Común/Deudor que no está en cero, y Semanal/Rollo cuyo debe no cuadra.
SELECT TOP 200 Bloque = '2 A REVISAR', Cliente, Tipo, CueIdCuenta, Moneda,
       SaldoLibro = CAST(Saldo AS DECIMAL(18,2)),
       DeudaDocumentada = CAST(VivaDoc AS DECIMAL(18,2)),
       Diferencia = CAST(Diferencia AS DECIMAL(18,2)),
       Situacion
FROM #cta
WHERE Movs > 0
  AND ( (Tipo IN ('Comun','Deudor') AND Situacion <> '1 EN CERO')
     OR (Tipo IN ('Semanal','Rollo') AND Situacion NOT IN ('1 EN CERO','3 DEBE Y CUADRA')) )
ORDER BY ABS(Saldo) DESC;

/* ── 3 · POR QUÉ hay saldo a favor: el documento cobrado de más ──────────── */
-- Se miran SOLO los documentos que cobran (PC/ET/FA). Los recibos (RA/RC) no
-- tienen cargo por diseño — son plata entrando — y no son un problema.
;WITH PorDoc AS (
    SELECT m.CueIdCuenta, m.DocIdDocumento,
           Neto  = SUM(m.MovImporte),
           Cargo = SUM(CASE WHEN m.MovImporte < 0 THEN -m.MovImporte ELSE 0 END),
           Cobro = SUM(CASE WHEN m.MovImporte > 0 THEN  m.MovImporte ELSE 0 END)
    FROM dbo.MovimientosCuenta m
    WHERE (m.MovAnulado IS NULL OR m.MovAnulado = 0)
      AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO') AND m.DocIdDocumento IS NOT NULL
    GROUP BY m.CueIdCuenta, m.DocIdDocumento
    HAVING SUM(m.MovImporte) > @Tol
)
, Clasificado AS (
    SELECT p.CueIdCuenta, p.Neto,
           Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
           Diagnostico = CASE
              WHEN p.Cargo <= 0.01 THEN 'a documento SIN cargo en el libro'
              WHEN otra.Hay = 1 THEN 'b cargo en OTRA cuenta (cross-moneda mal cerrado)'
              WHEN p.Neto > p.Cargo * 20 THEN 'c cobro ~40x el cargo (moneda cruda)'
              ELSE 'd cargo menor que el cobro' END
    FROM PorDoc p
    JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = p.CueIdCuenta
    JOIN dbo.DocumentosContables d ON d.DocIdDocumento = p.DocIdDocumento
    OUTER APPLY (SELECT Hay = MAX(1) FROM dbo.MovimientosCuenta m2
                 WHERE m2.DocIdDocumento = p.DocIdDocumento AND m2.CueIdCuenta <> p.CueIdCuenta
                   AND m2.MovImporte < 0 AND (m2.MovAnulado IS NULL OR m2.MovAnulado = 0)) otra
    WHERE RTRIM(d.DocSerie) IN ('PC','ET','FA')
)
SELECT Bloque = '3 COBRO DE MAS', Diagnostico, Moneda,
       Documentos = COUNT(*), Cuentas = COUNT(DISTINCT CueIdCuenta),
       CobradoDeMas = CAST(SUM(Neto) AS DECIMAL(18,2))
FROM Clasificado
GROUP BY Diagnostico, Moneda
ORDER BY Diagnostico, Moneda;

/* ── 4 · LAS DEUDAS POR ORDEN (no aparecen nunca en el saldo) ────────────── */
;WITH D AS (
  SELECT dd.DDeIdDocumento, dd.DDeImportePendiente, dd.CueIdCuenta,
         Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
         OrdenID = o.OrdenID,
         YaFacturada = CASE WHEN o.OrdenID IS NOT NULL
                             AND EXISTS (SELECT 1 FROM dbo.DocumentosContablesDetalle dcd
                                         WHERE RTRIM(dcd.OrdCodigoOrden) = RTRIM(o.CodigoOrden))
                            THEN 1 ELSE 0 END
  FROM dbo.DeudaDocumento dd
  JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = dd.CueIdCuenta
  LEFT JOIN dbo.Ordenes o ON o.OrdenID = dd.OrdIdOrden
  WHERE dd.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND dd.DDeImportePendiente > 0.01
    AND dd.DocIdDocumento IS NULL AND dd.OrdIdOrden IS NOT NULL)
SELECT Bloque = '4 DEUDA POR ORDEN',
       Estado = CASE WHEN OrdenID IS NULL THEN 'a la orden NO existe en dbo.Ordenes'
                     WHEN YaFacturada = 1 THEN 'b YA FACTURADA (deuda duplicada)'
                     ELSE 'c sin facturar (legitima)' END,
       Moneda, Deudas = COUNT(*), Cuentas = COUNT(DISTINCT CueIdCuenta),
       Pendiente = CAST(SUM(DDeImportePendiente) AS DECIMAL(18,2))
FROM D
GROUP BY CASE WHEN OrdenID IS NULL THEN 'a la orden NO existe en dbo.Ordenes'
              WHEN YaFacturada = 1 THEN 'b YA FACTURADA (deuda duplicada)'
              ELSE 'c sin facturar (legitima)' END, Moneda
ORDER BY 2, 3;

/* ── 5 · AJUSTES MANUALES vivos (plata escrita a mano) ───────────────────── */
SELECT Bloque = '5 AJUSTES A MANO', Cliente = RTRIM(c.Nombre),
       Moneda = CASE WHEN cc.MonIdMoneda = 2 THEN 'US$' ELSE '$' END,
       m.MovTipo, Importe = CAST(m.MovImporte AS DECIMAL(18,2)), m.MovFecha,
       Usuario = RTRIM(ISNULL(u.Usuario,'?')), Motivo = LEFT(m.MovConcepto, 90)
FROM dbo.MovimientosCuenta m
JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.Usuarios u ON u.IdUsuario = m.MovUsuarioAlta
WHERE m.MovTipo IN ('AJUSTE','AJUSTE_POS','AJUSTE_NEG')
  AND (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND cc.CueTipo LIKE 'DINERO%'
ORDER BY ABS(m.MovImporte) DESC;

/* ── 6 · LA COLUMNA CACHEADA contra el libro ─────────────────────────────── */
-- CueSaldoActual la lee el motor de cruce automático de monedas para decidir de
-- qué cuenta sacar plata. Mientras esté lejos del libro, mueve plata sola.
SELECT Bloque = '6 CueSaldoActual', Moneda,
       Cuentas = COUNT(*),
       Coinciden = SUM(CASE WHEN ABS(Guardado - Saldo) <= @Tol THEN 1 ELSE 0 END),
       NoCoinciden = SUM(CASE WHEN ABS(Guardado - Saldo) >  @Tol THEN 1 ELSE 0 END),
       PeorDiferencia = CAST(MAX(ABS(Guardado - Saldo)) AS DECIMAL(18,2)),
       -- las que el motor ve "con plata" y en realidad no la tienen
       FalsosPositivos = SUM(CASE WHEN Guardado > 0.01 AND Saldo <= 0.01 THEN 1 ELSE 0 END)
FROM #cta WHERE Movs > 0
GROUP BY Moneda;

DROP TABLE #cta;
