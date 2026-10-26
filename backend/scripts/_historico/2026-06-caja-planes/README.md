# Caja y planes — junio 2026

**Qué pasó:** ajustes de esquema y de datos de la caja y de los planes de metros (22 y 24/06, Yoania).

- `addEsCajaAdmin.js` y `addNotaGestionAutorizacion.js`: agregan columnas (ALTER TABLE).
- `fix-entregas-mal-tipadas.js`: corrige consumos de cuentas de recurso (metros o kilos) que quedaron como `ORDEN`/`ORDEN_ANTICIPO`. Venían de la «Nueva orden» del panel de planes.
- `fix-plan-articulos-no-cubiertos.js`: 3 clientes a los que se les cobró en plata una orden DTF/UV que su plan cubría.
- `verificar-iva.js`: solo lectura, de un solo uso (tasa de IVA por línea de factura).

**En producción:** las columnas de los dos `add*` están (inferido: el código las usa). Los dos `fix-*`, no lo sé.
