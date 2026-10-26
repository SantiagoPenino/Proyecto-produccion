# Desfasaje del cierre de ciclo — julio 2026

**Qué pasó:** cambios de precio en el cierre de ciclo que no llegaron a la factura dejaron el estado de cuenta distinto de la factura (15/07, Yoania). La regla que se tomó: la factura manda.

- `RUNBOOK_desfasaje_cierre_ciclo.md`: el procedimiento, cliente por cliente. El 15/07 decía «nada de esto se corrió todavía».
- `RUNBOOK_pendiente_produccion.md` (17/07): el orden para correr en producción los SQL de ese momento.
- `diagnostico_*.js`: solo lectura.
- `clientes_afectados_desfasaje.csv`: salida local con datos de clientes (fuera de git).

**En producción:** no lo sé. Los `.sql` que citan los runbooks no están en el repo (el 13/10 se decidió no rescatarlos).
**Quedó en `backend/scripts/`:** `auditoria_integridad_docs.js`, porque es genérico y se puede volver a usar.
