/* ═══════════════════════════════════════════════════════════════════════════
   CRUCE DE SALDOS ESPEJO — a favor en una moneda aplicado a la deuda de la otra
   27-jul-2026
   ───────────────────────────────────────────────────────────────────────────
   QUÉ ARREGLA
     Clientes con saldo A FAVOR en una moneda y DEUDA en la otra al mismo
     tiempo. En la gran mayoría el "a favor" es residuo técnico: pagos de
     documentos en pesos que quedaron registrados en la cuenta USD (o
     viceversa). El cliente YA pagó — la plata está en la billetera equivocada.
   QUÉ HACE (por cliente, calculado EN VIVO al correr):
     1) Par de movimientos PAGO_CRUZADO estándar: consume el a favor en su
        cuenta y lo aplica en la cuenta deudora, a la cotización vigente.
     2) Imputa el monto cruzado a las deudas vivas de esa cuenta (más viejas
        primero); las que llegan a 0 quedan COBRADO.
   EXCLUYE (a propósito): CAPA (CliId 854, reconciliación completa pendiente),
     Yesusport (bajo investigación desfasaje 75.440), Ventas local USER (interno).
   VALIDADO EN LOCAL: 20 clientes cruzados (US$ ~2.240 + $ ~13.279 aplicados);
     quedaron solo los 3 excluidos + migas de centavos por redondeo.
   Correr DESPUÉS de repara_casos_27jul_tanda2.sql.
   ═══════════════════════════════════════════════════════════════════════════ */

SET NOCOUNT ON;

DECLARE @Cot DECIMAL(18,4);
SELECT TOP 1 @Cot = CotDolar FROM dbo.Cotizaciones ORDER BY CotFecha DESC;
PRINT CONCAT('Cotizacion: ', @Cot);

/* ── PASO 0 — Foto de los casos (solo lectura) ─────────────────────────── */
IF OBJECT_ID('tempdb..#espejo') IS NOT NULL DROP TABLE #espejo;
;WITH billeteras AS (
  SELECT cc.CliIdCliente, cc.CueIdCuenta, cc.MonIdMoneda, SUM(m.MovImporte) AS Saldo
  FROM dbo.CuentasCliente cc
  JOIN dbo.MovimientosCuenta m ON m.CueIdCuenta = cc.CueIdCuenta
       AND (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
  WHERE cc.ProIdProducto IS NULL AND cc.CueTipo IN ('DINERO_USD','DINERO_UYU')
  GROUP BY cc.CliIdCliente, cc.CueIdCuenta, cc.MonIdMoneda
)
SELECT LTRIM(RTRIM(cli.Nombre)) AS Cliente, fav.CliIdCliente,
       fav.MonIdMoneda AS MonFavor,
       CAST(fav.Saldo AS DECIMAL(18,4)) AS Favor,
       CAST(deu.Saldo AS DECIMAL(18,4)) AS Deuda,
       fav.CueIdCuenta AS CtaFavor, deu.CueIdCuenta AS CtaDeuda
INTO   #espejo
FROM   billeteras fav
JOIN   billeteras deu ON deu.CliIdCliente = fav.CliIdCliente AND deu.MonIdMoneda <> fav.MonIdMoneda
JOIN   dbo.Clientes cli ON cli.CliIdCliente = fav.CliIdCliente
WHERE  fav.Saldo > 0.05 AND deu.Saldo < -0.05
  AND  fav.CliIdCliente NOT IN (854)                                   -- CAPA
  AND  LTRIM(RTRIM(cli.Nombre)) NOT IN ('Yesusport', 'Ventas local USER');

SELECT * FROM #espejo ORDER BY Cliente;   -- mirar antes de seguir (~20 en local)

BEGIN TRANSACTION;

/* ── PASO 1 — Cruce por cliente ────────────────────────────────────────── */
DECLARE @Cliente VARCHAR(120), @CliId INT, @MonFavor INT, @Favor DECIMAL(18,4),
        @Deuda DECIMAL(18,4), @CtaFavor INT, @CtaDeuda INT,
        @X DECIMAL(18,2), @Consumo DECIMAL(18,2), @FavConv DECIMAL(18,4),
        @Mov INT, @Sal DECIMAL(18,4), @Resta DECIMAL(18,2), @N INT = 0,
        @DdeId INT, @Pend DECIMAL(18,4), @Aplica DECIMAL(18,2),
        @ConcA NVARCHAR(500), @ConcB NVARCHAR(500), @Obs NVARCHAR(500);

DECLARE curE CURSOR LOCAL FAST_FORWARD FOR
  SELECT Cliente, CliIdCliente, MonFavor, Favor, Deuda, CtaFavor, CtaDeuda FROM #espejo;
OPEN curE;
FETCH NEXT FROM curE INTO @Cliente, @CliId, @MonFavor, @Favor, @Deuda, @CtaFavor, @CtaDeuda;
WHILE @@FETCH_STATUS = 0
BEGIN
  SET @FavConv = CASE WHEN @MonFavor = 2 THEN @Favor * @Cot ELSE @Favor / @Cot END;
  SET @X = ROUND(CASE WHEN @FavConv < -@Deuda THEN @FavConv ELSE -@Deuda END, 2);
  IF @X >= 0.05
  BEGIN
    SET @Consumo = ROUND(CASE WHEN @MonFavor = 2 THEN @X / @Cot ELSE @X * @Cot END, 2);
    IF @Consumo > @Favor SET @Consumo = ROUND(@Favor, 2);
    SET @Obs = CONCAT('Cruce de saldos espejo (residuo de pagos registrados en la otra moneda) @ cot ', @Cot, '. repara_cruce_saldos_espejo.sql 27-jul-2026');
    SET @ConcA = CONCAT('Cruce saldo a favor -> cubre deuda ', CASE WHEN @MonFavor = 2 THEN '$' ELSE 'US$' END, ' ', @X);
    SET @ConcB = CONCAT('Cobertura desde ', CASE WHEN @MonFavor = 2 THEN 'DINERO_USD' ELSE 'DINERO_UYU' END, ' (cruce de saldo a favor ', CASE WHEN @MonFavor = 2 THEN 'US$' ELSE '$' END, ' ', @Consumo, ')');

    DECLARE @ConsumoNeg DECIMAL(18,2) = -@Consumo;
    EXEC dbo.SP_RegistrarMovimiento @CueIdCuenta=@CtaFavor, @MovTipo='PAGO_CRUZADO', @MovConcepto=@ConcA,
         @MovImporte=@ConsumoNeg, @MovUsuarioAlta=1, @MovObservaciones=@Obs, @MovIdGenerado=@Mov OUTPUT, @SaldoResultante=@Sal OUTPUT;

    EXEC dbo.SP_RegistrarMovimiento @CueIdCuenta=@CtaDeuda, @MovTipo='PAGO_CRUZADO', @MovConcepto=@ConcB,
         @MovImporte=@X, @MovUsuarioAlta=1, @MovObservaciones=@Obs, @MovIdGenerado=@Mov OUTPUT, @SaldoResultante=@Sal OUTPUT;

    -- Imputar a deudas vivas de la cuenta deudora, más viejas primero
    SET @Resta = @X;
    DECLARE curD CURSOR LOCAL FAST_FORWARD FOR
      SELECT DDeIdDocumento, DDeImportePendiente FROM dbo.DeudaDocumento
      WHERE CueIdCuenta = @CtaDeuda AND DDeEstado IN ('PENDIENTE','PARCIAL','VENCIDO')
      ORDER BY DDeFechaEmision, DDeIdDocumento;
    OPEN curD; FETCH NEXT FROM curD INTO @DdeId, @Pend;
    WHILE @@FETCH_STATUS = 0 AND @Resta >= 0.01
    BEGIN
      SET @Aplica = ROUND(CASE WHEN @Resta < @Pend THEN @Resta ELSE @Pend END, 2);
      UPDATE dbo.DeudaDocumento
      SET DDeImportePendiente = CASE WHEN DDeImportePendiente - @Aplica < 0.01 THEN 0 ELSE DDeImportePendiente - @Aplica END,
          DDeEstado = CASE WHEN DDeImportePendiente - @Aplica < 0.01 THEN 'COBRADO' ELSE DDeEstado END,
          DDeFechaCobro = CASE WHEN DDeImportePendiente - @Aplica < 0.01 THEN GETDATE() ELSE DDeFechaCobro END,
          DDeObservaciones = LEFT(ISNULL(DDeObservaciones,'') + ' | Aplicados ' + CAST(@Aplica AS VARCHAR(20)) + ' por cruce de saldo espejo. repara_cruce_saldos_espejo.sql', 500)
      WHERE DDeIdDocumento = @DdeId;
      SET @Resta = ROUND(@Resta - @Aplica, 2);
      FETCH NEXT FROM curD INTO @DdeId, @Pend;
    END
    CLOSE curD; DEALLOCATE curD;
    SET @N += 1;
    PRINT CONCAT('Cruzado: ', @Cliente, ' — aplicado ', @X, ' (consumio ', @Consumo, ' del a favor)');
  END
  FETCH NEXT FROM curE INTO @Cliente, @CliId, @MonFavor, @Favor, @Deuda, @CtaFavor, @CtaDeuda;
END
CLOSE curE; DEALLOCATE curE;
PRINT CONCAT('Clientes cruzados: ', @N);   -- local: 20

/* ── PASO 1b — CR SPORT (doc 2091, PC-1361): residuo de una fix_deudas_duplicadas
   ANTERIOR (previa a hoy) que ajustó el importe original del documento pero
   NUNCA restó los 2 pagos reales que ya existían en ese momento (277,40 y
   160,07 de jun-2026). Gap fijo = 437,4754 pagado − 224,1354 que sí se
   restó en su momento = 213,34. Es un monto HISTÓRICO constante — no
   depende de lo que el PASO 1 de este script cruce hoy para este cliente
   (los cruces se imputan por CueIdCuenta, no quedan linkeados por
   DocIdDocumento, por eso no se puede recalcular sumando pagos del doc). */
UPDATE dbo.DeudaDocumento
SET    DDeImportePendiente = DDeImportePendiente - 213.34,
       DDeObservaciones = LEFT(ISNULL(DDeObservaciones,'') + ' | Pendiente realineado -213,34: 2 pagos reales de jun-2026 (277,40+160,07) que una fix_deudas_duplicadas anterior nunca habia restado del todo. repara_cruce_saldos_espejo.sql', 500)
WHERE  DDeIdDocumento = 3409
  -- Guard NUMÉRICO (no por texto): el estado sin corregir ronda 2.76-2.98
  -- según lo que haya cruzado el PASO 1 de arriba para este cliente en esta
  -- corrida puntual; el estado ya corregido queda por debajo de 2.600.
  -- Así es seguro re-correr el script en un entorno que ya tenga el fix
  -- aplicado (no vuelve a restar) sin depender del texto exacto usado antes.
  AND    DDeImportePendiente > 2600;
PRINT CONCAT('CR SPORT PC-1361 realineado: ', @@ROWCOUNT);   -- 1 en prod (primera vez) · 0 si ya estaba corregido

/* ── PASO 2 — Verificación: espejos restantes = 3 (CAPA, Yesusport,
      Ventas local USER) + eventuales migas de centavos ───────────────────── */
;WITH billeteras AS (
  SELECT cc.CliIdCliente, cc.MonIdMoneda, SUM(m.MovImporte) AS Saldo
  FROM dbo.CuentasCliente cc
  JOIN dbo.MovimientosCuenta m ON m.CueIdCuenta = cc.CueIdCuenta
       AND (m.MovAnulado IS NULL OR m.MovAnulado = 0) AND m.MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
  WHERE cc.ProIdProducto IS NULL AND cc.CueTipo IN ('DINERO_USD','DINERO_UYU')
  GROUP BY cc.CliIdCliente, cc.CueIdCuenta, cc.MonIdMoneda
)
SELECT LEFT(LTRIM(RTRIM(cli.Nombre)),30) AS Cliente,
       CAST(fav.Saldo AS DECIMAL(18,2)) AS Favor, CAST(deu.Saldo AS DECIMAL(18,2)) AS Deuda
FROM billeteras fav
JOIN billeteras deu ON deu.CliIdCliente = fav.CliIdCliente AND deu.MonIdMoneda <> fav.MonIdMoneda
JOIN dbo.Clientes cli ON cli.CliIdCliente = fav.CliIdCliente
WHERE fav.Saldo > 0.05 AND deu.Saldo < -0.05
ORDER BY Cliente;

/* Si la lista final son los 3 excluidos (+ centavos) → COMMIT TRANSACTION;
   Si no → ROLLBACK TRANSACTION; y avisar. */
