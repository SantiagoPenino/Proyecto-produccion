# Fallas, faltantes y parciales — Guía de prueba manual (Spec 39)

Todo lo de abajo corre contra tu base **local** (nunca producción). El sistema ya está
implementado y con 33 pruebas automáticas en verde; esto es para que lo toques vos antes de
decidir el piloto.

## 0. Antes de arrancar

1. Corré, en este orden, contra tu base local:
   - `docs/migrations/fallas_faltantes_parciales.sql`
   - `docs/migrations/fallas_faltantes_parciales_menu.sql`
   - `docs/migrations/fallas_faltantes_parciales_piloto.sql` (editá las dos variables del
     principio con las Áreas que querés probar — por defecto Corte Láser y Taller Costura).
2. Reiniciá el backend para que tome el menú nuevo y los jobs.
3. Entrá con un usuario Admin o Administración: en el menú de Atención al Cliente vas a ver
   "Solicitudes de insumo".

## 1. Reportar una falla propia (insumo del área, sin insumo del cliente)

1. Andá a la bandeja de un área piloto (por ejemplo Corte Láser) con una orden en curso.
2. Abrí una orden y tocá **"Reportar falla / faltante"**.
3. Paso 1: elegí "Falla propia" (no faltante de otra área).
4. Paso 2: cargá tipo de falla, cantidad (si el área cuenta unidades), motivo, foto opcional.
5. Paso 3: confirmá. Se crea una orden `-F` **Pendiente**, la orden original queda
   **Retenida** (podés seguir trabajando con lo que tenés) y aparece en la bandeja de falla.
6. Terminá la orden `-F` como cualquier otra: si es la misma área y la madre no está en
   envío parcial, se incorpora sola (no viaja, no lleva bultos). Si viaja, aparece como
   complemento al armar el remito de esa área.

## 2. Reportar un faltante (la falla es de un área anterior)

1. En un área piloto, con un pedido que ya pasó por Sublimación u otra área anterior, abrí
   la orden y tocá "Reportar falla / faltante".
2. Antes de nada, el panel **"Lo que falta de este pedido"** te muestra qué llegó y qué
   sigue pendiente — mirá esto antes de reportar para no duplicar un reclamo ya abierto.
3. Elegí "Faltante" (vino mal de otra área). El sistema te propone la cadena hacia atrás
   (una orden `-F` por cada área involucrada, encadenadas). Confirmá.
4. Se crean las órdenes `-F`: la primera nace Pendiente, las siguientes Bloqueadas hasta que
   llegue la reposición de la anterior. Tu orden original queda Retenida.
5. Seguí el camino: al terminar cada `-F` y enviarla, la siguiente se desbloquea sola.

## 3. Insumo del cliente (tela o prendas)

1. Reportá una falla o faltante sobre una orden que tenga tela o prenda de cliente asociada
   (`BobinaTelaID` / `PrendaClienteID`).
2. **No se crea ninguna orden.** Se abre una Solicitud en la nueva bandeja
   "Solicitudes de insumo" (Atención al Cliente).
3. Andá a esa bandeja, abrí la solicitud: vas a ver el stock que el sistema ya buscó (misma
   tela, mismo cliente) si existe.
4. Tocá **"Avisar al cliente por el portal"** — crea un ticket visible en el portal del
   cliente (nada por WhatsApp). Confirmá con el diálogo.
5. Registrá la decisión:
   - **Usa su stock**: elegís la bobina/prendas encontradas → se crea la orden `-F` en el
     acto, con esa bobina.
   - **Trae más tela / Administración compra**: no se crea nada todavía. Anotá el número de
     solicitud.
   - **Se lleva lo producido**: cargá la cantidad real producida → la orden madre se
     redimensiona, se recotiza sola y la falla se cierra sin reponer nada.

## 4. Cerrar el círculo de "trae más tela"

1. Con la solicitud del paso 3 en "Trae más tela", andá a **Ingreso de materiales**
   (recepción de PRE) y cargá la tela nueva de ese mismo cliente.
2. Vas a ver un selector amarillo "¿Repone una solicitud de insumo abierta?" con la
   solicitud pendiente. Elegilo.
3. Al guardar la PRE, la orden `-F` nace sola con esa bobina nueva, y la solicitud pasa a
   Resuelta.

## 5. Producto del local dañado

1. Reportá una falla sobre una orden con producto de la tienda asociado (venta WMS).
2. Se abre una solicitud tipo "Producto del local". Si nadie responde a tiempo (o directo lo
   decidís vos), elegí **"Reponer del stock del local (VEN interna)"**.
3. Se genera una venta interna (`VEN-####`) a precio cero: descuenta stock, no genera deuda
   ni factura, y viaja como complemento de la orden original.

## 6. Envío parcial hacia un área (nunca hacia Depósito)

1. En la vista de despacho de un área piloto, con una orden que tiene una `-F` en curso,
   probá armar un remito **sin** esperar la reposición.
2. El sistema te deja mandar lo que tenés ("envío parcial") y te muestra si estás dejando
   la orden incompleta.
3. Intentá lo mismo pero con destino Depósito: tiene que **rechazarlo siempre** con el
   motivo exacto (qué orden, qué reposición, en qué estado). Depósito nunca recibe un
   pedido incompleto, ni forzando el ingreso.

## 7. Qué mirar si algo falla

- **Nada se manda por WhatsApp**: solo el ticket del portal y (si el cliente tiene push) una
  notificación. Si ves un mensaje de WhatsApp disparado por esto, avisá — no debería pasar.
- **Depósito nunca recibe incompleto**: si alguna vez ves un pedido con reposición abierta
  llegar a Depósito, es un bug — repórtalo con el código de pedido.
- **Los switches están apagados salvo en tu piloto**: en cualquier otra área, todo se
  comporta exactamente igual que hoy (sin botón de parcial, sin cadena de faltante).

## 8. Antes de subir a producción

1. Repetí los pasos 1 a 6 con datos reales del área piloto elegida, no sintéticos.
2. Confirmá que el job diario de solicitudes vencidas corrió (mirá el registro de jobs, o
   forzalo llamando `node -e "require('./backend/jobs/solicitudesInsumo.job.js').run()"`).
3. Recién ahí, `git commit` (lo hacés vos) y correr los tres scripts SQL en producción.
4. Activar el piloto en producción con `fallas_faltantes_parciales_piloto.sql` apuntando
   solo al área elegida; ampliar a más áreas después de una semana sin sorpresas.
