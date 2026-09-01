# Spec 01 — Visión General del Sistema

> Nivel: negocio. Sin nombres de tablas, columnas ni funciones.

## 1. Qué es el sistema

Sistema integral de gestión para una empresa de **producción gráfica/textil** en Uruguay:
impresión por sublimación, DTF, UV gran formato, impresión directa, bordado, corte láser,
costura/confección, parches, estampado y venta de productos. Cubre el ciclo completo:

```
Cliente pide (portal / interno / tienda / API)
   → Pedido → Órdenes por área
   → Producción (lotes o bandejas, por área)
   → Bultos → Remitos → Transporte
   → Depósito central (aquí la mercadería se convierte en plata)
   → Aviso al cliente (WhatsApp/push)
   → Retiro (mostrador / encomienda)
   → Caja (cobro) → Documento fiscal (CFE ante DGI) → Contabilidad
```

Dos flujos de dinero paralelos al de mercadería: la **billetera del cliente** (anticipos,
cuentas, saldos a favor) y los **recursos prepagos** (planes de metros, "rollo en plata",
telas propias del cliente en depósito).

## 2. Actores

| Actor | Rol |
|---|---|
| **Cliente del portal** | Pide, aprueba bocetos, ve sus recursos, retira, paga |
| **Diseñador** | Tercero autorizado por el cliente; pide a nombre del cliente sin ver precios |
| **Vendedor / Atención** | Ingresa pedidos internos, gestiona ventas de rollo y entregas |
| **Operario de área** | Produce: lotes, máquinas, bandejas, control de calidad, fallas |
| **Logística / Depósito** | Bultos, remitos, transporte, recepción, estantes, entrega |
| **Cajero** | Cobra retiros y deudas, anticipos, arqueo |
| **Contabilidad** | Factura (CFE), ciclos, notas de crédito, libros, reportes, tesorería |
| **Administrador** | Usuarios, roles, nomencladores, configuración, precios, consola |
| **Contador (externo)** | Recibe exports de libros y reportes |

## 3. Módulos y sus specs

| # | Módulo | Spec |
|---|---|---|
| 02 | Pedidos e ingreso | [02-pedidos-e-ingreso.md](02-pedidos-e-ingreso.md) |
| 03 | Producción por áreas | [03-produccion.md](03-produccion.md) |
| 04 | Logística, depósito y entrega | [04-logistica-y-entrega.md](04-logistica-y-entrega.md) |
| 05 | Caja y cobranza | [05-caja-y-cobranza.md](05-caja-y-cobranza.md) |
| 06 | Facturación y contabilidad | [06-facturacion-y-contabilidad.md](06-facturacion-y-contabilidad.md) |
| 07 | Recursos del cliente | [07-recursos-del-cliente.md](07-recursos-del-cliente.md) |
| 08 | Artículos, stock y tienda | [08-stock-articulos-tienda.md](08-stock-articulos-tienda.md) |
| 09 | Precios | [09-precios.md](09-precios.md) |
| 10 | Portal, usuarios y notificaciones | [10-portal-usuarios-notificaciones.md](10-portal-usuarios-notificaciones.md) |
| 11 | Modelo de datos conceptual | [11-modelo-de-datos-conceptual.md](11-modelo-de-datos-conceptual.md) |

## 4. Los conceptos que atraviesan todo

1. **Pedido vs Orden**: el Pedido es el proyecto del cliente; la Orden es la unidad de
   trabajo por área. Casi toda regla difícil del sistema nace de esta relación (órdenes
   hermanas, pedido completo, hermanas internas, multitela).
2. **Pedido completo**: la mercadería avanza, se contabiliza y se avisa **solo cuando el
   pedido está completo** (en el área, globalmente, o físicamente, según la etapa). Es el
   gate maestro de logística y notificaciones.
3. **El check-in en depósito convierte mercadería en plata**: ahí nace el cargo contable,
   la deuda o el consumo de recursos, y el derecho al aviso.
4. **Cobertura**: una orden puede estar cubierta por pago, plan de metros, cuenta
   restringida, crédito de ciclo o adelanto. La cascada de cobertura decide si el retiro
   frena en caja.
5. **Dos monedas siempre**: pesos y dólares conviven en todos los módulos; todo importe
   viaja con su moneda y toda conversión registra su cotización.
6. **Documentos congelados**: precios, receptor y cotización se sellan al emitir; nada
   posterior los altera. Lo aceptado por DGI solo se revierte con Nota de Crédito.
7. **Integridad por recálculo**: los saldos acumulados guardados demostraron corromperse;
   la verdad está siempre en los movimientos. (El sistema nuevo debe resolver esto por
   estructura — ver Spec 11.)
8. **Toda acción tiene autor**: cambios de estado, cobros, envíos y ediciones registran
   usuario, fecha y detalle; sin usuario identificable, la operación se rechaza.
9. **Configuración sobre código**: prefijos de área, estados padre/hijo, reglas contables,
   servicios visibles, gates y umbrales viven en datos administrables, no en el código.

## 5. Sistemas externos

| Sistema | Rol |
|---|---|
| **DGI (vía proveedor CFE homologado)** | Autorización de comprobantes fiscales (CAE) |
| **WMS** | Depósito externo de productos: catálogo, variantes, stock, remitos de egreso |
| **Proveedor de WhatsApp** | Plantilla de aviso "pronto para retirar" |
| **Proveedores de email** | Transaccional del portal + contabilidad |
| **Pasarelas de pago** | Cobros online (siempre caja administrativa) |
| **Banco Central** | Cotización diaria del dólar |
| **Almacenamiento de archivos** | Artes, referencias, comprobantes |
