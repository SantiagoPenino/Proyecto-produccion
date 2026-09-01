# GUÍA DE PRUEBAS — Billetera prepaga (F1–F5 + visibilidad) · 01-09-2026

Todas las pruebas son contra la **réplica local** (los SQL ya están aplicados acá).
Antes de empezar: **reiniciar el backend** (hay código nuevo en motor, webhooks y rutas).

Clientes sugeridos:
- **COMÚN**: cliente 58 (tiene BILLETERA UY #7703 y BILLETERA USD prepago, saldo 0).
- **SEMANAL**: Tamara (5216) u otro con TClIdTipoCliente=2 / CueDiasCiclo en la principal.

Consulta rápida de apoyo (saldo real de una cuenta, correr cuando quieras verificar):
```sql
SELECT ISNULL(SUM(MovImporte),0) SaldoReal FROM MovimientosCuenta
WHERE CueIdCuenta = @CUENTA AND (MovAnulado IS NULL OR MovAnulado = 0)
  AND MovTipo NOT IN ('ORDEN','ORDEN_ANTICIPO');
```

---

## 0. Visibilidad de la billetera en el portal (flag nuevo)

1. Entrar al portal del cliente de prueba → **Mis Recursos**: la sección "Mi billetera"
   **NO debe existir** (el flag arranca en 0 para todos).
2. Gestión → 360 del cliente (o Cuentas) → botón **"Cuentas"** → arriba de la lista está el
   switch 🌐 **"Billetera visible en el portal"** → prenderlo.
3. Refrescar el portal → la sección aparece con sus cuentas y botones.
4. Extra (candado de atrás): con el flag apagado, pegar a mano la URL de la API
   `/api/web-orders/mis-cuentas/XXXX/movimientos` → debe dar 403
   "Tu billetera no está habilitada en el portal…".

## 1. Recarga web facturada (F4) — cuenta PREPAGO

En el portal, "Mi billetera" → **Recargar** sobre una BILLETERA (badge prepago).

**Validaciones (sin pagar nada):**
- No elegir comprobante → error "Elegí qué comprobante…".
- e-Factura con RUT inventado (ej. 218973270019) → error de dígito verificador.
- e-Factura con RUT bien (ej. 218973270018) pero sin razón social → error.
- e-Ticket con importe ≥ $65.000 sin cédula → error "DGI exige identificar al receptor…".
- e-Ticket con cédula inválida → error de dígito verificador.

**Recarga real (recomendado: e-Ticket, $10 por Handy o MP):**
1. Confirmar → pagar en la pestaña de la pasarela.
2. Cuando el webhook confirme, verificar TODO esto:
   - El saldo de la cuenta subió $10 (portal y 360).
   - **Bandeja CFE**: apareció un e-Ticket PENDIENTE con la línea
     "Crédito prepago de servicios — carga de saldo «BILLETERA UY»", pagado con Handy/MP.
   - Libro de la cuenta (360) y Movimientos (portal): fila **CARGA_PREPAGO** con el
     documento ET-x y ref `VS-<doc>`.
   - En Movimientos del portal, la fila de la carga tiene botón **📄 PDF** → descarga el
     mismo PDF que la bandeja.
   - Asiento: Caja (D) / Ventas + IVA (H) por $10.
3. Repetir con **e-Factura + RUT** → el doc sale tipo e-Factura con receptor RUT+razón social.
4. Si la pasarela reintenta el webhook: NO debe duplicar (guard por Tx en la observación).

## 2. Común: descuento AL INGRESO (y qué pasa cuando se acaba el saldo)

Con el cliente COMÚN y su BILLETERA UY con saldo (ej. $200 tras recargar):

- **2a. Saldo alcanza**: ingresar a depósito una orden de $100 → al confirmarse el ingreso,
  la orden queda **pronta (estado 7) sin deuda**; el libro de la cuenta muestra
  CONSUMO_CUENTA −100 con marca `CUBIERTO_CUENTA_…`; la principal NO tiene ORDEN.
- **2b. Saldo parcial**: con $100 restantes, ingresar una orden de $150 → el consumo sale
  por −100 con marca `CUBIERTO_PARCIAL_CUENTA` y nota "(sin saldo para el total, el resto
  va a la cuenta principal)"; la principal gana una **ORDEN de −50 con deuda de $50**
  (se cobra por caja como siempre); la orden queda pendiente (estado 1).
- **2c. Saldo en 0**: ingresar otra orden → va ENTERA a la principal, deuda normal, camino
  de caja completo. La cuenta de un común **nunca queda en negativo**.
- **2d. Retiro**: la orden de 2a en el retiro sale **Abonada** sin pasar por el cobro; la
  de 2b exige cobrar los $50.

## 3. F3: editar el precio de una orden ya descontada

Sobre la orden de 2a (cubierta entera por $100), desde caja-admin → Editar orden:

- **Baja a $80** → el mensaje de la caja dice "Billetera re-sincronizada: «…» recuperó
  $ 20.00"; el consumo queda en −80 y el saldo sube $20.
- **Sube a $130 con saldo** → el consumo pasa a −130, el saldo baja $30.
- **Sube a $150 SIN saldo** → el consumo queda igual, la marca pasa a PARCIAL y los $50
  restantes nacen como ORDEN en la principal con deuda; la orden vuelve a pendiente.
- Repetir una edición desde la **pre-factura** (guardar precios) sobre una orden cubierta:
  mismo comportamiento (el aviso sale en el toast).

## 4. Semanal: exención al ingreso + cierre F2 (agotamiento orden a orden)

Con el cliente SEMANAL, su BILLETERA con saldo (ej. $100) y 3 órdenes de la semana
(ej. $40, $50 y $30):

- **4a. Ingreso**: al entrar a depósito NO se descuenta nada (las libres de un semanal se
  saltean; solo una restringida-por-material descontaría al ingreso).
- **4b. Pre-factura**: abrir Facturar semanales → paso 2 muestra la **caja 🔋** con el
  desglose: "SUB-a ← BILLETERA UY", "SUB-b ← BILLETERA UY" y "a factura va 1 por $30"
  (FIFO: $40+$50 caben, la de $30 ya no porque quedan $10).
- **4c. Cerrar** → la factura sale SOLO por $30; el libro muestra los 2 consumos
  (−40, −50, saldo final $10); las 2 órdenes cubiertas quedan pagas y marcadas
  `CUBIERTO_CUENTA_… (cierre ciclo #N)`.
- **4d. Negativo (solo semanales)**: prender "negativo" en la cuenta (⚙ del 360), repetir
  con saldo insuficiente → cubre TODO y la cuenta queda en rojo (visible en rojo en el
  libro y los chips); la próxima carga la compensa. Apagar el switch al terminar.
- **4e. Cubre todas** → el paso 2 muestra el cartel verde "cubre TODAS → cierra SIN factura"
  y el botón dice "Cerrar ciclo descontando de la billetera".

## 5. F5: "Cubrir con mi billetera" (portal)

Con el cliente COMÚN, dejarle 1–2 órdenes pendientes de pago (caso 2b/2c) y saldo:

- **5a. Alcanza**: portal → Retirar pedidos → elegir las órdenes → "Método de pago" →
  botón cyan **"Cubrir con mi billetera"** (muestra el saldo usable) → el Swal detalla
  "SUB-x ← «BILLETERA UY» $ …" y avisa "no se emite factura nueva" → confirmar →
  retiro RW nace **Abonado**, las órdenes quedan cubiertas (misma marca + deuda cancelada).
- **5b. NO alcanza**: con más total que saldo, el botón no aparece; si se fuerza por API →
  400 listando qué orden no entra y los saldos disponibles.
- **5c. Reversa**: 360 → libro de la cuenta → 🔄 sobre uno de esos consumos con
  "reactivar orden" → la plata vuelve, la marca se limpia y la deuda vuelve PENDIENTE.

## 6. Candado "nunca negativo" como medio de pago

En caja (Pago de Deudas o cobro de retiro), elegir medio **"Saldo de cuenta"** con una
cuenta con menos saldo que la línea → cartel rojo inline y bloqueo, aunque la cuenta
tenga "negativo ON" (el negativo es solo del descuento automático semanal).

## 7. Dónde MIRAR el saldo agotado (resumen de control)

| Situación | Dónde se ve |
|---|---|
| Consumo parcial por falta de saldo | Libro de la cuenta: obs `CUBIERTO_PARCIAL_CUENTA … (sin saldo para el total…)` + ORDEN del resto en la principal |
| Semanal en rojo (negativo ON) | Saldo en ROJO en libro, chips del 360 y portal |
| Orden que el cierre no pudo cubrir | Caja 🔋 del paso 2: "a factura van N por $X" — y sale facturada |
| Portal sin saldo | Botón "Cubrir con mi billetera" desaparece; API responde 400 con los saldos |
| Consulta global (hoy no hay pantalla) | `SELECT` de cuentas con saldo real < 0 o = 0 (ver arriba) — si se quiere, se arma un reporte/alerta |

---

**Al terminar**: si probaste con datos inventados, avisar qué órdenes/facturas de prueba
quedaron para limpiarlas (o anularlas por bandeja si emitiste CFE de prueba).
