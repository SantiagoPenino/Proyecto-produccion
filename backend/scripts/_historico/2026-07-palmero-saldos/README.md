# Palmero y saldos — julio 2026

**Qué pasó:** la sesión del 20-21/07 sobre el cliente Palmero destapó bugs generales de saldo: cargos en la moneda equivocada y saldo a favor fantasma. La cronología está en `RESUMEN_SESION_20-07_PALMERO.md`. Los mismos bugs, en forma genérica y con la consulta para detectarlos, están en `backend/scripts/CATALOGO_BUGS_SALDO_CLIENTES.md`, que sigue vigente.

- `diag_*.js` y `resolver_clientes_por_doc.js`: solo lectura. `diag_reconciliacion_lote.js` no anda: lee `diag_reconciliacion_cliente.sql`, que no existe.
- `fix_referencia_cobros.js` (23/07): escribe. Completa el documento de los cobros que el Panel 360 mostraba «Sin referencia».

**En producción:** `fix_referencia_cobros.js`, no lo sé.
**Quedó en `backend/scripts/`:** `backfill_ordcodigoorden_detalle.js`, porque lo cita `contabilidadReportesController.js`.
