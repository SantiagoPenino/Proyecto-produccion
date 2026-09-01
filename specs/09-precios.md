# Spec 09 — Precios y Cotización de Moneda

> Nivel: negocio. Sin nombres de tablas, columnas ni funciones.
> Entidades definidas aquí: **Precio Base**, **Perfil de Precios**, **Regla de Precio**,
> **Excepción de Cliente**, **Cotización de Moneda**.

## 1. Precio base

- **RN-PRE.01** Cada Artículo tiene un precio de lista con su **moneda**. Un artículo puede
  tener **dos precios, uno por moneda**; la clave del precio es **artículo + moneda**
  (guardar es un upsert sobre esa combinación, con sello de actualización).
- **RN-PRE.02** Al cotizar: se prioriza el precio en la moneda pedida; si no existe, se
  prefiere dólares y luego el que haya; con moneda "automática" se respeta la moneda
  original del artículo.
- **RN-PRE.03** Los sectores (terminaciones, productos terminados, opciones del
  configurador) escriben su precio **directo al precio base** del artículo vinculado — una
  sola fuente de precios. Un artículo sin precio base se advierte explícitamente, nunca
  falla en silencio.

## 2. Perfiles de precios escalonados

- **RN-PRE.04** Un **Perfil** es un conjunto nombrado de reglas. Cada regla define: alcance
  (un artículo, un grupo/familia entero, o "todo el resto"), **cantidad mínima** (el
  escalón), tipo (precio fijo exacto / descuento % / recargo % / descuento por monto),
  valor y moneda.
- **RN-PRE.05** Un perfil es **global** (todos los clientes, acotable por área/categoría) o
  **asignado** a clientes concretos.
- **RN-PRE.06** **Selección del escalón**: solo compiten reglas cuyo mínimo ≤ volumen; gana
  **el escalón más alto que corresponde**. La especificidad (regla propia del artículo)
  solo desempata **dentro del mismo escalón**. *(Lección: ordenar por especificidad antes
  que por escalón cobraba el precio equivocado.)*
- **RN-PRE.07** De cada perfil compite solo su mejor regla. Entre el mejor descuento y el
  mejor precio fijo **gana el más bajo para el cliente**. Un precio fijo de 0 solo aplica
  si es **excepción explícita del cliente** (los ceros de perfiles globales son plantillas
  vacías y no ganan).
- **RN-PRE.08** Los **recargos se acumulan** (urgencia, tinta…). Pero si el precio quedó en
  0 por descuento total, **no se aplica ningún recargo: cero es cero**.
- **RN-PRE.09** **Urgencia**: el perfil de urgencia se inyecta solo cuando la orden es
  urgente, con tres niveles de exclusión: áreas específicas del perfil; lista de áreas sin
  urgencia cuando aplica a todos; y **excepciones por cliente** (total, por artículo o por
  área).
- **RN-PRE.10** **Recargo por tinta** (UV/Látex): es del **material impreso**. No se aplica
  a los servicios/terminaciones de la orden (el % encarece la impresión por m², no el
  trabajo manual).
- **RN-PRE.11** **Tarifas técnicas** que pisan el precio base:
  - Bordado por **puntadas**: base hasta un umbral + incremento por tramo adicional
    (parámetros configurables); el dato real del ponchado manda sobre la estimación.
  - Estampado por **bajadas**: cargo fijo bajo el umbral; por encima, precio por bajada ×
    total, dividido entre la cantidad para el unitario.
  - En estas áreas el escalón se decide por el **dato técnico**, no por la cantidad de
    piezas.
  - Artículos con unidad "piezas" se cotizan por piezas aunque la magnitud de producción
    siga en metros.
- **RN-PRE.12** **Trazabilidad del cálculo**: cada cotización produce una traza legible
  (reglas encontradas, ganadora por perfil, competencia, recargos, precio final) y un
  desglose (base / override / descuento / recargo) que **se guarda con la línea**.

## 3. Precios especiales por cliente

- **RN-PRE.13** Dos mecanismos conviven: **perfiles asignados** (hereda sus reglas) y
  **excepciones directas del cliente**, que **ganan por sobre todo**. Cada excepción aplica
  a un artículo, a un **grupo/familia entero** ("% sobre grupo") o a todo, con tipo, valor,
  moneda y cantidad mínima.
- **RN-PRE.14** Guardar el set de reglas de un cliente **reemplaza el set completo** y
  limpia duplicados históricos.
- **RN-PRE.15** Solo las excepciones explícitas del cliente pueden fijar precio **0**.

## 4. Cotización de moneda

- **RN-PRE.16** La cotización oficial se toma del **Banco Central** (interbancaria),
  convertida a precio bancario con spreads de compra/venta; **se guarda la venta**. Corre
  dos veces por día hábil e inserta **una sola cotización por día**; si la fuente no
  responde, reintenta días hacia atrás (fines de semana/feriados) y luego cae a un proveedor
  de respaldo. Siempre se usa la cotización más reciente.
- **RN-PRE.17** Conversión aplicada en: homogeneización de una cotización con monedas
  mezcladas; checkout (pedido entero a dólares si algún ítem lo es; **sin cotización se
  rechaza**); consumo de planes cross-moneda; e importes externos en pesos llevados a
  dólares.
- **INV-PRE.01** Toda conversión **registra la cotización usada** junto al movimiento o la
  línea. Un importe sin su moneda y cotización es un dato incompleto.

## 5. Congelamiento del precio

El precio se calcula dinámicamente y se **congela** (número fijo que ya no se recalcula) en
estos momentos:

1. **Al generar la cotización/pedido de cobranza** (momento principal): por línea se sellan
   precio y subtotal en la moneda del pedido **y en la moneda original**, la traza del
   cálculo, los perfiles aplicados y el dato técnico usado (puntadas/bajadas). El costo se
   sella también en la Orden.
2. Al **checkout de la tienda** (recalculado server-side y sellado con original +
   convertido).
3. Al **vender por caja / venta de depósito**.
4. Al **comprar un Plan de Recursos** (importe y moneda del plan; su precio unitario
   implícito valoriza consumos y devoluciones).
5. Al **emitir el documento contable** — **punto de no retorno**: bloquea reversas de
   consumo (Spec 07, INV-REC.03).
6. **Override manual**: pisa todo el motor y queda registrado como ajuste manual.
7. En el configurador, el precio calculado de cada variante se persiste al generarlas; el
   precio manual por variante lo pisa.

Fuerzan precio 0 al congelar: reposiciones/fallas sin cargo, retiros de componentes de
combo, y líneas 100% cubiertas por plan prepago.

- **INV-PRE.02** Un documento histórico conserva sus precios congelados para siempre:
  cambiar la lista de precios, el perfil o la ficha del cliente **jamás** altera documentos
  ya emitidos.

## 6. Formación de precios (costeo y márgenes) — to-be

> Esta sección es de escalamiento: el sistema actual NO forma precios (el precio base se
> carga a mano, sin relación con los costos); el nuevo debe poder responder "¿este precio
> deja margen?".

- **RN-PRE.18** Cada Artículo puede tener una **estructura de costo**: insumos (con su
  costo por unidad — alimentado por las compras, Spec 29 Nivel B, o cargado a mano
  mientras no exista ese circuito), merma estándar (%), y costo de proceso por área
  (derivable de la capacidad real: velocidad y costo-hora de máquina, Spec 03 RN-PRO.23).
- **RN-PRE.19** El **margen** se declara por artículo, categoría o grupo (% objetivo y %
  mínimo). El sistema calcula el **precio sugerido** = costo × (1 + margen objetivo) y lo
  contrasta con el precio base vigente: la pantalla de precios muestra el margen real de
  cada artículo y **alerta cuando un precio (o el resultado de un perfil/excepción) cae
  bajo el margen mínimo**.
- **RN-PRE.20** El precio base sigue siendo una **decisión humana** (el sugerido no pisa
  nada solo): actualizar precios desde costos es una operación masiva con
  previsualización (Spec 21 RN-ADM.05). Cuando sube el costo de un insumo, el sistema
  lista qué artículos quedaron bajo margen — hoy eso se descubre nunca.
- **RN-PRE.21** La moneda del costo y la del precio pueden diferir: el margen se calcula
  con la cotización vigente y se recalcula al moverse el tipo de cambio (los artículos
  cuyo margen depende del dólar se marcan).
- > DECISIÓN PENDIENTE (negocio): profundidad del costeo de proceso (¿solo insumos +
  > margen, o también costo de máquina/hora por área?). Se puede arrancar con insumos y
  > crecer.

## 7. Listas de precios y promociones — to-be

> Escalamiento: el sistema actual tiene UN precio base por artículo+moneda y perfiles de
> reglas, pero no listas nombradas ni promociones con vigencia.

### 7.1 Listas de precios

- **RN-PRE.22** Una **Lista de Precios** es un conjunto nombrado y versionado de precios
  por artículo (+moneda), con **vigencia** (desde/hasta) y **audiencia**: la lista
  general, listas por segmento (mayorista, revendedor, tipo de cliente) o por cliente.
  El precio base actual pasa a ser "la lista general vigente".
- **RN-PRE.23** **Resolución en cascada declarada**: lista del cliente → lista de su
  segmento → lista general — y sobre el resultado corren los perfiles escalonados y las
  excepciones de siempre (§2 y §3). El orden de resolución es visible en la traza del
  cálculo (RN-PRE.12).
- **RN-PRE.24** Las listas se **versionan**: publicar una versión nueva no toca la
  vigente hasta su fecha; el histórico de listas se conserva (qué precio regía tal día —
  hoy imposible de responder). Actualización masiva con previsualización (Spec 21
  RN-ADM.05), incluyendo "nueva versión = versión anterior + X%".
- **RN-PRE.25** La lista de precios **públicos** de la vidriera (Spec 30 RN-CMS.09) es
  una audiencia más de este mecanismo, no un sistema aparte.

### 7.2 Precios promocionales

- **RN-PRE.26** Una **Promoción** es una regla de precio con **vigencia obligatoria**
  (desde/hasta, se apaga sola — nunca depende de la memoria de nadie), alcance (artículo,
  grupo, lista o audiencia), tipo (precio fijo promocional o % de descuento) y
  **prioridad declarada frente al resto del motor**: por defecto gana el precio **más
  bajo para el cliente** entre promoción y su precio normal (coherente con RN-PRE.07),
  y una promoción **no se acumula** con descuentos de perfil salvo que lo declare.
- **RN-PRE.27** El precio congelado (§5) registra **qué promoción aplicó**: la línea del
  documento sabe que se vendió en promo (reportable: cuánto vendimos en promoción y
  cuánto margen resignamos — cruzado con el costeo del §6).
- **RN-PRE.28** Las promociones vigentes son **visibles donde se vende**: tienda del
  portal (precio anterior tachado + vigencia), caja y cotizador. Su publicación puede
  vincularse a una pieza de contenido (Spec 30) con la misma vigencia — la promo y su
  banner se apagan juntos.

## 8. Interacciones

| Módulo | Interacción |
|---|---|
| Pedidos (Spec 02) | La cotización corre al ingresar; urgencia y tinta vienen de la orden. |
| Recursos (Spec 07) | Cobertura por plan parte líneas y fuerza $0; urgencia pagada en metros cuando el precio quedó en 0. |
| Artículos (Spec 08) | Alcance por grupo/familia; precio de excepción por variante de depósito. |
| Facturación (Spec 06) | La emisión sella los importes; los documentos guardan moneda y cotización. |
