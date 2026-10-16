# Spec 41 — Captación de Solicitudes de Vendedores (to-be)

> Nivel: negocio. Sin nombres de tablas, columnas ni funciones.
> Módulo nuevo (no existe en el sistema actual). Se apoya en el ingreso de pedidos de prenda
> (Spec 02), en la gestión de archivos (Spec 19), en Caja y anticipos (Spec 05), en precios
> (Spec 09) y en la trazabilidad (Spec 13). Se relaciona con CRM (Spec 26) y Presupuestos
> (Spec 33).
> Entidades definidas aquí: **Solicitud**, **Producto Solicitado**, **Servicio Adicional de
> la Solicitud**, **Interacción**, **Historial de la Solicitud**.
> Estado: **borrador, pendiente de aprobación**. Decisiones ya tomadas en §13; los puntos
> marcados **PENDIENTE** (§14) se deciden antes de construir.

## 1. Qué es una Solicitud

- **RN-SOL.01** Una **Solicitud** es el registro que hace un **vendedor** del requerimiento
  de un **cliente**, con todo lo necesario para llegar a un pedido de producción. El cliente
  pide; el vendedor capta y pacta.
- **RN-SOL.02** La Solicitud vive **antes** del pedido: mientras se está captando, diseñando
  o esperando la seña **no existe ninguna orden de producción**. Las órdenes nacen recién
  cuando la Solicitud se convierte en pedido (§9).
- **RN-SOL.03** Una Solicitud admite **múltiples interacciones** con el cliente (pedidos de
  cambio, aclaraciones, archivos nuevos, aprobaciones). Cada Interacción queda registrada con
  fecha, autor y texto, y puede llevar archivos.
- **RN-SOL.04** Alcance de esta versión: los trabajos que hoy se cargan en el ingreso de
  pedidos de prenda como **"Fabricar prendas a la medida"**, en sus dos tipos:
  **Producto terminado** (del catálogo, trae sus servicios incluidos) y **Producto
  personalizado del cliente** (libre, servicios a mano).

## 2. Datos principales de la Solicitud

- **RN-SOL.05** Datos obligatorios al ingresarla:
  - **Fecha de la solicitud** (la pone el sistema).
  - **Cliente**.
  - **Nombre del trabajo**.
  - **Vendedor que pacta** (por defecto, quien la ingresa).
  - **Detalle de la solicitud**: texto libre con lo que pide el cliente.
  - Al menos un **Producto Solicitado** (§3).
- **RN-SOL.05a** **El cliente es siempre obligatorio** y tiene que existir en el sistema: no se
  carga una Solicitud a nombre de alguien que todavía no es cliente (primero se lo da de alta).
- **RN-SOL.05b** La Solicitud puede **asociarse al Presupuesto del que salió** (el que el
  vendedor emitió en Ventas → Presupuestos). Es opcional y es solo una **referencia**: no copia
  el precio ni lo obliga; el precio pactado es el de la Solicitud (§5). Un presupuesto anulado
  no se puede asociar. Asociarlo, cambiarlo o quitarlo queda en el historial.
- **RN-SOL.06** Datos que se completan durante la vida de la Solicitud (no bloquean el
  ingreso, sí la conversión a pedido): precio pactado y seña (§5), archivos de diseño
  terminados (§6), observaciones generales.

## 3. Productos solicitados y servicios adicionales

- **RN-SOL.07** Una Solicitud tiene **uno o varios Productos Solicitados**. De cada uno se
  registra:
  - **Tipo de fabricación**: producto terminado del catálogo, o producto personalizado del
    cliente.
  - **Producto** (obligatorio si es producto terminado).
  - **Cantidad de prendas**.
  - **Lista de talles y nombres/números**: se carga como **planilla adjunta** (la misma
    planilla de pedido que hoy se adjunta al pedido de prenda). No hay grilla en pantalla.
  - **Observaciones** del producto.
- **RN-SOL.08** Cada Producto Solicitado puede llevar **Servicios Adicionales**: **Bordado**,
  **Estampado DTF**, **Estampado TPU**. De cada servicio se registra: **cuántos** (cantidad
  total y estampados/bordados por prenda), **dónde** va (ubicación en la prenda), **el arte**
  que trajo el cliente, y **quién diseña**: el arte viene listo del cliente o **se diseña en
  la empresa**.
- **RN-SOL.09** Si el producto es un **producto terminado**, los servicios que el producto
  trae incluidos aparecen solos y no se pueden quitar; los servicios que el producto no
  admite no se ofrecen. (Misma regla que el ingreso de pedidos de prenda.)
- **RN-SOL.10** **Datos exigidos según el servicio activado.** La Solicitud debe poder
  guardar todo lo que el ingreso de pedidos de prenda exige, para que la conversión a pedido
  no vuelva a preguntar nada:

  | Parte | Datos requeridos para convertir a pedido |
  |---|---|
  | Pedido (cabecera) | Cliente, nombre del trabajo, tipo de fabricación, cantidad de prendas, cómo se cobra (facturar por cada área / precio establecido con su moneda) |
  | Producción principal (sublimación) | Archivos para producción, cada uno con su material y su configuración de impresión/copias |
  | Corte | Tipo de molde (propio / moldes del cliente), origen de la tela (sublimada en la empresa / tela del cliente / tela de stock); **tizadas** si los moldes son del cliente; **bobina** si la tela es del cliente |
  | Costura | Instrucciones especiales (opcional). Costura requiere Corte |
  | Bordado | Tipo/variante, prenda soporte, cantidad total; arte: **logo/ponchado o boceto** (al menos uno) |
  | Estampado DTF | Film/material, cantidad total, estampados por prenda; **archivo a imprimir** (obligatorio); boceto de ubicación (opcional) |
  | Estampado TPU | Tipo/variante, tipo de TPU, cantidad total, estampados por prenda, origen de las prendas; **archivo a imprimir** (obligatorio); boceto de ubicación (opcional) |

- **RN-SOL.11** **Dos momentos de exigencia.** Al **ingresar** la Solicitud solo se exige lo
  que el cliente puede dar (qué quiere, cuánto, dónde, su arte o referencia). Los **archivos
  listos para producción** son el **resultado del diseño** y se exigen recién al convertir a
  pedido.

## 4. Archivos

- **RN-SOL.12** A la Solicitud se anexan **archivos de distintos tipos** brindados por el
  cliente: logos, referencias, bocetos, planillas, moldes/tizadas. Cada archivo lleva su
  **rol** (arte del cliente, referencia, boceto de ubicación, planilla, tizada, diseño
  terminado) y a qué producto o servicio pertenece (o a la Solicitud en general).
- **RN-SOL.13** **Un archivo se sube una sola vez.** Todo archivo de la Solicitud queda
  guardado en el repositorio de archivos de la empresa desde el momento en que se adjunta.
  Al convertir la Solicitud en pedido **no se vuelve a subir nada**: el pedido toma la
  referencia (el enlace) del archivo ya guardado.
- **RN-SOL.14** Los archivos que van a producción deben pasar las **mismas validaciones de
  medida y formato** que el ingreso de pedidos de prenda (formato permitido, medida legible,
  ancho dentro del material, una sola página, etc.). Se validan cuando Diseño sube el
  archivo terminado, no recién al convertir.

## 5. Precio pactado, seña y confirmación del pago

- **RN-SOL.15** La Solicitud lleva **un solo precio pactado, por la Solicitud entera** (no
  por producto), con su **moneda**, y cómo se cobra: **precio establecido** (un total, todo
  incluido) o **facturar por cada área**. Cómo llega ese precio único a cada pedido cuando
  la Solicitud tiene varios productos: ver P-14.
- **RN-SOL.16** El vendedor indica si la Solicitud **requiere seña inicial** y de cuánto. La
  seña es **una sola por Solicitud** y frena la conversión de **todos** sus productos.
- **RN-SOL.17** Si requiere seña, la Solicitud no se libera a producción hasta que la seña
  esté **confirmada** con: **vía de entrada** del dinero, **monto** y **referencia del
  pago**. **La confirma el vendedor.** Queda registrado quién la confirmó y cuándo.
- **RN-SOL.17a** La seña frena **solo la conversión a pedido**. Enviar partes a Diseño,
  diseñar y subir archivos se puede hacer sin seña confirmada.
- **RN-SOL.17b** **La seña en la Solicitud es un dato, no un movimiento de dinero.** La
  Solicitud solo deja constancia de que el cliente pagó (vía, monto, referencia). **Ingresar
  ese saldo en la cuenta del cliente le corresponde a Administración y Caja**, por su
  circuito habitual (Spec 05). La Solicitud no acredita, no descuenta ni genera ningún
  comprobante.
- **INV-SOL.01** **Ninguna Solicitud pasa a producción sin precio pactado** y, si requiere
  seña, **sin la seña confirmada**.
- **INV-SOL.04** **La Solicitud nunca modifica el saldo del cliente.**

## 6. Diseño: liberación por partes

- **RN-SOL.18** La Solicitud se **libera a Diseño por partes**. Son **partes a diseñar** de
  cada Producto Solicitado: su **producción principal** (el arte de la sublimación) y **cada
  Servicio Adicional**. Cada parte se envía a diseñar por separado, sin esperar a que el
  resto esté definido.
- **RN-SOL.18b** Al enviar una parte a Diseño el vendedor indica el **tipo de trabajo**:
  **Revisar** (el cliente trajo el arte y Diseño lo controla y lo deja listo para
  producción) o **Diseñar desde cero**. El arte de la producción principal **siempre** pasa
  por Diseño, en uno de esos dos tipos.
- **RN-SOL.18c** Las partes enviadas caen en una **bandeja común de Diseño**: no se asignan
  a una persona. Cualquier diseñador **toma** una parte de la bandeja; al tomarla queda a
  su nombre y sale de las disponibles para los demás.
- **RN-SOL.19** El diseñador trabaja la parte que tomó y, al terminar, **sube el archivo de
  diseño pronto** sobre esa parte. Subir el archivo terminado es lo que la marca como
  diseñada.
- **RN-SOL.19b** **Corregir un diseño es sustituir el archivo.** Una parte **Diseñada** no
  vuelve atrás de estado ni se cancela: si hay que corregirla, se **sustituye el archivo de
  diseño pronto** por el nuevo y la parte sigue Diseñada. La sustitución pasa las mismas
  validaciones (RN-SOL.14) y queda en el historial (quién, cuándo, qué archivo reemplazó a
  cuál). Vale mientras el producto no se haya convertido en pedido.
- **RN-SOL.20** Un **Servicio Adicional** cuyo arte vino **listo del cliente** puede no pasar
  por Diseño: el vendedor adjunta el archivo y el servicio queda diseñado directamente (con
  las validaciones de RN-SOL.14). No aplica a la producción principal (RN-SOL.18b).
- **RN-SOL.20b** **La Solicitud se puede editar después de enviada a Diseño** (cantidades,
  ubicaciones, arte, servicios nuevos, quitar servicios). Cuando el vendedor cambia algo de
  una parte que ya está en Diseño (en la bandeja, tomada o diseñada), la parte queda
  **señalada como "Modificada"**, mostrando **qué cambió**, quién y cuándo. El diseñador
  debe **aceptar el cambio** (darse por enterado); si la parte aún no fue tomada, lo acepta
  quien la tome. Si el cambio obliga a rehacer el arte, el diseñador sustituye el archivo
  (RN-SOL.19b). La señal se apaga al aceptar; cambio y aceptación quedan en el historial.
- **RN-SOL.20c** Un producto con **cambios sin aceptar** no se puede convertir en pedido.
  Un producto **ya convertido** no se edita desde la Solicitud.
- **RN-SOL.21** Cuando **todas** las partes de un Producto Solicitado tienen su archivo de
  diseño pronto, ese producto queda listo para convertirse en pedido (§9).

- **RN-SOL.22b** **Tizada de TizadaPro.** La tizada de la producción principal se genera en
  TizadaPro. El diseñador que tiene el trabajo la **vincula** a la solicitud eligiéndola de
  la lista de tizadas terminadas (se filtra por el molde del producto del catálogo; usar una
  de otro molde exige confirmarlo). La solicitud guarda una **copia** del resultado (hojas
  por tela, ancho, consumo y piezas), porque TizadaPro borra sus trabajos viejos. El PDF de
  cada hoja se sube a mano y **hereda tela, ancho y metros de la hoja**, sin medir el
  archivo. Vincular otra tizada deja la anterior como historial. Después de convertir a
  pedido, la tizada no se cambia desde la solicitud.
- **RN-SOL.22c** **Piezas y telas de la sublimación.** Si el producto es del catálogo y tiene
  molde de TizadaPro, el **vendedor** indica en la solicitud el **modelo** (entre los que el
  producto ofrece) y, **pieza por pieza**, la **tela** (entre las que el producto ofrece; una
  pieza con tela fija en el molde no se elige) y el **arte del cliente** que va en esa pieza
  (un archivo ya subido como "Arte del cliente"), con una nota opcional. Se guarda en
  `SolicitudesVendedorProductos.DatosJson.sublimacion` y queda en el historial y en la ficha
  PDF. **La producción principal no se puede enviar a Diseño hasta que cada pieza tenga su
  tela y esté la planilla de talles y nombres (o la nota de talles)** — salvo productos por
  medidas, que las escriben en la solicitud. El servidor lo rechaza con 409; la pantalla lo
  avisa en lugar del botón. Los productos del cliente solo exigen la planilla o la nota.
- **RN-SOL.22d** **Talles en la solicitud, no en el formulario.** La lista de talles / medidas /
  nombres y números se carga en el detalle de la solicitud (sección "Planilla de talles y
  nombres" de la producción principal), no como paso del formulario. Cambiarla con la
  producción principal ya en Diseño la deja **Modificada** (RN-SOL.20b).
- **RN-SOL.22e** **Diseño trabaja fuera de la solicitud.** La solicitud muestra solo el estado de
  cada servicio; la tizada, el PDF por hoja y el diseño pronto se cargan en la pantalla de
  Diseño (`/ventas/solicitudes/:id/diseno`), adonde llega el diseñador desde su bandeja. Si un
  servicio quedó Diseñado sin pasar por Diseño (RN-SOL.20), quitar su único diseño pronto lo
  devuelve a Ingresado.

## 7. Estados

- **RN-SOL.22** Estados de la **Solicitud completa**:

  | Estado | Significado |
  |---|---|
  | **Ingresada** | El vendedor la cargó; todavía no se envió nada a Diseño |
  | **En diseño** | Al menos una parte fue enviada a Diseño y no todas están diseñadas |
  | **Pedido solicitado** | Todos sus productos se convirtieron en pedido de producción (§9) |
  | **Cancelada** | El vendedor la dio de baja antes de convertirla |

- **RN-SOL.23** Estados de **cada parte a diseñar** (producción principal y cada Servicio
  Adicional):

  | Estado | Cuándo se pone |
  |---|---|
  | **Ingresado** | Al cargar la parte en la Solicitud |
  | **Enviado a diseño** | Cuando el vendedor la envía a la bandeja de Diseño |
  | **Diseño iniciado** | Cuando un diseñador la toma de la bandeja |
  | **Diseñado** | Cuando se sube el archivo de diseño pronto |

- **RN-SOL.24** Ingresada, En diseño y Pedido solicitado **se derivan** de los estados de
  las partes y de la conversión a pedido; nadie los cambia a mano. **Cancelada** es la única
  que pone una persona.
- **RN-SOL.24b** **Cancelar** exige **motivo** y solo se puede mientras ningún producto de
  la Solicitud se haya convertido en pedido. Al cancelar, las partes que estaban en la
  bandeja o tomadas por un diseñador **salen de Diseño**. Una Solicitud cancelada no se
  reabre ni se convierte. Si tenía una seña registrada, la Solicitud lo muestra para que
  Administración resuelva qué hacer con ese dinero (INV-SOL.04: la Solicitud no lo toca).
- No existe un estado de "corrección": corregir es sustituir el archivo (RN-SOL.19b).

## 8. Historial

- **RN-SOL.25** La Solicitud guarda su **historial**: cada cambio de estado (de la Solicitud
  y de cada servicio), cada interacción, cada archivo agregado y cada dato de precio/seña
  modificado, con **fecha y hora** y **quién lo hizo** (qué vendedor o qué diseñador).
- **INV-SOL.02** El historial **no se edita ni se borra**.

## 9. Conversión a pedido de producción

- **RN-SOL.26** **Un pedido por Producto Solicitado.** Con todos los archivos de diseño de
  un producto prontos, el vendedor **envía a crear las órdenes** de producción de ese
  producto desde la Solicitud. El pedido se arma con los datos y los archivos que la
  Solicitud ya tiene (RN-SOL.13). Una Solicitud con tres productos termina en tres pedidos.
  Los productos se convierten **por separado**, a medida que cada uno queda diseñado, sin
  esperar al resto.
- **RN-SOL.27** **Antes de crear nada se valida todo**: los datos requeridos de §3
  (RN-SOL.10), los archivos (RN-SOL.14), el precio pactado y la seña (INV-SOL.01). Si algo
  falta, no se crea ningún pedido y se informa exactamente qué falta y en qué producto o
  servicio.
- **RN-SOL.28** Cada pedido creado queda **asociado a la Solicitud y a su Producto
  Solicitado**: desde uno se llega al otro. La Solicitud pasa a **Pedido solicitado** cuando
  **todos** sus productos tienen pedido.
- **RN-SOL.29** El pedido se ingresa por la **interfaz de ingreso de pedidos por sistema**
  (en definición); los archivos viajan **como enlace** al archivo ya guardado, nunca como
  una nueva subida. El resultado debe ser **idéntico** al de un pedido cargado a mano en el
  ingreso de pedidos de prenda.
- **INV-SOL.03** Cada Producto Solicitado genera **un solo pedido**: reintentar la
  conversión no duplica órdenes.

## 10. Quién ve qué

- **RN-SOL.30** Los **vendedores** ven **todas** las Solicitudes y pueden **filtrar por
  estado** (y por cliente, vendedor y fecha).
- **RN-SOL.30a** **Diseñador es un rol del sistema** ("Diseñador"), que se le asigna a la
  persona como cualquier otro rol. Un administrador puede además habilitar como diseñador,
  por excepción, a alguien que tiene otro rol y también diseña.
- **RN-SOL.31** Los **diseñadores** ven la **bandeja común de Diseño** (las partes enviadas
  que nadie tomó) y **las partes que ellos mismos tomaron**. No ven Solicitudes que no
  tengan nada enviado a Diseño. *(15/10)* Cualquier diseñador puede **abrir** una solicitud
  que tenga algo enviado a Diseño (para ver lo ya hecho desde "Hechos" y para **Corregir el
  diseño** de un pedido en producción); editar cada trabajo sigue siendo de quien lo tomó.

## 11. Fuera de alcance de esta versión

- Los otros modos del ingreso de pedidos de prenda: **Comprar prendas**, **Combos y
  Promos**, **Personalizar prenda del cliente**.
- Que el **cliente** cargue o vea la Solicitud desde el portal.
- Aprobación del diseño por el cliente dentro del sistema (hoy se resuelve por
  interacciones, RN-SOL.03).

## 12. Cómo se prueba

1. Solicitud con un producto personalizado + Bordado y DTF: se envía Bordado a Diseño y DTF
   queda ingresado → Solicitud **En diseño**; en la bandeja común aparece solo el Bordado.
2. Un diseñador toma el Bordado → deja de estar disponible para los demás; sube el archivo
   → parte **Diseñada**; el historial muestra las tres transiciones con fecha y autor.
3. Producción principal enviada como **Revisar** → no se puede convertir hasta que Diseño
   suba el archivo revisado.
4. Intentar convertir con DTF sin archivo a imprimir → bloquea y nombra el DTF.
5. Intentar convertir con seña requerida y sin confirmar → bloquea por INV-SOL.01.
6. Confirmar la seña en la Solicitud → el saldo del cliente **no cambia** (INV-SOL.04).
7. Solicitud con dos productos: se convierte el primero → un pedido, Solicitud sigue **En
   diseño**; se convierte el segundo → segundo pedido, Solicitud **Pedido solicitado**.
   Órdenes creadas sin volver a subir archivos; repetir la conversión no duplica.
8. Cancelar sin motivo → no deja. Cancelar con motivo y una parte tomada por un diseñador →
   la parte sale de Diseño. Cancelar con un producto ya convertido → no deja.

## 13. Decisiones tomadas (18-sep-2026)

| # | Decisión | Dónde quedó |
|---|---|---|
| P-01 | El arte de la producción principal (sublimación) **sí pasa por Diseño**: para **revisar** lo que trajo el cliente o para **diseñar desde cero** | RN-SOL.18, RN-SOL.18b |
| P-02 | Se agrega el estado **Cancelada**. **No hay vuelta atrás ni estado de corrección**: corregir un diseño es **sustituir el archivo** | RN-SOL.22, RN-SOL.24b, RN-SOL.19b |
| P-03 | **Bandeja común** de Diseño: cualquier diseñador toma | RN-SOL.18c, RN-SOL.31 |
| P-04 | Talles y nombres: **por planilla adjunta**, sin grilla en pantalla | RN-SOL.07 |
| P-05 | La seña en la Solicitud **es un dato**. Ingresar el saldo le corresponde a **Administración y Caja** | RN-SOL.17b, INV-SOL.04 |
| P-06 | La seña frena **solo la conversión a pedido**, no el envío a Diseño | RN-SOL.17a |
| P-07 | Los archivos viajan a la interfaz de ingreso **como enlace** al archivo ya guardado | RN-SOL.13, RN-SOL.29 |
| P-08 | La Solicitud **se puede editar** después de enviada a Diseño; la parte queda señalada como **Modificada** y el diseñador **acepta** el cambio | RN-SOL.20b, RN-SOL.20c |
| P-08b | Un producto con **cambios sin aceptar no se convierte** en pedido, y un producto **ya convertido no se edita** desde la Solicitud (confirmado) | RN-SOL.20c |
| P-09 | La Solicitud **se asocia al presupuesto del que salió** (opcional, solo referencia). El **cliente es siempre obligatorio** | RN-SOL.05a, RN-SOL.05b |
| P-03b | Se crea el **rol "Diseñador"** | RN-SOL.30a |
| P-10 | **Un producto por pedido** (a confirmar: el usuario lo dio como "creo que sí") | RN-SOL.26, RN-SOL.28, INV-SOL.03 |
| P-11 | El **precio pactado es uno solo por Solicitud**, no por producto. La seña también es una sola | RN-SOL.15, RN-SOL.16 |
| P-12 | La seña la **confirma el vendedor** | RN-SOL.17 |
| P-13 | Los productos se convierten a pedido **por separado**, a medida que cada uno queda diseñado | RN-SOL.26 |

## 14. PENDIENTE — decisiones antes de construir

| # | Pregunta | Por qué importa |
|---|---|---|
| P-14 | El precio es uno por Solicitud, pero hay un pedido por producto y se convierten por separado: cuando es **precio establecido**, ¿**cuánto lleva cada pedido**? Opciones: (a) el vendedor **reparte** el total entre los productos al cargar la Solicitud; (b) el total va entero en el **primer** pedido y los demás en cero; (c) los pedidos van sin precio y se cobra el total por fuera. Con un solo producto no hay problema | Cada pedido se factura y se cobra por lo que lleva adentro: si el reparto no está definido, la suma de los pedidos puede no dar el precio pactado |
