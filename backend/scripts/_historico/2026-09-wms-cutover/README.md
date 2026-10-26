# Cutover del WMS propio — setiembre 2026

**Qué pasó:** el stock pasó del WMS externo a las tablas propias `Wms_*`. El import en producción dio paridad perfecta el 24/09, y `WMS_INTERNO=true` está en producción desde el 30/09.

- `wmsBajarSnapshot.js`: baja la foto del WMS externo, para importar sin conexión.
- `wmsRepararNegativos.js`: **escribe en el WMS externo.** No correrlo después del cutover.
- `wmsBultosVentaAlDeposito.js` (17/09): mueve a Depósito los bultos de ventas VEN que quedaron trabados en PRO.
- `diagWmsEgresos.js`: solo lectura contra el WMS externo.
- `menu_stock_gestion.sql`, `menu_stock_secciones_2026-09-28.sql`: el menú de /stock y sus cinco secciones.
- `wms_compras_recibido_2026-09-30.sql`: lo recibido de las compras migradas del sistema viejo.

**En producción:** `wms_compras_recibido_2026-09-30.sql` se corrió el 30/09 (CHANGELOG). Del resto, no lo sé.
**Quedaron en `backend/scripts/`**, porque el código los cita: `wmsImportSnapshot.js`, `wmsRellenoTelas.js` y `sql/areas_sector_stock_2026-09-29.sql`.
Los documentos de la corrida están en `docs/_historico/2026-09-wms-cutover/`.
