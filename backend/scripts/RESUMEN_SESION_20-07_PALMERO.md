# Resumen de sesión — 20-21/7/2026 — Palmero + hallazgos generales

> Para continuar en una sesión nueva: pegar este archivo como contexto inicial.
> Todos los scripts mencionados están en `backend/scripts/`.
> **Ver también [`CATALOGO_BUGS_SALDO_CLIENTES.md`](CATALOGO_BUGS_SALDO_CLIENTES.md)**
> — los bugs de acá catalogados de forma genérica, con la consulta de
> detección de cada uno, para chequear si le pasa lo mismo a otros clientes.

## Contexto de arranque de la sesión
Hoy empezó como "corré estos scripts pendientes de producción" (ver
`RUNBOOK_pendiente_produccion.md`) y terminó destapando una cadena de bugs
reales en la cuenta de **Palmero** (CliIdCliente 998), a raíz de que una
especialista reportó que un cobro con cheque no se veía reflejado.

## Regla de trabajo (importante, ya corregida hoy)
El asistente se conecta **siempre a `localhost`** (`backend/config/db.js`),
que es una **réplica separada**, NO producción. Para cualquier dato de
producción hay que pedir la consulta lista y que el usuario la corra en su
SSMS y devuelva el resultado — el asistente nunca ejecuta nada directo contra
producción. (Ver memoria `feedback_testear_contra_base`.)

## Qué se encontró y arregló HOY, en orden

1. **Incidente de bloqueo/timeout en producción** (sesiones `node-mssql` con
   transacciones abiertas sin cerrar, bloqueándose entre sí). Se autorresolvió
   solo cada vez (varias sesiones 61, luego 54/59/73). Causa raíz NO
   encontrada — se revisó `ordenesRetiroController.js` (12 bloques de
   transacción) y `cajaService.js` (4 bloques): todos con `rollback()`
   garantizado en el `catch`, sin huecos. Hipótesis más probable: transacción
   legítimamente larga (loop de varios registros), no un bug de código que
   pierde el cierre. **Para la próxima vez**: capturar el SQL en vivo con la
   query que quedó en la última respuesta sobre el tema (busca sesiones con
   `open_transaction_count > 0` y trae su `sql_handle` en el momento).

2. **PC-2220 (Palmero, $33.479,61): el pago de $19.583,46 que la especialista
   cobró se aplicó a la deuda FANTASMA duplicada de PC-1982 (#5439) en vez de
   a la deuda real de PC-2220 (#6846).** Diagnosticado y corregido con
   [`fix_pago_mal_aplicado_pc2220.sql`](fix_pago_mal_aplicado_pc2220.sql) —
   **YA CORRIDO Y CONFIRMADO** (PC-2220 quedó en $13.896,15 pendiente, #5439
   cancelada).

3. **Cross-moneda: 7 documentos (de varios clientes) con un pago que cayó en
   la cuenta de la moneda equivocada**, con el mismo número que la factura sin
   convertir (matemáticamente imposible que sea un pago real convertido al TC
   del día). Incluye PC-1451 de Palmero.
   [`fix_crossmoneda_lote1.sql`](fix_crossmoneda_lote1.sql) — **YA CORRIDO Y
   CONFIRMADO** (`[OK] Movimientos reclasificados: 7`, `Saldos ajustados en 12
   cuentas`). Los otros 6 casos (elea, Martina Berriel, Rdssport, SRL Tienda
   Online, Ventas local USER x2) quedaron resueltos también, pero **no se
   verificó el saldo de esos clientes uno por uno** como sí se hizo con
   Palmero — pendiente si hace falta.

4. **Deuda duplicada de PC-1982 (Palmero)**: la fantasma (#5439) recibió pagos
   reales durante semanas sin que nadie notara que era duplicada de la #5438
   (ya paga). Se canceló como parte del punto 2 (el pago que tenía aplicado
   resultó ser, en realidad, el de PC-2220).

5. **Reconciliación completa de Palmero, documento por documento** —
   [`diag_reconciliacion_cliente.sql`](diag_reconciliacion_cliente.sql)
   (solo lectura, sirve para cualquier cliente, cambiar `@Cli`). Resultado:
   limpio. Solo dos observaciones menores, ninguna es plata perdida:
   - PC-1982: diferencia de **$449,69** sin explicar (cobrado real $90.807,45
     vs esperado $91.257,14). Chico, no urgente, pendiente de explicar.
   - PC-2072: cierra perfecto, solo un aviso informativo (pagos encontrados
     vía texto de observaciones en vez de vínculo directo — mismo bug de
     `DocIdDocumento` no estampado, ya conocido).
   - Cero pagos huérfanos totales.

6. **El saldo cacheado (`CueSaldoActual`) de Palmero seguía mostrando un
   "saldo a favor" grande que el cliente NO tiene**, a pesar de que la
   reconciliación por documento (punto 5) salió limpia. Conclusión: no es un
   problema de un documento puntual — es el síntoma de un **bug estructural
   más grande y ya conocido de antes** (ver memoria
   `project_ciclo_anticipo_facturacion`): doble conteo en `CueSaldoActual` +
   documentos anulados que no revierten su movimiento. **No se investigó a
   fondo hoy** (quedó para después, ver pendientes).

   Como parche pragmático, se armó
   [`fix_saldo_real_palmero.sql`](fix_saldo_real_palmero.sql): pone el saldo
   cacheado de Palmero exactamente en lo que debe (USD −$154,00 / UYU
   −$13.896,15, sin nada a favor), confirmado por el usuario. **NO es un fix
   de la causa raíz**, solo pone el número al día para que caja/cobranza no
   se confunda mientras se investiga el bug estructural. **Verificar si ya se
   corrió** (quedó pendiente de confirmación al cierre de la sesión).

## CIERRE — el "saldo a favor" fantasma quedó resuelto (20/7, tarde)

Se encontraron y confirmaron con evidencia SQL (no a mano) las DOS causas
reales del saldo a favor fantasma de Palmero:

1. **PC-1156 (DocId 1795, $271.157,55 UYU) nunca tuvo su cargo en pesos** en
   el libro mayor — solo estaba el pago (+271.157,55) y el cargo original en
   USD (-7.369,43), sin el `CIERRE_CICLO` en UYU que debería existir (mismo
   patrón que todas las demás facturas). La transacción se creó vía "Pago
   Factura Manual Edicion" (sin sesión de caja, sin detalle) — se saltó el
   paso que genera ese cargo.
2. **12 pares de "cruce automático" (UYU→USD)** donde el lado USD se anuló
   (al anularse la factura PC-1932) pero el lado UYU que lo financió nunca se
   anuló — $104.119,45 contando de más como gasto en UYU.

**Fix aplicado y confirmado:** [`fix_saldo_palmero_completo.sql`](fix_saldo_palmero_completo.sql)
— insertó el cargo faltante de PC-1156, anuló los 12 huérfanos, y recalculó
`MovSaldoPosterior`/`CueSaldoActual` (mismo método que la herramienta ya
existente `fix_saldo_por_cliente.sql`). **CORRIDO Y COMMITEADO.**

**Resultado:** saldo UYU pasó de +$154.117,25 (fantasma) a −$12.920,85, contra
una deuda real de $14.050,15 → diferencia final de solo **$1.129,30** (antes
$168.167,40). 99,3% resuelto. El resto es probablemente el gap de $449,69 de
PC-1982 ya conocido, más algo chico sin identificar — no urgente.

**Nuevo, sin resolver, no urgente:** cuenta USD de Palmero muestra
`SaldoEnVivo = -42.273,41` pero `DeudaViva = 0` (ninguna factura/deuda formal
respalda esa deuda). Puede ser trabajo pendiente de facturar (normal) o un
desfasaje nuevo — revisar en otra sesión si hace falta.

**Metodología que funcionó bien hoy** (para reusar en otros clientes con el
mismo síntoma): 1) reconciliar documento por documento
(`diag_reconciliacion_cliente.sql`) para descartar duplicados/pagos
huérfanos — si sale limpio, el problema es estructural, no de un documento
puntual; 2) desglosar el saldo en vivo por `MovTipo`
(`diag_desglose_saldo_palmero.sql`) para ver qué categoría pesa; 3) buscar
específicamente documentos ANULADOS con movimientos vivos, y pares
`PAGO_CRUZADO` con anulado asimétrico (`diag_anulados_sin_revertir.sql`); 4)
para documentos con pago pero sin cargo, comparar contra el patrón de
`CIERRE_CICLO` esperado. Todo el cálculo final por SQL, nunca a mano — hoy
hubo un error real por sumar dólares y pesos sin convertir al hacerlo a mano
(retractado a tiempo).

## CONTINUACIÓN (21/7, madrugada) — 2 causas más encontradas, y una alarma

El usuario no se conformó con el 99,3% — insistió en llegar a exactamente
$14.050,15 (la deuda real) y en nada más. Se retomó documento por documento,
empezando por los más viejos.

**BUG nuevo encontrado (mismo patrón que PC-1156, catalogado como BUG 3 en
el catálogo):** dos documentos más con la firma "Pago Factura Manual
Edicion" tenían el mismo problema — pago completo, sin su cargo en la
moneda correcta:
- **PC-1447** ($93.584,55) — cargo viejo en USD (-$3.019,95, sin el
  descuento aplicado), sin cargo en UYU.
- **PC-1451** ($12.159,89) — mismo caso (-$517,20 en USD sin descuento). Ya
  se le había arreglado el PAGO por la mañana (BUG 2), pero nunca el CARGO.

Se confirmó con el usuario: la causa es que el precio se ajusta manualmente
en el cierre (descuentos) y ese ajuste no se propaga al libro mayor —
**NO es un error de tipo de cambio** (se había sospechado eso primero y se
descartó). Se corrió [`fix_saldo_palmero_pc1447_pc1451.sql`](fix_saldo_palmero_pc1447_pc1451.sql)
— **CORRIDO Y COMMITEADO.** Cada documento, individualmente, ahora cierra
perfecto (cargo + pago = 0 neto).

**⚠️ Pero el saldo agregado empeoró, no mejoró:** UYU pasó de −$12.920,85 a
**−$118.665,29** (vs. objetivo −$14.050,15 — gap de $104.615, en la
dirección OPUESTA a como empezamos: ahora falta plata, no sobra). Se
verificó con un barrido general (comparar cargo vs factura en TODOS los
documentos activos, no solo los de "Manual Edicion") que **los 10
documentos activos de Palmero ya están perfectos** — el problema ya no es
de ningún documento puntual.

**Sospecha fuerte, NO confirmada:** el fix de los 12 pares `PAGO_CRUZADO`
huérfanos de esta mañana (BUG 5 del catálogo) puede haber sido el
movimiento equivocado. Se investigó y se encontró que la relación entre el
pedido nombrado en cada cruce y el importe NO es 1 a 1 (un pedido de
US$61,79 disparó un cruce de US$87,40) — el mecanismo de `PAGO_CRUZADO`
parece cubrir el déficit acumulado de la cuenta en ese momento, no el costo
puntual de ese pedido. Reconstruir esto a mano es de alto riesgo de
equivocarse de nuevo (ya pasó 2 veces hoy con cálculos manuales).

**DECISIÓN: se frenó acá.** No se tocó nada más. Se le pidió al usuario
llevar esto a quien programó el mecanismo de `PAGO_CRUZADO`, para entender
la lógica original antes de decidir si el BUG 5 se revierte, se ajusta
parcialmente, o se deja como está. Ver BUG 5 en el catálogo para el detalle
completo y la consulta de detección.

## Actualización 21/7 — verificación de los otros 6 clientes del cross-moneda (punto 4) — Y hallazgo grande (BUG 7)

Se corrió `diag_reconciliacion_cliente.sql` contra la réplica local para los 5
clientes restantes (Ventas local USER cubre los 2 docs ET-2061/ET-2074):
elea (257), Martina Berriel (896), Rdssport (930), SRL Tienda Online (644),
Ventas local USER (8627).

**Primer chequeo (retractado):** se miró primero `CueSaldoActual` (el campo
cacheado) y pareció que ninguno tenía saldo a favor fantasma. **Error** — ese
campo es justo el que el catálogo marca como no confiable (BUG 6, las
pantallas ni lo leen). Rehecho con el saldo EN VIVO (`SUM(MovImporte)` real)
contra la deuda viva, como indica la metodología del catálogo.

**Con el dato correcto, los 5 SÍ tienen desfasajes** — y los tres que se
pudieron explicar (elea, Martina Berriel, SRL Tienda Online) resultaron ser
la MISMA causa nueva, no el "saldo a favor" de Palmero: **BUG 7**, agregado
al catálogo — el CARGO (`VTA_CAJA`/`CIERRE_CICLO`) de la factura cae en la
cuenta de la moneda equivocada, con el mismo número sin convertir (misma
firma que BUG 2, pero del lado del cargo, no del pago). Ejemplos concretos:
- **elea, PC-1906** (US$1.142,28): cargo -1.142,28 en la cuenta **UYU** en vez
  de USD → después de que el fix de esta mañana corrigiera el PAGO (BUG 2),
  quedó un desbalance de $1.142,28 en cada cuenta, en sentido opuesto.
- **Martina Berriel, PC-1165** ($8.800) y **PC-1570** ($60.319,02): mismo
  patrón. PC-1570 es el caso grave: el cargo de -$60.319,02 está en la cuenta
  **USD**, y la fila de `DeudaDocumento` (DDeIdDocumento 3984) calculó su
  pendiente ($2.024,40) a partir de los números USD equivocados — **por eso
  el sistema no rastrea ~$58.294,62 de deuda real: no es un bug aparte, es
  consecuencia directa de BUG 7.**
- **SRL Tienda Online, FA-73** ($7.100): mismo patrón exacto.
- **Rdssport, 14 "pagos huérfanos"** (~$143.704,81 UYU, 11/6–16/7): revisados
  uno por uno — **esto SÍ es normal**, no un bug: son ventas de mostrador
  (`VTA_CAJA` + `PAGO` casi simultáneos, mismo importe, se cancelan netos).
  Solo les falta el `DocIdDocumento` en el `PAGO` (cosmético, ya conocido).

**Se corrió un barrido general (no solo estos 5 clientes) para dimensionar
BUG 7 — ver detalle y query en `CATALOGO_BUGS_SALDO_CLIENTES.md`, sección
BUG 7:** **298 clientes distintos** con este patrón (459 de 468 documentos con
el número idéntico sin convertir). Esto contesta el pendiente #3 de más
abajo ("dimensionar cuántos clientes más"). **No se tocó nada — solo
diagnóstico.** Dado el tamaño, no conviene arreglar cliente por cliente (ver
recomendación completa en el catálogo).

Scripts nuevos (solo lectura, todos en `backend/scripts/`):
`resolver_clientes_por_doc.js`, `diag_reconciliacion_lote.js`,
`diag_saldo_vivo_lote.js` (saldo en vivo vs deuda, varios clientes),
`diag_bug3_lote_v2.js` (BUG 3 por `CueTipo`, no por `MonIdMoneda` — esa
columna viene NULL en algunas cuentas), y el nuevo detector general
`diag_crossmoneda_cargo_todos_clientes.sql` (BUG 7, TODOS los clientes).

## Actualización 21/7 (más tarde) — corrección de los 5 clientes, uno por uno

Siguiendo la guía "Cómo chequear un cliente nuevo, de punta a punta" del
catálogo, se pasó de diagnosticar a corregir (probado con `ROLLBACK` contra
la réplica local en cada caso, nada corrido en producción todavía). Detalle
completo y "visto en" actualizado en `CATALOGO_BUGS_SALDO_CLIENTES.md`
(sección BUG 7). Resumen:

- **elea** — [`fix_saldo_elea_pc1906.sql`](fix_saldo_elea_pc1906.sql). Un solo
  documento (PC-1906), swap limpio. Después del fix: USD = -deuda viva exacta,
  UYU = $0. Listo para correr en producción.
- **SRL Tienda Online** — [`fix_saldo_srl_fa73.sql`](fix_saldo_srl_fa73.sql).
  Un documento (FA-73), swap limpio. Queda un residuo de $91,44 en USD sin
  relación con este bug (deuda vieja sin `DocIdDocumento`) — no tocado,
  documentado en el script.
- **Martina Berriel** — [`fix_saldo_martina_berriel.sql`](fix_saldo_martina_berriel.sql).
  Dos documentos con DOS bugs distintos: PC-1165 es BUG 3 clásico (cargo
  nunca generado en la moneda correcta) y PC-1570 es BUG 7 (cargo swap) MÁS
  la fila de `DeudaDocumento` calculada mal (tomó el costo de las órdenes en
  USD en vez del total real de la factura — **nuevo hallazgo, sin catalogar
  todavía, ver el catálogo**). Después del fix, las dos cuentas cierran
  EXACTO contra su deuda viva.
- **Ventas local USER** — [`fix_saldo_ventas_local_user.sql`](fix_saldo_ventas_local_user.sql).
  Solo 2 de los 5 documentos afectados (ET-2061, ET-2074) — los otros 3
  (ET-1980, ET-1982, ET-2137) tienen un pago chico en USD de origen incierto
  y no se tocaron. Es una cuenta genérica de mostrador (no un cliente real
  con nombre), y quedan residuos ($2.055 a favor en UYU, $73,16 de
  desfasaje en USD) sin explicar — no se sabe si son normales para este tipo
  de cuenta agregada.
- **Rdssport — NO se encontró un fix seguro.** Dos hallazgos nuevos, sin
  catalogar, documentados en el catálogo: PC-1971 (pagado por MercadoPago,
  sin ningún `PAGO` en el libro mayor — problema de integración de pagos, no
  de moneda) y ET-1330 (desfasaje de $118,18 sin causa clara, pero la deuda
  ya figura `COBRADO`, bajo impacto). Se paró antes de tocar nada, como se
  pidió.

**BUG 5 (`PAGO_CRUZADO` con anulado asimétrico): se buscó en los 5 clientes,
CERO casos.** No hace falta preocuparse por eso acá.

## Pendiente — orden sugerido para la próxima sesión

0. **PRIORIDAD — BUG 5 del catálogo (los 12 pares `PAGO_CRUZADO`).** Palmero
   quedó con el saldo UYU en −$118.665,29 (debería ser −$14.050,15) porque
   se sospecha que el fix de esta mañana (anular esos 12 pares) estuvo mal.
   Hablar con quien programó el mecanismo de `PAGO_CRUZADO` antes de decidir
   nada — no improvisar una reversión. Ver el catálogo para el detalle.
1. ~~Confirmar que `fix_saldo_real_palmero.sql` se corrió~~ — SUPERADO por
   `fix_saldo_palmero_completo.sql` (corregido de raíz, no solo parcheado).
2. **Aplicar el cheque 629303 ($6.600, Banco Santander) a PC-2220.** La
   pantalla de pago NO tiene forma de seleccionar un cheque ya cargado (solo
   "cargar nuevo") — evaluar si conviene:
   - (a) cargarlo de nuevo por la pantalla (crea un cheque duplicado en
     `TesoreriaCheques`, después anular a mano la fila vieja con nota), o
   - (b) pedir agregar la función de "seleccionar cheque existente" al panel
     de pago (`ChequeRecibirModal.jsx` / `CajaPanelPago.jsx` /
     `CajaPagoDeudaTab.jsx`), o
   - (c) armar el fix 100% por SQL replicando `procesarPagoDeuda` a mano (se
     descartó hoy por riesgo/complejidad, pero queda como opción si hace
     falta).
3. **Investigar la causa raíz en el CÓDIGO** de las causas encontradas
   (para que no vuelva a pasar en más clientes):
   - ¿Por qué "Pago Factura Manual Edicion" no genera el `CIERRE_CICLO` en la
     moneda del documento? (buscar ese flujo, probablemente en
     `FacturacionManualModal.jsx` / el controller que atiende esa edición)
   - ¿Por qué al anular una factura, el reverso de `PAGO_CRUZADO` solo anula
     el lado USD y no el UYU que lo financió?
   - **BUG 7 (nuevo, 298 clientes): ¿por qué el cargo (`VTA_CAJA`/`CIERRE_CICLO`)
     de una factura cae a veces en la cuenta de la moneda equivocada, con el
     mismo número sin convertir?** Mismo sospechoso que BUG 3 (cierre de
     ciclo / conversión de moneda al consolidar). **Dimensionado — ver punto
     4, ya HECHO.**
4. ~~Verificar el saldo de los otros 6 clientes del fix cross-moneda~~ —
   **HECHO 21/7.** Resultado: no tienen el "saldo a favor fantasma" de
   Palmero, pero sí tienen BUG 7 (ver arriba) — y ese mismo BUG 7 resultó
   estar en 298 clientes, no solo estos 6. Sigue pendiente: la causa en el
   código (punto 3) y decidir la estrategia de fix (uno por uno no escala).
5. **Explicar el resto de $1.129,30 en Palmero** (antes $168 mil, ya bajó
   99,3%) — probablemente el gap de $449,69 de PC-1982 + algo chico más.
   Chico, no urgente.
5b. **Investigar el hallazgo nuevo de USD**: `SaldoEnVivo = -42.273,41` sin
   ninguna `DeudaViva` que lo respalde — puede ser normal (trabajo pendiente
   de facturar) o un desfasaje más. No urgente.
6. **Retomar el `RUNBOOK_pendiente_produccion.md` general** — quedaba en el
   paso E1/E2/E3 (cross-moneda, HOY completado). Falta: Grupo B (cheques
   duplicados), Grupo C (`add_PagIdCheque.sql`, obligatorio antes de
   deployar), Grupo D (deploy del código con todos los fixes ya
   implementados pero no desplegados).
7. **El incidente de transacciones colgadas** (punto 1) — sin causa raíz
   encontrada. Si vuelve a pasar, capturar el SQL en vivo (ver script de
   diagnóstico usado hoy) antes de que se autorresuelva.

## Scripts creados hoy (todos en `backend/scripts/`)
- `CATALOGO_BUGS_SALDO_CLIENTES.md` — **catálogo genérico de los 6 bugs**,
  con consulta de detección de cada uno. Empezar por acá para otros clientes.
- `fix_pago_mal_aplicado_pc2220.sql` — corrido ✅ (BUG 4)
- `fix_crossmoneda_lote1.sql` (+ `fix_crossmoneda_pc1451.sql`, individual,
  ya incluido en el lote) — corrido ✅ (BUG 2)
- `fix_saldo_palmero_completo.sql` — corrido ✅ (BUG 3 en PC-1156 + BUG 5 en
  los 12 pares — este último AHORA SOSPECHOSO, ver arriba)
- `fix_saldo_palmero_pc1447_pc1451.sql` — corrido ✅ (BUG 3 en PC-1447/1451)
- `diag_crossmoneda_todos_clientes.sql` — solo lectura, referencia (BUG 2)
- `diag_reconciliacion_cliente.sql` — solo lectura, reusable para cualquier
  cliente (BUG 1 y 4)
- `diag_desglose_saldo_palmero.sql` — solo lectura, desglosa el saldo en
  vivo por `MovTipo`
- `diag_anulados_sin_revertir.sql` — solo lectura, detecta el BUG 5
- `fix_saldo_real_palmero.sql` — **DESCARTADO, no usar**: pisaba el campo
  `CueSaldoActual` cacheado, que las pantallas ni siquiera leen (ver BUG 6).
- `diag_transacciones_abiertas.sql` / `diag_detalle_sesiones_bloqueadas.sql`
  — solo lectura, para el incidente de bloqueos (sin relación con lo demás)
