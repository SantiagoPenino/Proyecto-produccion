# Órdenes de plan sin línea de pedido — setiembre 2026

- `reparar_rebaja_plan_ordenes_sin_linea.js` (25/09): desde el deploy del 23/09, las órdenes cubiertas por un plan de metros quedaban sin línea en `PedidosCobranzaDetalle` y el plan no se rebajaba (63 órdenes al 25/09). Rebaja lo que faltó.
- `backfill_desglose_pcd.js` (17 al 23/09): completa el desglose de precio (lista, descuento, recargo) de las líneas viejas, a partir del texto que dejaba el motor de precios.

**En producción:** no lo sé.
