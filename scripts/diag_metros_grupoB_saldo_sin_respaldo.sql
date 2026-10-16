/* ============================================================================
   DIAGNÓSTICO — METROS · GRUPO B: saldo de cuenta que el libro no respalda.
   SOLO LECTURA. No modifica nada. Correr en PRODUCCIÓN.

   Es la otra mitad del problema de metros. Mientras el grupo A tiene el plan
   inflado (y se arregla con fix_sobregiro_metros_todos.sql), acá pasa lo
   contrario: la CUENTA tiene más metros que los planes activos, y ese saldo no
   se puede reconstruir sumando MovimientosCuenta. Son metros que el cliente
   pagó y no puede usar, porque el motor de cobertura mira el PLAN.

   Al 31-ago-2026 en prod: 8 cuentas, ~1.255,3 mts atascados.
     Maximiliano Castro 500 · Rodrigofalero 199,73 · Ricardo Pino 191,56 ·
     EMEXEM 143,99 · RXD 109,925 · Mariana Valiante 100 · Le Agency 5,42 ·
     Magela García 4,69
   Cuatro de ellas tienen saldo con CERO movimientos y en tres el saldo es
   EXACTAMENTE el doble del plan (1000/500, 200/100, 9,38/4,69).

   CAUSA (medida en local el 31-ago-2026 — NO es el tacho sobre la ENTRADA,
   como se supuso al principio; son dos cosas distintas y las dos históricas):

     1. ANULAR LA VENTA DEL ROLLO no revierte el recurso. El plan queda ACTIVO
        con sus metros y el saldo de la cuenta se queda con lo sumado por la
        venta. En local hay 11 planes vivos nacidos de ventas ANULADAS (BLOQUE 6)
        y son justamente los del grupo B: Rodrigofalero #87, Ricardo Pino #72,
        CAMILO #62, EMEXEM #18, RXD #35 (dos anulaciones sobre el mismo plan)…
        Ver [[project_bug_anular_rollo_adelantado_recurso]]: el fix de
        revertirRecursosPorTransaccion está en el código, sin deployar.

     2. Hasta mediados de julio la venta de rollo por caja NO dejaba el
        movimiento de ENTRADA: actualizaba CueSaldoActual directamente. Por eso
        el libro no explica el saldo. En local: junio 72 de 72 ventas COMPLETADAS
        sin movimiento, julio 24 de 55, agosto 0 de 2 (BLOQUE 5). El INSERT ya
        está en cajaService.js — eso quedó cerrado, lo que sobra es data vieja.

   Lo que hay que sacar en limpio de acá: para cada cuenta, CUÁL de los tres
   números es el bueno (BLOQUE 4), antes de tocar nada. Si el plan nació de una
   venta anulada, el cliente no compró: el saldo correcto es sin esos metros.
   ============================================================================ */

SET NOCOUNT ON;

/* ── BLOQUE 1 · Las cuentas del grupo B, con todos los números ──────────── */
SELECT
    cc.CueIdCuenta, cc.CliIdCliente,
    RTRIM(c.Nombre)  AS Cliente, RTRIM(c.IDCliente) AS Codigo,
    RTRIM(a.Descripcion) AS Material,
    cc.CueSaldoActual                                      AS SaldoChip,
    lib.SumaMovs                                           AS SaldoLibro,
    ROUND(cc.CueSaldoActual - lib.SumaMovs, 4)             AS SaldoSinRespaldo,
    lib.NMovs,
    pl.NPlanes, pl.Comprado, pl.Usado,
    pl.RestanteActivos,
    ROUND(pl.RestanteActivos - cc.CueSaldoActual, 4)       AS Dif_Plan_vs_Cuenta,
    -- Si el saldo fuera exactamente el doble de lo comprado en planes, es la
    -- firma del tacho (se sumó la compra en vez de restarla).
    CASE WHEN ABS(cc.CueSaldoActual - 2 * pl.RestanteActivos) < 0.01
         THEN 'SI - saldo = 2x restante del plan' ELSE 'no' END AS PatronDoble
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.Articulos a ON a.ProIdProducto = cc.ProIdProducto
CROSS APPLY (
    SELECT COUNT(*) AS NMovs,
           ISNULL(SUM(CASE WHEN ISNULL(m.MovAnulado,0)=0 THEN m.MovImporte END), 0) AS SumaMovs
    FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
) lib
CROSS APPLY (
    SELECT COUNT(*) AS NPlanes,
           ISNULL(SUM(p.PlaCantidadTotal), 0) AS Comprado,
           ISNULL(SUM(p.PlaCantidadUsada), 0) AS Usado,
           ISNULL(SUM(CASE WHEN p.PlaActivo = 1 THEN p.PlaCantidadTotal - p.PlaCantidadUsada END), 0) AS RestanteActivos
    FROM dbo.PlanesMetros p WHERE p.CueIdCuenta = cc.CueIdCuenta
) pl
WHERE cc.CueTipo NOT LIKE 'DINERO%'
  AND (   ABS(cc.CueSaldoActual - lib.SumaMovs) > 0.005      -- el libro no explica el saldo
       OR (cc.CueSaldoActual <> 0 AND lib.NMovs = 0) )       -- o directamente no hay libro
ORDER BY ABS(cc.CueSaldoActual - lib.SumaMovs) DESC;

/* ── BLOQUE 2 · Planes SIN su movimiento de ENTRADA ─────────────────────
   Cada compra o recarga de rollo tiene que dejar un movimiento POSITIVO que
   mencione el plan. Si acá aparece un plan, su compra no está en el libro:
   o nunca se registró, o el movimiento se borró después.                    */
SELECT
    p.PlaIdPlan, p.CueIdCuenta, RTRIM(c.Nombre) AS Cliente,
    RTRIM(a.Descripcion) AS Material,
    p.PlaCantidadTotal, p.PlaCantidadUsada, p.PlaActivo,
    p.PlaFechaAlta, p.PlaDescripcion,
    ent.NEntradas, ent.SumaEntradas,
    ROUND(p.PlaCantidadTotal - ISNULL(ent.SumaEntradas, 0), 4) AS CompraNoRegistrada
FROM dbo.PlanesMetros p
JOIN dbo.Clientes c ON c.CliIdCliente = p.CliIdCliente
LEFT JOIN dbo.Articulos a ON a.ProIdProducto = p.ProIdProducto
CROSS APPLY (
    SELECT COUNT(*) AS NEntradas, ISNULL(SUM(m.MovImporte), 0) AS SumaEntradas
    FROM dbo.MovimientosCuenta m
    WHERE m.CueIdCuenta = p.CueIdCuenta
      AND m.MovImporte > 0
      AND (m.MovObservaciones LIKE '%Plan #' + CAST(p.PlaIdPlan AS varchar(10)) + '%'
        OR m.MovConcepto     LIKE '%plan #' + CAST(p.PlaIdPlan AS varchar(10)) + '%')
) ent
WHERE p.PlaCantidadTotal - ISNULL(ent.SumaEntradas, 0) > 0.01
ORDER BY CompraNoRegistrada DESC;

/* ── BLOQUE 3 · Ventas de rollo cobradas cuyo movimiento YA NO EXISTE ────
   Esta es la prueba de la hipótesis. La venta de un rollo por caja deja:
     - TransaccionDetalle con TdeCodigoReferencia = 'PLAN_MTS_<producto>'
       y TdeReferenciaId = el PlaIdPlan
     - un movimiento ENTRADA con MovRefExterna = el TcaIdTransaccion
   Si la venta está y el movimiento no, alguien lo borró (el tacho).          */
SELECT
    tca.TcaIdTransaccion, tca.TcaFecha, tca.TcaEstado,
    tca.TcaClienteId, RTRIM(c.Nombre) AS Cliente,
    td.TdeCodigoReferencia, td.TdeReferenciaId AS PlaIdPlan, td.TdeImporteFinal,
    p.PlaCantidadTotal, p.PlaActivo, p.CueIdCuenta,
    mv.NMovsDeEstaVenta,
    CASE WHEN mv.NMovsDeEstaVenta = 0 THEN 'MOVIMIENTO BORRADO O NUNCA CREADO' ELSE 'ok' END AS Estado
FROM dbo.TransaccionDetalle td
JOIN dbo.TransaccionesCaja tca ON tca.TcaIdTransaccion = td.TcaIdTransaccion
LEFT JOIN dbo.Clientes c ON c.CliIdCliente = tca.TcaClienteId
LEFT JOIN dbo.PlanesMetros p ON p.PlaIdPlan = td.TdeReferenciaId
CROSS APPLY (
    SELECT COUNT(*) AS NMovsDeEstaVenta
    FROM dbo.MovimientosCuenta m
    WHERE m.MovRefExterna = CAST(tca.TcaIdTransaccion AS varchar(100))
      AND m.MovImporte > 0
      AND m.CueIdCuenta = p.CueIdCuenta
) mv
WHERE td.TdeCodigoReferencia LIKE 'PLAN_MTS%'
  AND mv.NMovsDeEstaVenta = 0
ORDER BY tca.TcaFecha DESC;

/* ── BLOQUE 4 · Qué saldo tendría cada cuenta según cada fuente ─────────
   Los tres candidatos, uno al lado del otro, para decidir con qué corregir:
     SaldoChip   = lo que hoy muestra la pantalla (CueSaldoActual)
     SaldoLibro  = sumando los movimientos que quedaron
     SegunPlanes = comprado - usado, según PlanesMetros (incluidos los cerrados)
   Cuando SegunPlanes coincide con la MITAD del chip, la firma del tacho queda
   confirmada para esa cuenta.                                                */
SELECT
    cc.CueIdCuenta, RTRIM(c.Nombre) AS Cliente, RTRIM(a.Descripcion) AS Material,
    cc.CueSaldoActual                                          AS SaldoChip,
    lib.SumaMovs                                               AS SaldoLibro,
    ROUND(pl.Comprado - pl.Usado, 4)                           AS SegunPlanes,
    ROUND(cc.CueSaldoActual / NULLIF(pl.Comprado - pl.Usado, 0), 4) AS Chip_sobre_Planes,
    pl.Comprado, pl.Usado
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.Articulos a ON a.ProIdProducto = cc.ProIdProducto
CROSS APPLY (
    SELECT ISNULL(SUM(CASE WHEN ISNULL(m.MovAnulado,0)=0 THEN m.MovImporte END), 0) AS SumaMovs,
           COUNT(*) AS NMovs
    FROM dbo.MovimientosCuenta m WHERE m.CueIdCuenta = cc.CueIdCuenta
) lib
CROSS APPLY (
    SELECT ISNULL(SUM(p.PlaCantidadTotal), 0) AS Comprado,
           ISNULL(SUM(p.PlaCantidadUsada), 0) AS Usado
    FROM dbo.PlanesMetros p WHERE p.CueIdCuenta = cc.CueIdCuenta
) pl
WHERE cc.CueTipo NOT LIKE 'DINERO%'
  AND (   ABS(cc.CueSaldoActual - lib.SumaMovs) > 0.005
       OR (cc.CueSaldoActual <> 0 AND lib.NMovs = 0) )
ORDER BY ABS(cc.CueSaldoActual - lib.SumaMovs) DESC;

/* ── BLOQUE 5 · ¿El bug sigue vivo? Ventas de rollo por mes ─────────────
   Cuenta, mes a mes, cuántas ventas de rollo dejaron su movimiento de ENTRADA
   y cuántas no. Separado por estado, porque en una venta ANULADA es normal que
   el movimiento ya no esté (se revirtió).

   En local al 31-ago-2026 el corte es nítido: junio 72 de 72 COMPLETADAS sin
   movimiento, julio 24 de 55, agosto 0 de 2. O sea el INSERT del movimiento se
   agregó a mediados de julio y desde entonces funciona. Si en prod agosto
   aparece limpio, el bug está cerrado y lo que queda es data histórica.        */
SELECT FORMAT(tca.TcaFecha, 'yyyy-MM') AS Mes, tca.TcaEstado,
       COUNT(*)                                     AS VentasDeRollo,
       SUM(CASE WHEN mv.N > 0 THEN 1 ELSE 0 END)    AS ConMovimiento,
       SUM(CASE WHEN mv.N = 0 THEN 1 ELSE 0 END)    AS SinMovimiento
FROM dbo.TransaccionDetalle td
JOIN dbo.TransaccionesCaja tca ON tca.TcaIdTransaccion = td.TcaIdTransaccion
LEFT JOIN dbo.PlanesMetros p ON p.PlaIdPlan = td.TdeReferenciaId
CROSS APPLY (
    SELECT COUNT(*) AS N FROM dbo.MovimientosCuenta m
    WHERE m.MovRefExterna = CAST(tca.TcaIdTransaccion AS varchar(100))
      AND m.MovImporte > 0 AND m.CueIdCuenta = p.CueIdCuenta
) mv
WHERE td.TdeCodigoReferencia LIKE 'PLAN_MTS%'
GROUP BY FORMAT(tca.TcaFecha, 'yyyy-MM'), tca.TcaEstado
ORDER BY 1, 2;

/* ── BLOQUE 6 · Planes vivos nacidos de una venta ANULADA ───────────────
   Si la venta se anuló, el cliente no compró esos metros: el plan tendría que
   estar cerrado y el saldo no debería tenerlos. Cada fila acá es un cliente con
   metros que no pagó — o, si el saldo quedó duplicado, el rastro de una
   anulación que sumó en vez de restar.
   Ver [[project_bug_anular_rollo_adelantado_recurso]]: el fix de
   revertirRecursosPorTransaccion está en el código pero sin deployar.          */
SELECT tca.TcaIdTransaccion, tca.TcaFecha, tca.TcaFechaAnulacion,
       RTRIM(c.Nombre) AS Cliente, RTRIM(a.Descripcion) AS Material,
       p.PlaIdPlan, p.PlaCantidadTotal, p.PlaCantidadUsada, p.PlaActivo,
       cc.CueIdCuenta, cc.CueSaldoActual AS SaldoCuenta
FROM dbo.TransaccionDetalle td
JOIN dbo.TransaccionesCaja tca ON tca.TcaIdTransaccion = td.TcaIdTransaccion
JOIN dbo.PlanesMetros p       ON p.PlaIdPlan = td.TdeReferenciaId
JOIN dbo.CuentasCliente cc    ON cc.CueIdCuenta = p.CueIdCuenta
JOIN dbo.Clientes c           ON c.CliIdCliente = p.CliIdCliente
LEFT JOIN dbo.Articulos a     ON a.ProIdProducto = p.ProIdProducto
WHERE td.TdeCodigoReferencia LIKE 'PLAN_MTS%'
  AND tca.TcaEstado = 'ANULADO'
  AND p.PlaActivo = 1
ORDER BY p.PlaCantidadTotal - p.PlaCantidadUsada DESC;
