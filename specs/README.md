# Especificaciones del Sistema (specs)

Especificaciones funcionales del sistema, escritas a **nivel de negocio**, no de implementación.
Su propósito es doble:

1. **Documentar** lo que el sistema hace hoy: entidades, reglas, ciclos de vida y flujos.
2. **Servir de contrato** para el diseño de la próxima versión del sistema: estas specs
   describen el QUÉ; el sistema nuevo decide libremente el CÓMO (tecnología, esquema físico,
   nombres de tablas y campos).

## Convenciones

- **Nada de nombres físicos**: las specs no mencionan tablas, columnas ni funciones del
  código actual. Hablan de conceptos ("el documento fiscal guarda una foto del receptor"),
  nunca de implementación ("la columna X de la tabla Y").
- **Entidad** se escribe con mayúscula inicial (Pedido, Orden, Documento, Retiro) y se
  define en la spec del módulo dueño; las demás specs la referencian.
- **RN-XX.NN**: las reglas de negocio se numeran por módulo (ej. RN-CAJA.03) para poder
  citarlas desde otras specs y, en el futuro, desde el diseño del sistema nuevo.
- **INV**: los invariantes (condiciones que deben cumplirse SIEMPRE) se marcan aparte;
  son las reglas que la base de datos nueva debe garantizar por estructura, no por código.
- Los estados se nombran por su significado de negocio, no por su código numérico actual.

## Índice

| Spec | Contenido |
|------|-----------|
| [00-glosario.md](00-glosario.md) | El lenguaje ubicuo: definición canónica de cada término del sistema |
| [01-vision-general.md](01-vision-general.md) | Qué es el sistema, actores, módulos y cómo se conectan |
| [02-pedidos-e-ingreso.md](02-pedidos-e-ingreso.md) | Canales de ingreso, Pedido vs Orden, cotización al ingresar |
| [03-produccion.md](03-produccion.md) | Áreas, ciclo de vida de la Orden, bandejas, control, capacidad |
| [04-logistica-y-entrega.md](04-logistica-y-entrega.md) | Bultos, remitos, transporte, depósito, retiros, pedido completo |
| [05-caja-y-cobranza.md](05-caja-y-cobranza.md) | Sesiones de caja, cobros, anticipos, billetera, deudas |
| [06-facturacion-y-contabilidad.md](06-facturacion-y-contabilidad.md) | CFE/DGI, documentos, deudas, ciclos, plan de cuentas, multiempresa |
| [07-recursos-del-cliente.md](07-recursos-del-cliente.md) | Planes de metros, rollos, telas del cliente, bobinas |
| [08-stock-articulos-tienda.md](08-stock-articulos-tienda.md) | Catálogo de artículos, WMS, combos, tienda del portal |
| [09-precios.md](09-precios.md) | Precios base, perfiles escalonados, precios especiales, monedas |
| [10-portal-usuarios-notificaciones.md](10-portal-usuarios-notificaciones.md) | Portal de clientes, roles internos, WhatsApp, email |
| [11-modelo-de-datos-conceptual.md](11-modelo-de-datos-conceptual.md) | Entidades, relaciones e invariantes — sin nombres físicos |
| [12-seguridad.md](12-seguridad.md) | *(to-be)* Módulo dedicado: identidad, autorización por operación, fail-closed |
| [13-trazabilidad-auditoria.md](13-trazabilidad-auditoria.md) | *(to-be)* Módulo dedicado: libro único de eventos, correlación, retención |
| [14-maquina-de-estados-procesos.md](14-maquina-de-estados-procesos.md) | *(to-be)* Motor declarativo de estados, transiciones, guardas y flujos |
| [15-errores-y-mensajes.md](15-errores-y-mensajes.md) | *(to-be)* Tratamiento central de errores, catálogo de mensajes, best-effort declarado |
| [16-arquitectura-y-modularidad.md](16-arquitectura-y-modularidad.md) | *(to-be)* Monolito modular, capas, POO con dominio rico, eventos, ADRs |
| [17-frontend-y-experiencia.md](17-frontend-y-experiencia.md) | *(to-be)* Contratos de interacción: audiencias, claridad máxima, patrones, permisos en UI |
| [18-documentos-impresos-y-reporteria.md](18-documentos-impresos-y-reporteria.md) | *(to-be)* Plantillas × variantes (térmica/A4), PDFs almacenados y descargables, estaciones, reportes |
| [19-gestion-de-archivos.md](19-gestion-de-archivos.md) | *(to-be)* Repositorio con metadata, estructura derivada, pipeline de validación configurable |
| [20-procesamiento-de-imagenes.md](20-procesamiento-de-imagenes.md) | *(to-be)* Operaciones de imagen versionadas, editores que guardan data (terminaciones, texturas, bordado) |
| [21-administracion-y-mantenimiento.md](21-administracion-y-mantenimiento.md) | *(to-be)* Reglas comunes de ABM de maestros, seeds versionados, backups/purgas/salud, consola de administración |
| [22-integraciones-externas.md](22-integraciones-externas.md) | *(to-be)* Contratos por proveedor (DGI, WMS, WhatsApp, pasarelas...), degradación, sandbox |
| [23-requisitos-no-funcionales.md](23-requisitos-no-funcionales.md) | *(to-be)* Volúmenes reales, p95, concurrencia, RPO/RTO, archivado |
| [24-estrategia-de-pruebas.md](24-estrategia-de-pruebas.md) | *(to-be)* Cada RN con su prueba, suite sagrada de invariantes, regresiones históricas, e2e canónicos |
| [25-cumplimiento-legal-y-datos.md](25-cumplimiento-legal-y-datos.md) | *(to-be)* Conservación fiscal, Ley 18.331, tabla de retenciones (plazos pendientes de contador/asesor) |
| [26-crm-comercial.md](26-crm-comercial.md) | *(to-be)* Leads con conversión real, una sola regla de asignación de vendedor, auditoría comercial |
| [27-soporte-mesa-de-ayuda.md](27-soporte-mesa-de-ayuda.md) | *(to-be)* Tickets con guardas en servidor, SLA por área, tipificación de cierre, métricas |
| [28-tesoreria.md](28-tesoreria.md) | *(to-be)* Cheques con asiento obligatorio por transición, cuentas bancarias, boletas de depósito, conciliación |
| [29-compras-y-gastos.md](29-compras-y-gastos.md) | *(to-be)* Proveedor como entidad, egreso que asienta según medio real, cuentas por pagar (alcance A/B a decidir) |
| [30-contenido-portal-cms.md](30-contenido-portal-cms.md) | *(to-be)* Piezas de contenido con vigencia, publicación con permiso, landing fuera del código, precios públicos internos |
| [31-migracion-de-datos.md](31-migracion-de-datos.md) | *(to-be)* Qué se migra/recalcula/abandona, pipeline repetible, corte por pedido, convivencia |
| [32-plan-de-construccion.md](32-plan-de-construccion.md) | *(to-be)* Las 7 etapas de construcción, verificables por etapa, reglas del plan |
| [33-presupuestos-cotizaciones.md](33-presupuestos-cotizaciones.md) | *(to-be)* Presupuesto formal con validez, aceptación en portal, conversión a pedido con precios pactados |
| [34-mantenimiento-de-maquinas.md](34-mantenimiento-de-maquinas.md) | *(to-be)* Preventivo por uso/calendario, correctivo, máquina parada descuenta capacidad, historial y costos |
| [35-estados-contables.md](35-estados-contables.md) | *(to-be)* Períodos con cierre, estado de resultados, balance que cuadra por construcción, conciliaciones |
| [36-rrhh-ligero.md](36-rrhh-ligero.md) | *(to-be)* Legajo, asistencia, licencias que descuentan capacidad, export de novedades al estudio |
| [37-activos-fijos.md](37-activos-fijos.md) | *(to-be)* Activos con amortización automática, vínculo máquina↔activo, bajas y ventas |
| [38-presupuesto-de-gastos.md](38-presupuesto-de-gastos.md) | *(to-be)* Partidas por rubro, real vs presupuesto, alerta de desvío durante el mes |
| [39-fallas-faltantes-y-parciales.md](39-fallas-faltantes-y-parciales.md) | *(to-be, pendiente de aprobación)* Envío parcial entre áreas, libro de entregas por orden, faltantes con reposición hacia atrás, solicitud de insumo del cliente o del local |
| [40-beneficios-pactados.md](40-beneficios-pactados.md) | *(to-be, pendiente de aprobación)* Beneficios sobre la billetera: plantillas, pacto vendedor-cliente con aprobación, activación por carga facturada, precios pactados y consumo de la bolsa |

Las specs 01–11 documentan el sistema **actual** (as-is, a nivel de negocio). Las specs
12–14 son de **escalamiento** (to-be): definen módulos que el sistema actual no tiene como
tales y que el nuevo debe tener, partiendo del diagnóstico del actual.

## Cómo mantenerlas

Cuando una regla de negocio cambia o se agrega una funcionalidad, la spec del módulo se
actualiza en el mismo cambio. Una spec desactualizada es peor que ninguna.
