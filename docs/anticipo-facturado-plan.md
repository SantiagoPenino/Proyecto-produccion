# Saldo Anticipado facturable — plan

**Fecha:** 2026-08-20 · **Estado:** propuesta, sin implementar · **Origen:** el saldo anticipado debería facturarse al ingresar, y lo gastado con ese saldo NO debería volver a facturarse (hoy es al revés y el CFE del anticipo hecho "por afuera" termina en doble facturación).

---

## 1. Situación actual (verificada en código)

Los dos flujos de plata adelantada usan **modelos opuestos**:

| | Venta de recursos (plan/bolsa) | Saldo Anticipado (dinero) |
|---|---|---|
| Documento al ingresar | Pedido Caja `BORRADOR` o e-Ticket/e-Factura `PENDIENTE` → Bandeja CFE (`cajaService.procesarVentaDirecta`, línea ~539) | Solo Recibo interno serie RA, `cfeEstado: null` — **nunca es fiscal** (`cajaController.registrarPagoAnticipo`, ~3040) |
| Al consumir | La ORDEN monetaria se marca `CUBIERTO_POR_PLAN_X` (`contabilidadService` ~1070) y **queda excluida** de la facturación | Se debita billetera con mov `ORDEN_ANTICIPO` (`anticipoService.aplicarAnticipoAOrden`) y la orden **entra igual** a "Facturar semanales" |
| CFE final | Sobre la venta de la bolsa (1 sola vez) | Sobre las órdenes gastadas (`getOrdenesAnticipo` + `cerrarCicloCompleto`) |

- La cola "Facturar semanales" = `MovimientosCuenta` con `MovTipo IN ('ORDEN','ORDEN_ANTICIPO')`, `DocIdDocumento IS NULL`, `MovObservaciones NOT LIKE 'CUBIERTO%'` (`contabilidadController.getOrdenesAnticipo`, ~2902).
- El consumo del anticipo se dispara en la auditoría de depósito: si `saldoEfectivo >= monto` del retiro, se auto-aprueba entero (`auditDepositoController` ~381). **No existe aplicación parcial** en esta vía.
- `FacturarAnticipoModal.jsx` no lo importa nadie — código muerto.

**El agujero:** si al cliente se le emite un CFE por el anticipo (Factura Manual / venta directa con un concepto "anticipo"), el sistema no lo asocia a nada: las órdenes gastadas con ese saldo siguen en la cola y, al emitirlas, la misma plata se factura dos veces.

## 2. Objetivo

Replicar para el dinero el modelo que ya funciona con los planes:

1. El anticipo **puede facturarse al ingresar** (e-Ticket / e-Factura contado, además del Recibo actual).
2. Lo gastado con un anticipo facturado se marca `CUBIERTO_POR_ANTICIPO` y **no vuelve a facturarse**.

## 3. Preguntas abiertas (responder antes de implementar)

**(a) ¿Flag por cliente o por depósito?**
La billetera es fungible: si conviven anticipos facturados y sin facturar en la misma cuenta, decidir qué orden queda "cubierta" exige llevar FIFO de saldos por tipo — mucho mecanismo para poco caso real.
→ **Propuesta: flag por cliente** (`Clientes.FacturaPorAnticipo` bit, u opción equivalente por cuenta): "a este cliente los anticipos se le facturan; sus consumos nunca entran a la cola". Todo o nada, sin ambigüedad. El comprobante elegido en cada alta (Recibo vs CFE) queda igual registrado por depósito como trazabilidad.

**(b) Cobertura parcial.**
Hoy el auto-aprobado solo aplica anticipo cuando cubre el retiro ENTERO, así que no hay caso parcial en producción. ¿Lo dejamos así (si no alcanza el saldo, la orden va a caja/cta cte y se factura normal)? Los planes ya tienen precedente `CUBIERTO_PARCIAL_x/y` si algún día hace falta.

**(c) DGI / CFE de anticipo.**
La factura de anticipo en el régimen CFE tiene reglas propias (momento del IVA, referencia del anticipo en la factura definitiva si la hubiera). Acá el diseño evita la factura definitiva (el consumo no se factura), pero **esto hay que validarlo con el contador o el proveedor de CFE antes de codificar**: ¿alcanza con e-Factura/e-Ticket contado común con un concepto "Anticipo por servicios"? ¿o exige un tratamiento específico?

**(d) Migración.**
Clientes que ya tienen saldo cargado sin facturar cuando se prenda el flag: ¿sus consumos futuros se excluyen igual (y el anticipo viejo se factura a mano una vez), o el flag solo aplica a depósitos posteriores? Propuesta simple: al activar el flag, revisar y facturar el saldo vivo a mano ese día; desde ahí todo consumo queda excluido.

## 4. Fases

### F0 — Decisiones (sin código)
Responder (a)–(d). Con (a) y (c) resueltas, el resto es mecánico.

### F1 — Alta del anticipo con CFE
- `CajaSaldoAnticipoTab.jsx`: `tiposDocDisponibles` pasa de solo `RECIBO_ANTICIPO` a incluir `e-Ticket contado` / `e-Factura contado` (mismo combo y validación RUT/CI que venta directa). Datos DGI editables como en `CajaVentaDirectaTab`.
- `registrarPagoAnticipo` (cajaController ~3040): si `tipoDocumento` es CFE →
  - numerar por `SecuenciaDocumentos`/`Config_TiposDocumento` (mismo mecanismo que `procesarVentaDirecta` ~144),
  - `crearDocumentoContable` con ese tipo, `cfeEstado: 'PENDIENTE'` (entra solo a la Bandeja CFE), desglose IVA 22 sobre el importe, 1 línea "Anticipo: <concepto>",
  - el mov `ANTICIPO` de billetera guarda la referencia (`MovObservaciones = 'ANTICIPO_FACTURADO_DOC_<docId>'`).
  - Con Recibo se mantiene el comportamiento actual intacto (serie RA, cfeEstado null).
- El asiento contable no cambia de estructura (Caja / Deudores / Anticipos 2.3.1); solo revisar si con CFE corresponde abrir la pata de IVA — depende de (c).

### F2 — Exclusión del consumo
- `aplicarAnticipoAOrden` (anticipoService ~152): si el cliente tiene el flag → tras registrar el `ORDEN_ANTICIPO`, marcar **todos** los movimientos de esa entrega que hoy entran a la cola, espejando el UPDATE de los planes (`contabilidadService` ~1078):
  ```sql
  UPDATE m SET m.MovObservaciones = 'CUBIERTO_POR_ANTICIPO_<docId|CLIENTE>'
  FROM dbo.MovimientosCuenta m
  JOIN dbo.CuentasCliente cc ON cc.CueIdCuenta = m.CueIdCuenta
  WHERE (m.OReIdOrdenRetiro = @OReId OR m.OrdIdOrden IN (<hijas del retiro>))
    AND cc.CueTipo IN ('DINERO_USD','DINERO_UYU')
    AND m.MovTipo IN ('ORDEN','ORDEN_ANTICIPO')
    AND m.DocIdDocumento IS NULL
    AND (m.MovObservaciones IS NULL OR m.MovObservaciones NOT LIKE 'CUBIERTO%')
  ```
  (cubre tanto el débito nuevo como el cargo ORDEN que la orden ya tuviera de `hookOrdenCreada`).
- **Auditar las demás vías** que cancelan órdenes con billetera, para marcar igual si el flag está activo: grep de `SP_ImputarPagoPEPS`, `crearDeudaDocumento` (auto-consumo de saldo a favor), `procesarPagoDeuda` pagando con saldo, y la auto-imputación PEPS dentro del propio `registrarPagoAnticipo` (~3250). Regla general: deuda que ya nace de un documento fiscal no se toca (no hay doble); lo que se excluye es solo lo que iría a la cola de "pendiente de facturar".
- Verificar que TODOS los consumidores de la cola respeten `CUBIERTO%` (hoy: `getOrdenesAnticipo`, `contabilidadService` ~530/~1093/~1186, `contabilidadRoutes` ~536, email semanal ~291 — ya lo hacen; sumar test/grep al cierre).

### F3 — Bordes y limpieza
- **Anulaciones:** anular el CFE del anticipo → revertir crédito de billetera y (si hubo) desmarcar consumos, espejo de `revertirRecursosPorTransaccion` de los planes. Anular una orden marcada `CUBIERTO_POR_ANTICIPO` → devolver el débito a billetera (la reversa de `aplicarAnticipoAOrden` existente, revisar que conserve/limpie la marca).
- **Visibilidad:** en el 360, el chip de la orden cubierta debería decir "Cubierto por anticipo" (igual que hoy los `CUBIERTO_POR_PLAN` muestran lo suyo) para que no parezca que "falta facturar".
- Borrar `FacturarAnticipoModal.jsx` (muerto).
- CHANGELOG + este doc actualizado a "implementado".

## 5. Qué NO cambia

- Venta de recursos / planes: intactos (son el modelo de referencia).
- Clientes sin el flag: comportamiento 100% actual (recibo interno + facturación por semanales).
- El auto-aprobado del depósito, estados de retiro, arqueo de caja: sin cambios de lógica, solo la marca posterior.

## 6. Riesgos

- **(c) es el riesgo real**: si DGI exige un tratamiento de anticipo distinto al CFE contado común, cambia la F1. Validar primero.
- Marcar de más (excluir una orden pagada con plata NO facturada) = plata sin factura. Por eso el flag es por cliente y explícito, nunca inferido por saldo.
- Los saldos previos al flag (pregunta d) son el único caso con intervención manual.
