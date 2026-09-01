# Spec 02 — Pedidos e Ingreso de Órdenes

> Nivel: negocio. Sin nombres de tablas, columnas ni funciones.
> Entidades definidas aquí: **Pedido**, **Orden**, **Servicio**, **Archivo de Arte**,
> **Archivo de Referencia**, **Reposición**, **Falla**, **Matriz**.
> Referencia entidades de otras specs: Cliente, Diseñador, Bobina, Plan de Recursos,
> Artículo, Área.

## 1. Conceptos centrales

- **RN-PED.01** Un **Pedido** es lo que el cliente pide de una vez: recibe un **número
  correlativo único global** reservado al inicio, compartido por todas sus órdenes.
- **RN-PED.02** Una **Orden** es una unidad de trabajo en un área concreta: es lo que
  producción ve, lo que se etiqueta, se cotiza y se cobra. Su código = **prefijo del área +
  número de pedido**. El prefijo sale de un **nomenclador configurable** (área ↔ prefijo),
  nunca del código fuente; sin prefijo configurado aplica un prefijo genérico.
- **RN-PED.03** Un Pedido genera varias **órdenes hermanas** cuando: hay servicios
  complementarios (corte, costura, bordado, estampado — cada uno orden propia); es
  multimaterial (una orden por tela); es corte multi-tela (una orden por bobina, cada una
  descuenta su tela); es bordado multi-diseño (una orden por logo); o el servicio genera
  automáticamente una **hermana interna de terminaciones** desde el ingreso.
- **INV-PED.01** Cuando dos órdenes del mismo pedido caen en la misma área, se numeran
  (1/N), (2/N)… El código de orden es **clave de negocio única**: dos órdenes con el mismo
  código duplicaron cobros. *(El sistema nuevo debe garantizar unicidad por estructura.)*
- **RN-PED.04** Las hermanas se ordenan por la **secuencia de proceso configurada por
  área** y cada una apunta a la siguiente; la última apunta a Depósito. El pedido avanza de
  área en área sin ruteo manual.
- **RN-PED.05** El cliente ve el Pedido como un proyecto único cuyo estado se **deriva** de
  sus órdenes (todas canceladas ⇒ cancelado; todas entregadas ⇒ entregado; alguna activa ⇒
  activo). Se le ocultan las órdenes de falla interna y las hermanas de terminaciones.

## 2. Canales de ingreso

| Canal | Qué ingresa |
|---|---|
| **Portal del cliente** | Todos los servicios visibles (cada tarjeta prendible/apagable por configuración, con descripción e imagen propias) |
| **Interno (vendedor)** | Prendas/confeccionados: el vendedor elige cliente (impersonación validada) y **define él mismo el orden de los pasos** de producción; dos modalidades: fabricar a medida y comprar-y-personalizar |
| **Tienda del portal** | Solo productos terminados al carrito; personalizados/confeccionados derivan a pedido normal (Spec 08) |
| **API externa / planilla** | Con clave de API; validación **tolerante**: entra igual pero marcada con observaciones para revisión |
| **Tótem** | **No ingresa pedidos**: solo retiros y anuncio en mostrador (Spec 10) |

- **RN-PED.06** Cliente **Bloqueado**: no crea pedidos, no compra, no genera retiros, por
  ningún canal.
- **RN-PED.07** Un servicio puede ofrecer **complementarios** configurables. Reglas: un
  complementario se oculta si el servicio principal ya trae ese bloque integrado; **costura
  depende de corte** (no se activa sin corte; apagar corte apaga costura).

## 3. Validaciones transversales del ingreso

- **RN-PED.08** Campos comunes: nombre del proyecto obligatorio; prioridad normal/urgente;
  variante y material obligatorios si el selector está visible; forma de envío donde se
  ofrece.
- **RN-PED.09** **Urgencia**: solo existe en áreas habilitadas; si el área no la admite,
  el servidor la fuerza a normal aunque venga en el pedido. No aplica a productos
  terminados ni a trabajos con terminaciones (el taller de armado no se comprime); si el
  cliente la marcó y agrega terminación, se le avisa y se revierte.
- **RN-PED.10** **Archivos de arte**: formatos acotados por servicio (transparencia
  requerida o no); 1 archivo = 1 página (arte multipágina se rechaza; las referencias sí
  pueden ser multipágina); **sin resolución declarada se rechaza** (no se asume un DPI);
  ancho ≤ ancho del material − margen; materiales de medida fija exigen medida exacta con
  tolerancia mínima y **la orientación importa**.
- **INV-PED.02** **Toda validación del formulario existe también en el servidor.** Las
  reglas que viven solo en el navegador dejan entrar pedidos armados a mano (mínimos,
  clientes ajenos, cantidades inválidas — todos casos reales).
- **RN-PED.11** **Sin arte no hay pedido** para servicios que miden por metros (nacería con
  magnitud 0). Exentos: servicios por unidad y los que miden por otro dato técnico
  (bordado por puntadas, boceto de parche).
- **RN-PED.12** **Anti-duplicado**: candado contra el doble envío del formulario (dos
  clicks seguidos creaban dos pedidos completos).
- **INV-PED.03** El cliente del pedido **sale siempre de la sesión**, jamás del contenido
  del formulario.

## 4. Reglas por servicio (esencia)

- **Sublimación**: material **por archivo** (multimaterial); modo normal / repetición de
  patrón / escala; doble cara opcional; bloque corte+costura integrado; nomenclatura de
  archivo especial activable por configuración.
- **DTF**: material único; alto por archivo entre un mínimo y un máximo; al subir el arte
  se genera en segundo plano la capa de tinta blanca.
- **Impresión ecológica (UV)**: dos categorías comerciales — **material impreso** (por m²,
  un material por pedido, tinta que rutea a máquina y puede recargar) con **terminaciones
  por archivo posicionadas sobre un plano** (reglas físicas: bolsillo y soldadura no
  comparten lado, separaciones máximas de ojales, consumos de borde documentados en la nota
  al taller); y **productos terminados** (precio cerrado por unidad, ficha con medidas y
  terminaciones incluidas, arte validado contra la ficha con revalidación si cambia el
  producto). Las terminaciones generan líneas de cobro y checklist de control; las
  incluidas solo checklist. Nace la hermana interna de terminaciones desde el ingreso.
- **Impresión directa gran formato**: material único; mínimo de metros configurable; tela
  doble cara exige boceto frente/dorso por archivo y **medidas idénticas** entre caras;
  la unidad (piezas o metros) la define **el artículo, no el área**.
- **Corte**: el cliente sube **tizadas** que el sistema **mide automáticamente** (por
  líneas, no trazos: una línea compartida entre piezas cuenta una vez). Formatos = solo los
  que come la máquina; **sin medición no hay pedido** (no se puede cotizar); límites de la
  mesa física; ancho útil = rollo − margen; metros de todas las tizadas ≤ restante de la
  bobina; el cliente **confirma explícitamente** el resumen medido (con esas piezas se
  controla producción).
- **Bordado**: catálogo en dos ejes independientes — el DÓNDE (prenda vs parche: variante,
  cambia el flujo; el parche no consume prendas) y el DE QUÉ (con aplique de tela vs 100%
  hilo: artículo, cambia el precio); el relieve 3D es un **cargo**, no un artículo. Un
  bloque por diseño/logo: prendas de origen (línea del inventario del cliente), cantidad,
  medidas, boceto y prediseño opcionales. El saldo de prendas se valida **sumando todos los
  diseños** que usan la misma línea. Estimación técnica: puntadas por área × cobertura ×
  densidad según tipo de puntada; relieve solo en satén (+50% densidad); tiempo de máquina
  derivado. Genera una orden por diseño + cargo de matriz por diseño nuevo + recargo 3D.
- **Parches TPU**: trabajo nuevo = el cliente sube **boceto** (no arte final), mínimo de
  unidades, se cobra la **matriz** como línea aparte; producción diseña el arte (5 capas) y
  lo manda a aprobación del cliente.

## 5. Tela del cliente en el ingreso

- **RN-PED.13** Con tela propia el cliente **elige la bobina concreta**; el ancho y largo
  del arte se validan **contra la bobina**, no contra el catálogo.
- **RN-PED.14** Los metros se descuentan **al ingresar**, con descuento condicionado (dos
  pedidos simultáneos no dejan la bobina en negativo) y movimiento de consumo que habilita
  la devolución al cancelar (Spec 07). Un descuento por pedido en el flujo clásico; en
  corte multi-tela cada orden descuenta su bobina.
- **RN-PED.15** Como la bobina ya está elegida, el requisito de producción "tela" nace
  **cumplido** con todos los datos.

## 6. Cotización al ingresar

- **RN-PED.16** Confirmado el pedido, corre una **auto-cotización asíncrona** de todas sus
  órdenes (el cliente no espera). Si falla, el pedido no se pierde: queda advertencia y la
  orden existe sin precio hasta recalcular.
- **RN-PED.17** La cantidad cotizada depende del servicio: metros/m² de los archivos
  (impresión), piezas (artículos por unidad), piezas o metros de corte según artículo,
  **puntadas** (bordado), prendas × bajadas (estampado), unidad (producto terminado).
- **INV-PED.04** La magnitud del material impreso son **los metros de los archivos**, jamás
  contaminada con unidades de servicios (magnitud = m² + cantidad de terminaciones cobró
  material 4× de más).
- **RN-PED.18** Artículo sin precio base ⇒ advertencia explícita y precio 0 (no falla).
  Líneas sin cargo (reposiciones, fallas, componentes de combo) **se insertan igual con
  importe 0** y se excluyen de la facturación. La hermana de terminaciones no genera línea
  propia (su precio viaja en la orden de impresión). El resto del motor de precios: Spec 09.

## 7. Estados iniciales y pase a producción

- **RN-PED.19** La orden nace en estado **"Cargando"** (el cliente sube archivos):
  invisible para producción. El pedido se crea en dos tiempos: estructura + manifiesto de
  archivos, y subida archivo por archivo con progreso.
- **RN-PED.20** Cuando el último archivo de la orden termina de subir, pasa automáticamente
  a **"Pendiente"** y entra a producción (tablero del área + avisos en tiempo real).
  Órdenes sin archivos se activan en el acto.
- **RN-PED.21** Excepciones: pedido cargado por Diseñador con aprobación activada ⇒ queda
  **retenido** invisible hasta que el cliente apruebe. Parche nuevo ⇒ producción sube el
  boceto y el cliente aprueba (aprobado = verde "falta arte"; rechazado = rojo con **motivo
  obligatorio** en historial y nota).
- **RN-PED.22** Cancelación por el cliente: orden zombie en "Cargando" ⇒ se elimina; en
  "Pendiente" sin tomar ⇒ se cancela con razón obligatoria (queda historial); esperando su
  aprobación ⇒ **no se cancela, se rechaza con motivo**; ya aprobada o más allá ⇒ no puede
  (contactar a la empresa). Cancelar devuelve los metros de tela del cliente
  (idempotente).
- **RN-PED.23** Fecha de entrega: al crear se estampa una fecha provisoria de respaldo y
  se ejecuta el cálculo real (área, prioridad, horario laboral, feriados, capacidad).
  El formulario muestra el tiempo prometido por área y prioridad. *(Estado conocido: la
  capacidad real por máquina —incluyendo cabezales— aún no está cargada; los tiempos
  prometidos no coinciden con los reales. El sistema nuevo debe modelar capacidad real y
  una agenda interna que se reordene sin mover la fecha prometida.)*

## 8. Reposiciones y fallas (re-trabajo sin cargo)

- **RN-PED.24** **Reposición de cliente** (sufijo propio): se rehace a pedido del cliente.
  El código se construye sobre la **raíz** (la reposición de una reposición incrementa el
  número, nunca apila sufijos). **Tope duro: no se repone más metros ni copias que el
  original.** Copia todo de la orden original, prioridad "reposición", costo 0, reutiliza
  el archivo original (con miniatura); la nota lleva el defecto + máquina y lote del
  original. Visible para el cliente.
- **RN-PED.25** **Falla interna** (sufijo propio distinto): la declara el operario en el
  control del archivo; el archivo que falló identifica la falla. Varias fallas de la misma
  orden madre se juntan en **una** reposición activa; pero una falla de una falla genera
  **su propio eslabón numerado** (el linaje se conserva). Motivo siempre obligatorio.
  Van a un canasto propio y la orden madre queda esperando. **Invisible para el cliente.**
- **RN-PED.26** Regla económica común: reposiciones y fallas se cotizan **forzadas a 0**
  (no basta un perfil de precios: se fuerza explícitamente), figuran en la cotización sin
  sumar y se excluyen de la facturación.
- **RN-PED.27** Completar una reposición dispara el re-aviso al cliente de la orden madre
  (Spec 10, RN-WSP.04).

## 9. Matrices (reuso de troquel de parche)

- **RN-PED.28** La **Matriz** es el molde del parche: costo de arranque cobrado una vez.
  En "mis matrices" el cliente ve sus trabajos finalizados y puede pedir repetición con un
  **mínimo menor** al de trabajo nuevo (la matriz ya está amortizada), **sin volver a
  cobrar matriz** y **sin nueva aprobación** (el diseño ya fue aprobado). El mínimo se
  valida también en el servidor.
- **RN-PED.29** El arte de la matriz tiene la **cantidad incrustada**: misma cantidad ⇒ el
  arte se copia y la orden nace lista para producción; cantidad distinta o matriz sin arte
  completo ⇒ el arte viejo va solo como referencia y producción **regenera** las capas, con
  el motivo correcto informado al operario.
- **RN-PED.30** Texturas 3D del parche: el cliente puede elegirlas en un visor (confirmar =
  aprobar) o delegarlas al diseñador; queda registrado quién eligió. Un rechazo del boceto
  **descarta** la elección de texturas.

## 10. Archivos de referencia

- **RN-PED.31** Además del arte, la orden lleva archivos tipificados que no se imprimen:
  referencia general, boceto (uno por archivo en doble cara), planilla del pedido (una
  sola vez, en la primera orden), tizada con su medición, guía de confección, logo y
  prediseño de bordado (separados para no confundirlos con el arte), arte base a
  regenerar, boceto aprobado. Las referencias generales van a la **primera orden** del
  pedido; las de un servicio a **su** orden. Los nombres se sanean y tipifican con
  prefijo; se generan miniaturas y se lee el perfil de color en segundo plano.

## 11. Actores

| Actor | Puede |
|---|---|
| Cliente | Crear pedidos de servicios visibles, subir arte, elegir bobina/prendas propias, aprobar/rechazar bocetos, elegir texturas, comprar, cancelar en estado inicial, reusar matrices |
| Diseñador | Crear pedidos **a nombre del cliente que lo autorizó** (deuda y avisos siempre del cliente); ver estado de los suyos **sin precios**; nunca aprobar por el cliente |
| Vendedor interno | Ingresar prendas/confeccionados eligiendo cliente y secuencia de pasos |
| Operario de producción | Tomar órdenes pendientes, subir bocetos y arte, declarar fallas con motivo/máquina/lote |
| Administrador | Prender/apagar servicios, configurar complementarios, tiempos prometidos, mínimos |

## 12. Interacciones

| Módulo | Interacción |
|---|---|
| Producción (Spec 03) | "Pendiente" es la puerta de entrada al tablero del área; la secuencia de hermanas define el ruteo. |
| Recursos (Spec 07) | Descuento de bobina al ingresar; devolución al cancelar; consumo de planes al cotizar. |
| Precios (Spec 09) | Auto-cotización al ingresar; urgencia/tinta; forzado a 0 de reposiciones. |
| Caja (Spec 05) | La cotización deja la orden lista para cobrar sin sync manual. |
| Portal (Spec 10) | Canales, candados de pertenencia, aprobaciones, bloqueo de cliente. |
