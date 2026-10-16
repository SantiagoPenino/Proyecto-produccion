# Solicitudes de vendedores — plan técnico

**Spec:** [specs/41-captacion-de-solicitudes-vendedores.md](../specs/41-captacion-de-solicitudes-vendedores.md)
**Fecha:** 18/09/2026 · **Estado:** F1 y F2 escritas en LOCAL (sin probar contra la base: falta correr el SQL). F3 sin construir.

Todo es **aditivo**: tablas nuevas, archivos nuevos, 1 bloque en `backend/server.js` y 3 ediciones en
`src/components/layout/MainAppContent.jsx`. No toca pedidos, órdenes, caja ni saldos (INV-SOL.04).

## Qué hay

| Capa | Archivo |
|---|---|
| SQL (tablas + menú) | `scripts/add_solicitudes_vendedor.sql` — idempotente, sintaxis validada con `PARSEONLY` |
| Rutas | `backend/routes/solicitudesVendedorRoutes.js` → `/api/solicitudes-vendedor` (solo internos) |
| Controller | `backend/controllers/solicitudesVendedorController.js` (fino) |
| Reglas | `backend/services/solicitudesVendedorService.js` |
| Subida | `backend/middleware/multerSolicitudesConfig.js` → `uploads/tmp` → Drive (`PEDIDOS WEB/SOLICITUDES`) |
| Front | `src/services/modules/solicitudesVendedorService.js` · `src/components/pages/ventas/{SolicitudesVendedorPage,SolicitudVendedorForm,SolicitudVendedorDetalle,BandejaDisenoPage,solicitudesComunes}.jsx` |
| Pantallas | `/ventas/solicitudes` · `/ventas/solicitudes/nueva` · `/ventas/solicitudes/:id` · `/ventas/solicitudes/:id/editar` · `/ventas/bandeja-diseno` |

Tablas: `SolicitudesVendedor` (cabecera, precio, seña, cancelación) · `SolicitudesVendedorProductos` ·
`SolicitudesVendedorPartes` (producción principal + Bordado/DTF/TPU, con sus estados y la señal "Modificada") ·
`SolicitudesVendedorArchivos` · `SolicitudesVendedorEventos` (historial; las interacciones son eventos `INTERACCION`) ·
`SolicitudesVendedorDisenadores`.

## Decisiones técnicas

- **Cliente = `Clientes.CodCliente`**, el mismo identificador que usa `/ventas/pedido-prenda`.
- **Quién es diseñador:** el script crea el **rol "Diseñador"** en `Roles` (se resuelve por nombre: el `IdRol` es IDENTITY
  y no coincide entre local y prod) y le da en el menú el grupo "Ventas" + la Bandeja de Diseño. Es diseñador quien tiene
  ese rol, o Admin, o —por excepción— alguien con otro rol habilitado en `SolicitudesVendedorDisenadores` desde la
  Bandeja de Diseño (solo Admin).
- **Quién es vendedor:** roles Admin, Administracion, Coordinador, Atención al Cliente, VENTAS.
- **El estado de la Solicitud se deriva** (`recalcularEstado`) después de cada cambio de una parte; solo `CANCELADA` se pone a mano.
- **Tomar un trabajo** es un `UPDATE … WHERE Estado='ENVIADO_DISENO' AND DisenadorID IS NULL`: si dos diseñadores hacen clic a la vez, gana uno y el otro recibe 409.
- **Archivos:** fila `Pendiente` → Drive (fuera de transacción) → cierre en transacción (vigente + evento + estado). Si Drive falla, la fila pendiente se borra.
- **Medida del diseño pronto:** la hace el navegador con `fileService.uploadFile` (la misma función del ingreso de prenda): sin DPI se rechaza, más de 1 página se rechaza, DTF 0,10–2,50 m de alto. Formatos: sublimación PNG/JPEG/PDF, DTF y TPU PNG/PDF, bordado libre.
- **Edición:** el form manda la solicitud entera; el service compara contra la base, arma el texto de qué cambió y, si la parte ya no está `INGRESADO`, la marca `Modificada`. Quitar un servicio o producto es baja lógica (`Activo = 0`).

## F3 — Conversión a pedido (SIN CONSTRUIR)

Hoy existe solo `faltantesConversion()` (RN-SOL.27): la pantalla muestra por producto qué falta, y el botón
"Convertir en pedido de producción" está deshabilitado. Para construirla hace falta:

1. La interfaz de ingreso de pedidos por sistema ([api-externa-pedidos-prenda-plan.md](api-externa-pedidos-prenda-plan.md)), con archivos **por enlace** (su decisión D2).
2. **P-14** de la spec: precio único por Solicitud + un pedido por producto → cuánto lleva cada pedido.
3. Material por archivo de la producción principal (el ingreso de prenda lo exige por archivo) y validar el ancho contra el material.
4. Bobina de tela del cliente: se elige al convertir (depende del stock de ese momento).
5. Al convertir: grabar `PedidoNoDocERP`, `FechaConversion`, `UsuarioConversion` en el producto y llamar `recalcularEstado` (ya contempla `PEDIDO_SOLICITADO`).

## Deploy

1. Correr `scripts/add_solicitudes_vendedor.sql` (local primero, después prod).
2. Deploy de backend + front.
3. En la pantalla de Usuarios, asignarle el rol **"Diseñador"** a cada diseñador (tienen que volver a iniciar sesión: el rol viaja en el token).
4. Solo si alguien con otro rol también diseña: un Admin lo habilita en **Ventas → Bandeja de Diseño → "Ver quiénes son diseñadores"**.

## Pruebas pendientes (los 8 escenarios del §12 de la spec)

Sin correr: requieren las tablas en la base local.
