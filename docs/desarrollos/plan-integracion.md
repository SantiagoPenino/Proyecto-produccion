# Desarrollos dentro del sistema: plan de integración

14/10/2026 · borrador para revisar antes de escribir código.

Fuentes: el paquete de Felipe (*Guía para Sistemas*, *Plan funcional*, código y `copia-de-datos.json` del 12/10) y tres especificaciones que armé leyendo el código del prototipo de punta a punta. Las especificaciones están al lado de este archivo:

- `spec-A-base-datos.md`: modelo de datos, reglas calculadas, cruces y la página principal.
- `spec-B-pedidos-bandeja-proyectos.md`: Pedidos, Bandeja, Proyectos, Plantillas y Archivo, con los textos de pantalla tal cual.
- `spec-C-planificacion-tareas-muestras-catalogo.md`: Planificación, Tareas, Inicio, Muestras, Catálogo técnico y Reportes.

Marcas: **[verificado: dónde]** · **[inferido de X]** · **[no lo sé]**. Lo verificado contra la base se hizo en la **copia local** de prod, con lecturas solamente.

---

## 1. Resumen

- **Qué es.** Una herramienta para llevar un desarrollo desde que alguien lo pide hasta que se termina. Sirve para productos, máquinas, procesos y cambios de sistemas. Hoy es un prototipo de Felipe que corre como artifact de Claude, sin servidor, con una base de documentos JSON. Tiene datos reales: 65 proyectos, 35 pedidos, 13 muestras, 53 capacidades y 102 opciones de molde.
- **Qué propongo.** Construirla adentro del sistema como un módulo nuevo, **Desarrollos**, usando el prototipo como especificación. Las reglas de negocio quedan como las definió Felipe; se arreglan los problemas técnicos (identidad, permisos, integridad, concurrencia). Lo que parezca una decisión de producto se le pregunta a él.
- **Cómo se pasa.** Se desarrolla en 5 fases. Cada fase se prueba con los datos reales importados en la copia local, y Felipe la revisa. El pase es **uno solo**: Felipe exporta el JSON final, se importa en prod y el prototipo queda de solo lectura. Así nadie carga lo mismo en dos lados.
- **Qué gana respecto del prototipo.** Login y permisos reales, vendedores adentro del sistema (hoy no pueden usarlo), proyecto enlazado al artículo del maestro en vez de un código tipeado, muestras enlazadas a la orden real con su estado, avisos en la campanita y el celular, y respaldo diario de la base.

---

## 2. Respuestas a las preguntas de la guía de Felipe (sección 10)

| Pregunta | Respuesta |
|---|---|
| 1. ¿El sistema ya tiene gestión de proyectos, tareas o pedidos internos? | **No para esto.** Servicio Técnico tiene proyectos de mantenimiento (`ST_Proyectos`). `Tareas` es una lista de pendientes simple. Solicitudes de vendedores es el circuito de diseño de pedidos, no de desarrollo. `ProyectosTecnicos` y `UpdatesProyecto` existen pero no las usa ningún código **[verificado: 0 filas en la copia local y sin referencias en el código]**. Desarrollos es un módulo nuevo. |
| 2. ¿Se puede consultar el maestro de productos? | **Sí, es `Articulos`.** Los REF del prototipo (`PR-001`…`PR-057`) son exactamente los 57 `Articulos.CodArticulo` que empiezan con `PR-` **[verificado: copia local]**. La familia sale de `Articulos.CodStock`, igual que en Configurar Productos **[verificado: ConfigurarProductosPage.jsx:1380]**. La etiqueta (Fútbol / Básquet / Vóley) sale de `ProductoVentaConfig.EtiquetaID` → `ProductoEtiqueta` **[verificado: copia local]**. |
| 3. ¿Las órdenes de USER se encuentran por número y tienen estado? | **Sí, por `Ordenes.CodigoOrden`.** `SUB-31561`, `SUB-31584` y `DIR-31586`, de las muestras, existen con su área y su estado **[verificado: copia local]**. |
| 4. ¿Usuarios y permisos? | **Sí.** `Usuarios` + `Roles`, y el menú por rol con `Modulos` + `PermisosRoles`. Felipe (78), German (65), Sergio (64) y Agustín (53) ya son usuarios **[verificado: copia local]**. |
| 5. ¿Adjuntos? | **En Google Drive** (`driveService.uploadToDrive`), como el resto del sistema **[verificado: código]**. El límite lo pone cada ruta de subida; propongo 50 MB por archivo **[decisión mía, se puede cambiar]**. |
| 6. ¿El sistema maneja variantes? | **En parte, y se pisa con lo de Yoania.** Configurar Productos tiene modelos por producto (`ProductoModelos`) y telas (`ProductoTelas`), y TIZADA PRO tiene los moldes con sus opciones. Las "variantes" y "opciones de slot" del prototipo se superponen con eso **[inferido de las tablas y del código de solicitudes]**. Se define con Yoania antes de la fase 4 (§9). |
| 7. ¿Qué camino? | **Integrarlo entero** (entre el B y el C de la guía): se rehace adentro por fases y se pasa de una vez. El camino A (dejarlo afuera y enlazar) no sirve: el prototipo no tiene API ni servidor, así que el sistema no tiene cómo leerle ni escribirle **[verificado: Guía §9 y código]**. |

---

## 3. Qué hace hoy, pantalla por pantalla (resumen)

El detalle completo, con fórmulas y textos de pantalla, está en las tres especificaciones.

| Pantalla | Qué hace | Quién la usa |
|---|---|---|
| **Pedidos** | Formulario corto (qué piden, detalle, cliente, para cuándo, fotos o PDF). "Mis pedidos" muestra el estado en palabras simples: Recibido / Aprobado · en desarrollo (etapa) / Listo / No se hace / Pospuesto, con el motivo. Tiene comentarios. | Vendedores (es lo único que ven) y el equipo |
| **Bandeja** | Todo lo que entra: pedidos, ideas, órdenes, correcciones y variantes. Se busca, se filtra y se ordena ("Recomendado para atender", puntaje, fechas). Se edita y se decide: **Aprobar** (elige plantilla y crea el proyecto), **Posponer** o **Descartar** (con un motivo que ve quien lo pidió). Se puede reabrir. | Equipo de desarrollo; aprobar, solo el editor |
| **Proyectos** | Lista de lo que está en curso, con filtros, órdenes y chips de etapa. La **ficha** tiene datos, notas, archivos, la etapa actual ("Ahora"), las tareas por etapa (✓, estado, responsable, fecha, "⋯ más"), puntaje, enlaces, comentarios, historial, "Guardar como plantilla" y cancelar / reactivar / borrar. | Equipo; edita el editor |
| **Plantillas** | Flujos guardados (etapas con color y tareas con días hábiles, entregable y "Pide REF"). Vienen 8 de fábrica más la interna de variantes. Desde ahí también se editan los tipos de desarrollo. | Editor |
| **Planificación** | Tandas de 1 a 4 semanas: se vinculan proyectos y se eligen sus tareas, se agrupan proyectos y se cierra la tanda (lo pendiente pasa a la próxima o queda sin planificar). También la "lista de desarrollo" con orden manual. | Editor |
| **Tareas** | El trabajo del día, en lista agrupada o tablero por estado. Por defecto muestra solo lo planificado. Fechas sugeridas según duraciones y dependencias, que se confirman de a una o todas juntas. | Equipo |
| **Inicio** | Lo mío (atrasadas primero), mis proyectos, la tanda en curso y los resúmenes de Bandeja y Muestras. | Equipo |
| **Muestras** | Cada muestra física: sus órdenes de USER, los proyectos a los que pertenece (varios), estado, tildes, ronda, fecha, comentario y fotos. Se cargan de a una o pegando filas de una planilla. | Equipo (colaboradores también) |
| **Catálogo técnico** | Capacidades (con "Qué destraba más"), variantes de cada producto (estado en moldes, TizadaPro y ERP, con avisos) y opciones de slot de cada molde. | Editor |
| **Archivo** | Proyectos terminados y cancelados, con lo que llevó cada uno. Solo consulta. | Todos |
| **Reportes** | Resumen semanal que se copia como texto para WhatsApp. Incluye el "Esto me trabó". | Equipo |
| Página principal | Login con PIN, buscador, guías, Más (equipo, listas, fuentes de moldes, importar del ERP, proyecto directo), Cronograma, copia semanal en JSON. | — |

---

## 4. Cómo queda adentro del sistema

### 4.1 Menú y pantallas

- Grupo de menú **Desarrollos**. Cada pantalla es su propia entrada en `Modulos`, como Servicio Técnico (`servicioTecnicoSecciones.js` + `DynamicRouter`). Así cada rol ve solo lo suyo con `PermisosRoles`.
- Orden del menú, el mismo del prototipo: Inicio, Bandeja, Proyectos, Planificación, Tareas, Muestras, Pedidos, Catálogo técnico, Archivo, Reportes y Plantillas.
- Rol VENTAS (7): ve **solo Pedidos**, igual que el "vendedor" del prototipo.
- Pantallas en React, en `src/components/pages/desarrollos/`, con el tema claro y las reglas de UI del sistema (Lucide en cian de marca, `Selector` propio, modales en z-[6000], sin desenfoque de fondo).
- Los **textos de pantalla se conservan** tal cual los escribió Felipe (están en las especificaciones). La herramienta ya se usa así.
- Tiempo real: cada cambio emite un evento por socket y las pantallas abiertas se refrescan, sin pisar lo que alguien esté escribiendo (regla del prototipo).

### 4.2 Permisos

El prototipo tiene tres niveles: lectura, colaborador (carga pedidos, muestras y comentarios) y editor (todo). Además, aprobar es solo del editor. Hoy lo decide cómo se comparte el artifact; el PIN y el rol solo cambian qué se ve.

En el sistema:

- **Ver cada pantalla**: `PermisosRoles` del menú.
- **Equipo de desarrollo** (reemplaza a "Más › Equipo"): una tabla con cada usuario, su nivel (**Editor** o **Colaborador**) y sus líneas. Los Admin son editores sin tener que cargarlos. Los selectores de responsable muestran solo al equipo; en el prototipo aparecen también los vendedores.
- **Cada endpoint valida el permiso en el servidor.** En el prototipo, cancelar, reactivar y borrar proyectos, y todo lo que se escribe desde la Bandeja, no tienen control del lado del servidor.

### 4.3 Datos (tablas nuevas, prefijo `Des`)

Las tres recomendaciones de la guía (tareas en tabla propia, tandas con tabla de relación, variantes aparte) más lo que pide una base relacional:

| Tabla | Qué guarda | Diferencia con el prototipo |
|---|---|---|
| `DesEquipo` | usuario, nivel, líneas | Por `IdUsuario`, no por nombre |
| `DesTiposDesarrollo` | clave, nombre, es producto, orden | No se puede borrar uno en uso |
| `DesPlantillas` · `DesPlantillaEtapas` · `DesPlantillaTareas` | flujos guardados | Las etapas tienen id propio; en el prototipo el id es el texto de la etapa |
| `DesSolicitudes` | pedidos | `PedidoPorUsuarioID` + `CliIdCliente` (con texto libre para prospectos) |
| `DesProyectos` | proyectos | `ProIdProducto` (artículo del maestro) en vez de `ref_erp` tipeado; `AreaID` como línea; fechas de terminado y cancelado guardadas |
| `DesProyectoEtapas` | etapas copiadas de la plantilla, **siempre** | Un solo orden de tareas; el prototipo tiene dos que pueden no coincidir |
| `DesTareas` · `DesTareaDependencias` | tareas de proyectos y de variantes | Tabla propia |
| `DesTandas` · `DesTandaGrupos` · `DesTandaProyectos` · `DesTandaTareas` | planificación | "Una tarea, una tanda abierta" con índice único filtrado y transacción |
| `DesOrdenLista` | orden manual de la lista de desarrollo | — |
| `DesMuestras` · `DesMuestraOrdenes` · `DesMuestraProyectos` · `DesMuestraEstados` · `DesMuestraTildes` | muestras | Cada orden enlazada a `Ordenes.OrdenID` cuando existe |
| `DesCapacidades` · `DesCapacidadUso` | capacidades y qué proyecto o pedido las requiere o resuelve | — |
| `DesVariantes` · `DesOpcionesSlot` | catálogo técnico | Forma final a definir con Yoania (§9) |
| `DesComentarios` · `DesBitacora` · `DesAdjuntos` | comunes a todo | La bitácora no se corta en 200; los adjuntos van a Drive |
| `DesConfig` | horizonte y largo de tanda, fuentes de moldes | — |

Las tablas se crean solas la primera vez, desde un archivo JS versionado en git, como `TiendaConfecciones`. Así existen en cualquier base sin depender de que alguien corra un script. Las altas de menú y permisos te las paso como SQL para correr a mano.

Los **códigos se generan en el servidor**, dentro de la transacción. En el prototipo los calcula el navegador y dos altas al mismo tiempo pueden repetir número.

### 4.4 Enlaces con el resto del sistema

| Con | Qué se hace |
|---|---|
| **Usuarios** | Pedido, responsable, líder, comentarios y bitácora guardan `IdUsuario`. En el prototipo son nombres de texto: si alguien cambia de nombre, pierde sus pedidos. |
| **Artículos** | La tarea "Alta en el ERP como borrador" pide **elegir el artículo** del maestro, con buscador, en vez de tipear el REF. Familia y etiqueta salen del artículo y dejan de cargarse a mano. Las listas copiadas de familias y etiquetas desaparecen. |
| **Clientes** | El pedido elige el cliente de `Clientes`; al vendedor le salen primero los suyos. Queda texto libre para prospectos que todavía no son clientes. |
| **Órdenes** | En Muestras se busca la orden por número; se ve su estado y su área en vivo y se abre su detalle. |
| **Líneas** | sublimación → `SB`, directa → `DIRECTA`, ecouv → `ECOUV` (`Areas`) **[verificado: copia local]**. |
| **Avisos** | Con `notificacionesService.notificar` (campanita + push). Es nuevo: el prototipo no avisa nada. Al vendedor, cuando su pedido se aprueba, pospone, descarta, termina o se cancela. Al responsable, cuando le asignan una tarea. A los editores, cuando entra un pedido. |
| **TIZADA PRO / Configurar Productos** | Variantes y opciones de slot, y las tareas "Molde y modelos en TizadaPro" / "Cargar el modelo en TizadaPro". Se define con Yoania (§9). |
| **Servicio Técnico** | Un desarrollo de tipo "máquina" puede terminar en un equipo nuevo. Por ahora no se enlazan; queda anotado. |

### 4.5 Lo que no se pasa (y por qué)

| Del prototipo | Qué pasa | Por qué |
|---|---|---|
| Login con PIN | Se usa el login del sistema | El PIN no es seguridad (lo dice la guía) |
| Copia semanal en JSON | No hace falta | La base se respalda todos los días a las 03:00 **[verificado: memoria de infra]** |
| Listas de familias y etiquetas | Salen del maestro | Eran copias a mano del ERP |
| Cronograma | No se pasa por ahora | Felipe dice que es lo único que queda de la versión anterior y que no entiende las etapas propias |
| Guías paso a paso, buscador global | Después del pase (fase 5) | No guardan datos |
| Importar un listado del ERP | No se pasa | Con el artículo elegido del maestro no hace falta |

---

## 5. Migración de los datos

Un script de importación (`backend/scripts/desarrollos/importar.js`) lee el JSON del prototipo y carga las tablas:

- **Repetible**: corre sobre tablas vacías, adentro de una transacción. Se puede correr cuantas veces haga falta en la copia local.
- **Guarda el id original** de cada documento (`IdOrigen`) para poder rastrear.
- **Personas**: nombre → usuario. "Felipe" y "Felipe Lalinde" → 78, "German" → 65, "Sergio" → 64. Lo que no es una persona ("Lista de WhatsApp (06/10)", "Sugerencia de Claude", "Claude") queda como texto, sin usuario.
- **REF → artículo** por `CodArticulo`. Casos que necesitan decisión: `PR-034 PR-030` (dos códigos en un campo), `574`, que en el maestro es "Camiseta localhost", un artículo de prueba, y `PRP-001`, que no está en el maestro **[verificado: copia local]**.
- **Variantes**: los ids `v1`…`v5` se repiten entre productos **[verificado: spec A]**. Al importar reciben un id nuevo.
- **Etapas**: los 65 proyectos usan las 5 etapas de siempre **[verificado: JSON]**. Se copian a `DesProyectoEtapas` con id propio.
- **Muestras**: cada número de orden se busca en `Ordenes` y se enlaza si existe.
- **Al final** imprime un **reporte**: conteos contra el JSON (65 / 35 / 13 / 53 / 102 / 759 tareas) y todo lo que no pudo enlazar.
- **Archivos**: el JSON no trae fotos ni archivos. Hay 1 imagen referenciada sin el archivo **[verificado: JSON]**. Si hay archivos en el almacén del artifact, Felipe los tiene que bajar aparte **[no lo sé si hay más]**.
- **Fuentes de moldes**: una nota trae datos de acceso a una cuenta de mail **[verificado: JSON, config/fuentes]**. **No se importa**; se le avisa a Felipe para que lo guarde en otro lado.

**Cómo sale el JSON final [no lo sé]**: en el código, la única exportación es la del modo local ("Descargar copia de seguridad"). El artifact publicado no tiene botón para exportar, y la "copia de los viernes" que mencionan las guías no está en el código **[verificado: spec A §3.11]**. Hay que preguntarle a Felipe cómo sacó `copia-de-datos.json`. Otra posibilidad: si te comparte el artifact con permiso de edición, quizás yo pueda leer su base directamente **[inferido de las herramientas de artifacts que tengo; no lo probé]**.

**El día del pase**: Felipe exporta el JSON final → corro el script en la copia local con ese JSON y revisamos el reporte → te paso cómo correrlo en prod → el prototipo queda de solo lectura. Durante una semana se compara contra el prototipo ante cualquier duda.

---

## 6. Fases

Cada fase se prueba en la copia local con los datos reales importados, Felipe la revisa y recién ahí se pasa a la siguiente. El pase a prod es al final de la fase 4.

### Fase 0: base
- Tablas, equipo y permisos, grupo de menú y secciones, esqueleto de la API.
- Piezas comunes: bitácora, comentarios, adjuntos en Drive, eventos por socket.
- Script de importación v1 y su reporte.
- **Se prueba**: el importador da los conteos del JSON; cada rol ve el menú que corresponde; un vendedor no puede llamar a un endpoint de editor.

### Fase 1: Pedidos y Bandeja
- Pedidos (vendedor) y Bandeja completa: filtros, órdenes, edición, aprobar / posponer / descartar / reabrir.
- Aprobar crea el proyecto con su plantilla en **una sola transacción**. En el prototipo son dos escrituras sueltas.
- Plantillas y tipos de desarrollo, solo lectura (el editor llega en la fase 2).
- Avisos al vendedor.
- **Se prueba**: el estado que ve el vendedor en cada caso de la tabla de spec B §1.4; el vendedor ve solo sus pedidos y **nunca** la nota interna; el puntaje y el "Recomendado" dan lo mismo que el prototipo con los mismos datos; aprobar dos veces seguidas no crea dos proyectos.

### Fase 2: Proyectos, Tareas, Archivo y Plantillas
- Lista y ficha del proyecto, con todas las reglas de tareas: auto-avance, "Pide REF" con el artículo, dependencias sin ciclos, fechas sugeridas en días hábiles.
- Pantalla Tareas (lista y tablero), Archivo y el editor de Plantillas.
- **Se prueba**: etapa actual, avance, atrasadas, bloqueadas y fechas sugeridas comparadas contra el prototipo, proyecto por proyecto, con los 65 importados; cancelar, reactivar y borrar sin dejar referencias colgadas.

### Fase 3: Planificación e Inicio
- Tandas, grupos, elegir tareas, cerrar la tanda (pasar lo pendiente o no), lista de desarrollo con orden manual.
- Inicio.
- **Se prueba**: "una tarea, una tanda abierta" con dos personas tocando a la vez; cerrar una tanda y que lo pendiente llegue a la próxima con sus grupos.

### Fase 4: Muestras y Catálogo técnico (después de hablar con Yoania)
- Muestras con órdenes enlazadas y el pegado desde planilla.
- Capacidades con "Qué destraba más", variantes y opciones de slot, según lo que se acuerde.
- **Se prueba**: el ranking de capacidades da lo mismo que el prototipo; pegar filas no duplica órdenes ya cargadas.

### Pase a prod

### Fase 5: después del pase
- Reportes y "Esto me trabó", buscador.
- De la lista de pendientes de Felipe: aviso diario o semanal por persona, tiempo real contra estimado por tarea.
- Más adelante: crear el artículo en el maestro desde la tarea "Alta en el ERP"; que TIZADA marque sola la tarea de "modelo cargado".

---

## 7. Decisiones que tomé (para que las revises)

**Criterio general**: lo que es regla de negocio queda como lo hizo Felipe, aunque a mí me parezca raro. Lo que es un error técnico se arregla. Lo dudoso se le pregunta (§8).

Arreglos técnicos:
1. **Identidad por usuario**, no por nombre (spec B, rareza 1).
2. **Permisos en el servidor** (B-2).
3. **El vendedor ve solo el motivo, nunca la nota interna.** Hoy, si no hay motivo, se le muestra la evaluación del equipo (B-3).
4. **Códigos en el servidor**, sin repetidos (B-21).
5. **Etapas con id propio y un solo orden de tareas** (B-16, B-17).
6. **Borrar = marcar como borrado.** No se elimina la fila, así el pedido de origen, las muestras y los comentarios no quedan colgados (B-25). Solo el editor.
7. **Fecha de terminado y de cancelado guardadas.** En el prototipo, editar un cancelado le cambia la fecha en el Archivo (B-28).
8. **Al borrar un pedido**, sus adjuntos siguen visibles desde el proyecto (B-11).
9. **"Guardar como plantilla" conserva el tipo de desarrollo** (B-18).
10. **"Pide REF" solo aplica en desarrollos de producto** (B-20).
11. **Crear una capacidad con un nombre que ya existe** avisa en vez de pisar la existente (spec C).
12. **Tandas con transacción** y la regla "una tarea, una tanda" garantizada por la base (spec C).

Ajustes de comportamiento que me parecen errores, pero son de producto (se los confirmo a Felipe; por defecto los arreglo así):
13. **El tipo "proceso" propone la plantilla "Proceso o procedimiento".** Hoy propone la de máquina, y su propio Plan funcional dice que es la de procedimiento (B-6).
14. **Una "orden" no se puede descartar**, como dice su propia descripción del tipo (B-5).
15. **Variante aprobada**: el vendedor ve el avance de la variante y no el del producto padre, que suele estar "Listo" desde antes (B-4).
16. **PD- o CO- lo decide la plantilla** en los dos caminos. Hoy al aprobar lo decide el tipo de pedido y en "Nuevo proyecto" la plantilla (B-7).
17. **Prefijo de los pedidos**: `SOL-` ya lo usan las solicitudes del WMS (`wmsInternoController.js:785`) y las de vendedores (`solicitudesVendedorService.js:749`). Propongo **`DES-`**, con el mismo número: SOL-12 → DES-12. Lo viejo en la bitácora queda como está.

---

## 8. Qué hablar con Felipe

- **Congelar el prototipo.** Cambió todos los días entre el 12 y el 13/10 (anexo del Plan funcional). Hay que acordar una fecha a partir de la cual no cambia más, o que avise cada cambio. Si no, se construye sobre una especificación que se mueve.
- **Confirmar los ajustes 13 a 17** de §7.
- **Qué hace la marca `erp`** de las tareas "Configuración completa en el ERP". Se guarda pero no hace nada. Propuesta: que no se pueda marcar hecha si el artículo no tiene su configuración de venta.
- **La urgencia cuenta dos veces** en "Recomendado para atender" (en el puntaje y en el extra). ¿Es a propósito?
- **Pospuestos con la fecha de revisión cumplida**: hoy quedan escondidos en el chip "Pospuestas". ¿Deberían volver a "Por resolver"?
- **Cómo sacó el JSON y cómo va a sacar el final** el día del pase (§5).
- Los casos de datos: `PR-034 PR-030`, `574`, `PRP-001` y las personas que no son personas.
- **Los datos de acceso que están en las fuentes de moldes.**
- **Si hay fotos o archivos** en el almacén del artifact que no vienen en el JSON.
- **Quiénes son los vendedores** y quiénes del equipo son editores o colaboradores.
- **La Bandeja ya no muestra los "pasos previos"** (registro, aclaración, viabilidad…) pero todavía existen en los datos. ¿Se descartan?

## 9. Qué hablar con Yoania (antes de la fase 4)

- **Variantes del prototipo contra `ProductoModelos` y TIZADA PRO.** ¿Una variante "lista" debería existir como modelo en Configurar Productos? ¿Quién es el dueño de ese dato?
- **Opciones de slot** (los 6 moldes y sus partes: cuello, costadillo, manga…). ¿Salen de TIZADA PRO? Si TIZADA ya las expone, el catálogo las lee de ahí y no se duplican **[no lo sé si las expone así; lo revisamos juntos]**.
- Si se pueden marcar solas las tareas **"Molde y modelos en TizadaPro"** y **"Habilitar en el ERP («Modelos que se venden»)"** consultando TIZADA y Configurar Productos.
- Que sepa del módulo nuevo, porque toca artículos y la configuración de venta, que son terreno suyo.

## 10. Riesgos

| Riesgo | Cómo se maneja |
|---|---|
| Es grande: 11 pantallas | Fases chicas con revisión; los textos y las reglas ya están escritos; nada pasa a prod hasta el final |
| La especificación se mueve | Congelar el prototipo (§8); el importador se ajusta al JSON final |
| Se pisa con TIZADA y Configurar Productos | Reunión con Yoania antes de la fase 4; hasta entonces el catálogo se importa tal cual, sin perder nada |
| Datos sucios (nombres, REF raros) | El reporte del importador los lista y se deciden uno por uno |
| Los vendedores no lo usan | Avisos al celular y la pantalla Pedidos tan corta como la de Felipe |
| Dos "Solicitudes" en el sistema | Prefijo `DES-` y el nombre "Pedidos de desarrollo" en el menú |

---

## 11. Qué necesito de vos para arrancar

- El OK al plan, o lo que cambiarías.
- Si querés que le pase a Felipe las preguntas de §8 armadas como mensaje, o se las pasás vos.
- Con el OK arranco por la fase 0 en la copia local. No toco prod.
