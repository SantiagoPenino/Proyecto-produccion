# Spec 37 — Activos Fijos y Amortizaciones (to-be)

> Módulo nuevo (hoy explícitamente inexistente: las máquinas no viven en la contabilidad).
> Alcance deliberadamente acotado: registro del activo + amortización automática +
> bajas/ventas. La política contable la fija el contador.
> Entidades definidas aquí: **Activo Fijo**, **Plan de Amortización**, **Baja de Activo**.

## 1. El Activo Fijo

- **RN-ACT.01** Un **Activo Fijo** registra: descripción, categoría (maquinaria,
  vehículos, equipos de cómputo, mejoras — nomenclador con cuenta contable y vida útil
  por defecto), fecha y valor de compra con moneda/cotización, proveedor (Spec 29),
  comprobante adjunto (Spec 19), ubicación/área, y estado (en uso / en mantenimiento /
  dado de baja / vendido).
- **RN-ACT.02** **Las máquinas de producción son activos**: el equipo de la Spec 03 y el
  activo contable se vinculan — la ficha técnica (capacidad, mantenimiento, Spec 34) y la
  ficha contable (valor, amortización) son dos caras del mismo bien, nunca dos registros
  sueltos.
- **RN-ACT.03** El alta puede nacer de una compra (Spec 29: una factura de proveedor cuya
  categoría es de naturaleza "activo" — INV-COM del tratamiento por naturaleza — propone
  crear el activo) o cargarse directa (los bienes existentes entran por carga inicial,
  Spec 31, con valor residual que indique el contador).

## 2. Amortización

- **RN-ACT.04** Cada activo tiene su **Plan de Amortización**: método lineal por vida
  útil en meses (otros métodos solo si el contador los pide), valor residual, inicio.
  El sistema genera el **asiento mensual de amortización** como asiento de ajuste del
  período (Spec 35 RN-EST.02) — automático, con previsualización en el cierre.
  > DECISIÓN PENDIENTE (contador): vidas útiles por categoría, tratamiento fiscal
  > (coeficientes DGI) vs contable, y si la amortización la asienta el sistema o el
  > estudio (en cuyo caso el módulo solo lleva el registro y el cálculo informativo).
- **RN-ACT.05** El activo muestra en todo momento: valor de origen, amortización
  acumulada y **valor neto** — que es lo que suma al balance (Spec 35 RN-EST.06).

## 3. Bajas y ventas

- **RN-ACT.06** **Baja** (rotura, obsolescencia): motivo obligatorio, asiento de baja del
  neto contra resultado, estado terminal. **Venta**: el documento de venta (Spec 06) se
  vincula al activo; el resultado de la venta (precio − neto) se asienta como
  ganancia/pérdida por venta de activo. Ambas con permiso propio y registro (Spec 13).
- **RN-ACT.07** El historial del activo consolida: compra, mantenimientos y sus costos
  (Spec 34 RN-MNT.07), amortizaciones, y baja/venta — el costo total de poseer cada
  máquina, de punta a punta.

## 4. Interacciones

| Con | Relación |
|---|---|
| Spec 34 | Mismo bien, dos caras: mantenimiento (técnica) y activo (contable). |
| Spec 35 | Amortización como ajuste del período; neto en el balance. |
| Spec 29 | La compra de naturaleza activo propone el alta; proveedor y comprobante. |
| Spec 31 | Los bienes existentes entran por carga inicial con valores del contador. |
