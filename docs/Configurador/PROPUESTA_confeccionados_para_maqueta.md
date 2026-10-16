# Propuesta: configurador de productos confeccionados

Resumen para armar la **maqueta navegable** de la propuesta. Es solo diseño de pantallas con datos de ejemplo: no hay que conectar backend ni base de datos.

- **Base:** documento "Lógica de producto: piezas, componentes y variantes" (Felipe Lalinde, 24-sep-2026).
- **Alcance:** solo **productos confeccionados**, las prendas que se cortan y cosen en la planta. Quedan afuera los productos del local, los combos y ECOUV.

---

## 1. La idea en una frase

Un producto confeccionado deja de ser "un artículo por cada combinación" (hoy hay 57, como "Camiseta futbol FP+B+DTF") y pasa a ser **una prenda con reglas**. El cliente elige opciones y el sistema resuelve solo qué piezas se cortan, con qué molde de cada talle, en qué tela, con qué diseño y con qué avíos.

## 2. Conceptos (vocabulario de las pantallas)

| Concepto | Qué es | Ejemplo |
|---|---|---|
| Categoría | Árbol de clasificación, de los niveles que haga falta | Indumentaria › Deportiva › Básquet |
| Producto | La prenda que se vende | Camiseta de básquet, Campera |
| Talles del producto | Los talles que ofrece, tomados de una curva | Masculino XS–6XL, Femenino, Niño 0–16 |
| Componente | Aspecto configurable del producto | Cuello, Tipo de manga, Bolsillos |
| Opción | Cada alternativa de un componente | Cuello bomber |
| Pieza | Parte de tela que se corta por separado | Frente, Dorso, Manga, Puño |
| Variante de pieza | Forma concreta de una pieza, que aparece solo con ciertas opciones | "Frente raglán, escote estándar, con bolsillo" |
| Condición | Las opciones que activan una variante o un avío | Manga = Raglán **y** Cuello = Bomber |
| Molde | Archivo de una variante de pieza para un talle o un rango | Frente raglán, talle M |
| Avío | Insumo que no es tela | Cierre frontal, cierre de bolsillo, botones |
| Compatibilidad | Regla entre opciones | "Corte en el cuerpo" excluye "Manga pegada" |
| Técnica de decoración | Lo que se le hace encima a la prenda | Sublimación, Bordado, DTF, TPU |
| Diseño | Arte asignado a cada pieza del pedido | Escudo en el frente izquierdo |

**Reglas clave que la maqueta tiene que mostrar:**

1. **Existen efectos de opción:** agrega pieza, cambia la forma de una pieza, divide una pieza, mueve piquetes, agrega o cambia un avío, o no hace nada.
2. **La forma de una pieza depende de varias opciones juntas**, no de una sola. El frente de la campera depende de manga, cuello, cortes, bolsillos y cintura.
3. **Condición:** "Y" entre componentes, "O" dentro del mismo componente.
4. **Existe no es lo mismo que se ofrece:** una combinación puede tener moldes cargados y aun así no ofrecerse.
5. **El pedido guarda una foto resuelta.** Si mañana cambia el catálogo, el pedido viejo no cambia.

## 3. Qué va a la tabla de Artículos

**Una fila por prenda configurable. Nada más.**

| Campo de Artículos | Qué lleva | Ejemplo |
|---|---|---|
| Código | Código propio del producto | CONF-0001 |
| Descripción | Nombre de la prenda, sin técnicas ni opciones | Camiseta de básquet |
| Super-familia / Grupo | Productos / Confeccionados | 2 / 2.1 |
| Variante de stock (familia) | Tipo de prenda en StockArt, con tipo "Producto terminado" | Camisetas |
| Moneda y unidad | Moneda del precio, unidad "cantidades" | $ · uni |
| Visible | Si se ofrece | Sí |
| Precio base | Va en la tabla de precios base, no en el artículo | $ 890 |

**Lo que NO va en Artículos**, porque vive en el catálogo del configurador colgado del producto:

- categoría del árbol
- talles disponibles
- componentes y opciones
- piezas, variantes de pieza y condiciones
- moldes
- reglas de avíos
- compatibilidades
- técnicas permitidas

**Lo que ya existe como artículo y se referencia:**

- **Telas:** ya son artículos de Sublimación. La tela general del producto y la tela de una pieza apuntan a ese artículo.
- **Técnicas:** bordado, DTF y TPU ya tienen su artículo que las cotiza.
- **Avíos:** se propone un grupo propio de artículos de insumo, por ejemplo "Avíos", para poder comprarlos y tener stock. El catálogo de avíos apunta a ese artículo.

**Las 57 prendas PR- actuales** ("Camiseta futbol FP+B", etc.) no se borran porque pueden tener historial. Se ocultan, y cada una queda como referencia a su producto nuevo más las técnicas que decía su nombre.

## 4. Modelo de datos propuesto

Primero las tablas que ya existen y cómo se reutilizan:

| Tabla hoy | Uso en la propuesta |
|---|---|
| Articulos + PreciosBase | El producto y su precio base |
| ProductoVentaConfig | Configuración de venta del producto: estado borrador o publicado, cantidad mínima. Se le suma la categoría |
| CurvasTalle + CurvaTalleItems | Los talles; cada producto elige los suyos |
| PiezasPrenda | Nomenclador general de piezas (FRENTE, DORSO, MANGA…); cada producto usa las suyas |
| Moldes + MoldePiezas | El archivo del molde y sus piezas por talle, con espejado; se vinculan a la variante de pieza |
| ProductoTerminadoServicios + TecnicaOpciones | Técnicas del producto (construcción y decoración), sin cambios |
| ArchivosOrden | Los diseños que sube el cliente; cada pieza del pedido apunta a uno |

Después las tablas nuevas del catálogo:

- **CategoriaProducto:** el árbol, con id, nombre y padre.
- **ProductoTalle:** los talles disponibles de cada producto.
- **ProductoComponente:** del producto, con selección única o múltiple, obligatorio y orden.
- **ProductoOpcion:** del componente, con la marca "ofrecida".
- **ProductoPieza:** pieza del producto, con la marca "es par" (izquierda y derecha).
- **PiezaVariante:** forma concreta de la pieza y cantidad por prenda.
- **Condicion:** qué opciones activan una variante o una regla de avío.
- **PiezaVarianteMolde:** molde por talle o rango, con lado (izquierda, derecha o ambos) y espejado.
- **Avio** y **AvioRegla:** qué avío lleva el producto, cuándo y con qué medida por talle o rango.
- **Compatibilidad:** "A excluye B" o "A requiere B".

Y las tablas nuevas de la foto del pedido, colgadas de la orden madre:

- **PrendaConfig:** producto y tela general.
- **PrendaConfigTalle:** cantidades por talle.
- **PrendaConfigOpcion:** las opciones elegidas.
- **PrendaConfigPieza:** cada pieza resuelta, con lado, tela propia si tiene y diseño.
- **PrendaConfigPiezaMolde:** el molde usado en cada talle.
- **PrendaConfigAvio:** los avíos resueltos, con su medida por talle.

## 5. Pantallas que tiene que mostrar la maqueta

Estilo: el mismo de la pantalla actual "Configurar Productos": fondo claro, tarjetas blancas con bordes suaves, pastillas redondeadas, íconos Font Awesome, estilo Tailwind. Textos en español rioplatense. Cada botón dice exactamente qué hace, por ejemplo "Crear y asignar" o "Guardar nombre", nunca solo "OK". Los estados usan verde (completo), ámbar (a revisar) y rojo (falta algo).

### Pantalla A: Catálogo de confeccionados

- **Panel izquierdo:** árbol de categorías plegable.
  - Ejemplo: Indumentaria › Deportiva › Básquet › *Camiseta de básquet*.
  - Ejemplo: Indumentaria › Abrigo (equipos largos) › *Campera*.
- **En cada producto:** nombre, precio base, estado (● Publicado / ○ Borrador) y un semáforo de completitud ("Faltan 3 moldes").
- **Arriba:** buscador y botones "+ Nueva categoría" y "+ Nuevo producto".
- **Nunca se muestran** acá las variantes de depósito (talle y color del stock) ni la cantidad de órdenes.

### Pantalla B: Ficha del producto (pasos)

1. **General:** nombre, categoría (selector de árbol), familia, curva y talles disponibles (chips que se prenden y apagan), tela por defecto (selector de telas), precio base y estado.
2. **Componentes y opciones:** una lista de componentes. Cada uno tiene su selección (única o varias), si es obligatorio, sus opciones con la marca "Se ofrece", y una opción "Ninguno" cuando aplica. Ejemplo: los 7 componentes de la campera.
3. **Piezas:**
   - Lista de piezas del producto: frente izquierdo y derecho, dorso, mangas, tira de cuello, bolsillos, puños y cintura.
   - Cada pieza muestra si es par y sus variantes.
   - Cada variante muestra sus condiciones como chips, por ejemplo "Manga: Raglán" + "Cuello: Común o Bomber" + "Bolsillos: Ojal con vivo".
   - Un dibujo esquemático de la prenda. Colores de las láminas del documento: gris sin cambios, naranja modificada, azul agregada.
4. **Moldes:**
   - Una **grilla de variante de pieza × talle**.
   - Cada celda muestra el molde cargado, o queda en **rojo si falta**.
   - Admite rango de talles, por ejemplo "Bolsillo S–XL".
   - Cada molde marca lado y espejado.
5. **Avíos:** reglas del tipo "Cierre frontal largo, cuando Cuello = Común, medida por talle", con una tabla de medidas por talle o rango.
6. **Compatibilidades:** reglas "excluye" y "requiere", con el motivo. Hay que mostrar la diferencia entre **existe** (moldes cargados) y **se ofrece**. Ejemplo: "Corte hombro–axila excluye Manga pegada: existe, pero hoy no se ofrece".
7. **Técnicas de decoración:** sublimación, bordado, DTF y TPU, cada una obligatoria u opcional y cobrada aparte o incluida. Los apliques se ubican **sobre una pieza del producto**, por ejemplo "Bordado en Frente izquierdo".
8. **Probar configuración (simulador):**
   - Se eligen opciones y un talle.
   - La pantalla muestra la lista resuelta: cada pieza con su variante, su molde de ese talle y su tela, más los avíos con su medida.
   - Muestra las validaciones: combinación no ofrecida, pieza obligatoria sin variante, talle sin molde, dos variantes enteras para la misma pieza.
9. **Revisar y publicar:** checklist de completitud y el botón "Publicar producto".

### Pantalla C: El pedido (vendedor o cliente en el portal)

1. Elegir el producto desde el árbol de categorías.
2. Elegir las opciones de cada componente. Las que no se ofrecen o chocan con otra aparecen deshabilitadas, con el motivo.
3. Elegir la tela general y, si hace falta, otra tela para piezas puntuales.
4. Asignar un diseño a cada pieza, subiendo un archivo o eligiendo uno ya subido. Izquierda y derecha pueden llevar diseños distintos.
5. Cargar cantidades por talle.
6. Ver el resumen o "foto": piezas, moldes, avíos, técnicas y precio.

### Pantalla D: Corte (lo que recibe producción)

Para un pedido, una tabla de **pieza × talle × cantidad × molde × tela × diseño**, más la lista de avíos a retirar con su medida.

## 6. Datos de ejemplo para la maqueta

**Campera** (Indumentaria › Abrigo (equipos largos) › Campera), talles S a XXL, cierre frontal siempre:

| Componente | Selección | Opciones |
|---|---|---|
| Cuello | Única, obligatorio | Común, Bomber, Cuadrado |
| Tipo de manga | Única, obligatorio | Raglán, Pegada |
| Bolsillos | Única, obligatorio | Sin bolsillos, Ojal con vivo, Ojal en costado, Con cierre |
| Cortes cuerpo | Única, obligatorio | Sin corte, Hombro–axila / axila–cintura |
| Cortes mangas | Única, obligatorio | Sin corte, Codo |
| Terminación mangas | Única, obligatorio | Dobladillo, Puño |
| Terminación cintura | Única, obligatorio | Dobladillo, Puño |

**Ejemplo resuelto para el simulador:** campera talle M, cuello bomber, manga raglán, bolsillos con cierre, cortes en el cuerpo, puño en mangas y dobladillo en cintura. Da como resultado:

- **Frente izquierdo y derecho**, cada uno en dos partes (hombro–axila y axila–cintura).
- **Dorso** en dos partes.
- **Mangas raglán**, con largo para puño.
- **Tira de cuello bomber.**
- **Puños.**
- **Piezas del bolsillo con cierre.**
- **Avíos:** cierre frontal bomber/cuadrado en medida M, y 2 cierres de bolsillo en la medida del rango S–M.

**Camiseta de básquet** (Indumentaria › Deportiva › Básquet), curva masculina XS–6XL, tela Dry Pro, técnicas sublimación, corte y costura obligatorias, bordado y DTF opcionales:

| Componente | Opciones |
|---|---|
| Cuello | Redondo, En V |
| Sisa | Normal, Deportiva |

## 7. Decisiones abiertas (mostrarlas como notas en la maqueta)

1. **Precio:** el documento no lo define. Propuesta: precio base del producto más un extra opcional por opción, y las técnicas se cobran como hoy.
2. **Técnicas:** ¿bordado o DTF son una opción del producto o un atributo del diseño de la pieza? Propuesta: siguen como técnicas del producto y el aplique se ubica en una pieza.
3. **Etiqueta** (Básquet, Fútbol): pasa a ser un nivel del árbol de categorías.
4. **Avíos como artículos:** ¿se compran y tienen stock? Si es así, van en un grupo propio de artículos.
5. **Migración:** las 57 prendas PR- se convierten en unos 18 productos con sus técnicas, y las viejas quedan ocultas.
