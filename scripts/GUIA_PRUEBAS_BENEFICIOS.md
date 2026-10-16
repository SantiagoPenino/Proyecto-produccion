# Guía de pruebas — Beneficios pactados sobre la billetera

Las reglas de negocio (motor de precios, cascada, agotado, pausa, cierre) ya se probaron
**en automático contra la base local**, de punta a punta, en `beneficiosService` /
`pricingService` / `contabilidadService` reales (no mocks): 25 verificaciones, todas OK,
sin dejar datos de prueba. Esta guía es para el recorrido **manual por pantalla**, para
confirmar que la UI llama bien a ese motor ya probado. No hace falta repetir la aritmética,
solo que cada pantalla muestre y dispare lo que dice.

Requisito: `ConfiguracionGlobal.BENEFICIOS_ACTIVOS = '1'` (ver `DEPLOY_BENEFICIOS.md` §3).

## 1. Beneficios predefinidos (`/beneficios/predefinidos`)

1. Crear uno nuevo: nombre, moneda, carga (fija o mínima), vigencia (días o hasta fecha, o
   dejar ambas vacías = "hasta agotar"), una regla (artículo / grupo / servicio, tipo
   fijo / % / monto). Si tu usuario aprueba (Admin/Administración) queda **PUBLICADA** de
   una; si no, queda **PENDIENTE** para que Administración la publique.
2. El switch de arriba de la página (solo visible si aprobás) prende/apaga
   `BENEFICIOS_ACTIVOS` para toda la empresa — confirmá que el mensaje de confirmación dice
   exactamente qué va a pasar antes de tocarlo en producción con clientes reales activos.
3. Ir a la página "Perfiles de Precios": el perfil `BENEFICIO · <nombre>` que se acaba de
   crear **no** debe aparecer en esa lista ni ser elegible para asignar a mano.

## 2. Pactar con un cliente (Vista 360 de vendedores → pestaña "Beneficios")

1. Abrir un cliente en `/vendedores/cliente-360`, pestaña **Beneficios**. Debe verse: los
   beneficios ya activos del cliente (si tiene), los predefinidos disponibles, y el botón
   para pactar uno a medida.
2. Pactar uno nuevo: elegir alcance (artículo / grupo / servicio), tipo de regla, carga.
   Antes de guardar, la tabla de comparación debe mostrar **las cuatro columnas**: precio de
   lista, precio especial del cliente (si tiene), beneficios activos que ya alcanzan (si
   tiene otro), y el precio pactado — con alerta si el pactado sale peor que lo que el
   cliente paga hoy.
3. Guardar: el pacto queda **PENDIENTE**. Repetir con un segundo vendedor o con vos mismo
   para confirmar que un vendedor no ve la opción de aprobar su propio pacto.

## 3. Aprobación (`/beneficios/pactos`)

1. Como Administración: ver el pacto recién creado en la lista, con los KPI por estado
   arriba y los filtros funcionando (cliente, vendedor, estado, fechas).
2. Si tenía alertas de precio peor, intentar aprobar **sin** nota → debe rechazar el aprobar
   pidiendo la nota. Con nota, aprobar → pasa a **APROBADO**.
3. Probar "Rechazar" en otro pacto de prueba sin motivo → debe pedirlo. Probar "Cancelar" un
   PENDIENTE o un APROBADO sin activar.

## 4. Activar desde caja (Venta de saldo)

1. Desde el 360 de Administración (o donde esté el botón "Cargar en caja" de la lista de
   pactos), abrir **Venta de saldo** para el cliente del pacto aprobado.
2. Elegir "¿Qué cargás?" → **Un beneficio aprobado o predefinido**. Debe listar el pacto
   recién aprobado (con su badge "Aprobado · sin activar") y cualquier plantilla publicada
   pública. El importe se completa solo con la carga pactada (editable si es "mínima").
3. Armar la factura, cobrarla. Al confirmar el pago: mensaje de éxito, y en el bloque
   "Beneficios" del gestor de Cuentas del cliente debe aparecer la cuenta nueva
   `Beneficio: <nombre>` con el saldo cargado, estado **habilitado**.
4. Cotizar un pedido de ese cliente en el alcance pactado: el precio debe salir el pactado
   (revisar el desglose/traza del motor si tu pantalla de cotización lo muestra: debe decir
   "BENEFICIO PACTADO").

## 5. Activar desde el portal

1. Como ese cliente en el portal, entrar a "Mis recursos" → sección **Mis beneficios**.
   Debe verse en "Para activar" (si el pacto no se activó por caja) o en "Habilitados".
2. Activar uno: elegir comprobante (e-Ticket con cédula si el importe supera el umbral, o
   e-Factura con RUT), pagar con Handy o MercadoPago (sandbox).
3. Cuando el webhook confirme el pago: el beneficio debe pasar a "Habilitados" con su saldo,
   y debe existir la factura correspondiente (mismo comportamiento que una recarga de saldo
   común, pero con la línea "Beneficio: «nombre»").
4. Confirmar que la cuenta del beneficio **no** aparece mezclada en "Mi billetera" con el
   saldo común: debe tener su propio bloque/chip.

## 6. Dos beneficios sobre el mismo cliente (especificidad)

1. Con el pacto anterior (artículo específico) y una plantilla publicada que cubra el mismo
   grupo/servicio más ancho, ambos activos: cotizar el artículo específico → debe ganar el
   pactado a medida. Cotizar otro artículo del mismo grupo, sin regla propia → debe aplicar
   el de la plantilla.
2. Agotar el pacto específico (pedidos hasta $0) y volver a cotizar el artículo específico:
   debe caer al beneficio más ancho (la plantilla), no al precio de lista.

## 7. Cascada de la última orden

1. Con un beneficio casi agotado (dejalo en un saldo chico, por ejemplo $10) y algo de saldo
   en la billetera común del mismo cliente y moneda: cotizar un pedido cuyo total pactado
   supere esos $10. El pedido debe salir **entero al precio pactado**, descontando primero
   la bolsa hasta $0 y el resto de la billetera común (revisar el libro de ambas cuentas:
   dos líneas de `CONSUMO_CUENTA` con la leyenda "(parte 1 de 2)" / "(parte 2 de 2)").
2. Si ni la bolsa ni la común alcanzan: el pedido también sale entero al precio pactado, pero
   el resto queda como pendiente de facturar en la cuenta principal (no se pierde ni se
   inventa saldo) — revisar que la orden no quedó marcada como "Abonada" de más.

## 8. Pausa, reanudación y cierre (360 de Administración)

1. En el bloque "Beneficios" del gestor de Cuentas: pausar un beneficio activo → cotizar el
   cliente: debe volver a su tarifa normal (o al siguiente beneficio activo, si tiene otro).
   El saldo de la bolsa no debe cambiar.
2. Reanudar → el precio pactado vuelve a aplicar.
3. Cerrar un beneficio con saldo: debe pedir confirmación mostrando el importe exacto que se
   transfiere a la billetera común. Confirmar que después de cerrar, ese saldo aparece en la
   billetera común del cliente (y que la cuenta del beneficio queda inactiva, no la vuelve a
   ofrecer para activar).
4. Confirmar el candado: intentar cargar saldo común usando la cuenta de un beneficio como
   destino (si tu UI lo permitiera) o transferir hacia una bolsa desde el gestor de cuentas
   → debe rechazarlo con un mensaje claro.

## 9. Vencimiento

1. Si armaste un beneficio con vigencia por días o fecha, adelantar la fecha del servidor de
   prueba (o esperar) hasta pasar el vencimiento y refrescar la bolsa (`POST
   /api/beneficios/bolsas/:bclId/refrescar`, o simplemente cotizar/consultar el cliente, que
   dispara el refresco). Debe pasar a **VENCIDO** con su saldo intacto, dejar de aplicar
   precio, y ofrecer "Cerrar" para pasar el remanente a la billetera común.

## 10. Qué NO debería pasar (candados)

- Una recarga de saldo común (sin elegir beneficio) nunca debe activar ni tocar una bolsa.
- Una transferencia entre cuentas nunca debe permitir una bolsa de beneficio como destino
  (ni como origen, salvo el cierre).
- El medio de pago "Saldo de cuenta" nunca debe poder pagarse con el saldo de una bolsa.
- Un consumo manual de cuenta nunca debe poder cargarse a una bolsa de un pedido que no es
  el suyo.
- Con `BENEFICIOS_ACTIVOS = '0'`, ningún precio cambia y ningún beneficio se puede activar
  (ni desde caja ni desde el portal), aunque haya pactos aprobados esperando.
