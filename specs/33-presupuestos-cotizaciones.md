# Spec 33 — Presupuestos / Cotizaciones al Cliente (to-be)

> Módulo nuevo (no existe en el sistema actual): el presupuesto formal PREVIO al pedido —
> documento con validez, enviable, aceptable, convertible en Pedido. Hoy el sistema
> cotiza internamente al ingresar, y los presupuestos se piden... por ticket de soporte
> ("Presupuestos / Área de Ventas" es una categoría del helpdesk).
> Entidades definidas aquí: **Presupuesto**, **Línea de Presupuesto**, **Aceptación**.

## 1. El Presupuesto

- **RN-PSU.01** Un **Presupuesto** es un documento comercial no fiscal: cliente (o
  prospecto/lead — puede presupuestarse a quien aún no es cliente, Spec 26), líneas
  (artículo/servicio, cantidad, precio), moneda con cotización, **validez** (vence a N
  días, configurable por defecto), condición de pago propuesta y notas. Numeración
  correlativa propia.
- **RN-PSU.02** Los precios de las líneas salen del **motor de precios real** (Spec 09:
  lista del cliente, perfiles, promociones vigentes) con la traza del cálculo — pero son
  **editables por el vendedor** dentro de su permiso (descuento máximo por rol; más allá,
  autorización elevada, Spec 12 RN-SEG.08). El precio pactado queda registrado con quién
  lo autorizó.
- **RN-PSU.03** Ciclo de vida (motor, Spec 14): **Borrador → Enviado → Aceptado /
  Rechazado / Vencido** (vence solo al pasar su validez — nada depende de memoria).
  Un presupuesto vencido puede **revalidarse** (recalcula contra los precios vigentes y
  muestra las diferencias) o duplicarse como versión nueva.
- **RN-PSU.04** **Envío**: PDF por plantilla (Spec 18, con la identidad de la Empresa
  Emisora) por email con registro (Spec 10 RN-MAIL.05), y visible en el portal del
  cliente con botón de **aceptar en línea** (la aceptación registra quién, cuándo y qué
  versión aceptó).

## 2. Conversión a Pedido

- **INV-PSU.01** **Aceptado ⇒ convertible en Pedido con sus precios congelados**: la
  conversión crea el Pedido (Spec 02) con las líneas y precios del presupuesto como
  override pactado (Spec 09 §5.6) — el motor no recalcula lo pactado, y la línea del
  documento final referencia al presupuesto de origen. Si al convertir cambió algo
  estructural (artículo desactivado, material sin stock), se informa y se resuelve antes.
- **RN-PSU.05** Un presupuesto aceptado **no obliga**: puede convertirse parcialmente
  (algunas líneas) o no convertirse; lo no convertido queda visible como oportunidad
  abierta del vendedor (Spec 26).
- **RN-PSU.06** Trazabilidad completa: presupuesto → pedido → órdenes → factura comparten
  correlación (Spec 13). La pregunta "¿cuánto de lo presupuestado se concreta?" (tasa de
  conversión por vendedor, por servicio) es un reporte estándar.

## 3. Interacciones

| Con | Relación |
|---|---|
| Spec 02 | La conversión crea el Pedido; el presupuesto es el paso previo opcional. |
| Spec 09 | Precios del motor + override pactado con autorización; congelamiento. |
| Spec 26 | Presupuestos a leads; oportunidades del vendedor; tasa de conversión. |
| Spec 18 | PDF por plantilla, almacenado y descargable. |
| Spec 27 | La categoría de tickets "presupuestos" deriva a este módulo. |
