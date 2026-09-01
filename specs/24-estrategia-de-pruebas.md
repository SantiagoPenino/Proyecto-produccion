# Spec 24 — Estrategia de Pruebas y Calidad (to-be)

> Cómo se verifica el sistema nuevo. Especialmente crítica porque el desarrollo será
> asistido por agentes de IA: la suite de pruebas es lo que impide que "terminado"
> signifique solamente "compila". El sistema actual no tiene pruebas automatizadas: cada
> regla se verificó a mano y cada regresión se descubrió en producción.

## 1. Principios

- **INV-PRU.01** **Ninguna regla de negocio existe sin su prueba.** Cada RN e INV de las
  specs tiene al menos un caso de prueba que lo referencia por su número (RN-CAJA.16 →
  su test). La matriz specs↔pruebas es verificable: una regla sin prueba es deuda
  visible.
- **INV-PRU.02** **Los invariantes maestros (Spec 11 §10) son la suite sagrada**: diez
  familias de pruebas que corren SIEMPRE y cuya rotura bloquea cualquier integración de
  código. Un agente o humano no puede fusionar código que rompa "un documento, una deuda
  viva".
- **INV-PRU.03** Los **incidentes históricos son casos de regresión permanentes**: cada
  bug documentado en las specs (cobro 40×, deudas duplicadas, re-avisos masivos, remitos
  resucitados, doble descuento multitela, NC como venta) se codifica como prueba con
  nombre propio. El sistema nuevo nace inmune a los bugs que el viejo ya pagó.

## 2. La pirámide

| Nivel | Qué prueba | Sin qué corre |
|---|---|---|
| **Dominio (la base, la mayoría)** | Las clases de negocio: guardas, invariantes, cálculos (precios, coberturas, cuadres, conversiones) | Sin base de datos, sin servidor — posible por Spec 16 RN-ARQ.06 |
| **Módulo** | Casos de uso completos contra base real de prueba: transacciones, constraints, eventos emitidos | Sin proveedores externos (dobles de la Spec 22 RN-INT.02) |
| **Flujo (end-to-end)** | Las cadenas completas: pedido → producción → depósito → retiro → cobro → factura → asiento | Con todo el sistema, proveedores falsos |
| **Contrato externo** | Cada adaptador contra el sandbox real del proveedor (DGI homologación, WMS test) | A demanda, separada del resto |
| **Carga** | Los números de la Spec 23 (p95, concurrencia de escaneo, volumen ×3) | Periódica y antes de cada release mayor |

- **RN-PRU.01** Los flujos end-to-end canónicos mínimos (la lista viva crece):
  1. Pedido multitela → hermanas → pedido completo → check-in → aviso → retiro → cobro
     mixto cross-moneda → factura → DGI (simulado) → asiento cuadrado.
  2. Cliente rollo: compra de plan → orden cubierta → sobregiro → herencia → NC total
     bloqueada por consumo.
  3. Ciclo semanal: acumulación → pre-factura → cierre con neteo → anulación → reasignación.
  4. Falla por copias → reposición → linaje → cura de familia → re-aviso.
  5. Anulación de cobro: reversa completa sin retroceder estados físicos.

## 3. Reglas del proceso

- **RN-PRU.02** **Nada se integra sin pasar la suite** (bloqueo automático, no
  disciplina). Cada cambio corre: dominio + módulo afectado + suite sagrada; los e2e
  completos, al menos a diario.
- **RN-PRU.03** **Datos de prueba generados, nunca copiados de producción** (datos
  personales reales no viajan a ambientes de prueba — Spec 25). Un generador de
  escenarios produce clientes/pedidos/estados sintéticos realistas, incluyendo los casos
  torcidos (multitela, cross-moneda, combos, hermanas internas).
- **RN-PRU.04** **Ambientes**: desarrollo (cada quien el suyo, base propia sembrada por
  seeds — Spec 21 RN-ADM.03), pruebas (donde corren las suites), staging (réplica de
  configuración de producción, con sandbox de proveedores), producción. La promoción
  entre ambientes es siempre por el mismo mecanismo de deploy (Spec 21 RN-ADM.11).
- **RN-PRU.05** Los **chequeos de consistencia de negocio** (Spec 21 RN-ADM.09) son
  también aserciones post-prueba: al final de cada suite e2e, deudas duplicadas = 0,
  documentos descuadrados = 0, saldos = movimientos. Si un flujo los rompe, la prueba
  falla aunque el flujo "haya funcionado".
- **RN-PRU.06** **Definición de terminado** para cualquier tarea (humana o de agente):
  código + pruebas de sus reglas + specs actualizadas si la regla cambió + suite en
  verde. Las cuatro cosas o no está terminado.

## 4. Interacciones

| Con | Relación |
|---|---|
| Todas las specs | Cada RN/INV numerado es un caso de prueba trazable. |
| Spec 11 | Los diez invariantes maestros = la suite sagrada. |
| Spec 22 | Dobles por adaptador; contratos contra sandbox real. |
| Spec 23 | Los números de rendimiento son pruebas de carga automatizadas. |
| Spec 25 | Prohibición de datos reales en ambientes de prueba. |
