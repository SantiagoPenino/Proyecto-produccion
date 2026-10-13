# Multitela: órdenes hermanas (x/y) con costo POR ORDEN — Plan

**Estado: PROPUESTA — no implementado.** (2026-07-08)

## Objetivo

Un pedido multitela sigue siendo UN pedido (`NoDocERP`), partido en órdenes hermanas `(1/2)`, `(2/2)`…
cada una con **su material y su costo propio**, atravesando TODO el flujo (producción, logística,
bultos, WSP, retiro, caja, CFE) sin romper nada de lo existente.

## Estado actual (mapa verificado en código)

| Etapa | Dónde | Granularidad HOY | Monto |
|---|---|---|---|
| Split "(x/y)" al crear | webOrdersController.js:728-737 | **Por orden** (solo SB, ≥2 telas) | sin costo al crear |
| Precio calculado | erpSyncService.js:145 → pricingService | **Por orden** | `Ordenes.CostoTotal` |
| Cabecera cobranza | erpSyncService.js:710-761 | **Por pedido** | `PedidosCobranza.MontoTotal` (1 fila/NoDocERP) |
| Detalle cobranza | erpSyncService.js:763-791 | **Por orden** | `PedidosCobranzaDetalle.Subtotal` (FK OrdenID) |
| **Depósito (check-in)** | logisticsController.js:1166/1240/1417 | **Por pedido (untado)** ⚠️ | `OrdenesDeposito.OrdCostoFinal` = MontoTotal en la 1ª hermana recibida, 0 en el resto |
| Aviso WSP | wspAvisos.job.js:269-286 | **Por pedido** (1 msg, suma hermanas) | `SUM(OrdCostoFinal)` |
| Bultos/etiquetas | LabelGenerationService.js:12,184-215 | **Por orden** | detalle impreso = pedido |
| Gates completitud | pedidoCompletoService (llamado por logistics:421,823 y productionFile:1855) | por área / global (NoDocERP) | n/a |
| Retiro | retiroService.js:113,250 | **Por retiro** (lump) | `OrdenesRetiro.OReCostoTotalOrden` |
| Pago MP/Handy/Caja | cajaController.js:1735-1762 | 1 cobro por pedido, **líneas por orden** | `DocumentosContablesDetalle` ← `pcd.Subtotal` |
| CFE | cfeController + contabilidadCore.js:415-484 | 1 doc por cobro, líneas por orden | idem |

**Conclusión:** el costo por orden YA existe y es limpio en `Ordenes.CostoTotal` y
`PedidosCobranzaDetalle.Subtotal` (ambos escritos por erpSync). El único punto donde se
degrada a "por pedido" es `OrdenesDeposito.OrdCostoFinal` (el check-in de depósito unta el
`MontoTotal` del pedido en la primera hermana y deja 0 en las demás). Todo lo aguas abajo
(WSP, caja, CFE) o suma hermanas del NoDocERP o va directo a `PedidosCobranzaDetalle`, por
eso hoy "funciona" pero las vistas por-orden muestran montos incoherentes (ej. el retiro
del portal mostraba el total del pedido en cada hermana).

## Diseño propuesto (mínimo invasivo)

### F0 — `OrdCostoFinal` por orden (el corazón del cambio)
En `logisticsController.receiveDispatch` (check-in DEPOSITO), al insertar cada fila de
`OrdenesDeposito`, en vez de `pc.MontoTotal`:
1. Buscar `PedidosCobranzaDetalle.Subtotal` por `OrdenID` (SUM de sus líneas).
2. Fallback: `Ordenes.CostoTotal` de esa orden.
3. Último fallback (sin cotización): comportamiento actual.
- El guard `MontoContabilizado` (evento contable por pedido) NO cambia: contabilidad sigue
  registrando el pedido una vez.
- **Invariante a validar con test**: `SUM(OrdCostoFinal de hermanas) == PedidosCobranza.MontoTotal`.

### F1 — Vistas de retiro/cobro leen el costo por orden
`getPickupOrders` (portal) y `getClientePickupOrders` (tótem): preferir el costo por orden
(`OrdCostoFinal` ya correcto tras F0, o `PedidosCobranzaDetalle`) en vez de
`PedidosCobranza.MontoTotal` por código. Cada hermana muestra SU importe; el total del
retiro = suma de las seleccionadas (eso ya funciona así). *(Nota: acá vivía el dedupe que
se revirtió el 08/07 — con F0 ese parche no hace falta: el dato de origen queda bien.)*

### F2 — WSP: sin cambios (verificar)
El job ya agrupa por `NoDocERP`, manda UN mensaje y suma `OrdCostoFinal` de las hermanas.
Con F0 la suma sigue dando el total del pedido. Solo verificación.

### F3 — Caja/CFE: sin cambios (verificar)
Ya cobran 1 documento por pedido con líneas por orden desde `PedidosCobranzaDetalle`
(match por NoDocERP sin sufijo). Verificar que el reparto proporcional siga cuadrando
con OrdCostoFinal nuevo.

### Fuera de alcance (decisiones aparte)
- **Retiro/pago PARCIAL de un pedido** (retirar la 1/2 sin la 2/2): hoy el gate global
  de DEPOSITO lo impide a nivel recepción, y el retiro agrupa lump. Habilitarlo es otra
  feature (tocaría pedidoCompletoService + retiroService + facturación parcial).
- Extender el split "(x/y)" a áreas no-SB.
- Migración de datos históricos (OrdenesDeposito viejas con el monto untado): NO tocar;
  el cambio aplica a check-ins nuevos.

## Preguntas abiertas (responder antes de implementar)

1. **¿Retiro parcial sí o no?** ¿Se puede retirar/cobrar una hermana sin la otra, o el
   pedido sigue siendo indivisible hasta estar completo (como hoy)?
2. **WSP**: ¿el mensaje sigue siendo UNO por pedido con el total (como hoy), o querés
   detalle por tela/orden en el texto?
3. **Precios congelados**: si el cajero edita el monto de un pedido en caja, ¿se ajusta a
   nivel pedido (MontoTotal) y se re-prorratea a las hermanas, o se edita por orden?
4. **Pedidos ya existentes** con OrdCostoFinal untado: ¿se dejan como están (propuesta) o
   hace falta un backfill?
5. El caso SUB-4727 mostró **ambas hermanas con 106.52** (no "una con todo y otra en 0"),
   lo que sugiere que en algún flujo las dos matchearon la cobranza. Verificar en prod
   cómo quedaron esas filas (`SELECT OrdCodigoOrden, OrdCostoFinal FROM OrdenesDeposito
   WHERE OrdCodigoOrden LIKE 'SUB-4727%'`) antes de asumir el patrón untado.
