# Incidente del 07/10/2026 — pagos online sin registrar

Una consulta manual sin COMMIT bloqueó `PedidosCobranza`. Los webhooks de MercadoPago y Handy marcaron pagos como cobrados, pero no los registraron. `registrarPagosOnlinePendientes.js` los registra con el mismo payload del webhook.

**En producción:** corrido con `--ejecutar` para los 9 pagos (5 de MercadoPago y 4 de Handy). El arreglo de fondo está en `cobranzaService.js` (CHANGELOG del 07/10).
