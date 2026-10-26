# RUNBOOK — Pendiente de producción (17-jul-2026)

> Orden para correr en producción. Cada script SQL trae **preview arriba** y el
> `UPDATE`/`COMMIT` **comentado dentro de una transacción**: mirás, y recién ahí
> descomentás y hacés `COMMIT`. Nada se aplica solo.

---

## GRUPO A — Limpiezas de datos (seguras, corren en cualquier momento)

Se pueden correr **antes** del deploy, sobre la base actual. Cada una es idempotente.

| # | Script | Qué hace | Riesgo |
|---|---|---|---|
| A1 | `fix_deudas_duplicadas_por_documento.sql` | Cancela las deudas fantasma duplicadas (PC-1982 y las demás). Sección 2 = las claras (automático); Sección 4 = los ambiguos (CR SPORT, Mazzoni) con "la factura manda" | Bajo — no toca contabilidad, solo el registro de deudas |
| A2 | `fix_fecha_deuda_segun_documento.sql` | Realinea la fecha de las deudas a la del documento (deuda vieja que figuraba "al día") | Bajo |
| A3 | `backfill_DocIdDocumento_pago_deuda.sql` | Repara los cobros que salían como "ANTICIPO" sin serlo | Bajo |

> A1 ya se corrió parcialmente (la fantasma de PC-1982 está cancelada). Correrlo de
> nuevo es seguro — la Sección 2 detecta lo que falte, la Sección 4 son los ambiguos.

---

## GRUPO B — Cheques (migración + limpieza, orden importa)

⚠️ **Orden obligatorio**: primero limpiar el duplicado, después crear el índice UNIQUE
(si no, el índice falla con el cheque repetido vivo).

| # | Script | Qué hace |
|---|---|---|
| B1 | `fix_cheques_duplicados_con_reversa.sql` | Anula el cheque 668805 repetido **y revierte su asiento** (a diferencia de las deudas, el cheque SÍ tenía asiento duplicado) |
| B2 | `add_tesoreria_cheques_rechazo_cobro_y_unique.sql` | Carga los 2 eventos contables que faltaban (rechazo/cobro) + el índice UNIQUE que frena duplicados futuros |

---

## GRUPO C — Migración obligatoria ANTES del deploy de código

🚨 **CRÍTICO**: el código nuevo escribe `PagIdCheque` en cada cobro. Si desplegás el
código SIN esta columna, **se rompen TODOS los cobros** (caja + pago de deudas).

| # | Script | Qué hace |
|---|---|---|
| C1 | `add_PagIdCheque.sql` | Agrega la columna que vincula pago ↔ cheque |

---

## GRUPO D — Deploy del código

Recién **después** de C1. Trae:
- Estado de cuenta unificado (documentos + pagos + saldo por moneda, recibo + medio de pago).
- Diferencia de cambio en pago de deudas (4.2.1 / 5.2.01, tope 1 USD).
- Guard de idempotencia en `crearDeudaDocumento` → **impide que nazcan nuevas deudas duplicadas**.
- Candado al editar una factura ya cobrada (Bandeja CFE).
- `DocPagado=1` al saldar por Pago de Deudas.
- Tesorería: botones funcionando + anular cheque + ver/editar cheque.

> Sin el guard (D), los duplicados que limpiás en A1 pueden volver a nacer. Por eso
> conviene A1 + D juntos.

---

## GRUPO E — Cross-moneda + saldos (DIAGNÓSTICO primero, NO tocar todavía)

Esto NO es un UPDATE — es una **reconstrucción contable**. Palmero (y ~otros clientes)
tienen el cruce de moneda: órdenes en US$, facturas convertidas a $, y en algún caso el
pago cayó en la cuenta equivocada (PC-1451: pago US$ que debía ser $). Los saldos por
cuenta se ven mal por separado pero se compensan entre las dos monedas.

| # | Script | Qué hace |
|---|---|---|
| E1 | `diag_crossmoneda_cliente.sql` | **SOLO LECTURA.** Mapa por cliente: moneda del doc vs órdenes vs pago, y marca la anomalía real (pago en moneda distinta). Cambiá `@Cliente` |
| E2 | `diag_crossmoneda_todos_clientes.sql` | **SOLO LECTURA.** Mismo criterio que E1 pero barre TODOS los clientes. Detectó 11 documentos con pago en cuenta de moneda distinta; 7 con `MismoNumero='SÍ'` — confirmado ERROR (no pago legítimo en otra moneda: el TC del día era ≈40,5-40,9 y el importe no se convirtió, quedó igual). Los otros 4 (importe del pago ≠ total del doc) parecen excedente/vuelto en otra moneda a propósito — no tocados |
| E3 | `fix_crossmoneda_lote1.sql` | **EL FIX de los 7 casos confirmados.** Palmero PC-1451, elea PC-1906, Martina Berriel PC-1165, Rdssport ET-1330, SRL Tienda Online FA-73, Ventas local USER ET-2074 y ET-2061. Reclasifica cada pago a la cuenta de la moneda del documento (mismo importe, sin conversión — ya estaba bien en su moneda, solo en la cuenta que no correspondía) y ajusta `CueSaldoActual` por cuenta (agrupado por si dos docs comparten cuenta, como Ventas local USER). Preview cuenta "X de 7" antes del UPDATE — si da menos de 7, no correr sin entender por qué. Probado en transacción con ROLLBACK, los 7 matchean y los deltas cierran. (`fix_crossmoneda_pc1451.sql` queda como script individual de referencia — ya incluido en el lote, no hace falta correr los dos) |

⚠️ Nota de datos suelta (no bloquea nada): la cuenta DINERO_UYU de Rdssport
(CueIdCuenta 234) tiene `MonIdMoneda` en NULL en vez de 1. El fix la identifica por
`CueTipo`, no por `MonIdMoneda`, así que no afecta — pero valdría la pena una limpieza
aparte algún día.

**NO recomputar el `CueSaldoActual` desde cero** — solo se ajustó el delta puntual de
estos 7 casos. Los otros 4 de E2 (importe no coincide con el total del doc) no están
confirmados como error; revisar aparte si hace falta.

---

## Resumen del orden sugerido

```
1. A1  (deudas duplicadas)        ─┐  limpiezas seguras, cualquier momento
2. A2  (fechas)                    │
3. A3  (backfill imputación)      ─┘
4. B1  (cheque duplicado)          ─┐  cheques (orden importa)
5. B2  (eventos + UNIQUE)          ─┘
6. C1  (add PagIdCheque)           ←  OBLIGATORIO antes del deploy
7. D   (deploy código)             ←  trae el guard anti-duplicados
8. E1  (diagnóstico cross-moneda 1 cliente)   ─┐
9. E2  (diagnóstico cross-moneda todos)        │  solo mirar
10. E3 (fix de los 7 casos confirmados)        ←  confirmado, corre cuando quieras
    (los otros 4 de E2 no son error confirmado — no tocar sin revisar)
```
