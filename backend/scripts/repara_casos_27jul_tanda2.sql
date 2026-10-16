/* ═══════════════════════════════════════════════════════════════════════════
   REPARACIÓN TANDA 2 — casos puntuales 27-jul-2026 (post-lotes)
   Odysseus · Carolina Naser · Marisa Perez · Mariana Valiante · 5 dobles cobros
   ───────────────────────────────────────────────────────────────────────────
   TODO VALIDADO EN LOCAL. Resultados esperados en PASO FINAL:
     Odysseus: USD 0,00 / UYU -896,01 (= su única deuda real, ET-1554)
     Carolina Naser: USD -54,48 (= FA-301 pendiente real)
     Marisa Perez: USD 0,00 · Mariana Valiante: USD 0,00
     Awoyó UYU 0,00 · JTS UYU 0,00 · Rodrigofalero UYU 0,00 · Támara UYU 0,00
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;
BEGIN TRANSACTION;

/* 1 ── Carolina Naser (FA-301, doc 5503): la DEUDA nació inflada (72,64) pero
       el documento y su cargo son 54,48. Se alinea la deuda al documento. */
UPDATE dbo.DeudaDocumento SET DDeImporteOriginal = 54.48, DDeImportePendiente = 54.48,
  DDeObservaciones = LEFT(ISNULL(DDeObservaciones,'') + ' | Importe corregido 72,64->54,48 (= DocTotal de FA-301; deuda nacio inflada). repara_casos_27jul_tanda2.sql', 500)
WHERE DDeIdDocumento = 8033 AND ABS(DDeImportePendiente - 72.64) < 0.01;
PRINT CONCAT('1 Carolina deuda: ', @@ROWCOUNT);          -- esperado 1

/* 2 ── Odysseus (ET-1554, doc 3492): deuda inflada 1.874,80 vs doc 896,01. */
UPDATE dbo.DeudaDocumento SET DDeImporteOriginal = 896.01, DDeImportePendiente = 896.01,
  DDeObservaciones = LEFT(ISNULL(DDeObservaciones,'') + ' | Importe corregido 1.874,80->896,01 (= DocTotal de ET-1554; deuda nacio inflada). repara_casos_27jul_tanda2.sql', 500)
WHERE DDeIdDocumento = 5556 AND ABS(DDeImportePendiente - 1874.80) < 0.01;
PRINT CONCAT('2 Odysseus deuda: ', @@ROWCOUNT);          -- esperado 1

/* 3 ── Odysseus (PC-2508, doc 4921): cargo en la cuenta USD (111) con su pago
       en la UYU (1617) — patrón Raul Rivero. Se migra el cargo con su pago. */
UPDATE dbo.MovimientosCuenta SET CueIdCuenta = 1617,
  MovObservaciones = LEFT(ISNULL(MovObservaciones,'') + ' | Migrado de cuenta 111 (USD) a 1617 (UYU): cargo del PC-2508 (doc en pesos) varado en la cuenta USD; su pago ya estaba en UYU. repara_casos_27jul_tanda2.sql', 500)
WHERE MovIdMovimiento = 22027 AND CueIdCuenta = 111;
PRINT CONCAT('3 Odysseus cargo migrado: ', @@ROWCOUNT);  -- esperado 1

/* 4 ── Marisa Perez (PC-738, doc 1137): su pago real (mov 4995, +336,01) estaba
       estampado al PC-849 (doc 1298) y la ANULACIÓN de ese doc se lo llevó.
       Se revive y se vincula a su documento real. */
UPDATE dbo.MovimientosCuenta SET MovAnulado = 0, DocIdDocumento = 1137,
  MovObservaciones = LEFT(ISNULL(MovObservaciones,'') + ' | REVIVIDO y re-vinculado a PC-738 (doc 1137): este pago era del PC-738 pero estaba estampado al doc 1298 y la anulacion de ese doc se lo llevo por error. repara_casos_27jul_tanda2.sql', 500)
WHERE MovIdMovimiento = 4995 AND MovAnulado = 1;
PRINT CONCAT('4 Marisa pago revivido: ', @@ROWCOUNT);    -- esperado 1

/* 5 ── Mariana Valiante (ET-1723, doc 3643): DOS pagos de 810 para un cobro
       real único (15:51 y 17:20 del mismo día). Se anula el segundo. */
UPDATE dbo.MovimientosCuenta SET MovAnulado = 1,
  MovObservaciones = LEFT(ISNULL(MovObservaciones,'') + ' | ANULADO: cobro duplicado del ET-1723 (el pago real es el mov 17038, mismo dia 15:51; este se registro de nuevo 17:20). repara_casos_27jul_tanda2.sql', 500)
WHERE MovIdMovimiento = 17211 AND (MovAnulado IS NULL OR MovAnulado = 0);
PRINT CONCAT('5 Mariana doble anulado: ', @@ROWCOUNT);   -- esperado 1

/* 6 ── DOBLES COBROS confirmados (pagos = 2x total del doc, con UNA sola plata
       real en caja): se anula el SEGUNDO pago de cada par.
       19348 ET-2149 JTS · 20091 ET-2880 Awoyó · 21030 PC-2404 Rodrigofalero
       23394 PC-2442 Támara · 19832 ET-2152 vym */
UPDATE dbo.MovimientosCuenta SET MovAnulado = 1,
  MovObservaciones = LEFT(ISNULL(MovObservaciones,'') + ' | ANULADO: cobro DUPLICADO del mismo documento (la plata real de caja entro UNA vez; este mov es la segunda insercion). repara_casos_27jul_tanda2.sql', 500)
WHERE MovIdMovimiento IN (19348, 20091, 21030, 23394, 19832)
  AND (MovAnulado IS NULL OR MovAnulado = 0);
PRINT CONCAT('6 Dobles pagos anulados: ', @@ROWCOUNT);   -- esperado 5

/* 7 ── CARGOS duplicados de esos mismos docs (JTS y Awoyó tenían el bloque
       contable ENTERO insertado dos veces): se anula el segundo cargo. */
UPDATE dbo.MovimientosCuenta SET MovAnulado = 1,
  MovObservaciones = LEFT(ISNULL(MovObservaciones,'') + ' | ANULADO: CARGO duplicado del mismo documento (el bloque contable se inserto dos veces). repara_casos_27jul_tanda2.sql', 500)
WHERE MovIdMovimiento IN (19346, 20089)
  AND (MovAnulado IS NULL OR MovAnulado = 0);
PRINT CONCAT('7 Dobles cargos anulados: ', @@ROWCOUNT);  -- esperado 2

/* 8 ── Atan indumentarias (PC-2143 / RT-18868, doc 4324): cobro contado real
       del 16-jul (Pago #53407, Tca 4180 del propio doc, mismo minuto que el
       cargo 19770) sin movimiento en cuenta. Se repone. Era el "pago huérfano"
       que la verificación independiente dejó para confirmar: evidencia cerrada. */
IF EXISTS (SELECT 1 FROM dbo.MovimientosCuenta WHERE PagIdPago = 53407)
    PRINT '8 Atan: el movimiento del pago #53407 ya existe, no se hace nada.';
ELSE
BEGIN
    DECLARE @MovAtan INT, @SalAtan DECIMAL(18,4), @CtaAtan INT;
    SELECT @CtaAtan = cc.CueIdCuenta FROM dbo.CuentasCliente cc
    JOIN dbo.Clientes c ON c.CliIdCliente = cc.CliIdCliente
    WHERE LTRIM(RTRIM(c.IDCliente)) = 'Atan-2023' AND cc.CueTipo = 'DINERO_USD';

    EXEC dbo.SP_RegistrarMovimiento
        @CueIdCuenta = @CtaAtan, @MovTipo = 'PAGO',
        @MovConcepto = N'Pago (Pedidos Caja): PC-2143 / RT-18868 (repuesto: el cobro contado del 16-jul no había escrito el movimiento)',
        @MovImporte = 287.79, @MovUsuarioAlta = 1,
        @PagIdPago = 53407, @DocIdDocumento = 4324,
        @MovObservaciones = N'Pago #53407 (Tca 4180 del propio doc, mismo minuto que el cargo 19770). repara_casos_27jul_tanda2.sql',
        @MovFecha = '2026-07-16T14:36:00',
        @MovIdGenerado = @MovAtan OUTPUT, @SaldoResultante = @SalAtan OUTPUT;
    PRINT CONCAT('8 Atan pago repuesto, MovId=', @MovAtan);
END

/* 9 ── Atan (PC-2420, doc 4769): deuda DUPLICADA e inflada. La fila real
       (#7183, 1.629,92) está COBRADA por el mov 21827; la duplicada #7177
       quedó VENCIDA con 2.016,41 (importe que ni coincide con el doc). */
UPDATE dbo.DeudaDocumento SET DDeEstado = 'COBRADO', DDeImportePendiente = 0, DDeFechaCobro = '2026-07-21T17:10:00',
  DDeObservaciones = LEFT(ISNULL(DDeObservaciones,'') + ' | Cerrada: el PC-2420 ya esta pagado entero (mov 21827 del 21-jul, fila real #7183 COBRADO); esta fila duplicada quedo viva con importe inflado (2.016,41 vs doc 1.629,92). repara_casos_27jul_tanda2.sql', 500)
WHERE DDeIdDocumento = 7177 AND DDeEstado = 'VENCIDO' AND ABS(DDeImportePendiente - 2016.41) < 0.01;
PRINT CONCAT('9 Atan deuda duplicada cerrada: ', @@ROWCOUNT);  -- esperado 1
/* Verificación Atan: billetera USD = 0,00 y 0 deudas vivas */

/* 10 ── Martina Berriel (PC-1165, doc 1815, $8.800): el cargo del cierre quedó
        en la cuenta USD (507) como -279,90 (las órdenes USD del ciclo, sin
        convertir); su pago real de +8.800 ya estaba en la UYU (1121, Pago
        #50537 de la Tca 1781). Se convierte y migra el cargo. */
UPDATE dbo.MovimientosCuenta SET CueIdCuenta = 1121, MovImporte = -8800,
  MovObservaciones = LEFT(ISNULL(MovObservaciones,'') + ' | Cargo del PC-1165 (doc en pesos, $8.800) que habia quedado en la cuenta USD como -279,90 (ordenes del ciclo sin convertir); su pago +8.800 ya estaba en UYU. Convertido y migrado. repara_casos_27jul_tanda2.sql', 500)
WHERE MovIdMovimiento = 8306 AND CueIdCuenta = 507 AND ABS(MovImporte + 279.90) < 0.01;
PRINT CONCAT('10 Martina cargo PC-1165 convertido: ', @@ROWCOUNT);  -- esperado 1

/* 11 ── Martina Berriel (A-2, doc 816): E-Ticket "contado" USD 2.680,50 con
        deuda VIVA y sin ningún cobro (ni Tca ni Pagos). El doc figuraba
        DocPagado=1 (el cierre marcaba pagado a todo lo que dijera CAJA/CONTADO)
        contradiciendo su propia deuda. Se sincera: NO está pagado. */
UPDATE dbo.DocumentosContables SET DocPagado = 0
WHERE DocIdDocumento = 816 AND DocPagado = 1;
PRINT CONCAT('11 Martina A-2 DocPagado=0: ', @@ROWCOUNT);           -- esperado 1
/* Verificación Martina: USD -2.680,50 (= pendiente USD) · UYU -81.598,43
   (la diferencia restante con el pendiente $ es TODA del PC-1570: cargo
   60.319,02 vs deuda 2.024,40 — DECISIÓN DE NEGOCIO pendiente, no tocar acá) */

/* 12-18 ── "LA FACTURA MANDA": deudas vivas alineadas a su documento
   (deuda = DocTotal − cobros registrados; con cobertura de plan respetada).
   NO toca: CAPA PC-1387 (cobertura por plan legítima, reconciliación aparte)
   ni Yesusport PC-2461 (atado a la decisión del cobro del PC-525). */

-- 12: Rodrigofalero PC-2404 — deuda 11.224,94 sin relación con el doc (1,65 YA PAGADO)
UPDATE dbo.DeudaDocumento SET DDeEstado='CANCELADO', DDeImportePendiente=0, DDeObservaciones=LEFT(ISNULL(DDeObservaciones,'')+' | CANCELADO: importe 11.224,94 sin relacion con el doc (PC-2404 = 1,65 contado YA PAGADO). La factura manda. repara_casos_27jul_tanda2.sql',500)
WHERE DDeIdDocumento=7135 AND DDeEstado='VENCIDO' AND ABS(DDeImportePendiente-11224.94)<0.01;
PRINT CONCAT('12 PC-2404: ', @@ROWCOUNT);   -- 1

-- 13: CAPA PC-2327 — dos filas vivas; se cancela la del importe pre-descuento (29.352), queda la alineada (28.247,60)
UPDATE dbo.DeudaDocumento SET DDeEstado='CANCELADO', DDeImportePendiente=0, DDeObservaciones=LEFT(ISNULL(DDeObservaciones,'')+' | CANCELADO por duplicado: queda viva la #7042 (28.247,60 = DocTotal tras el descuento); esta fila conservaba el importe pre-descuento 29.352. repara_casos_27jul_tanda2.sql',500)
WHERE DDeIdDocumento=7041 AND DDeEstado='VENCIDO' AND ABS(DDeImportePendiente-29352)<0.01;
PRINT CONCAT('13 PC-2327 dup: ', @@ROWCOUNT);   -- 1

-- 14: Martina Berriel PC-1570 — doc $60.319,02 sin NINGÚN cobro registrado; deuda decía 2.024,40
--     (si administración confirma cobro externo, se registra ese cobro y la deuda baja)
UPDATE dbo.DeudaDocumento SET DDeImporteOriginal=60319.02, DDeImportePendiente=60319.02, DDeObservaciones=LEFT(ISNULL(DDeObservaciones,'')+' | Alineada a la factura: doc \$60.319,02 sin NINGUN cobro registrado (deuda nacia en 2.024,40 sin respaldo). Si administracion confirma cobro externo, registrarlo y bajara. repara_casos_27jul_tanda2.sql',500)
WHERE DDeIdDocumento=3984 AND ABS(DDeImportePendiente-2024.40)<0.01;
PRINT CONCAT('14 PC-1570: ', @@ROWCOUNT);   -- 1

-- 15: Nicolas Rodriguez PC-1891 — base inflada 1.561,86 → doc 1.350,37 preservando lo imputado (pendiente 190,03)
UPDATE dbo.DeudaDocumento SET DDeImporteOriginal=1350.37, DDeImportePendiente=190.03, DDeObservaciones=LEFT(ISNULL(DDeObservaciones,'')+' | Alineada a la factura: doc 1.350,37; se preserva lo imputado (1.160,34 de anticipo RA-17) -> pendiente 190,03 (antes 401,52 sobre base inflada 1.561,86). repara_casos_27jul_tanda2.sql',500)
WHERE DDeIdDocumento=4755 AND ABS(DDeImportePendiente-401.52)<0.01;
PRINT CONCAT('15 PC-1891: ', @@ROWCOUNT);   -- 1

-- 16: Matías Siri PC-1983 — deuda 1.224 sin respaldo → doc 1.705,98
UPDATE dbo.DeudaDocumento SET DDeImporteOriginal=1705.98, DDeImportePendiente=1705.98, DDeObservaciones=LEFT(ISNULL(DDeObservaciones,'')+' | Alineada a la factura: doc 1.705,98, sin cobros registrados ni cobertura de plan en este doc (deuda decia 1.224 sin respaldo). repara_casos_27jul_tanda2.sql',500)
WHERE DDeIdDocumento=5443 AND ABS(DDeImportePendiente-1224)<0.01;
PRINT CONCAT('16 PC-1983: ', @@ROWCOUNT);   -- 1

-- 17: Matías Siri ET-1498 — deuda 11.155,68 era el costo PRE-cobertura de plan (18 órdenes cubiertas) → doc 2.075
UPDATE dbo.DeudaDocumento SET DDeImporteOriginal=2075, DDeImportePendiente=2075, DDeObservaciones=LEFT(ISNULL(DDeObservaciones,'')+' | Alineada a la factura: doc 2.075 (18 ordenes cubiertas por plan explican el resto); la deuda 11.155,68 era el costo PRE-cobertura. repara_casos_27jul_tanda2.sql',500)
WHERE DDeIdDocumento=5442 AND ABS(DDeImportePendiente-11155.68)<0.01;
PRINT CONCAT('17 ET-1498: ', @@ROWCOUNT);   -- 1

-- 18: Támara PC-1137 — base inflada 7.253,05 → doc 5.241,96 preservando la imputación de 750 (a validar) → pendiente 4.491,96
UPDATE dbo.DeudaDocumento SET DDeImporteOriginal=5241.96, DDeImportePendiente=4491.96, DDeObservaciones=LEFT(ISNULL(DDeObservaciones,'')+' | Alineada a la factura: doc 5.241,96; se preserva la imputacion de 750 (a validar por administracion) -> pendiente 4.491,96 (antes 6.503,05 sobre base inflada 7.253,05). repara_casos_27jul_tanda2.sql',500)
WHERE DDeIdDocumento=2890 AND ABS(DDeImportePendiente-6503.05)<0.01;
PRINT CONCAT('18 PC-1137: ', @@ROWCOUNT);   -- 1

/* Verificación 12-18: el barrido de deudas vivas desalineadas debe quedar en 2
   (CAPA PC-1387 y Yesusport PC-2461, diferidas a propósito):
   SELECT COUNT(*) FROM DeudaDocumento d JOIN DocumentosContables dc ON dc.DocIdDocumento=d.DocIdDocumento
   WHERE d.DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO') AND dc.DocEstado<>'ANULADO'
     AND ABS(d.DDeImporteOriginal - dc.DocTotal) > 0.05  */

/* ── PASO FINAL — Verificación (comparar con los esperados del encabezado) ── */
SELECT LEFT(LTRIM(RTRIM(cli.Nombre)),22) AS Cliente, cc.CueTipo,
       CAST(ISNULL(SUM(CASE WHEN m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
                             AND (m.MovAnulado IS NULL OR m.MovAnulado = 0)
                            THEN m.MovImporte END),0) AS DECIMAL(18,2)) AS Billetera
FROM dbo.CuentasCliente cc
JOIN dbo.Clientes cli ON cli.CliIdCliente = cc.CliIdCliente
LEFT JOIN dbo.MovimientosCuenta m ON m.CueIdCuenta = cc.CueIdCuenta
WHERE cc.ProIdProducto IS NULL
  AND cc.CliIdCliente IN (386, 462, 7048, 8611,
        (SELECT CliIdCliente FROM dbo.DocumentosContables WHERE DocIdDocumento = 4428),
        (SELECT CliIdCliente FROM dbo.DocumentosContables WHERE DocIdDocumento = 4200),
        (SELECT CliIdCliente FROM dbo.DocumentosContables WHERE DocIdDocumento = 4739),
        (SELECT CliIdCliente FROM dbo.DocumentosContables WHERE DocIdDocumento = 4814),
        (SELECT CliIdCliente FROM dbo.DocumentosContables WHERE DocIdDocumento = 4074))
GROUP BY cli.Nombre, cc.CueTipo
ORDER BY Cliente, cc.CueTipo;

/* Si calza con los esperados → COMMIT TRANSACTION;   Si no → ROLLBACK TRANSACTION; */
