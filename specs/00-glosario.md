# Spec 00 — Glosario (lenguaje ubicuo)

> El diccionario canónico del sistema. Cada término tiene UNA definición y se usa igual en
> specs, código, pantallas y conversación. Si un término no está acá, no es vocabulario
> del sistema. La spec del módulo dueño amplía el detalle; este glosario fija el nombre y
> la esencia.

## Partes

| Término | Definición | Spec |
|---|---|---|
| **Cliente** | Quien compra: tiene ficha, billetera, tipo comercial (común / semanal / rollo) y puede estar bloqueado | 10 |
| **Diseñador** | Tercero autorizado POR el cliente para pedir a su nombre, sin ver precios | 10 |
| **Usuario Interno** | Persona del equipo, con rol (permisos) y área asignada | 12 |
| **Vendedor** | Interno responsable de una cartera de clientes, asignado por zona | 26 |
| **Empresa Emisora** | Cada una de las razones sociales que emiten comprobantes fiscales | 06 |
| **Dispositivo Autorizado** | Equipo no-humano con llave: tótem, estación de impresión | 12 |

## Pedido y producción

| Término | Definición | Spec |
|---|---|---|
| **Pedido** | Lo que el cliente pide de una vez: el proyecto. Número correlativo único. Su estado se deriva de sus órdenes | 02 |
| **Orden** | Unidad de trabajo en UN área. Código único = prefijo de área + número de pedido (+ discriminador) | 02 |
| **Órdenes hermanas** | Las órdenes de un mismo pedido (varias áreas, o varias en la misma área: multitela) | 02 |
| **Hermana interna** | Orden que existe solo para el trabajo interno (terminaciones, componentes): el cliente no la ve | 02 |
| **Área** | Sector productivo (sublimación, DTF, bordado, corte…) con prefijo, secuencia y modelo de trabajo | 03 |
| **Servicio** | Lo que el cliente elige pedir en el portal; se traduce a órdenes en áreas | 02 |
| **Lote** | Agrupación de órdenes compatibles que se produce junta en una máquina | 03 |
| **Bandeja** | Modelo de trabajo por orden individual (sin lotes): bordado, estampado, corte, costura | 03 |
| **Magnitud** | La cantidad de una orden CON su unidad (metros, m², unidades, piezas, puntadas) | 03 |
| **Tizada** | Archivo de corte vectorial, medido automáticamente (piezas, metros de corte, metros de tela) | 02 |
| **Falla** | Re-trabajo por error interno; invisible para el cliente; costo 0; con linaje | 02 |
| **Reposición** | Re-trabajo a pedido del cliente; visible; costo 0; nunca mayor al original | 02 |
| **Matriz** | Molde/troquel de un parche: costo de arranque que se cobra una vez y se puede reusar | 02 |
| **Canasto** | Ubicación lógica de espera al salir de producción (producción, incompletos, falla, reposiciones) | 04 |
| **Fecha prometida** | La fecha de entrega sellada al cliente al ingresar (área + prioridad + calendario) | 03 |
| **Pedido completo** | El gate maestro: nada avanza a depósito, se contabiliza ni se avisa hasta que el pedido está completo (en área / global / físicamente) | 04 |

## Logística

| Término | Definición | Spec |
|---|---|---|
| **Bulto** | El paquete físico con etiqueta y QR; la unidad que se pistolea | 04 |
| **Remito** | Documento de traslado de bultos entre dos puntos, con firma de salida y recepción | 04 |
| **Orden en Depósito** | El registro comercial de la orden ya en el depósito central: lo que se cobra, avisa y entrega | 04 |
| **Check-in** | La recepción en el depósito central: el momento en que la mercadería se convierte en plata | 04 |
| **Esperando bultos** | Estado de un pedido al que le faltan bultos físicos: no se contabiliza ni se avisa | 04 |
| **Retiro** | Agrupación de órdenes en depósito de un cliente para un solo acto de entrega | 04 |
| **Encomienda** | Retiro cuyo destino no es el local: viaja como bulto en un remito a agencias | 04 |
| **Estante** | Casillero físico donde espera el paquete armado; nunca mezcla clientes | 04 |
| **Aviso** | La notificación al cliente de que su orden está pronta (WhatsApp/push), gobernada por gates | 10 |

## Dinero

| Término | Definición | Spec |
|---|---|---|
| **Billetera** | El conjunto de cuentas de un cliente (dinero por moneda + recursos) | 05 |
| **Cuenta principal** | Una por moneda; la única que cubre retiros automáticamente | 05 |
| **Cuenta restringida** | "Rollo en plata": paga sola las órdenes de sus artículos, puede ir en negativo | 05 |
| **Anticipo** | Dinero a favor del cliente (crédito), con recibo propio; se imputa por antigüedad | 05 |
| **Cobertura** | La cascada que decide si un retiro pasa por caja: pago / rollo / plan / cuenta / crédito | 05 |
| **Adelanto limpio** | Saldo real de la principal calculado desde movimientos, excluyendo la capa fiscal | 05 |
| **Caja central** | La del mostrador: con sesión, arqueable | 05 |
| **Caja administrativa** | Operaciones sin plata en mano: sin sesión, fuera del arqueo | 05 |
| **Sesión de caja** | El turno del cajero: apertura con fondo, cierre con arqueo por denominación | 05 |
| **Ciclo** | Período de acumulación de órdenes de un cliente semanal, facturado en un solo comprobante | 06 |
| **Plan de Recursos** | Bolsa prepaga de metros/kg/piezas que cubre órdenes sin pasar por caja | 07 |
| **Rollo (adelantado)** | La compra de un plan de recursos: se paga una vez y se consume con pedidos | 07 |
| **Movimiento** | Cada línea del submayor de una cuenta (el libro); la fuente de verdad del saldo | 05 |
| **Cheque** | Valor a depositar: nunca es plata en caja hasta que se deposita | 05 |
| **Exoneración** | "Pago" de $0 que salda una orden sin cambiar su importe ni su deuda | 05 |

## Facturación

| Término | Definición | Spec |
|---|---|---|
| **Documento** | Comprobante emitido: fiscal (e-Ticket, e-Factura, NC, ND) o interno (Pedido Caja, recibos) | 06 |
| **CFE** | Comprobante Fiscal Electrónico: el documento ante DGI, con CAE y número oficial | 06 |
| **Pedido Caja** | Borrador interno de venta: no es fiscal, debe convertirse para ir a DGI | 06 |
| **Deuda** | Lo pendiente de cobro de un documento; hereda la moneda de su cuenta; a lo sumo una viva por documento | 06 |
| **Receptor CFE** | A quién se emite el comprobante ante DGI: puede diferir del cliente interno, congelado en el documento | 06 |
| **Consumidor final** | Venta sin receptor identificado; la ficha genérica no tiene cuenta corriente | 06 |
| **Nota de Crédito** | La única reversa de un documento aceptado por DGI; referencia obligatoria al original | 06 |
| **Cuadre pre-DGI** | El bloqueo que impide enviar un CFE cuyas líneas no suman el total del documento | 06 |
| **Asiento** | Registro contable de partida doble bimonetaria, generado por el motor de reglas | 06 |
| **Cotización implícita** | La tasa a la que la plata entró de verdad (cobrado ÷ líneas), prioritaria para convertir | 06 |

## Catálogo y recursos

| Término | Definición | Spec |
|---|---|---|
| **Artículo** | Lo que se vende o se consume: cuelga de una categoría con tipo de stock | 08 |
| **Tipo de stock** | Material / producto terminado / producto local / terminación | 08 |
| **Terminación** | Servicio de acabado (ojal, soldadura, bolsillo, bastidor) con reglas de ubicación | 08 |
| **Combo** | Artículo compuesto: stock armable calculado, se explota en componentes | 08 |
| **Bobina** | Rollo físico de material en inventario (propio o del cliente), con ledger propio | 07 |
| **Tela del cliente** | Material físico que el cliente deja en depósito a su nombre, por bobina | 07 |
| **Precio base** | Precio de lista de un artículo, por moneda (artículo + moneda es la clave) | 09 |
| **Perfil** | Conjunto nombrado de reglas de precio escalonadas (global o asignado) | 09 |
| **Excepción** | Regla de precio propia de un cliente: gana sobre todo; única que puede valer 0 | 09 |
| **Congelamiento** | El momento en que un precio deja de recalcularse y queda sellado | 09 |

## Plataforma

| Término | Definición | Spec |
|---|---|---|
| **Evento de Negocio** | La unidad del libro de trazabilidad: quién, qué, cuándo, antes→después, correlación | 13 |
| **Correlación** | El hilo que une todo lo derivado de un pedido, de punta a punta | 13 |
| **Transición** | Cambio de estado declarado en el motor, con permiso, guardas y efectos | 14 |
| **Guarda** | Condición declarativa que una transición exige, aplicada en todos los caminos | 14 |
| **Best-effort** | Operación secundaria que no rompe la principal, PERO deja pendiente visible y reprocesable | 15 |
| **Alerta Operativa** | Falla técnica o pendiente que administración debe ver, con escalamiento | 15 |
| **Módulo** | Unidad de la arquitectura: dueño de sus datos, habla por interfaz o eventos | 16 |
| **Agregado** | Frontera transaccional del dominio: lo que cambia junto o no cambia | 16 |
| **Plantilla de Documento** | La maquetación única de un documento imprimible, con variantes por formato | 18 |
| **Documento Generado** | Un PDF/archivo emitido y almacenado: reimprimir entrega el mismo archivo | 18 |
| **Derivado** | Archivo producido desde un original (miniatura, capa, medición): el original nunca se modifica | 19 |
| **Composición** | El resultado de un editor guardado como datos (terminaciones, texturas, anotaciones), nunca imagen aplastada | 20 |
| **Dato Maestro** | Nomenclador administrable: nada referenciado se borra, se desactiva | 21 |
