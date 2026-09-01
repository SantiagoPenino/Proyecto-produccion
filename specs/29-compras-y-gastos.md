# Spec 29 — Compras, Gastos y Proveedores (to-be)

> Spec de escalamiento. El hallazgo estructural del sistema actual: está construido
> enteramente desde el lado del cliente — **el lado del proveedor no fue modelado**. Solo
> existe el "egreso de caja chica" (que funciona bien como vale) con huecos contables.
> El sistema nuevo modela el circuito del gasto; la profundidad del circuito de compras
> es una decisión de alcance del negocio (§5).
> Entidades definidas aquí: **Proveedor**, **Egreso**, **Cuenta por Pagar**, **Pago a
> Proveedor**, **Categoría de Gasto**.

## 1. Diagnóstico del sistema actual

Lo que funciona (se conserva): el egreso como transacción atómica (egreso + asiento +
documento numerado + PDF archivado, todo o nada); voucher con numeración correlativa y
firmas de entrega/recepción; bimonetario con cotización; anulación limpia con motivo;
separación caja central/administrativa con reclasificación; presencia en el arqueo.

Lo que falla:
1. **No existe el Proveedor**: el beneficiario es texto libre — imposible saber cuánto se
   le pagó a alguien; el documento interno se emite contra el cliente genérico.
2. **El asiento siempre acredita Caja** aunque se pague por transferencia o cheque: el
   gasto por banco descuenta el efectivo del cajón para siempre.
3. El cajero imputa eligiendo **directamente una cuenta del plan contable** (sin capa de
   categorías amigable); "modificar monto" está roto para el 100% de los egresos reales.
4. Sin comprobante del proveedor adjunto, sin IVA compras, sin cuentas por pagar, sin
   autorización ni topes, sin gastos recurrentes, sin centros de costo, sin reportes de
   gastos, sin retiros de socios (que hoy solo podrían registrarse mal, como gasto).

## 2. Proveedor (la entidad que falta)

- **RN-COM.01** El **Proveedor** existe como ficha: razón social, RUT, contacto,
  condición de pago, categoría de gasto habitual, cuenta bancaria para transferencias,
  estado activo. Todo egreso, endoso o cheque emitido **referencia a un Proveedor** (o a
  un beneficiario ocasional tipificado — nunca texto libre suelto).
- **RN-COM.02** Pregunta respondible por diseño: "¿cuánto le pagamos a X este año, por
  qué conceptos y por qué medios?" — hoy imposible.

## 3. El Egreso (caja chica y gastos), corregido

- **RN-COM.03** El egreso registra: proveedor/beneficiario, **Categoría de Gasto**
  (capa amigable administrable, mapeada a cuenta contable — el cajero no elige cuentas
  del plan), moneda con cotización, **medio de pago que gobierna el asiento**:
  - efectivo ⇒ acredita caja (y entra al arqueo);
  - transferencia ⇒ acredita la cuenta bancaria (Spec 28 RN-TES.06), no toca el arqueo;
  - cheque propio ⇒ pasivo de cheques a pagar (Spec 28 RN-TES.02).
- **INV-COM.01** **El asiento del egreso refleja el medio de pago real.** (Corrige el
  defecto estructural actual.)
- **RN-COM.04** El egreso admite **adjuntar el comprobante recibido** (boleta/factura del
  proveedor — al repositorio, Spec 19) y desglosar IVA compras si el comprobante lo
  discrimina.
  > DECISIÓN PENDIENTE (contador): si se lleva crédito fiscal de IVA compras en el
  > sistema o solo el total al gasto (como hoy).
- **RN-COM.05** **Autorización configurable**: tope de importe por rol para egresos de
  caja; por encima, exige autorización elevada (Spec 12 RN-SEG.08). Los conceptos
  sensibles (retiro de socio, préstamo) requieren siempre autorización.
- **RN-COM.06** **Retiros de socios** son un concepto propio que imputa a patrimonio,
  no a gasto (corrige la única forma actual de registrarlos, contablemente incorrecta).
- **RN-COM.07** **Gastos recurrentes** (alquiler, servicios): plantillas con periodicidad
  que generan el egreso propuesto para confirmar — nadie tiene que acordarse.
- **RN-COM.08** Se conservan: voucher imprimible (vía Spec 18, con su variante ticket),
  anulación con motivo, "modificar monto" = anular + recrear (**funcionando** para todo
  egreso), bandeja con filtros y totales del filtro completo.

## 3.1 La familia de gastos (jerarquía de clasificación)

> El espejo, del lado del gasto, de la familia de productos: hoy el cajero imputa
> eligiendo una cuenta del plan contable — no hay clasificación de negocio.

- **RN-COM.10** Los gastos se clasifican en una **jerarquía propia de dos niveles**:
  **Rubro → Categoría de Gasto** (ej.: Insumos de producción → Tintas; Estructura →
  Alquiler; Vehículos → Combustible; Personal → Jornales). Es un dato maestro
  administrable (Spec 21) con las reglas comunes: nada referenciado se borra, cambios
  con historial, seeds versionados.
- **INV-COM.02** **La clasificación de negocio y la imputación contable son cosas
  distintas y se mapean**: cada Categoría de Gasto declara su cuenta contable — el
  operador elige la categoría (lenguaje del negocio), el asiento sale del mapeo (lenguaje
  del contador). Cambiar el mapeo afecta solo gastos futuros; el histórico conserva
  cuenta y categoría con las que nació. Es el mismo principio del sector comercial:
  la mirada del negocio es reconfigurable sin romper series.
- **RN-COM.11** Cada Categoría declara además su **comportamiento**: exige proveedor
  identificado o admite beneficiario ocasional; exige comprobante adjunto; admite
  recurrencia; requiere autorización siempre (retiros de socios, préstamos); y su
  **naturaleza contable** (gasto de resultado / patrimonio / activo) — lo que hace
  estructuralmente imposible registrar un retiro de socio como gasto (defecto actual).
- **RN-COM.12** Los reportes de gastos cortan y consolidan **por rubro y categoría**
  (roll-up), comparables mes a mes, con drill-down al egreso — el espejo exacto de
  "ventas por sector/área". Y el cruce ventas por sector vs gastos por rubro es la base
  del estado de resultados simple (RN-COM.09).

## 4. Reportes de gastos (hoy inexistentes)

- **RN-COM.09** Mínimos: gastos por categoría y período (comparativo mensual), gastos por
  proveedor, gastos por medio de pago, y el cruce con ventas (base de un estado de
  resultados simple).
  > DECISIÓN PENDIENTE (negocio): centros de costo por área/máquina — el modelo lo
  > soporta (categoría × área), se activa si el negocio lo quiere gestionar.

## 5. El circuito de compras completo — DECISIÓN DE ALCANCE

Dos niveles posibles; la spec deja ambos definidos y **el negocio elige** cuál se
construye primero:

**Nivel A — Gastos y pagos (lo descrito arriba)**: proveedor + egreso corregido +
cuentas por pagar simples (registrar la factura del proveedor como deuda, pagarla después
— total o parcial — con cualquier medio, antigüedad de saldos con proveedores). Cubre el
90% de la necesidad real detectada y da, junto a ventas, un resultado del período.

**Nivel B — Compras con stock**: orden de compra → recepción de mercadería → factura del
proveedor conciliada → impacto en costos e inventario de insumos (bobinas de material
propio, Spec 07). Más pesado; solo tiene sentido si el negocio quiere gestionar el
abastecimiento dentro del sistema.

> DECISIÓN PENDIENTE (negocio): Nivel A entra en el plan (Spec 32, etapa 6 sugerida);
> Nivel B se decide después de operar con A.

## 6. Interacciones

| Con | Relación |
|---|---|
| Spec 28 | Pagos por banco y cheques emitidos contra proveedores; endosos. |
| Spec 06 | Asientos por el motor de reglas; cuentas por pagar como pasivo; IVA compras si se decide. |
| Spec 05 | El egreso de efectivo sigue en el arqueo; central vs administrativa. |
| Spec 19 | Comprobantes del proveedor adjuntos al repositorio. |
| Spec 21 | Categorías de gasto como datos maestros con reglas comunes. |
