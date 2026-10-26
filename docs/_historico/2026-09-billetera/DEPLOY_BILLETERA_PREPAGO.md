# DEPLOY — Billetera prepaga (pivot F0–F5) · 31-08-2026

Paquete completo del pivot de la billetera: **toda plata adelantada entra CONTRA FACTURA**
(Venta de saldo en caja o recarga web facturada) y **los consumos no generan documento**
(orden a orden, como el rollo). Comunes descuentan al ingreso; semanales al cierre con
precios finales.

---

## 0. Diagnóstico primero

Correr `diag_billetera_prod.sql` (solo lectura) en prod: dice OK/FALTA por componente.
Estado al 01/09/2026: **TODO FALTA — prod no tenía nada del proyecto** (los scripts 1,
2 y 5 se estaban corriendo ese día).

## 1. SQL en PRODUCCIÓN — correr ANTES del deploy de código, EN ESTE ORDEN

Los scripts son idempotentes (se pueden correr de nuevo sin romper nada). El código nuevo
referencia las columnas/tipos que crean: si el código sube antes que el SQL, el backend
rompe al tocar cualquier cuenta.

**⚠️ CUÁNDO correr cada uno:**
- **1, 2 y 5 pueden ir cualquier día** (solo agregan columnas/tipos/medio que el código viejo no mira).
- **3 va PEGADO al deploy** (misma ventana: script → deploy → reinicio). Motivo: el
  backend viejo, ante un cliente cuya única cuenta es la BILLETERA recién creada, usaría
  LA BILLETERA como cuenta del sistema y las facturas le caerían adentro (mismo bug que
  se corrigió en `obtenerOCrearCuenta` el 01/09 — el fix viene en este deploy).
- **En la ventana del deploy, ANTES del script 3: repasar el script 1** (idempotente).
  El backend viejo crea cuentas nuevas con `CueEsPrincipal = 0` (deriva diaria detectada
  el 01/09: 1 par sin principal a horas del backfill); el re-run barre esa deriva.
- **Cómo correr los SQL en prod**: SIEMPRE File → Open desde el disco en SSMS (o
  `sqlcmd -i archivo`). NUNCA copiar/pegar el contenido desde el chat: la vista previa
  corta el texto cerca de la línea 100 y el script llega truncado (pasó el 01/09:
  mitad del script 1 aplicado y errores "Incorrect syntax" fantasma).
- **4 NO hace falta en prod**: era para migrar las billeteras viejas de local; el script 3
  actual ya las crea nacidas PREPAGO+automático. Correrlo igual no rompe (migra 0).

| # | Script | Qué hace | Qué esperar (referencia local) |
|---|--------|----------|-------------------------------|
| 1 | `add_billetera_cuentas.sql` | Columnas `CueNombre`/`CueEsPrincipal`/`CueRestringida`/`CueAutoConsumo`/`CueModalidadFiscal` + backfill de LA principal por (cliente, moneda) + índice único + tabla `CuentasClienteArticulosPermitidos` + TiposMovimiento `TRANSFERENCIA_*`, `CONSUMO_CUENTA`, `CARGA_PREPAGO` + medio de pago **"Saldo de cuenta"** | Local: 2.194 principales marcadas, 0 clientes sin principal. La verificación final "SIN principal" debe dar **0** |
| 2 | `add_tipo_pago_saldo.sql` | TipoMovimiento `PAGO_SALDO` (billetera usada como medio de pago) | "PAGO_SALDO listo." |
| 3 | `crear_billeteras_clientes.sql` | Crea "BILLETERA USD" y "BILLETERA UY" **solo para los clientes con alguna principal ACTIVA** (= los que operaron; en prod ≈2.700 pares): secundarias libres, **PREPAGO_FACTURADO**, auto **ON**, negativo **NO**, usuario 999. Los demás clientes las reciben **automáticamente al prenderles el switch** "Billetera visible en el portal" (setBilleteraPortal las crea si faltan — E2E validado 01/09) | El diag chequea: billeteras ≥ clientes con principal activa, y 0 habilitados sin sus 2 billeteras |
| 4 | ~~`migrar_billeteras_prepago.sql`~~ | **OBSOLETO — no correr**: era para migrar las billeteras viejas de local; ahora nacen PREPAGO+auto. El diag solo avisa si apareciera alguna en otra modalidad | — |
| 5 | `add_billetera_portal.sql` | Columna `Clientes.CliBilleteraPortal` (default **0**): la sección "Mi billetera" del portal solo la ven los clientes habilitados (switch en 360 → "Cuentas" → "Billetera visible en el portal") | Al principio NADIE la ve: habilitar cliente por cliente desde el 360 |

> Recordatorio: correrlos **el usuario en prod** (yo no toco prod). Guardar el output
> del punto 4: esa lista es el trabajo manual pendiente.

## 2. Config opcional

- `ConfiguracionGlobal` clave **`VALOR_UI`** (valor de la Unidad Indexada en pesos, ej
  `6.5`): define el umbral DGI del e-Ticket de la recarga web (10.000 UI ⇒ ~$65.000).
  Si la clave no existe, el sistema usa 6,5 como default. Conviene crearla y mantenerla.

## 3. Deploy de código + reiniciar backend

Backend (piezas del pivot):
- `services/contabilidadService.js` — motor auto-consumo (moneda/semanal/negativo),
  `consumirPrepagoDelCiclo` (F2), `resincronizarConsumosBilletera` (F3), transferencias,
  cierre que excluye `CUBIERTO%`.
- `controllers/contabilidadController.js` — consumir/devolver/revertir/editar consumos,
  carga-prepago, guardar-precios×2 con resync F3, asientos billetera.
- `controllers/ordenesRetiroController.js` y `controllers/quotationController.js` — resync F3 al
  editar costo / repropagar cotización.
- `controllers/webOrdersController.js` + `routes/webOrdersRoutes.js` — portal: mis-cuentas,
  recarga facturada (F4), comprobante PDF, cubrir-con-billetera (F5), webhooks Handy/MP.
- `controllers/cfeController.js`, `services/cajaService.js`, `services/retiroService.js` —
  medio "Saldo de cuenta", cobertura de retiros, guards.
- `utils/documentoUY.js` — validación RUT/CI (espejo en `src/utils/documentoUY.js`).

Frontend: portal `src/client-portal/modulos/RecursosView.jsx` (Mi billetera: recarga con
e-Ticket/e-Factura + PDF) y `PickupView.jsx` (botón "Cubrir con mi billetera"); gestión
`ContabilidadCuentasView.jsx`, `CierreCicloPreviewModal.jsx` (paso 2 con caja 🔋),
`ClienteBilletera`/360, `CajaPanelPago`, etc.

**Después del deploy: reiniciar el backend** (el motor cachea eventos/columnas).

## 4. Guía de merge del lunes (rama del compañero)

Conflictos esperados en:
- `cerrarCicloCompleto` (contabilidadService)
- `crearDeudaDocumento` (contabilidadService)
- flujo `pago-deuda` (`procesarPagoDeudaInterno` / contabilidadController)

**Resolución: tomar el lado LOCAL.** La copia local ya reimplementa la semántica de sus
3 reportes de prod (cierre y link excluyen `NOT LIKE 'CUBIERTO%'`; la deuda del cierre
nace por el TOTAL con `aplicarSaldoAFavor=false` y la cobertura por saldo queda como pago
VISIBLE `ANTICIPO_APLICADO` con `ImputacionPago` dirigida; `procesarPagoDeudaInterno`
escribe la traza en `ImputacionPago`). Después del merge, comparar contra su rama para
confirmar que no traía algo extra fuera de esos 3 puntos.

## 5. Smoke test post-deploy (en orden)

0. **Visibilidad**: entrar al portal con un cliente cualquiera → "Mi billetera" NO debe
   aparecer. 360 → "Cuentas" → prender "Billetera visible en el portal" → refrescar el
   portal → la sección aparece. (El switch es solo visibilidad web; el descuento
   automático interno no cambia.)
1. **Recarga web (F4)**: portal → Mi billetera → Recargar (elegir e-Ticket, monto chico)
   → pagar con la pasarela real → verificar: factura en la bandeja CFE (PENDIENTE),
   `CARGA_PREPAGO` con `VS-<doc>` en el libro de la cuenta, saldo subió, botón 📄 PDF
   en Movimientos descarga el comprobante.
   - Si la factura se emite y la carga falla: **NO reemitir** — libro de la cuenta →
     "Vincular factura emitida" (el log del backend lo dice con 🚨).
2. **Común con saldo**: ingresar una orden a depósito → se descuenta sola de la
   BILLETERA (CONSUMO_CUENTA, sin ORDEN en la principal, orden pronta).
3. **F3**: editar el precio de esa orden desde caja → el consumo se re-cuadra (la
   diferencia vuelve/sale de la cuenta; el mensaje de la caja lo dice).
4. **Semanal (F2)**: pre-factura → paso 2 muestra la caja 🔋 con el desglose → cerrar →
   la factura sale SOLO por lo no cubierto.
5. **F5**: portal → retirar pedidos pendientes → "Cubrir con mi billetera" → confirma el
   desglose → retiro nace Abonado; reversa 🔄 desde el libro si hace falta.

## 6. Sin SQL nuevo en F3/F4/F5

F3 (resync al editar precios), F4 (recarga facturada) y F5 (cubrir desde el portal) no
agregan tablas ni columnas: usan lo de los scripts 1–4.
