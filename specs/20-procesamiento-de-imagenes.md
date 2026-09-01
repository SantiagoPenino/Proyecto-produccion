# Spec 20 — Procesamiento y Edición de Imágenes (to-be)

> Spec de escalamiento. Todo el tratamiento técnico de imágenes — que hoy vive repartido
> entre TPU, Bordado, EcoUV, DTF y Corte — se separa como **módulo propio**: un servicio
> de operaciones de imagen + editores que guardan **datos estructurados**, nunca imágenes
> pisadas.
> Entidades definidas aquí: **Operación de Imagen**, **Composición** (terminaciones,
> apliques, texturas), **Editor**.

## 1. Diagnóstico del sistema actual

Lo que ya existe, cada pieza en su rincón:

| Capacidad | Dónde vive hoy |
|---|---|
| Medición de PDFs (metros, ancho, alto, DPI) | Al procesar el archivo, por área |
| Capa de tinta blanca (DTF) | Job encolado al subir el arte |
| Medición de tizadas (piezas por regiones cerradas, metros de corte, líneas compartidas contadas una vez) | Utilidad del portal, formatos de la máquina |
| Análisis de logo de bordado (quitar fondo, reducir a colores dominantes, vectorizar, asignar hilo de la carta, elegir puntada, estimar puntadas y tiempo) | Front del portal |
| Las 5 capas del arte TPU (con la cantidad incrustada en el layout) | Diseño manual + regeneración por reuso |
| Visor 3D de texturas TPU (textura y barniz por zona, escala, altura, posición) | Editor del portal |
| Terminaciones UV posicionadas sobre un plano (ubicación, separación de ojales, tamaño de bolsillo, reglas físicas de bordes) | Formulario del pedido |
| Anotaciones de ficha de diseño (puntos con flecha en %) | Configurador |
| Miniaturas + perfil ICC | Segundo plano al subir |

Problemas: capacidades duplicadas o casi (medir acá, medir allá), lógica técnica pesada
en el navegador (bordado), resultados no versionados (¿con qué análisis se cotizó?), y la
cantidad **incrustada dentro del arte** TPU — que obliga a regenerar capas cuando cambia.

## 2. El servicio de operaciones de imagen

- **RN-IMG.01** Existe un **catálogo de Operaciones de Imagen**, ejecutadas por el
  servidor como jobs idempotentes sobre archivos del repositorio (Spec 19): medir,
  generar miniatura, extraer perfil de color, generar capa blanca, medir tizada,
  vectorizar, separar colores, estimar puntadas, componer capas, renderizar preview.
  Cada operación declara entrada, parámetros y qué derivado produce.
- **INV-IMG.01** **Toda operación es reproducible y versionada**: el derivado guarda con
  qué versión del original, qué operación y qué parámetros se generó. La cotización que
  usó una medición referencia **esa** medición — si el arte cambia, la medición vieja no
  se pisa: se genera una nueva y la diferencia es visible.
- **RN-IMG.02** La lógica técnica pesada **corre en el servidor** (hoy el análisis de
  bordado corre en el navegador del cliente): el front pide la operación y muestra el
  resultado. El navegador puede anticipar (preview), pero el dato que cotiza y produce es
  el del servidor — el mismo principio que la validación (Spec 19 INV-ARC.02).
- **RN-IMG.03** Los algoritmos con reglas de negocio adentro las reciben **como
  parámetros de configuración**, no cableadas: densidades de puntada por tipo, velocidad
  de máquina, factor del relieve 3D, márgenes de material, consumos de borde de las
  terminaciones (soldadura 5 cm, ojal a 2,5/7,5 cm, bolsillo ×2 + 5 cm) — todo eso hoy
  está en el código y son decisiones del taller que cambian.

## 3. Composiciones: el resultado editable es DATA, no imagen

- **INV-IMG.02** Los editores (terminaciones sobre el plano, texturas 3D, anotaciones,
  apliques) **guardan datos estructurados** — posiciones en porcentaje, zonas, opciones,
  parámetros — nunca una imagen aplastada. La imagen final (preview, plano para el
  taller, boceto aprobado) es un **derivado renderizable** desde esos datos + el original.
  Consecuencias: se puede reeditar sin pérdida, re-renderizar si cambia el arte, y el
  checklist del taller sale de los datos (no de mirar un dibujo).
- **RN-IMG.04** Una **Composición** pertenece a su archivo/orden, se versiona, y registra
  quién editó qué (el cliente eligió las texturas / las delegó al diseñador — regla
  actual del TPU, generalizada). Un rechazo de boceto descarta la composición asociada
  (regla actual, conservada).
- **RN-IMG.05** **Las capas de producción se generan desde los datos**: el arte TPU deja
  de tener la cantidad incrustada como verdad — la cantidad vive en la orden, y las capas
  se renderizan (o re-renderizan) para la cantidad vigente. La regeneración por cambio de
  cantidad pasa de excepción manual a operación automática del catálogo.

## 4. Editores por dominio (lo que se conserva y se unifica)

- **RN-IMG.06** **Terminaciones (UV)**: el editor posiciona terminaciones sobre el plano
  del arte con las reglas físicas como validaciones en vivo (bolsillo y soldadura no
  comparten lado; separaciones máximas). Produce: la composición (data), las líneas de
  cobro (Spec 02), el checklist del área y la nota al taller — todos desde la misma
  fuente.
- **RN-IMG.07** **Bordado**: el análisis del logo produce una propuesta editable (paleta
  de hilos de la carta, tipo de puntada por zona, puntadas y tiempo estimados); el dato
  real del ponchado **manda sobre la estimación** (regla actual). La propuesta es una
  composición versionada ligada al logo.
- **RN-IMG.08** **TPU**: boceto → arte en capas → texturas 3D → boceto aprobado, cada
  etapa como derivados y composiciones versionadas; el visor 3D es un editor más del
  módulo.
- **RN-IMG.09** **Tizadas**: la medición (regiones cerradas, líneas compartidas una vez)
  es una operación del catálogo con sus parámetros de mesa; su resultado alimenta
  cotización y control **por referencia versionada**.

## 5. Interacciones

| Con | Relación |
|---|---|
| Spec 19 | Consume originales y produce derivados en el repositorio; jobs idempotentes con estado visible. |
| Spec 02 | Las validaciones de ingreso que necesitan mirar la imagen (DPI, medidas, medibilidad) usan operaciones de este módulo. |
| Spec 03 | Producción recibe capas, planos y checklists renderizados desde composiciones; el dato técnico (puntadas, piezas, bajadas) viaja a la cotización. |
| Spec 09 | Los datos técnicos que fijan precio provienen de operaciones versionadas — se sabe con qué análisis se cotizó. |
| Spec 15 | Operaciones que fallan quedan visibles y reintentables; nunca un derivado perdido en silencio. |
