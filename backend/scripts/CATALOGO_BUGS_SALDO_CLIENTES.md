# Catálogo de bugs de saldo/cuenta corriente — encontrados en Palmero, 20-21/7/2026

> Se investigó a fondo la cuenta de **Palmero** (CliIdCliente 998) por un
> reclamo puntual (un cobro con cheque no se veía reflejado) y se destapó una
> cadena de bugs reales. Este documento cataloga cada uno de forma genérica
> — **con su consulta de detección** — para poder chequear si otros clientes
> tienen el mismo problema, sin tener que redescubrir cada uno desde cero.
>
> Ver también `RESUMEN_SESION_20-07_PALMERO.md` para la cronología completa
> de lo que se hizo específicamente en Palmero.

---

## BUG 1 — Deuda duplicada por documento (ya conocido de antes)

**Síntoma:** un mismo documento tiene 2+ filas en `DeudaDocumento`. Una puede
estar paga y la otra seguir "viva", aceptando pagos reales sin que nadie note
que es un duplicado.

**Detección:**
```sql
SELECT DocIdDocumento, COUNT(*) FROM dbo.DeudaDocumento
WHERE DDeEstado NOT IN ('CANCELADA','ANULADA')
GROUP BY DocIdDocumento HAVING COUNT(*) > 1;
```

**Fix existente:** `fix_deudas_duplicadas_por_documento.sql` (script viejo,
ya en el repo). **OJO:** si la fila duplicada YA recibió pagos reales (no
está vacía), cancelarla a ciegas destruye el registro de un cobro real —
primero hay que mover ese pago a la deuda correcta (ver BUG 4).

**Visto en Palmero:** PC-1982 (moneda $).

---

## BUG 2 — Pago en cuenta de la moneda equivocada (mismo número, sin convertir)

**Síntoma:** el documento es en una moneda, pero el `MovimientosCuenta` del
pago (`MovTipo IN ('PAGO','COBRO')`) quedó en la cuenta de la OTRA moneda,
con el MISMO número (sin aplicar tipo de cambio — matemáticamente imposible
que sea un pago real convertido, el TC de este sistema anda en ~40 UYU/USD).

**Detección:** `diag_crossmoneda_todos_clientes.sql` (ya en el repo, sirve
para TODOS los clientes de una — no hace falta ir cliente por cliente).

**Fix:** `fix_crossmoneda_lote1.sql` (patrón reusable, ver el script).

**Visto en:** Palmero (PC-1451), elea, Martina Berriel, Rdssport, SRL Tienda
Online, Ventas local USER (x2). **7 casos ya corregidos en producción.**

---

## BUG 3 — Cargo faltante en la moneda del documento ("Pago Factura Manual Edicion")

**Síntoma:** un documento se cobra completo (el pago SÍ está, en la moneda
correcta), pero el CARGO (`CIERRE_CICLO`/`VTA_CAJA`) en esa misma moneda
**no existe** — solo queda el cargo viejo en la otra moneda (el valor
original en USD, antes de convertir/ajustar). Esto infla el saldo "a favor"
en la moneda del pago, porque el pago cuenta pero nada lo compensa.

**Causa raíz (confirmada por el usuario):** estos documentos se cargan por
**"Facturación Manual"** (un flujo que edita/registra el pago a mano,
saltándose el proceso normal de cierre de ciclo que genera el cargo
convertido). Es habitual que el precio se ajuste manualmente en el cierre
(descuentos, etc.) y ese ajuste **no se propaga al libro mayor**.

**Detección — dos consultas, usar las dos:**

```sql
-- A) Por firma del flujo (más preciso, encuentra la causa exacta)
SELECT dc.DocIdDocumento, RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero) AS Doc,
       dc.DocTotal, mo.MonSimbolo AS DocMoneda, tc.TcaObservaciones, tc.StuIdSesion,
       CargoMismaMoneda = (SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                            JOIN dbo.CuentasCliente cc2 ON cc2.CueIdCuenta = m.CueIdCuenta
                            WHERE m.DocIdDocumento = dc.DocIdDocumento AND m.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
                              AND cc2.MonIdMoneda = dc.MonIdMoneda AND (m.MovAnulado IS NULL OR m.MovAnulado=0))
FROM dbo.DocumentosContables dc
JOIN dbo.TransaccionesCaja tc ON tc.TcaIdTransaccion = dc.TcaIdTransaccion
JOIN dbo.Monedas mo ON mo.MonIdMoneda = dc.MonIdMoneda
WHERE tc.TcaObservaciones LIKE '%Manual Edicion%';   -- (agregar AND dc.CliIdCliente=@Cli si se quiere por cliente)

-- B) Barrido general por cliente (agarra cualquier causa, no solo "Manual Edicion")
SELECT dc.DocIdDocumento, RTRIM(dc.DocSerie)+'-'+RTRIM(dc.DocNumero) AS Doc,
       dc.DocTotal, mo.MonSimbolo AS DocMoneda,
       CargoMismaMoneda = (SELECT SUM(m.MovImporte) FROM dbo.MovimientosCuenta m
                            JOIN dbo.CuentasCliente cc2 ON cc2.CueIdCuenta = m.CueIdCuenta
                            WHERE m.DocIdDocumento = dc.DocIdDocumento AND m.MovTipo IN ('CIERRE_CICLO','VTA_CAJA')
                              AND cc2.MonIdMoneda = dc.MonIdMoneda AND (m.MovAnulado IS NULL OR m.MovAnulado=0))
FROM dbo.DocumentosContables dc
JOIN dbo.Monedas mo ON mo.MonIdMoneda = dc.MonIdMoneda
WHERE dc.CliIdCliente = @Cli AND dc.DocEstado <> 'ANULADO' AND RTRIM(dc.DocSerie) NOT IN ('RC')
ORDER BY dc.DocIdDocumento;
-- Alerta: cualquier fila con CargoMismaMoneda IS NULL o <> -DocTotal.
```

**Fix (patrón, ver `fix_saldo_palmero_pc1447_pc1451.sql` como plantilla):**
1. Poner en 0 el cargo viejo en la moneda original (queda como marca
   histórica de "convertido", igual que en los documentos bien armados).
2. Insertar el cargo real: `CIERRE_CICLO` en la cuenta de la moneda del
   documento, importe = `-DocTotal` (la factura manda — es el total YA
   ajustado/con descuento).
3. Recalcular `MovSaldoPosterior`/`CueSaldoActual` de las cuentas tocadas.

**Visto en Palmero:** PC-1156 ($271.157,55), PC-1447 ($93.584,55), PC-1451
($12.159,89). **Los 3 corregidos y confirmados** (cada uno individualmente
cierra perfecto: cargo + pago = 0 neto).

**⚠️ Para otros clientes:** correr la consulta A (por firma "Manual Edicion")
es el atajo más rápido — encuentra la causa exacta sin tener que barrer todo.

---

## BUG 4 — Pago aplicado al documento/deuda equivocada

**Síntoma:** un pago real se aplica a la `DeudaDocumento` incorrecta —
generalmente porque hay una deuda duplicada (BUG 1) todavía viva en la
lista, y el sistema/usuario termina imputando el cobro ahí en vez de a la
deuda real. Resultado: el documento que SÍ se cobró sigue mostrando deuda
pendiente, y una deuda fantasma no relacionada baja como si se hubiera
pagado.

**Detección:** cruzar `MovObservaciones` (formato `DeudaDoc #NNNN | Pagado...`)
contra qué documento es realmente cada `DDeIdDocumento` — ver
`diag_reconciliacion_cliente.sql` (Sección 2, columna `PagosViaObs`).

**Fix (patrón, ver `fix_pago_mal_aplicado_pc2220.sql`):** mover el
`MovimientosCuenta` (`DocIdDocumento`) y aplicar el importe a la
`DeudaDocumento` correcta; revertir/cancelar la fantasma.

**Visto en Palmero:** PC-2220 / PC-1982 ($19.583,46 mal aplicado).

---

## BUG 5 — ⚠️ SOSPECHOSO, NO CONFIRMADO — `PAGO_CRUZADO` con anulado asimétrico

**Síntoma:** cuando se anula una factura, el reverso de los movimientos
`PAGO_CRUZADO` (el mecanismo que cubre pedidos en USD con plata de UYU
automáticamente) parece anular solo el lado USD (el crédito recibido) y NO
el lado UYU (la plata que salió para financiarlo). Eso deja plata "gastada"
en UYU sin que su contraparte exista más.

**Detección:**
```sql
;WITH cruzados AS (
    SELECT m.MovIdMovimiento, m.MovFecha, cc.CueTipo, m.MovImporte, m.MovAnulado
    FROM dbo.MovimientosCuenta m JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
    WHERE cc.CliIdCliente = @Cli AND m.MovTipo = 'PAGO_CRUZADO'
)
SELECT a.MovIdMovimiento, a.MovImporte, a.MovFecha
FROM cruzados a
JOIN cruzados b ON b.CueTipo <> a.CueTipo AND ABS(DATEDIFF(SECOND, a.MovFecha, b.MovFecha)) <= 1
WHERE a.CueTipo = 'DINERO_UYU' AND a.MovAnulado = 0 AND b.MovAnulado = 1;
```

**⚠️ IMPORTANTE — este NO se debe arreglar todavía en otros clientes.** En
Palmero se revirtieron (anularon) 12 pares así, dando por hecho que era
"plata que había que devolver". Pero después de arreglar el BUG 3 (que
liberó $105.744 más en UYU), el saldo de Palmero quedó MUCHO más lejos de lo
real (−$118.665 vs −$14.050 esperado) — sospecha fuerte de que la reversión
fue el movimiento equivocado, y de que la relación entre el pedido nombrado
en el `MovConcepto` y el importe del cruce **no es 1 a 1** (el cruce cubre
el déficit acumulado de la cuenta en ese momento, no necesariamente el costo
de ESE pedido puntual — verificado: un pedido de US$61,79 disparó un cruce
de US$87,40, montos distintos).

**Estado: pendiente de investigación con quien programó el mecanismo de
`PAGO_CRUZADO` antes de decidir el fix correcto** (¿revertir totalmente,
parcialmente, o dejar como está?). No replicar este fix en otros clientes
hasta resolverlo.

---

## BUG 6 — (ya documentado antes, memoria `project_ciclo_anticipo_facturacion`)

`CueSaldoActual` (el campo CACHEADO en `CuentasCliente`) no es confiable —
puede tener doble conteo y no reflejar anulados. **La pantalla del Panel 360
y de Cobrar/Registrar Pago NO leen este campo** — recalculan en vivo desde
`MovimientosCuenta` cada vez (`SUM(MovImporte) WHERE MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO')
AND MovAnulado=0`). Por eso "arreglar" el campo cacheado (lo que se intentó
al principio con `fix_saldo_real_palmero.sql`) **no cambia nada visible** —
hay que arreglar los movimientos reales (BUGs 1-5), no el campo cacheado.

---

## BUG 7 — ⚠️ NUEVO (21/7), MUY EXTENDIDO — variante de BUG 2/3 del lado del CARGO

**Síntoma:** igual firma que BUG 2 (mismo número, sin convertir, TC ~40 UYU/USD
es imposible que sea real) pero en el CARGO (`VTA_CAJA`/`CIERRE_CICLO`), no en
el pago. Ej.: factura de $359 (pesos) con su `VTA_CAJA` de **-359 en la cuenta
USD** (no -8,86 que sería convertido). El efecto es el mismo que BUG 3: la
cuenta en la moneda real del documento se queda SIN cargo (o con uno chico
tipo `ORDEN` sin relación 1 a 1), y la cuenta equivocada absorbe un cargo que
no le corresponde. Se descubrió revisando los 5 clientes del lote de BUG 2
(punto pendiente #4) — **el detector de BUG 2 (`diag_crossmoneda_todos_clientes.sql`)
nunca lo vio porque solo mira `MovTipo IN ('PAGO','COBRO')`.**

**Detección:** [`diag_crossmoneda_cargo_todos_clientes.sql`](diag_crossmoneda_cargo_todos_clientes.sql)
(solo lectura, todos los clientes). **OJO:** hace `CROSS APPLY TOP 1` sobre el
primer cargo no-cero en la cuenta equivocada — si un documento tuviera
LEGÍTIMAMENTE dos cargos (uno bien puesto en la moneda correcta y otro chico
en la otra), esta consulta lo marcaría igual como falso positivo. Antes de
tocar cualquiera, verificar caso a caso que NO exista también un cargo
correcto en la cuenta de la moneda del documento (mismo método que la columna
`CargoMismaMoneda` de la consulta B del BUG 3, sumando en vez de tomar 1 solo).

**Magnitud (21/7, réplica local):** de un total de 468 documentos con cargo en
cuenta de moneda distinta a la del documento, **459 tienen el número idéntico
sin convertir** (el patrón de bug, no un cargo parcial legítimo) — **298
clientes distintos afectados**, no solo los 6 del lote de cross-moneda. Suma
de los importes (valor absoluto, mezclando monedas sin convertir — no es un
total en una sola moneda, solo para dimensionar) ≈ $822.256. Esto contesta
directamente el pendiente #3 de `RESUMEN_SESION_20-07_PALMERO.md`
("dimensionar cuántos clientes más tienen estos síntomas").

**Estado (21/7, actualizado): confirmado y corregido en 4 de los 5 clientes
del lote de BUG 2** (el muestreo manual pedido en el punto 1 de abajo — no
son falsos positivos, al menos en estos casos):
- **elea, PC-1906** (US$1.142,28) — corregido. [`fix_saldo_elea_pc1906.sql`](fix_saldo_elea_pc1906.sql).
- **SRL Tienda Online, FA-73** ($7.100) — corregido. [`fix_saldo_srl_fa73.sql`](fix_saldo_srl_fa73.sql).
  Queda sin explicar un residuo de $91,44 en la cuenta USD (`DeudaDocumento`
  sin `DocIdDocumento`, no relacionado con BUG 7 — no tocado).
- **Martina Berriel, PC-1165 y PC-1570** — corregidos. PC-1570 además tenía la
  fila de `DeudaDocumento` mal calculada (ver hallazgo nuevo abajo).
  [`fix_saldo_martina_berriel.sql`](fix_saldo_martina_berriel.sql).
- **Ventas local USER, ET-2061 y ET-2074** — corregidos (2 de los 5 documentos
  de esta cuenta con el patrón; los otros 3 — ET-1980, ET-1982, ET-2137 —
  tienen además un pago chico en USD de origen incierto, no se tocaron).
  [`fix_saldo_ventas_local_user.sql`](fix_saldo_ventas_local_user.sql).
- **Rdssport: NO se encontró un fix limpio** — ver "hallazgos nuevos, sin
  catalogar" más abajo (PC-1971, ET-1330).

Los 3 fixes de arriba (elea, SRL, Martina Berriel) siguen el mismo patrón:
reclasificar el `MovimientosCuenta` a la cuenta correcta (el número ya es
correcto, solo está en la cuenta que no corresponde) — igual que el fix de
BUG 2, pero aplicado al cargo. Cuando el cargo viejo NO tenía el número
completo (caso PC-1165, firma "Manual Edicion", el patrón real de BUG 3) se
usó el fix de BUG 3 en cambio: poner en 0 el cargo viejo e insertar el cargo
real. Todos probados con `ROLLBACK` contra la réplica local antes de
entregarse — **ninguno corrido en producción todavía**, quedan para que el
usuario los revise y corra él mismo.

**Sigue pendiente, sin cambios:** dado que esto se repite en 298 clientes en
total (no solo estos 5), sigue haciendo falta encontrar la causa en el CÓDIGO
antes de decidir si conviene un fix general con migración de datos en vez de
seguir cliente por cliente.

---

## Hallazgo nuevo (21/7), SIN CATALOGAR — DeudaDocumento calculada desde el
## costo de las órdenes (USD) en vez del total de la factura

**Síntoma:** en al menos 2 casos (Martina Berriel PC-1570 y Rdssport
ET-1330), la fila de `DeudaDocumento` de una factura en pesos se generó con
`DDeImporteOriginal` = la SUMA de los `MovImporte` de las líneas `ORDEN` en
USD (el costo interno de las órdenes, antes de aplicar precio/cierre), en vez
del `DocTotal` real de la factura. Efecto: el sistema subestima gravemente
cuánto debe el cliente (en Martina Berriel, rastreaba $2.024,40 quedando
~$58.294,62 de deuda real sin rastrear).

**No se encontró la causa ni un patrón de detección genérico todavía** — se
corrigió a mano en Martina Berriel (dentro de `fix_saldo_martina_berriel.sql`,
junto con el fix de BUG 7 del mismo documento) pero NO en Rdssport (ET-1330 ya
está marcado `COBRADO` con `DDeImportePendiente=0`, no es una deuda viva
activa — solo un desfasaje contable de $118,18 entre lo que dice la deuda
y el `DocTotal` real, bajo impacto, no se tocó).

**Pendiente:** encontrar más casos (no se armó un detector general todavía)
y la causa en el código — mismo sospechoso que BUG 3/7 (algo en el flujo de
cierre de ciclo/facturación usa el monto de las órdenes en vez del total ya
facturado al generar la fila de deuda).

---

## Hallazgos nuevos (21/7) en Rdssport — SIN CATALOGAR, NO TOCADOS

- **PC-1971 (pagado vía MercadoPago):** el cargo (`VTA_CAJA -US$197,65`) está
  en la cuenta UYU en vez de USD (firma de BUG 7), pero a diferencia de los
  demás casos, **no existe ningún `PAGO` en el libro mayor de este cliente
  para este documento** — el `DocEstado='PAGADO'` y la plata entró por
  MercadoPago (gateway externo), pero nunca se generó el movimiento de pago
  en `MovimientosCuenta`. Reclasificar el cargo NO alcanza para que cierre
  (no hay nada que lo compense). Esto huele a un problema distinto, en la
  integración de pagos online, no al patrón de BUG 2/3/7. **No tocar sin
  antes entender cómo se concilian los pagos de MercadoPago.**
- **ET-1330:** el cargo SÍ está en la cuenta correcta (UYU), pero por
  $5.800,40 en vez de los $5.918,58 reales — un desfasaje de $118,18 sin
  causa identificada (no es "mismo número sin convertir" como BUG 7, ni
  coincide con la suma de las líneas `ORDEN` de este documento). Ligado al
  hallazgo de `DeudaDocumento` de arriba (esa fila también quedó con
  $5.800,40 como importe original). Bajo impacto ($118,18), la deuda ya
  figura como `COBRADO`/`$0 pendiente` — no se tocó.

---

## Cómo chequear un cliente nuevo, de punta a punta

1. `diag_reconciliacion_cliente.sql` (cambiar `@Cli`) — descarta BUG 1 y 4.
2. `diag_crossmoneda_cliente.sql` o `diag_crossmoneda_todos_clientes.sql` — BUG 2.
3. La consulta A del BUG 3 (por "Manual Edicion") — la más rápida para BUG 3.
3b. `diag_crossmoneda_cargo_todos_clientes.sql` (filtrar por `CliIdCliente` si
   se quiere uno solo) — BUG 7, muy común, revisar siempre.
4. Si todo lo anterior sale limpio y el saldo en vivo SIGUE sin coincidir con
   la deuda real (`SUM(MovImporte) WHERE MovTipo NOT IN ORDEN/ORDEN_ANTICIPO
   AND MovAnulado=0` vs `SUM(DDeImportePendiente)` de deudas vivas) — ahí es
   BUG 5 o algo nuevo, todavía sin catalogar. Parar y pedir ayuda antes de
   tocar nada, no improvisar un fix.

**Nunca** confiar en `CueSaldoActual` (BUG 6) — siempre calcular el saldo
"en vivo" con la fórmula de arriba antes de decidir si un cliente tiene
problema o no.
