# Spec 27 — Soporte / Mesa de Ayuda (to-be)

> Spec de escalamiento. El sistema actual tiene un HelpDesk propio, completo y funcional
> (nunca documentado en specs hasta ahora); esta spec conserva su diseño bueno y cierra
> sus huecos.
> Entidades definidas aquí: **Ticket**, **Mensaje**, **Nota Interna**, **Área de
> Atención**, **Derivación**, **SLA**.

## 1. Diagnóstico del sistema actual

Lo que funciona (se conserva): dos caras (centro de ayuda del cliente + bandeja interna);
estados con la pelota clara ("Esperar" para el interno = "Responder" para el cliente);
**cambio de estado automático por el hilo** (responde el cliente → vuelve a Abierto;
responde el staff → Esperar; la nota interna no cambia nada); nota interna **filtrada en
el servidor** (nunca llega al cliente); push al cliente solo por respuestas públicas;
parpadeo rojo en ambos menús con condiciones inversas; avisos emergentes en tiempo real
clicables; vínculo con la orden precargado desde "iniciar reclamo"; adjuntos privados con
visor; candado de pertenencia del cliente bien puesto.

Lo que falla:
1. **Sin control de rol en la API**: un cliente podría cerrar o derivar su propio ticket
   por API; los **adjuntos no verifican pertenencia** (cualquier logueado que adivine la
   ruta ve evidencia ajena); el backend no impide responder un ticket cerrado (reapertura
   por API).
2. **Sin SLA ni métricas de ningún tipo**; la prioridad existe pero está muerta.
3. **Sin historial** de estados ni de derivaciones; sin motivo de cierre; sin
   tipificación.
4. Las áreas de atención se cargan directo en base; la ventana de reclamo (20 días) está
   fija en código y solo en la interfaz.
5. Sin plantillas de respuesta, sin búsqueda, sin vista mobile interna.

## 2. El Ticket

- **RN-SOP.01** Un Ticket tiene: asunto, **Área de Atención** destino, prioridad,
  estado, autor (cliente o interno), y opcionalmente **una Orden/Pedido vinculado**.
  El hilo es cronológico; cada mensaje puede llevar adjuntos (imágenes/PDF, límites
  configurables) o solo adjuntos, nunca vacío.
- **RN-SOP.02** Estados (nomenclador del motor, Spec 14): **Abierto** (pelota del staff)
  → **Procesando** → **Esperando al cliente** (el cliente lo ve como "Responder") →
  **Resuelto** / **Cerrado** (terminales). Se conserva el doble nombre por audiencia.
- **RN-SOP.03** **Transiciones automáticas por el hilo** (se conservan, ahora como
  transiciones del motor): respuesta del cliente ⇒ Abierto; respuesta pública del staff ⇒
  Esperando; nota interna ⇒ sin cambio.
- **INV-SOP.01** Las guardas corren **en el servidor por todos los caminos** (Spec 14):
  un ticket terminal no acepta respuestas del cliente (la reapertura es una transición
  explícita del staff, registrada); cambiar estado y derivar son operaciones **solo de
  internos con permiso** (Spec 12); el cliente jamás crea notas internas (se conserva,
  como guarda).
- **INV-SOP.02** **Los adjuntos verifican pertenencia**: solo el cliente dueño del ticket
  y los internos autorizados acceden a la evidencia (Spec 19 RN-ARC.05 — los adjuntos
  viven en el repositorio de archivos con su dueño).
- **RN-SOP.04** El cierre lleva **tipificación de resolución** (nomenclador: resuelto /
  reposición generada / sin lugar / duplicado / …) — es lo que permite medir de qué se
  queja la gente. La derivación queda en el hilo como evento visible ("derivado de X a
  Y por Z"), con historial.

## 3. Áreas de atención y ruteo

- **RN-SOP.05** El ticket se dirige a un **Área de Atención**, no a una persona; la
  responsabilidad es colectiva por área (se conserva). Las áreas son **datos maestros
  administrables** (Spec 21) con doble etiqueta: el nombre que ve el cliente (en su
  idioma: "Reclamo de calidad") y el interno ("Producción y Calidad"), y la marca
  "visible al cliente" (las áreas internas — sistemas, mantenimiento — no se le
  ofrecen). Se conserva el doble propósito: atención al cliente + tickets internos.
- **RN-SOP.06** Opcionalmente, un ticket puede **tomarse** (asignarse a una persona) para
  que la bandeja distinga "de mi área, sin dueño" de "míos" — sin volverlo obligatorio:
  el modelo colectivo actual funciona.
- **RN-SOP.07** La **ventana de reclamo** sobre pedidos entregados (hoy 20 días fijos en
  la interfaz) pasa a **configuración** y se valida **en el servidor**: pasado el plazo,
  el alta de reclamo vinculado a la orden lo indica y exige que el operador lo admita
  (no un bloqueo ciego — el negocio decide caso a caso).

## 4. SLA y métricas (lo que hoy no existe)

- **RN-SOP.08** Cada Área de Atención declara su **SLA configurable**: tiempo objetivo de
  primera respuesta y de resolución (en horas hábiles del calendario, Spec 03
  RN-PRO.25). El sistema marca los tickets fuera de plazo (semáforo en la bandeja) y
  genera Alerta Operativa (Spec 15) al vencerse.
- **RN-SOP.09** La **prioridad se usa o se elimina**: si se usa, la fija el interno (no
  el cliente), afecta el orden de la bandeja y ajusta el SLA. DECISIÓN PENDIENTE
  (negocio): confirmar si se necesita más de un nivel.
- **RN-SOP.10** Métricas mínimas del módulo (sobre el libro, Spec 13): tickets por área y
  período, tiempo de primera respuesta y de resolución (p50/p95), tipificación de
  cierres, reaperturas. Es el tablero que responde "¿de qué se queja la gente y qué tan
  rápido respondemos?".

## 5. Experiencia

- **RN-SOP.11** Se conservan: bandeja ordenada por última actualización que **esconde los
  terminales por defecto** (bandeja de trabajo, no archivo), punto rojo pulsante en
  abiertos, avisos emergentes clicables, sincronización en vivo del hilo, enlace directo
  al ticket, "iniciar reclamo" con la orden precargada, visor de imágenes con zoom.
- **RN-SOP.12** Se agregan: **búsqueda** de texto en tickets, **plantillas de respuesta**
  administrables por área, y vista **mobile** del panel interno (el TODO pendiente).
- **RN-SOP.13** Canales de aviso al cliente: push (se conserva) **y correo opcional**
  para clientes sin la app instalada (hoy no hay email en todo el flujo) — vía el
  historial único de envíos (Spec 10 RN-MAIL.05).
- **RN-SOP.14** DECISIÓN PENDIENTE (negocio, prioridad baja): base de conocimiento / FAQ
  en el portal (artículos administrables como piezas de contenido, Spec 30, sugeridos al
  cliente antes de abrir el ticket) — reduce tickets repetidos; se activa cuando haya
  material que publicar.

## 6. Interacciones

| Con | Relación |
|---|---|
| Spec 14 | Estados y transiciones automáticas del hilo como proceso declarado. |
| Spec 12 | Permisos por operación (cerrar/derivar solo internos); pertenencia. |
| Spec 19 | Adjuntos en el repositorio con dueño y acceso verificado. |
| Spec 13 | Historial de estados/derivaciones = eventos del libro; métricas. |
| Spec 02 | El reclamo puede derivar en una Reposición (RN-PED.24) — tipificado en el cierre. |
