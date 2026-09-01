# Spec 03 — Producción por Áreas

> Nivel: negocio. Sin nombres de tablas, columnas ni funciones.
> Entidades definidas aquí: **Área**, **Lote**, **Máquina/Equipo**, **Operario**,
> **Bitácora de Producción**, **Requisito de Producción**, **Tizada**, **Turno**,
> **Capacidad**, **Fecha Prometida**.
> Referencia entidades de otras specs: Pedido, Orden, Bulto, Remito, Bobina, Plan.

## 1. Dos modelos de trabajo

| Modelo | Áreas típicas | Unidad de trabajo |
|---|---|---|
| **Por Lote** (mesa de armado + kanban de máquinas + control de archivos) | Sublimación, DTF, Parches, Directa, UV | El lote, que agrupa órdenes compatibles |
| **Por Bandeja** (sin lotes) | Bordado, Estampado, Corte, Costura, Terminaciones | La orden individual, tarjeta por tarjeta |

Qué área usa qué modelo es **configuración**, no código.

## 2. Los tres ejes de estado de una Orden

- **RN-PRO.01** Una orden lleva tres estados paralelos: **estado en área** (el operativo,
  lo que se marca), **estado general** (el "padre": **nunca se fija a mano** — se deriva
  del estado en área por una jerarquía configurable de estados padre/hijo), y **estado
  logístico/canasto** (dónde espera físicamente). Además lleva un **estado de
  dependencia** (esperando impresión, esperando retiro de depósito, esperando material) con
  puntero a la orden que la libera.
- **INV-PRO.01** Toda transición de estado pasa por un **punto único** que registra
  historial (usuario, fecha, detalle legible) y emite el evento en tiempo real. Sin usuario
  identificable, el cambio se rechaza (Spec 10, RN-AUD.03).
- **INV-PRO.02** **Guarda de no-retroceso**: ninguna operación de lote (iniciar, pausar,
  finalizar, asignar, desmontar) puede pisar hacia atrás una orden ya resuelta (pronta, en
  tránsito, recibida, ingresada, avisada, con falla, retenida, finalizada, entregada,
  cancelada). *(Nació de un incidente: reasignar un lote revivió órdenes ya despachadas.)*
- **RN-PRO.02** Recorrido típico: Cargando → **Pendiente** (mesa de armado / bandeja) →
  En Lote → **En Máquina** → Control y Calidad → **Pronto** (o Retenido por falla) →
  En Tránsito → Recibido en Destino / **Ingresado** en depósito → Avisado → Entregado.
  La reactivación de una cancelada deja **siempre** en Pendiente (nunca restaura el estado
  previo). La cancelación devuelve los metros de tela del cliente (idempotente).

## 3. Modelo por Lote

- **RN-PRO.03** **Compatibilidad del lote** (validada al asignar y también al arrastrar
  entre lotes): DTF/Directa = un material y una variante; UV = un material y una tinta (la
  tinta rutea a la máquina); Sublimación no mezcla la variante papel; Parches no entra sin
  el arte completo (todas sus capas; el boceto no cuenta). Solo se asignan órdenes en el
  estado habilitante del área.
- **RN-PRO.04** **Armado automático**: agrupa las seleccionadas por variante/tinta/material,
  crea lotes, reserva una bobina con metros suficientes y sugiere máquina; avisa si ya hay
  un lote abierto del mismo material. El lote tiene nombre del operario **y número propio**
  (los nombres se repiten entre días).
- **RN-PRO.05** **Gates de máquina**: iniciar exige lote asignado a una máquina; al iniciar
  se monta la bobina del slot del equipo (sin bobina se permite bajo responsabilidad del
  operario), se abre la **bitácora** (equipo + usuario + hora) y se estampa la máquina en
  **todas** las órdenes del lote — en el momento real de producción, no al armar. Pausar
  cierra la bitácora sin cambiar el estado de las órdenes.
- **RN-PRO.06** **Finalizar** tiene tres destinos: a control de calidad; de vuelta a la
  cola (corrección — saltea validaciones); o a la **segunda estación** (calandra/corte
  final) si el equipo es impresora — ruteada automáticamente al equipo siguiente con menos
  cola; sin equipo disponible, el lote vuelve a la cola.
- **RN-PRO.07** **Bloqueos duros al finalizar**: órdenes de falla con metraje en 0 no
  cierran; en las áreas configuradas, toda orden del lote debe estar **marcada** por la
  estación correspondiente (impreso / calandrado / cortado — mismo concepto); a una
  calandra solo entra un lote terminado de imprimir; una orden de tinta UV solo va a
  máquina UV. Las validaciones aplican por **todos** los caminos (finalizar y arrastrar).
- **RN-PRO.08** **Impresión parcial** (solo áreas habilitadas): al finalizar, las órdenes
  incompletas vuelven a la mesa **conservando su avance** para continuar en otro lote.
- **INV-PRO.03** **Idempotencia**: repetir "finalizar" no re-corre el flujo (4 clicks en
  49 s pisaron estados ya avanzados — serializado a nivel de datos; el click repetido
  responde éxito sin actuar).
- **RN-PRO.09** **Avance parcial**: marca binaria por orden (libre u ordenada según el
  área) o contador x/y absoluto (unidades, copias) topeado al total, que deriva la marca al
  completarse; la segunda estación lleva su propio contador. Cuando el control aprueba
  todos los archivos, la marca de impresión queda puesta sola (no hay dos cuentas
  separadas).
- **RN-PRO.10** Al finalizar en una impresora se imprime la **etiqueta del lote** (metros o
  unidades totales, cantidad de órdenes, cuántas urgentes y cuántas fallas).

## 4. Modelo por Bandeja

- **RN-PRO.11** Entra a la bandeja de trabajo la orden sin dependencias pendientes, con
  todos los **requisitos bloqueantes** del área cumplidos (checklist configurable por
  área), y —si depende de un transfer— solo cuando el bulto fuente está **físicamente en
  stock** en el área. Orden FIFO. Las bloqueadas se muestran igual en "esperando
  requisitos" con **el motivo real**.
- **RN-PRO.12** **Gate máquina + operario**: iniciar y cargar avance exigen máquina Y
  operario asignados (sin eso no hay responsable y los reportes salen vacíos). Pausar y
  des-iniciar siempre se pueden. El **control no pasa por este gate** (otra fase, otra
  persona). El selector de operarios lista los activos del área + el usuario logueado, y
  lo precarga.
- **RN-PRO.13** Fases separadas con contadores separados: **trabajo** (avance 1..total,
  nunca supera lo pedido; no se finaliza lo que nunca se inició) y **control** (conteo
  completo obligatorio para aprobar). Aprobar el control pasa a Pronto y pregunta
  **cuántos bultos** salen, generando una etiqueta por bulto.
- **RN-PRO.14** **Cantidad de referencia** en cascada: piezas de tizadas medidas × copias →
  piezas de referencias → magnitud propia → cantidad de la orden madre (si es hermana de
  una madre administrativa).
- **RN-PRO.15** **Estampado con dos transfers** (DTF y parches en el mismo pedido): dos
  órdenes de estampado encadenadas cada una a su transfer, sobre la **misma prenda física**
  ⇒ **solo la última en aprobarse genera el bulto**.
- **RN-PRO.16** El **tipo de bulto** al aprobar depende del próximo destino: hacia depósito
  = producto terminado; hacia otra área = material en proceso (si no, depósito espera
  bultos que no llegan).
- **RN-PRO.17** **Terminaciones**: no se finaliza con terminaciones pendientes; la
  aprobación exige conteo copia por copia; al aprobar, la hermana queda **Finalizada** (no
  viaja) y **el producto se etiqueta a nombre de la orden madre** (lo que se cobra y
  entrega es la madre); el bulto de material recibido se consume. Puede confirmar
  magnitudes reales, lo que **recotiza** el pedido.

## 5. Pantalla de Control (áreas por lote)

- **RN-PRO.18** Se controla **archivo por archivo** y servicio por servicio: OK / falla /
  cancelado, con motivo, tipo de falla de catálogo e imagen anotada; contador de copias
  controladas por ítem (con incrementos rápidos). Los servicios de terminación por archivo
  se controlan en su área, no acá. En parches el control es **por parche**, no por capa.
  La información técnica de impresión se **conserva** al controlar.
- **RN-PRO.19** Cierre de la orden: todos los ítems no cancelados en OK. Resultados:
  todos cancelados ⇒ la orden se cancela de oficio (devuelve tela); con fallas ⇒ Retenida
  + esperando reposición; orden de falla sin fallas nuevas ⇒ Finalizada + **cura de la
  familia** (archivos del mismo nombre vuelven a OK, las madres retenidas vuelven a
  Pendiente); normal ⇒ Pronta + marca de impresión + canasto según completitud del pedido +
  **liberación de las dependencias encadenadas** (el transfer pronto libera su estampado).

## 6. Fallas por copias

- **RN-PRO.20** La falla se declara **por copias** (cuántas salieron mal); la orden de
  falla repone solo esas y las buenas se siguen controlando. El archivo pasa a falla recién
  cuando no queda nada por contar. Linaje conservado (la falla de una falla numera el
  eslabón). Una sola etiqueta de falla por archivo, listando fallas acumuladas con máquina,
  lote, motivo y qué copia.

## 7. Etiquetas y bultos (desde producción)

- **RN-PRO.21** Al quedar pronta (o retenida, para que el material circule) se generan las
  etiquetas y bultos (anti-duplicado: no se regeneran). Cantidad = manual o
  metros ÷ metros-por-bulto configurable por área. Si no se puede etiquetar (sin pedido,
  sin cotización válida), **el motivo vuelve a la pantalla** del operario.
- **RN-PRO.22** La etiqueta impresa lleva cliente, trabajo, material, prioridad, QR del
  bulto, banner de reposición/falla, numeración n/N, y la **lista de servicios con un paso
  por área** (no por orden: el recorrido físico es uno; el paso se tilda solo si todas las
  órdenes de esa área están prontas), cerrando siempre en Depósito. El destino impreso es
  el próximo servicio, corregible desde control.

## 8. Máquinas, operarios y turnos

- **RN-PRO.23** Ficha del equipo: área, nombre, activo, es-impresora (define si el lote
  continúa en el equipo siguiente), y capacidad real: **cabezales, velocidad real con
  unidad, minutos de preparación**. Los equipos tienen slots donde se monta la bobina.
- **RN-PRO.24** De cada trabajo queda: bitácora (tiempo de máquina), máquina y operario en
  la orden, magnitud con su unidad (metros/m²/unidades/piezas/puntadas), avance, e
  historial completo. La edición de medidas de un arte queda auditada (antes → después).
- **RN-PRO.25** Dos nociones de turno que no deben confundirse: **turnos analíticos**
  (franjas fijas para reportes) y **calendario laboral por área** (día de semana, nombre,
  horario, con soporte de cruce de medianoche) — este último alimenta la capacidad.

## 9. Capacidad y fecha prometida

- **RN-PRO.26** **Fecha prometida al cliente**: área + prioridad + hora de corte de
  urgentes (configurable; pasada la hora, el cálculo arranca al día siguiente) + plazo
  configurado por área y prioridad (con defaults) + salto de fines de semana y **feriados
  administrables**. Se sella en la orden como promesa.
- **RN-PRO.27** **Motor de capacidad**: capacidad instalada = suma de velocidades reales de
  máquinas activas (ficha técnica, nunca calibrada retroactivamente); capacidad del día =
  horas laborables × capacidad horaria (feriado = 0); requiere que la unidad de la
  velocidad coincida con la unidad de la magnitud del área — sin dato, el sistema dice
  "sin velocidad cargada" en vez de inventar. Cola pendiente = órdenes sin fecha de pronto.
- **RN-PRO.28** Orden de asignación de la cola: 1) urgente atrasado, 2) urgente de hoy
  antes de la hora de corte, 3) el resto por fecha de ingreso. Simulación día a día contra
  la capacidad; **semáforo por orden** que compara el día simulado de producción contra la
  fecha prometida (mide si el plan cumple la promesa, no si es urgente). Snapshot diario
  por área para ver la tendencia del backlog.
- **RN-PRO.29** *(Estado conocido, para el sistema nuevo)*: pocos datos de capacidad
  cargados; promesas desalineadas de los tiempos reales (prometer sobre percentil alto, no
  promedio); las **dependencias mandan sobre la cola**; un pedido grande tapa la cola;
  mostrar la fecha como estimada hasta validar el motor.

## 10. Áreas especiales

- **RN-PRO.30** **Área administrativa de prendas (madre)**: no arma lotes; es el **pilar**
  del pedido (agrupa precio y factura), **no es paso físico** (nunca llega a Pronto,
  excluida del pedido completo) y es el **único punto de salida hacia depósito** de los
  pedidos de prendas: los componentes mueren ahí, se reúnen físicamente y el responsable
  aprueba el control final. Su magnitud es la **cantidad de prendas, manual** (los archivos
  no la tocan); cambiarla recotiza el pedido completo con historial.
- **RN-PRO.31** **Recálculo de magnitud por archivos** (resto de áreas): unidad en metros ⇒
  suma metros × copias de archivos no cancelados; si no ⇒ suma copias. Los **servicios
  extra no se suman** cuando hay archivos (unidades ≠ metros: inflaban la magnitud y el
  material se cobraba de más); solo son la magnitud si la orden no tiene archivos.
  Parches y la madre administrativa quedan excluidos del recálculo.
- **RN-PRO.32** **Ruteo de prendas**: ramas que convergen en estampado, no cadena lineal.
  DTF y parches no dependen entre sí (cada transfer va a su propio estampado). En
  **combos**, el próximo paso se calcula **por componente** (el bordado del gorro no ve el
  DTF del short).
- **RN-PRO.33** **Corte**: el trabajo y el control se llevan **por tizada** (contadores
  propios, topeados a piezas × copias); el control cuenta **piezas** aunque se cotice por
  metros de corte; la orden acumula la suma. Costura ve los archivos de corte del pedido
  como referencia.
- **RN-PRO.34** **Nomenclatura de archivos**: el formato especial por área se activa por
  una clave de configuración (lista de áreas); apagado = formato histórico. Con tela del
  cliente se agrega el código de recepción de esa tela. Renombrado al procesar/medir el
  archivo.
- **RN-PRO.35** Prioridad de la planilla del área: fallas > urgentes > reposiciones >
  normales; en sublimación, dentro de cada grupo se ordena por material para reducir
  cambios de bobina en la calandra.
- **RN-PRO.36** Auto-limpieza: si la orden que cierra era la última activa de su lote, el
  lote se cancela y libera la máquina. Un bulto consumido no se reimprime ni se despacha.

## 11. Interacciones

| Módulo | Interacción |
|---|---|
| Pedidos (Spec 02) | La secuencia de hermanas define el ruteo; parches con aprobación de boceto; fallas y reposiciones. |
| Logística (Spec 04) | Canastos, etiquetas/bultos, remitos, pedido completo, recepción que cumple requisitos. |
| Recursos (Spec 07) | Bobinas montadas y reservadas; consumo y devolución de tela; urgencia pagada en metros. |
| Precios (Spec 09) | Recotización al cambiar magnitudes; datos técnicos (puntadas/bajadas) hacia el precio. |
| Contabilidad (Spec 06) | Eventos contables al ingresar a depósito; área estampada en las líneas del documento. |
