# RUNBOOK — Desfasaje del cierre de ciclo (la factura vs el estado de cuenta)

> **Objetivo:** corregir, cliente por cliente, el desfasaje entre el **estado de cuenta** (libro
> mayor) y las **facturas**, causado por cambios de precio en el cierre de ciclo que no se
> propagaron. **Regla de oro del equipo: LA FACTURA MANDA.**
>
> **Nada de esto se corrió todavía.** Restaurá la base en local, entendé, y corré vos con backup.

---

## 1. El bug (qué pasó)

Cuando se cierra un **ciclo de facturación** (o se hace una **venta Pedido Caja**), se genera:
- un **documento** (factura / e-Ticket / Pedido Caja) con su `DocTotal`, y
- un **movimiento en el libro mayor** (`MovimientosCuenta`, tipo `CIERRE_CICLO` o `VTA_CAJA`) que
  carga esa deuda a la cuenta corriente del cliente.

**El bug:** si se **cambió un precio** durante/después del cierre, el documento salió con el precio
nuevo pero el **movimiento del ledger quedó con el viejo** (o viceversa). Resultado:
`|MovImporte| ≠ DocTotal`. Eso **infla o desinfla el saldo** del cliente y, en varios casos, además
dejó **filas `DeudaDocumento` duplicadas**.

**Decisión del equipo (ya tomada en `fix_saldo_por_cliente.sql`): manda la FACTURA (`DocTotal`).**
El movimiento del ledger se corrige a `= -DocTotal`. Las facturas NO se tocan.

### Las 3 variantes

| Variante | Qué significa | Acción |
|---|---|---|
| **A** | El ledger facturó de **MÁS** (`\|MovImporte\| > DocTotal`). Factura consistente. | Bajar el ledger a `-DocTotal` (quita deuda fantasma). **Seguro.** |
| **B** | El ledger facturó de **MENOS** (`\|MovImporte\| < DocTotal`). Factura consistente. | Subir el ledger a `-DocTotal` (agrega deuda real). **Revisar** (sube lo que deben). |
| **C** | La **factura es inconsistente**: `DocTotal ≠ suma de sus líneas`. | ⚠️ **NO corregir a ciegas.** Decidir/**re-facturar** el documento primero. |

---

## 2. El listado de clientes afectados

- **Fuente:** `listar_clientes_afectados.sql` (solo lectura; autodetecta, sin IDs fijos).
- **Snapshot al 14/07/2026:** `../../sql/clientes_afectados_desfasaje_2026-07-14.csv`
- **Total: 66 clientes** — A=28 · B=35 · C=13 · Ajuste neto ≈ −$5.694.

> ⚠️ El CSV viejo `clientes_afectados_desfasaje.csv` (49 clientes) está **obsoleto** — el bug siguió.
> Volvé a correr `listar_clientes_afectados.sql` sobre la base restaurada para tener la lista al día.

**Top 15 por impacto (|ajuste|):**

| # | IDCliente | Cliente | Variantes | Ajuste |
|---|---|---|---|---|
| 1 | capa | CAPA Indumentaria Deportiva | A1,B1 | −40.853,84 |
| 2 | Andres XU | Emipal Sociedad Anonima | A3 | 10.295,19 |
| 3 | TheBearKing23 | Matías Siri | A1,B1 | 8.598,70 |
| 4 | mrivero-745 | Mrivero-745 | A5 | 6.712,67 |
| 5 | Martina Berriel | Martina Berriel | A1 | 6.340,54 |
| 6 | SilvaMartin | Martín Ezequiel Silva Nolasco | A1,B1 | −2.566,38 |
| 7 | 51814799 | Posse Gutierrez Santiago | A3 | 2.161,56 |
| 8 | nperez | Tdh Sports | A3 | 1.968,69 |
| 9 | TF SPORT | Támara flores | A2,B1 | 1.926,00 |
| 10 | ROLYMAJENSKI | Rolymajenski | B1 | −1.527,77 |
| 11 | FRAN29 | FRAN29 | B1 | −1.069,46 |
| 12 | GranAventura | Odysseus Ltda | A1 | 978,79 |
| 13 | CS Fotografia | CS Fotografia | **C1** | −895,84 |
| 14 | GLIDE | Valli Rodriguez Carmen Isabel | A1 | 610,95 |
| 15 | Kova | De Zuasnabar Aquino Adrian Gaston | A1,B1 | 503,18 |

(Los 66 completos, en el CSV.)

---

## 3. Las herramientas (qué es cada script)

| Archivo | Tipo | Qué hace | ¿Modifica? |
|---|---|---|---|
| `listar_clientes_afectados.sql` | SQL | Lista + clasifica (A/B/C) todos los clientes con desfasaje | **No** (solo lectura) |
| `diagnostico_cliente.js` | Node | Diagnóstico completo de UN cliente (saldos, desfasajes, DeudaDoc duplicada, órdenes en limbo) | **No** (solo lectura) |
| `fix_saldo_por_cliente.sql` | SQL | **EL FIX.** Corrige el ledger = `-DocTotal` de UN cliente + recomputa saldo. A/B/C. | **Sí** (ROLLBACK→COMMIT) |
| `fix_saldo_desfasaje_grupo_A.sql` | SQL | (Opcional) Batch dinámico de **todos** los A seguros de una | **Sí** (ROLLBACK→COMMIT) |
| `fix_saldo_desfasaje_grupo_B_dinamico.sql` | SQL | (Opcional) Batch dinámico de **todos** los B de una | **Sí** (ROLLBACK→COMMIT) |

### ⛔ NO usar (obsoletos, hardcodeados del 06/07):
- `fix_saldo_desfasaje_grupo_B.sql` (viejo, IDs fijos)
- `fix_saldo_desfasaje_grupo_C.sql` (viejo, IDs fijos)
- `clientes_afectados_desfasaje.csv` (lista vieja de 49)

---

## 4. Cómo leer el diagnóstico de un cliente

```
node scripts/diagnostico_cliente.js <IDCliente>
   ej:  node scripts/diagnostico_cliente.js capa
```

Muestra 5 bloques:
1. **Cuentas** — `SaldoActual` (lo que muestra hoy la billetera) vs `SaldoCorregido` (lo que va a
   mostrar cuando apliques la factura). Si difieren, ese cliente necesita el fix.
2. **Desfasajes** — un renglón por documento: `LedgerAhora` → `Correccion (-DocTotal)`, la variante
   (A/B/C) y `NLineas` (si es >1 el fix lo saltea → revisar a mano).
3. **DeudaDocumento duplicadas** — filas que hacían doble-contar en el cobro. La marcada
   `CONSERVA (=factura)` es la buena; las otras son fantasma.
4. **Órdenes en limbo** — órdenes anuladas/huérfanas (informativo; suelen explicar el gap).
5. **Recomendación** — si es seguro (solo A/B) o si tiene C / multi-línea (revisar).

---

## 5. Workflow por cliente (paso a paso)

> **Antes de empezar: BACKUP de la base. Ventana de bajo tráfico.**

Para **cada** cliente de la lista (empezando por los de mayor |ajuste|):

1. **Diagnosticá:** `node scripts/diagnostico_cliente.js <IDCliente>`. Entendé qué se va a cambiar.
2. **Si es A/B (factura consistente, 1 línea):**
   - Abrí `fix_saldo_por_cliente.sql`.
   - Línea 17: `DECLARE @IDCliente VARCHAR(50) = '<IDCliente>';`
   - Corré (viene con `ROLLBACK`). Mirá el **SELECT de control** (columna "SE CORRIGE") y la
     **verificación** (el saldo nuevo por cuenta).
   - Si está OK → cambiá **línea 107** `ROLLBACK TRANSACTION;` por `COMMIT TRANSACTION;` → corré de nuevo.
3. **Si tiene variante C** (factura inconsistente): **NO** corras el fix. Decidí la factura primero
   (re-facturá el documento, como el flujo de la pre-factura). Volvé al paso 1 después.
4. **Si algún doc tiene `NLineas > 1`:** el fix lo saltea (evita doble edición). Revisalo aparte.
5. **(Opcional) DeudaDocumento duplicada:** el fix del ledger NO la toca. Si querés dejar la base
   100% limpia, cancelá la fila que el diagnóstico marcó como fantasma (te preparo el `UPDATE ...
   SET DDeEstado='CANCELADA'` cuando lo pidas). En pantalla ya no molesta (el 360 la deduplica).
6. **Verificá:** reload backend → la billetera del cliente cuadra con Documentos.

### Alternativa rápida (si querés apurar A y B en batch)
- `fix_saldo_desfasaje_grupo_A.sql` corrige **todos** los A seguros de una (revisá control → COMMIT).
- `fix_saldo_desfasaje_grupo_B_dinamico.sql` corrige **todos** los B de una (revisá bien, sube deuda).
- Los **C** igual quedan para revisar uno por uno.

---

## 6. Qué mira el fix por dentro (para que lo entiendas)

`fix_saldo_por_cliente.sql`:
1. Detecta los movimientos `CIERRE_CICLO`/`VTA_CAJA` del cliente donde `|MovImporte| ≠ DocTotal`
   (factura no anulada, misma moneda). Los clasifica A/B/C.
2. **Solo si el documento tiene 1 línea de facturación:** hace `UPDATE MovImporte = -DocTotal` y deja
   una `MovObservaciones` con el valor viejo (auditoría).
3. Recomputa el **saldo corrido** (`MovSaldoPosterior`) y el **`CueSaldoActual`** almacenado de las
   cuentas tocadas, sumando el ledger vivo (sin órdenes).
4. `ROLLBACK` por defecto → nada se aplica hasta que vos pongas `COMMIT`.

**No toca:** facturas, `DocumentosContables`, `DeudaDocumento`, órdenes.

---

## 7. Reglas de oro

- **Backup antes de cada sesión.** Sin excepción.
- **Corré siempre con `ROLLBACK` primero**, revisá control + verificación, recién ahí `COMMIT`.
- **Nunca** los scripts viejos hardcodeados (grupo_B.sql / grupo_C.sql del 06/07).
- **Variante C = pará** y decidí la factura (re-facturar). El `-DocTotal` puede estar mal ahí.
- El **display del 360 ya muestra la factura** (dedup + resumen corregidos); el fix de datos hace
  que el **saldo/ledger** también cuadre.
