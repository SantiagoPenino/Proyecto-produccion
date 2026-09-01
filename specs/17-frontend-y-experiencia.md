# Spec 17 — Frontend y Experiencia de Uso (to-be)

> Spec de escalamiento. Fija los **contratos de interacción** del sistema nuevo: lo que
> cualquier pantalla debe cumplir, sea cual sea el framework. No define diseño visual ni
> tecnología (eso va en ADRs y en un design system aparte); define las reglas de
> experiencia que en este negocio son reglas de negocio. Consolida lo que las specs 02–10
> ya dicen de forma dispersa.

## 1. Las cuatro audiencias

| Audiencia | Contexto | Lo que manda |
|---|---|---|
| **Operario de planta/depósito** | Apurado, con guantes, pistola de escaneo, pantalla compartida | Botones grandes, escaneo como entrada primaria, cero ambigüedad, tiempo real |
| **Administrativo (caja/contabilidad)** | Sentado, tareas largas, precisión | Densidad de datos, teclado, filtros potentes, confirmaciones con cifras |
| **Cliente del portal** | Celular, esporádico, sin entrenamiento | Lenguaje de cliente, pasos guiados, estado visible de sus cosas, PWA instalable |
| **Tótem/kiosco** | De pie, público, sin sesión | Pantalla completa, flujo de un solo camino, cierre por inactividad, voz/impresión |

- **RN-FRO.01** Cada pantalla declara su audiencia y cumple las reglas de esa audiencia.
  Una misma función (p. ej. retiros) puede tener vistas distintas por audiencia — nunca
  una vista "promedio" que no sirve bien a ninguna.

## 2. Claridad máxima (la regla de la casa, elevada a contrato)

- **INV-FRO.01** Todo botón, label, confirmación y toast dice **exactamente** qué hace la
  acción, con los datos del caso. Prohibidos: "¿Está seguro?", "Aceptar", "Error al
  procesar". El modelo es el actual del forzado: "Forzar ingresa el pedido ENTERO, se
  contabiliza y se avisa al cliente aunque falten bultos".
- **RN-FRO.02** Los mensajes salen del **catálogo central** (Spec 15) con el nivel de la
  audiencia; el front no redacta errores por su cuenta.
- **RN-FRO.03** Toda acción destructiva o excepcional muestra **qué va a pasar antes** (el
  alcance real: cuántas órdenes, qué importes) y **qué pasó después** (resultado con
  cifras, incluyendo parciales: "se entregaron 8 de 10; fallaron estas 2").

## 3. Patrones de interacción canónicos

El sistema nuevo se construye con un juego cerrado de patrones reutilizables (el
equivalente front de los módulos del backend). Los principales, todos existentes hoy de
forma artesanal:

- **RN-FRO.04 Bandeja**: lista de trabajo con orden de prioridad de negocio (fallas >
  urgentes > reposiciones > normales), filtros persistentes, elementos bloqueados
  **visibles con su motivo real** (nunca ocultos), y acciones por fila según estado y
  permiso.
- **RN-FRO.05 Escaneo**: toda pantalla operativa que acepta pistola/QR escucha siempre,
  bloquea el escaneo durante una acción en curso, rechaza códigos ajenos con mensaje, y
  normaliza los formatos de etiqueta.
- **RN-FRO.06 Asistente (wizard)**: los flujos largos del cliente (pedido, retiro,
  checkout) van por pasos con validación en cada paso, resumen final **confirmado
  explícitamente** (el modelo del corte: "estas piezas y metros se leyeron — confirmá que
  es correcto") y candado anti-doble-envío.
- **RN-FRO.07 Tiempo real**: las pantallas compartidas (depósito, bandejas, mostrador,
  auditoría colaborativa) se actualizan por eventos (Spec 16 RN-ARQ.10) — nunca "apretá
  F5"; los escaneos concurrentes de varios operarios se ven entre sí.
- **RN-FRO.08 Línea de tiempo**: la vista de historia de cualquier entidad (pedido,
  cliente, documento) es la consulta al libro de trazabilidad (Spec 13 RN-TRZ.05),
  renderizada igual en todos lados.
- **RN-FRO.09 Estado visible**: toda entidad muestra su estado con el mismo lenguaje
  visual en todo el sistema (mismo nombre, mismo color, derivados del nomenclador de
  estados — Spec 14), nunca traducciones locales por pantalla.

## 4. Permisos en la interfaz

- **RN-FRO.10** La interfaz **refleja** el permiso, no lo implementa: una acción sin
  permiso no se muestra (o se muestra deshabilitada con el motivo), pero la decisión real
  vive en el backend (Spec 12 INV-SEG.02). El menú se arma desde los permisos efectivos.
- **RN-FRO.11** Las autorizaciones elevadas (Spec 12 RN-SEG.08) tienen un componente
  único: pide la credencial del autorizador, muestra qué se autoriza con datos, y deja
  constancia visible de ambos actores.

## 5. Datos y formato

- **RN-FRO.12** **Fechas**: se muestran siempre en hora local del negocio, con un único
  formateador central. Prohibido formatear fechas a mano por pantalla (la lección del
  "DATE que se muestra un día antes").
- **RN-FRO.13** **Dinero**: todo importe se muestra con su moneda, siempre; los totales
  mixtos declaran la cotización usada. Un número sin moneda es un bug de UI.
- **RN-FRO.14** **Idioma**: español rioplatense en todo el sistema; textos en un
  diccionario central (aunque no haya segundo idioma: el diccionario es lo que garantiza
  consistencia de vocabulario — "retiro", no "pickup" en una pantalla y "entrega" en
  otra).
- **RN-FRO.15** Listas largas: paginadas o virtualizadas por contrato; los totales del
  encabezado son del filtro completo, no de la página (lección del libro mayor de 10 MB).

## 6. Portal del cliente y tótem

- **RN-FRO.16** El portal es **PWA instalable** con push (Spec 10); funciona bien en
  celular primero. El cliente ve el estado de sus cosas sin preguntar: pedidos con su
  etapa, retiros, pagos, recursos con barras de consumo.
- **RN-FRO.17** El tótem es modo kiosco estricto: pantalla completa, un flujo por vez,
  cierre automático por inactividad (protege al cliente anterior), salida de emergencia,
  y las llaves de dispositivo de la Spec 12 RN-SEG.09.
- **RN-FRO.18** Al cliente **nunca** se le muestran internos: códigos de falla, nombres
  internos de planes, órdenes hermanas técnicas, jerga de estados de producción — la
  vista del cliente usa el subconjunto de estados marcado visible-al-cliente (Spec 14).

## 7. Resiliencia de la interfaz

- **RN-FRO.19** Toda acción muestra su estado en curso (enviando/procesando) y bloquea el
  reenvío; la respuesta tardía no permite duplicar (complementa la idempotencia del
  backend, Spec 15).
- **RN-FRO.20** Las estaciones críticas (caja, depósito, tótem) degradan con mensaje
  honesto cuando un proveedor está caído (stock "sin dato", "DGI no disponible —
  el documento queda pendiente de envío"), según el modo de degradación declarado
  (Spec 15 RN-ERR.08).

## 8. Qué NO va en esta spec

El diseño visual (colores, tipografía, componentes concretos) vive en un **design system**
propio del proyecto nuevo; la elección de framework y librerías, en ADRs (Spec 16 §8).
Esta spec es el contrato que ambos deben cumplir.

## 9. Interacciones

| Con | Relación |
|---|---|
| Spec 15 | Los mensajes y confirmaciones salen del catálogo; niveles por audiencia. |
| Spec 14 | Estados con lenguaje visual único desde el nomenclador; visible-al-cliente. |
| Spec 12 | La UI refleja permisos; componente único de autorización elevada. |
| Spec 13 | La línea de tiempo es la vista del libro. |
| Spec 16 | API única, tiempo real por eventos, PWA/kiosco como clientes de la misma plataforma. |
