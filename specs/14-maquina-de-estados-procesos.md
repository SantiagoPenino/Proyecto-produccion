# Spec 14 — Máquina de Estados, Procesos y Flujos (módulo dedicado, to-be)

> Spec de escalamiento: el sistema nuevo modela los ciclos de vida y los flujos como un
> **motor declarativo de primera clase**, no como lógica repartida por el código.
> Entidades definidas aquí: **Definición de Proceso**, **Estado**, **Transición**,
> **Guarda**, **Efecto**, **Instancia de Proceso**.

## 1. Diagnóstico del sistema actual

Lo que ya existe y hay que conservar como idea:
- Estados como datos con jerarquía padre/hijo (el estado general se **deriva**, nunca se
  fija a mano).
- Un **punto único de transición** con historial y autor obligatorio.
- Guardas reales nacidas de incidentes: no-retroceso de órdenes resueltas, no resucitar
  remitos recibidos, no des-entregar al anular, idempotencia del finalizar.

Lo que falla:
1. Las **transiciones, guardas y efectos viven en el código**, repetidas por camino: la
   misma regla debe recordarse en "finalizar", en "arrastrar", en "editar" — y cada
   camino olvidado fue un bug (validaciones salteadas al arrastrar lotes, updates masivos
   sin guarda que re-avisaron 60 órdenes entregadas).
2. Cada entidad tiene su ciclo a su manera: Orden (3 ejes), Retiro, Bulto, Remito,
   Documento, Deuda, Bobina, Ciclo, Cheque — nueve máquinas de estado implícitas sin un
   modelo común.
3. Los **flujos entre entidades** (pedido completo → contabilizar → avisar; transfer
   pronto → libera estampado) son cadenas de ifs distribuidos, no procesos declarados.
4. No hay forma de ver o versionar "el proceso": qué estados existen, qué transiciones
   son legales y quién puede hacerlas se descubre leyendo código.

## 2. El modelo

- **RN-FLU.01** Una **Definición de Proceso** por tipo de entidad con ciclo de vida
  (Orden, Retiro, Bulto, Remito, Documento, Deuda, Bobina, Ciclo, Cheque, Ticket de
  soporte…). Declara, como datos:
  - Sus **Estados** (nomenclador con columnas de comportamiento: es-inicial, es-final,
    cuenta-como-pronta, bloquea-facturación, visible-al-cliente…).
  - Sus **Transiciones** legales: estado origen → destino, **quién** puede ejecutarla
    (permiso, Spec 12), **cuándo** (guardas) y **qué pasa** (efectos).
  - Su derivación hacia arriba (estado del Pedido derivado de sus Órdenes; estado del
    Remito derivado de sus ítems) como regla declarada, no como consulta ad-hoc.
- **RN-FLU.02** **Guardas** declarativas y reutilizables, evaluadas por el motor **en
  todos los caminos** (botón, arrastre, lote masivo, API, job): pedido-completo,
  no-retroceso, todos-marcados, tiene-autor, no-tiene-pago, no-aceptado-DGI, bulto-vivo…
  Una guarda se define una vez; ningún camino puede saltearla porque no hay otro camino:
  **toda mutación de estado pasa por el motor**.
- **RN-FLU.03** **Efectos** declarados por transición: emitir evento de trazabilidad
  (Spec 13 — misma escritura), disparar el evento contable, generar etiquetas, encolar el
  aviso, liberar dependencias, recalcular derivados. Los efectos son transaccionales con
  la transición o explícitamente diferidos (colas), y **idempotentes**.
- **INV-FLU.01** No existe UPDATE directo del estado de una entidad con ciclo de vida:
  la única vía es el motor. (La versión estructural del "punto único" actual.)
- **INV-FLU.02** Una transición no declarada es **imposible**, no "no implementada". El
  catálogo de transiciones es cerrado y visible.

## 3. Procesos entre entidades (flujos)

- **RN-FLU.04** Los encadenamientos hoy implícitos se declaran como **procesos**: el
  ruteo de órdenes hermanas (secuencia por área, ramas que convergen, combos por
  componente), la cascada del check-in en depósito (pedido completo → contabilizar →
  habilitar aviso), las dependencias (transfer pronto libera estampado; retiro de
  depósito libera decoración), y los gates de notificación.
- **RN-FLU.05** Cada **Instancia de Proceso** (el pedido concreto atravesando su flujo)
  es consultable: en qué paso está, qué espera, desde cuándo, qué la destrabaría — la
  generalización de la "hoja de ruta" y de la bandeja "esperando bultos" actuales.
- **RN-FLU.06** Los **forzados manuales** son transiciones declaradas de tipo excepcional:
  exigen permiso elevado (Spec 12), motivo obligatorio, y quedan en el libro (Spec 13)
  con ambos actores. Forzar deja de ser un UPDATE especial y pasa a ser parte del proceso.

## 4. Versionado y administración

- **RN-FLU.07** Las definiciones de proceso se **versionan**: un cambio de flujo (nuevo
  estado, nueva guarda) crea una versión; las instancias en curso declaran con qué
  versión corren y cómo migran. Quién cambió el proceso y cuándo va al libro.
- **RN-FLU.08** Pantalla de administración: ver el diagrama real de cada proceso
  (estados, transiciones, guardas, permisos) generado **desde la definición** — el
  diagrama nunca miente porque es la definición.
- **RN-FLU.09** Los estados nuevos o reglas nuevas del negocio se agregan **como datos**
  (con su versión), no tocando veinte archivos — el objetivo declarado del nomenclador
  con columnas de comportamiento (Spec 11).

## 5. Qué cubren ya las specs 01–11 y qué agrega esta

| Ya especificado | Dónde | Esta spec agrega |
|---|---|---|
| Los tres ejes de estado de la Orden y el punto único | Spec 03 §2 | El punto único como **motor estructural** para todas las entidades |
| Estados de Bulto/Remito/Retiro/Documento/Deuda | Specs 04, 05, 06 | Un **modelo común** declarativo para todos |
| Guardas concretas (no-retroceso, no-resucitar, no-des-entregar) | Specs 03, 04, 06 | Guardas **declaradas una vez, aplicadas en todos los caminos** |
| Pedido completo como gate | Spec 04 §5, Spec 03 §1.3 | El gate como **proceso declarado y consultable** |
| Invariante "toda transición con autor" | Spec 11 §10.10 | El mecanismo que lo hace imposible de violar |

Las definiciones concretas de cada proceso (qué estados y transiciones tiene la Orden, el
Retiro, etc.) **son las que ya están escritas en las specs 02–10**: esta spec define el
motor que las ejecuta; aquellas definen el contenido.

## 6. Interacciones

| Módulo | Interacción |
|---|---|
| Trazabilidad (Spec 13) | Cada transición = un evento del libro; una sola escritura. |
| Seguridad (Spec 12) | Cada transición declara su permiso; los forzados exigen autorización elevada. |
| Todos los módulos | Dejan de implementar sus propios cambios de estado; declaran su proceso y llaman al motor. |
