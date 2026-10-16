# Tu sistema frente a un ERP profesional — qué falta por módulo

Fecha: 02-oct-2026. Referencia principal: Odoo; en lo esencial coincide con SAP Business One, Dynamics Business Central y ERPNext.

**Alcance y límites de esta comparación.** Está hecha con: el inventario completo de la base local (258 tablas, 187 con datos), la lectura a fondo del código de stock, compras, precios y contabilidad, y lo relevado en trabajos anteriores. **No** es una auditoría función por función de todos los módulos: donde dice "no lo vi" significa que no hay tabla ni rastro en lo revisado, no que esté descartado. Producción no se revisó.

Columna **Vos**: ✔ lo tenés · ◐ parcial · ✘ no lo vi.
Columna **Prioridad**: **A** afecta plata o datos hoy · **M** ordena y ahorra trabajo · **B** cuando haga falta.

---

## 0. Lo primero: cuatro diferencias de fondo

Antes del detalle, lo que más separa tu sistema de un ERP no son funciones sueltas sino cuatro cosas de base:

| # | En un ERP | En tu sistema | Prioridad |
|---|---|---|---|
| 1 | **Un maestro de artículos** del que cuelgan compras, stock, precios y contabilidad | Cuatro catálogos sin unir | **A** — es la propuesta del maestro |
| 2 | **Un maestro de terceros**: el mismo registro sirve de cliente, proveedor y contacto | Clientes por un lado (y hay cinco tablas de clientes en la base), proveedores en tres versiones | **A** |
| 3 | **La cadena de documentos enlazada**: presupuesto → pedido de venta → entrega → factura → cobro, cada uno apuntando al anterior | El "pedido" no es un documento propio: es un número que agrupa órdenes. Los presupuestos son texto libre, sin cliente ni artículos enlazados | **M** |
| 4 | **Relaciones declaradas en la base**: no se puede guardar una línea que apunte a algo inexistente | 67 relaciones declaradas para 258 tablas; el resto se sostiene en el código | **A** — es el origen de los huérfanos y duplicados que venimos reparando |

---

## 1. Terceros (clientes, proveedores, contactos)

| Función | Qué hace un ERP | Vos | Nota | Pr. |
|---|---|---|---|---|
| Ficha única cliente/proveedor | un registro, con roles | ✘ | 5 tablas de clientes (`Clientes`, `Clientes_Copia`, `ClientesPlanilla`, `Clientesreact`, "BASE DE DATOS CLIENTES REGISTRADOS") y 3 versiones de proveedor | A |
| Varios contactos y direcciones | facturación, entrega, contactos con cargo | ◐ | hay direcciones de envío; contactos no los vi | M |
| Condición de pago en la ficha | plazo, cuotas | ◐ | existe la tabla de condiciones (5); la ficha del cliente no la referencia | M |
| Límite de crédito con bloqueo | frena el pedido al superarlo | ◐ | hay alerta de cobranzas; bloqueo automático no lo vi | M |
| Lista de precios por cliente | asignada en la ficha | ✔ | precios especiales y perfiles por cliente | — |
| Posición fiscal | exento, exportación, zona franca: cambia impuestos solo | ✘ | el IVA es 22 % fijo | A |
| Grupos / etiquetas de clientes | segmentar para precios, canales, marketing | ◐ | tipos de cliente (4); grupos libres no | M |
| Vendedor asignado y equipo | | ✔ | | — |

## 2. Artículos

Ver `PROPUESTA_maestro_articulos_erp.md` y `ESTRUCTURA_NUEVA_maestro_articulos.md`. Resumen de lo que un ERP trae y hoy falta: roles (se vende / se compra / se fabrica), árbol de categorías con herencia de cuentas e impuestos, unidades con conversión y unidad de compra distinta, variantes por atributos con costo y precio propios, proveedor por artículo, costo estándar/promedio/último, visibilidad por canal y por cliente, códigos de barras, receta de materiales.

Lo que un ERP trae además y conviene prever en el diseño:

| Función | Vos | Pr. |
|---|---|---|
| Empaques (caja de 12, pallet) con su código de barras | ✘ | B |
| Productos alternativos y accesorios sugeridos (venta cruzada) | ✘ | B |
| Peso y volumen del artículo (para flete) | ◐ solo en compras | B |
| Vencimiento y garantía | ✘ | B |
| Historial de cambios de la ficha | ✘ | M |

## 3. Ventas y CRM

| Función | Qué hace un ERP | Vos | Nota | Pr. |
|---|---|---|---|---|
| Embudo de oportunidades | leads → etapas → ganado/perdido con motivo | ◐ | leads web (855) con estado; sin etapas ni motivos | M |
| Actividades y recordatorios | llamar, visitar, con fecha y responsable | ✘ | | M |
| Presupuesto formal | con cliente y artículos reales, validez, aceptación en línea, se convierte en pedido | ◐ | 5 presupuestos en texto libre; la solicitud de vendedor cubre parte | M |
| Pedido de venta como documento | con estado propio y enlace a entrega y factura | ◐ | implícito en el número de pedido | M |
| Margen en la línea | precio − costo al cotizar | ✘ | no hay costo en el artículo | A |
| Plantillas de presupuesto y opcionales | | ✘ | | B |
| Comisiones de vendedores | por venta cobrada, por margen | ✘ | no lo vi | M |
| Devolución de mercadería | reingresa stock y genera nota de crédito enlazada | ◐ | notas de crédito sí; el reingreso de stock no lo vi | M |
| Cupones, puntos, tarjetas de regalo | | ◐ | beneficios sobre billetera (tablas creadas, sin datos en local) | B |
| Contratos y suscripciones | facturación recurrente | ✔ | ciclos de crédito y planes de metros: propio y más rico que el estándar | — |

## 4. Precios

| Función | Vos | Nota | Pr. |
|---|---|---|---|
| Precio base + reglas por cantidad + por cliente | ✔ | bien resuelto | — |
| Precio por variante y por unidad | ✘ | propuesta del maestro | A |
| Vigencias (desde / hasta) y precios programados | ✘ | | M |
| Reglas por categoría del árbol | ◐ | hoy por "grupo" en texto | M |
| Precio calculado desde el costo (costo + margen) | ✘ | | M |
| Historial de precios | ✘ | la tabla existe, vacía | M |
| Varias monedas con cotización diaria | ✔ | | — |

## 5. Compras

| Función | Qué hace un ERP | Vos | Nota | Pr. |
|---|---|---|---|---|
| Pedido de compra y recepción | | ✔ | en el WMS propio, con importaciones y costos extra prorrateados | — |
| Proveedor por artículo, con su código y precio | | ✘ | | A |
| Unidad de compra distinta | compro por rollo, guardo por metro | ✘ | | A |
| Factura del proveedor | conciliada con pedido y recepción | ✘ | la compra no tiene comprobante estructurado ni IVA | A |
| **Cuentas por pagar** | deuda por proveedor, vencimientos, pagos | ✘ | hoy un pago a proveedor es un egreso de caja | A |
| Aprobación por monto | | ◐ | hay "autorizar recepción" | M |
| Sugerencia de compra | por punto de pedido o por pedidos de venta | ✘ | los umbrales existen pero solo pintan el panel | M |
| Pedidos abiertos / licitaciones | | ✘ | | B |
| Gastos (no stock) con categoría e IVA | | ◐ | egreso de caja por tipo; sin IVA compras | A |

## 6. Inventario

| Función | Vos | Nota | Pr. |
|---|---|---|---|
| Stock por depósito y por lote | ✔ | WMS propio | — |
| Traslados entre depósitos con remito | ✔ | | — |
| Conteos y ajustes con diferencia registrada | ✔ | | — |
| Costo por lote | ✔ | | — |
| Un solo stock (mercadería + insumos + bobinas) | ✘ | tres stocks separados | A |
| Reservas | ✘ | el stock baja al preparar, no al vender | A |
| Material de terceros (del cliente) dentro del mismo stock | ◐ | existe, pero en tablas aparte | M |
| Ubicaciones dentro del depósito (pasillo, estante) | ◐ | estantes para bultos; no para artículos | B |
| Punto de pedido y reposición automática | ◐ | umbrales sin acción | M |
| Vencimientos, números de serie | ✘ | | B |
| Valorización contable del stock | ✘ | queda para la etapa de inventario permanente | M |
| Costo en cada movimiento | ✘ | | A |
| Merma y descarte valorizados | ◐ | se registran, sin costo | M |
| Lectura por código de barras | ✔ | | — |

## 7. Fabricación, calidad y mantenimiento

| Función | Qué hace un ERP | Vos | Nota | Pr. |
|---|---|---|---|---|
| Órdenes de producción por área, con estados | | ✔ | bandejas, requisitos, dependencias entre órdenes: más fino que el estándar | — |
| Ruta de producción | lista de operaciones por producto | ◐ | procederes en el configurador; las tablas de rutas están vacías | M |
| **Lista de materiales (receta)** | qué consume cada producto y cuánto | ◐ | repartida en cuatro tablas; `OrdenMateriales` vacía | A |
| Consumo real por orden | lo que de verdad se gastó contra lo previsto | ◐ | solo en bobinas | A |
| Centros de trabajo con capacidad | | ✔ | máquinas con velocidad, slots, capacidad diaria | — |
| **Costo por orden** | materiales + mano de obra + máquina | ✘ | sin costo hora ni tiempos | A |
| Tiempos por operación | previstos y reales | ◐ | hay bitácora de producción; tiempos estándar no | M |
| Subcontratación (tercerizar una etapa) | | ✘ | | B |
| Calidad: puntos de control y no conformidades | | ◐ | control por área y fallas tipificadas (57 tipos); sin plan de control ni acciones correctivas | M |
| Mantenimiento preventivo y correctivo | | ◐ | tickets de mantenimiento (6); sin preventivo ni historial de costos | M |
| Versiones de ficha / molde | saber con qué versión se hizo cada pedido | ✘ | | M |
| Planificación y fecha prometida | | ✔ | | — |

## 8. Contabilidad y finanzas

| Función | Vos | Nota | Pr. |
|---|---|---|---|
| Asientos automáticos por evento | ✔ | motor de eventos y reglas | — |
| Factura electrónica | ✔ | CFE / DGI | — |
| Cuenta corriente de clientes, deuda, antigüedad | ✔ | | — |
| Varias empresas | ✔ | 2 | — |
| Diferencia de cambio | ✔ | | — |
| Cuenta de ingresos e impuesto por artículo/familia | ✘ | todo a una cuenta; IVA fijo | A (decidido) |
| Tasa mínima y exentos bien tratados | ✘ | el exento manual se convierte en 22 %; la mínima no viaja a DGI | A |
| Cuentas por pagar | ✘ | | A |
| Conciliación bancaria | ✘ | no hay cuentas bancarias propias | A |
| Cierre de período | ✘ | no vi ningún bloqueo que impida asentar en un mes ya informado | A |
| Costo de ventas e inventario | ✘ | el plan no tiene cuenta de costo de ventas | M (decidido: después) |
| Centros de costo / analítica | ◐ | sector y área se deducen para reportes; no están en el asiento | M |
| Estados contables (resultados, balance) | ◐ | reportes para el contador; el libro usa otro plan escrito en el código | M |
| Activos fijos y amortización | ✘ | | B |
| Presupuesto de gastos contra real | ✘ | | B |
| Ingresos diferidos | ✔ | anticipos y planes prepagos | — |
| Retenciones y percepciones | ✘ | no lo vi | M |
| Reclamo automático de deuda | ◐ | cola de estados de cuenta | B |

## 9. Tesorería y caja

| Función | Vos | Nota | Pr. |
|---|---|---|---|
| Caja con sesiones, arqueo y medios de pago | ✔ | | — |
| Cobro en línea | ✔ | MercadoPago, Handy | — |
| Cheques recibidos y emitidos | ✔ | con asiento | — |
| Cuentas bancarias propias y movimientos | ✘ | solo lista de bancos | A |
| Depósitos, transferencias entre cajas y bancos | ✘ | | M |
| Flujo de fondos proyectado | ✘ | | M |
| Varias cajas con turnos | ◐ | hoy una sesión global | M |

## 10. E-commerce y portal

| Función | Vos | Nota | Pr. |
|---|---|---|---|
| Portal de clientes con pedidos, archivos, estado de cuenta | ✔ | más completo que el estándar | — |
| Tienda con carrito y pago | ✔ | | — |
| Categorías de vidriera y fotos por color | ✔ | | — |
| Selector de variantes con precio por variante | ◐ | selector sí; precio por variante sin datos | A |
| Catálogo y precios según el cliente | ◐ | precios sí; catálogo por cliente no | M |
| Aviso de stock y bloqueo sin stock | ✘ | se vende sin control a propósito | M |
| Carritos abandonados, reseñas, SEO | ✘ | | B |
| Contenido editable sin programar | ◐ | tabla creada, sin datos | B |

## 11. Logística y entregas

| Función | Vos | Nota | Pr. |
|---|---|---|---|
| Bultos, remitos, depósito, retiros, pedido completo | ✔ | propio y detallado | — |
| Agencias y formas de envío | ✔ | | — |
| Costo de flete cobrado al cliente y pagado a la agencia | ✘ | no lo vi | M |
| Seguimiento del envío | ◐ | | B |

## 12. Personas

| Función | Vos | Nota | Pr. |
|---|---|---|---|
| Legajo | ◐ | 81 trabajadores con datos mínimos | B |
| Asistencia, licencias, turnos | ✘ | | M (las licencias cambian la capacidad) |
| Costo hora por puesto | ✘ | necesario para el costo por orden | M |
| Liquidación de sueldos | ✘ | lo normal es exportar novedades al estudio | B |
| Rendición de gastos | ✘ | | B |

## 13. Soporte y posventa

| Función | Vos | Nota | Pr. |
|---|---|---|---|
| Mesa de ayuda con departamentos | ✔ | 406 tickets | — |
| Tiempos comprometidos de respuesta, motivo de cierre, métricas | ✘ | | M |
| Reclamos de clientes enlazados al pedido | ◐ | | M |
| Servicio técnico / reparaciones con insumos | ✔ | | — |

## 14. Transversal

| Función | Qué hace un ERP | Vos | Nota | Pr. |
|---|---|---|---|---|
| Usuarios, roles y permisos | | ✔ | 18 roles, 445 permisos | — |
| Permiso por registro | "el vendedor ve solo sus clientes" | ◐ | no lo revisé a fondo | M |
| Auditoría de cambios | quién cambió qué, en cualquier ficha | ◐ | registro general; no por campo | M |
| Notas y adjuntos en cualquier registro | | ◐ | en órdenes y tickets | B |
| Aprobaciones configurables | por monto, por descuento | ◐ | casos puntuales (sin pago, beneficios) | M |
| Numeración por tipo de documento | | ✔ | | — |
| Integridad de datos | relaciones declaradas | ✘ | 67 de 258 tablas | A |
| Rutas protegidas | | ◐ | `/api/stock` y `/api/insumos` no piden sesión | A |
| Importar y exportar datos | plantillas por maestro | ◐ | | B |
| Tableros e indicadores | | ✔ | reportes y tableros propios | — |
| Tablas de respaldo fuera del esquema | | ✘ | hay copias (`_bk_…`, `…_backup_…`) dentro de la base operativa | M |
| Ambiente de prueba separado | | ✔ | local | — |

---

## 15. Dónde tu sistema está por delante

Un ERP estándar no trae, y vos sí:
- producción por áreas con bandejas, requisitos por orden y dependencias entre órdenes del mismo pedido;
- manejo de archivos de impresión con medición automática y control de medida;
- planes de metros, rollos adelantados y billetera del cliente;
- tela y prendas del cliente como recurso;
- integración con TizadaPro (moldes y consumo de tela);
- avisos por WhatsApp atados al estado del pedido;
- pedido completo: no sale a depósito hasta que estén todas las órdenes.

Eso es el corazón del negocio y no hay que tocarlo. Lo que falta está alrededor: maestros, compras, costos y finanzas.

---

## 16. Orden recomendado

| Etapa | Qué | Por qué primero |
|---|---|---|
| 1 | Maestro de artículos: saneo, ficha, árbol, unidades | todo lo demás se apoya en esto |
| 2 | Variantes y precios por variante y unidad | vender papel por rollo/metro; short por color |
| 3 | Ingresos e IVA por familia; corregir exentos y tasa mínima | decidido; impacta lo que se informa a DGI |
| 4 | Proveedor único, proveedor por artículo, costo último y promedio | sin costo no hay margen |
| 5 | Terceros unificados y cuentas por pagar | deja de pagarse a proveedores "por caja" |
| 6 | Cuentas bancarias, conciliación y cierre de período | cierra el circuito financiero |
| 7 | Receta y consumo por orden; costo por orden | margen real por producto fabricado |
| 8 | Stock único, reservas y punto de pedido | un solo número de stock |
| 9 | Inventario contable permanente | cuando compras y costos ya son confiables |
| 10 | Presupuesto → pedido → factura enlazados; comisiones; devoluciones | ordena el circuito comercial |
| después | calidad, mantenimiento preventivo, personas, activos fijos, presupuesto de gastos | cuando el resto esté firme |
