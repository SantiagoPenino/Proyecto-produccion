/* =====================================================================================
   FORENSE: retiros ENTREGADOS sin pago y sin cargo en la cuenta (06-oct-2026).
   SOLO LECTURA. Correr entero en SSMS contra SecureAppDB, en una pestaña nueva.

   Casos que salieron del análisis de Caja (PROD_analisis_retiros_pendientes_caja.sql, causa Z):
     yesus sport RT-25395 / RT-25396 · Le Agency RT-21665 · Camila Marisquirena RT-20944 · Sublime UY RT-19039

   Preguntas: ¿qué tipo de cliente es (hoy y en lo que se pueda ver de antes)? ¿por qué camino
   salió sin pasar por Caja? Los caminos que marcan un retiro como Entregado (estado 5):
     - Estantes (WebRetirosPage → /web-retiros/estantes/liberar-multiple): el control de pago está
       SOLO en la pantalla, y deja pasar si el retiro está Autorizado (9), si "parece pago"
       (estado 3/8 o la marca Pagado del estante), si el cliente es Semanal, o si no lo encuentra.
     - Despacho / mostrador (/despachos/entregar-autorizado): impago y no Semanal/Rollo pide
       contraseña y deja registro en RetirosConDeuda.
     - /marcarOrdenEntregada: sin ningún control.
   ===================================================================================== */
USE [SecureAppDB];
SET NOCOUNT ON;

IF OBJECT_ID('tempdb..#FRS_Ret') IS NOT NULL DROP TABLE #FRS_Ret;
CREATE TABLE #FRS_Ret (OReIdOrdenRetiro INT PRIMARY KEY);
INSERT INTO #FRS_Ret VALUES (25395), (25396), (21665), (20944), (19039);

/* F1. Retiro y cliente (tipo de cliente de HOY) ----------------------------------------- */
SELECT 'F1. RETIRO' AS Bloque, ISNULL(r.FormaRetiro, 'R') + '-' + CAST(r.OReIdOrdenRetiro AS VARCHAR(20)) AS Retiro,
       er.EORNombreEstado AS EstadoHoy, r.OReFechaAlta, ua.Nombre AS CreadoPor, r.OReCostoTotalOrden, r.MonIdMoneda,
       r.PagIdPago, r.ReferenciaPagoOnline, r.ORePasarPorCaja, r.LReIdLugarRetiro, fe.Nombre AS LugarRetiro,
       r.CodCliente, c.IDCliente, LTRIM(RTRIM(c.Nombre)) AS Cliente, c.TClIdTipoCliente, tc.TClDescripcion AS TipoClienteHoy
FROM #FRS_Ret k
JOIN OrdenesRetiro r WITH (NOLOCK) ON r.OReIdOrdenRetiro = k.OReIdOrdenRetiro
LEFT JOIN EstadosOrdenesRetiro er ON er.EORIdEstadoOrden = r.OReEstadoActual
LEFT JOIN FormasEnvio fe ON fe.ID = r.LReIdLugarRetiro
LEFT JOIN Usuarios ua ON ua.IdUsuario = r.OReUsuarioAlta
LEFT JOIN Clientes c WITH (NOLOCK) ON c.CodCliente = r.CodCliente
LEFT JOIN TiposClientes tc ON tc.TClIdTipoCliente = c.TClIdTipoCliente
ORDER BY r.OReIdOrdenRetiro;

/* F2. Historial de estados del retiro, con usuario: POR DÓNDE SALIÓ ---------------------
   - pasó por 9 (Autorizado)     → lo autorizó Caja sin cobrar
   - pasó por 3/4/8 (Abonado)    → algo lo puso "pagado" sin PagIdPago (estantes lo toma como pago)
   - de 1/2/7 directo a 5        → entrega sin autorización (pantalla de estantes u otro camino) */
SELECT 'F2. HISTORIAL RETIRO' AS Bloque, ISNULL(r.FormaRetiro, 'R') + '-' + CAST(h.OReIdOrdenRetiro AS VARCHAR(20)) AS Retiro,
       h.HEOFechaEstado, h.EORIdEstadoOrden, er.EORNombreEstado, u.Nombre AS Usuario, u.Usuario AS Login, h.HEOUsuarioAlta
FROM #FRS_Ret k
JOIN HistoricoEstadosOrdenesRetiro h WITH (NOLOCK) ON h.OReIdOrdenRetiro = k.OReIdOrdenRetiro
JOIN OrdenesRetiro r WITH (NOLOCK) ON r.OReIdOrdenRetiro = k.OReIdOrdenRetiro
LEFT JOIN EstadosOrdenesRetiro er ON er.EORIdEstadoOrden = h.EORIdEstadoOrden
LEFT JOIN Usuarios u ON u.IdUsuario = h.HEOUsuarioAlta
ORDER BY h.OReIdOrdenRetiro, h.HEOFechaEstado;

/* F3. Entregas autorizadas con contraseña (mostrador / despacho) ------------------------ */
SELECT 'F3. RETIROS CON DEUDA' AS Bloque, d.OrdenRetiro, d.Fecha, d.CodigoCliente, d.NombreCliente, d.Monto,
       u.Nombre AS Autorizo, d.Explicacion, d.Estado, d.Gestionado, d.FechaGestion, d.NotaGestion
FROM RetirosConDeuda d WITH (NOLOCK)
JOIN OrdenesRetiro r WITH (NOLOCK) ON d.OrdenRetiro = ISNULL(r.FormaRetiro, 'R') + '-' + CAST(r.OReIdOrdenRetiro AS VARCHAR(20))
JOIN #FRS_Ret k ON k.OReIdOrdenRetiro = r.OReIdOrdenRetiro
LEFT JOIN Usuarios u ON u.IdUsuario = d.UsuarioAutorizador;

/* F4. Órdenes del retiro ---------------------------------------------------------------- */
SELECT 'F4. ORDENES' AS Bloque, ISNULL(r.FormaRetiro, 'R') + '-' + CAST(od.OReIdOrdenRetiro AS VARCHAR(20)) AS Retiro,
       od.OrdIdOrden, od.OrdCodigoOrden, od.OrdNombreTrabajo, od.OrdCantidad, od.OrdCostoFinal,
       CASE WHEN od.MonIdMoneda = 2 THEN 'USD' ELSE 'UYU' END AS Moneda,
       od.PagIdPago, od.OrdEstadoActual, od.OrdFechaIngresoOrden, uo.Nombre AS IngresoPor,
       o.OrdenID, o.NoDocERP, o.CostoTotal AS CostoOrdenes,
       (SELECT ISNULL(SUM(Subtotal), 0) FROM PedidosCobranzaDetalle WITH (NOLOCK) WHERE OrdenID = o.OrdenID) AS SubtotalCotizado
FROM #FRS_Ret k
JOIN OrdenesRetiro r WITH (NOLOCK) ON r.OReIdOrdenRetiro = k.OReIdOrdenRetiro
JOIN OrdenesDeposito od WITH (NOLOCK) ON od.OReIdOrdenRetiro = k.OReIdOrdenRetiro
LEFT JOIN Ordenes o WITH (NOLOCK) ON LTRIM(RTRIM(o.CodigoOrden)) = LTRIM(RTRIM(od.OrdCodigoOrden))
LEFT JOIN Usuarios uo ON uo.IdUsuario = od.OrdUsuarioAlta
ORDER BY od.OReIdOrdenRetiro, od.OrdCodigoOrden;

/* F5. TODOS los movimientos de cuenta de esas órdenes, INCLUIDOS LOS ANULADOS -------------
   (si hubo cargo y alguien lo anuló, acá aparece) */
SELECT 'F5. MOVIMIENTOS' AS Bloque, od.OrdCodigoOrden, m.MovIdMovimiento, m.MovFecha, m.MovTipo, m.MovImporte,
       cc.CueIdCuenta, cc.MonIdMoneda AS MonedaCuenta, m.MovAnulado, m.DocIdDocumento, m.MovConcepto, m.MovObservaciones
FROM #FRS_Ret k
JOIN OrdenesDeposito od WITH (NOLOCK) ON od.OReIdOrdenRetiro = k.OReIdOrdenRetiro
JOIN CuentasCliente cc WITH (NOLOCK) ON cc.CliIdCliente = od.CliIdCliente
JOIN MovimientosCuenta m WITH (NOLOCK) ON m.CueIdCuenta = cc.CueIdCuenta
WHERE m.OrdIdOrden = od.OrdIdOrden
   OR m.OrdIdOrden IN (SELECT o2.OrdenID FROM Ordenes o2 WITH (NOLOCK) WHERE o2.CodigoOrden = od.OrdCodigoOrden)
   OR m.MovConcepto LIKE '%' + LTRIM(RTRIM(od.OrdCodigoOrden)) + '%'
ORDER BY od.OrdCodigoOrden, m.MovIdMovimiento;

/* F6. Auditoría: menciones del retiro o de sus órdenes ---------------------------------- */
SELECT 'F6. AUDITORIA' AS Bloque, a.FechaHora, u.Nombre AS Usuario, a.Accion, a.Detalles
FROM Auditoria a WITH (NOLOCK)
LEFT JOIN Usuarios u ON u.IdUsuario = a.IdUsuario
WHERE EXISTS (SELECT 1 FROM #FRS_Ret k JOIN OrdenesRetiro r WITH (NOLOCK) ON r.OReIdOrdenRetiro = k.OReIdOrdenRetiro
              WHERE a.Detalles LIKE '%' + ISNULL(r.FormaRetiro, 'R') + '-' + CAST(r.OReIdOrdenRetiro AS VARCHAR(20)) + '%')
   OR EXISTS (SELECT 1 FROM #FRS_Ret k JOIN OrdenesDeposito od WITH (NOLOCK) ON od.OReIdOrdenRetiro = k.OReIdOrdenRetiro
              WHERE a.Detalles LIKE '%' + LTRIM(RTRIM(od.OrdCodigoOrden)) + '%')
ORDER BY a.FechaHora;

/* F7. Cómo paga normalmente ese cliente: sus otros retiros ------------------------------ */
SELECT 'F7. OTROS RETIROS DEL CLIENTE' AS Bloque, LTRIM(RTRIM(c.Nombre)) AS Cliente, tc.TClDescripcion AS TipoClienteHoy,
       COUNT(*) AS Retiros,
       SUM(CASE WHEN r2.PagIdPago > 0 THEN 1 ELSE 0 END) AS ConPago,
       SUM(CASE WHEN r2.PagIdPago = 0 THEN 1 ELSE 0 END) AS CubiertoSinPago,
       SUM(CASE WHEN r2.PagIdPago IS NULL THEN 1 ELSE 0 END) AS SinPago,
       SUM(CASE WHEN au.OReIdOrdenRetiro IS NOT NULL THEN 1 ELSE 0 END) AS PasaronPorAutorizado,
       MIN(r2.OReFechaAlta) AS Primero, MAX(r2.OReFechaAlta) AS Ultimo
FROM (SELECT DISTINCT r.CodCliente FROM #FRS_Ret k JOIN OrdenesRetiro r WITH (NOLOCK) ON r.OReIdOrdenRetiro = k.OReIdOrdenRetiro) x
JOIN Clientes c WITH (NOLOCK) ON c.CodCliente = x.CodCliente
LEFT JOIN TiposClientes tc ON tc.TClIdTipoCliente = c.TClIdTipoCliente
JOIN OrdenesRetiro r2 WITH (NOLOCK) ON r2.CodCliente = x.CodCliente AND r2.OReEstadoActual <> 6
LEFT JOIN (SELECT DISTINCT OReIdOrdenRetiro FROM HistoricoEstadosOrdenesRetiro WITH (NOLOCK) WHERE EORIdEstadoOrden = 9) au
       ON au.OReIdOrdenRetiro = r2.OReIdOrdenRetiro
GROUP BY c.Nombre, tc.TClDescripcion;

/* F8. Ciclos de crédito del cliente (un Común con ciclo abierto retira "a crédito") -------- */
SELECT 'F8. CICLOS CREDITO' AS Bloque, LTRIM(RTRIM(c.Nombre)) AS Cliente, ci.CicIdCiclo, ci.CueIdCuenta, ci.CicEstado,
       ci.CicFechaInicio, ci.CicFechaCierre, ci.CicDiasAprobados, ci.CicTotalOrdenes, ci.CicTotalPagos,
       ua.Nombre AS AbrioCiclo, ci.CicObservaciones
FROM (SELECT DISTINCT r.CodCliente FROM #FRS_Ret k JOIN OrdenesRetiro r WITH (NOLOCK) ON r.OReIdOrdenRetiro = k.OReIdOrdenRetiro) x
JOIN Clientes c WITH (NOLOCK) ON c.CodCliente = x.CodCliente
JOIN CiclosCredito ci WITH (NOLOCK) ON ci.CliIdCliente = c.CliIdCliente
LEFT JOIN Usuarios ua ON ua.IdUsuario = ci.CicUsuarioApertura
ORDER BY c.Nombre, ci.CicIdCiclo;

/* F9. Movimientos de la cuenta del cliente alrededor de cada retiro (−15 / +15 días),
       incluidos anulados: ¿se cobró por otro lado (venta contado, e-ticket, pago suelto)? -- */
SELECT 'F9. MOVIMIENTOS CLIENTE' AS Bloque, ISNULL(r.FormaRetiro, 'R') + '-' + CAST(r.OReIdOrdenRetiro AS VARCHAR(20)) AS Retiro,
       LTRIM(RTRIM(c.Nombre)) AS Cliente, m.MovIdMovimiento, m.MovFecha, m.CueIdCuenta, m.MovTipo, m.MovImporte,
       m.MovAnulado, m.MovIdAnula, um.Nombre AS UsuarioMov, m.CicIdCiclo,
       d.DocTipo, d.DocSerie, d.DocNumero, d.DocEstado, d.DocPagado, m.MovConcepto, m.MovObservaciones
FROM #FRS_Ret k
JOIN OrdenesRetiro r WITH (NOLOCK) ON r.OReIdOrdenRetiro = k.OReIdOrdenRetiro
JOIN Clientes c WITH (NOLOCK) ON c.CodCliente = r.CodCliente
JOIN CuentasCliente cc WITH (NOLOCK) ON cc.CliIdCliente = c.CliIdCliente
JOIN MovimientosCuenta m WITH (NOLOCK) ON m.CueIdCuenta = cc.CueIdCuenta
     AND m.MovFecha BETWEEN DATEADD(DAY, -15, r.OReFechaAlta) AND DATEADD(DAY, 15, r.OReFechaAlta)
LEFT JOIN DocumentosContables d WITH (NOLOCK) ON d.DocIdDocumento = m.DocIdDocumento
LEFT JOIN Usuarios um ON um.IdUsuario = m.MovUsuarioAlta
ORDER BY r.OReIdOrdenRetiro, m.MovIdMovimiento;
