# Cierre retroactivo de bultos — 25/09/2026

Dos SQL que acompañaron el arreglo del 25/09: hasta ese día, entregar un retiro o cancelar una orden no tocaba sus bultos.

- `cierre_bultos_entregados_2026-09-25.sql`: pasa a ENTREGADO los bultos de retiros ya entregados que seguían «en stock». Según su cabecera, eran 24.494 en producción.
- `cierre_bultos_ordenes_canceladas_2026-09-25.sql`: pasa a CANCELADO los bultos de órdenes canceladas antes del cambio.

**En producción:** el CHANGELOG del deploy del 07/10 indica correrlos después del reinicio. Si se corrieron, no lo sé.
