# Deploy — Solicitudes de vendedores + conversión a pedido + ingreso de pedidos por sistema

Actualizado: 21/09/2026. Base de producción: **SecureAppDB**.

## 1. SQL a correr en producción, EN ESTE ORDEN

| # | Script | Qué hace | Toca algo que ya existe |
|---|---|---|---|
| 1 | `backend/scripts/create_articulo_prenda_personalizada.sql` | Crea el artículo genérico **PPERS** ("Prenda Personalizada", oculto, precio base $0). Sin él, convertir un producto **personalizado** responde "Falta el artículo PPERS". | INSERT de 1 fila en `Articulos` y 1 en `PreciosBase`. No modifica ninguna fila existente. **Si ya lo corriste (estaba pendiente desde el 17/09), no hace nada.** |
| 2 | `scripts/add_solicitudes_vendedor.sql` | Tablas `SolicitudesVendedor`, `…Productos`, `…Partes`, `…Eventos`, `…Archivos`, `…Disenadores` + rol **"Diseñador"** + 2 ítems de menú en "Ventas" con sus permisos. | INSERT en `Roles` (1 rol nuevo), `Modulos` (2 ítems) y `PermisosRoles`. No modifica filas existentes. **Ver §2: es lo único que se nota antes de desplegar.** |
| 3 | `scripts/add_conversion_solicitud_pedido.sql` | 4 columnas nuevas en `SolicitudesVendedorArchivos` (Material, CodArticulo, CodStock, Copias) + tabla `IntegracionPedidos` + ficha de ingreso (`FichaJson`, `FechaEntrega`, `FechaEntregaHasta`) + tipo de archivo nuevo `COMPROBANTE` (comprobante de pago de la seña: solo amplía la lista de tipos permitidos). | Nada: solo toca tablas del punto 2 y crea una tabla nueva. Si el punto 2 no corrió, **se frena solo con un mensaje** y no cambia nada. |

Los tres se pueden correr más de una vez (no duplican nada).

**No hay ningún ALTER sobre tablas de producción** (`Ordenes`, `ArchivosOrden`, `Clientes`, etc.), ningún cambio de procedimiento almacenado, ningún UPDATE ni DELETE de datos existentes.

Verificación después de correrlos:

```sql
SELECT 'PPERS' AS Que, COUNT(*) AS OK FROM dbo.Articulos WHERE LTRIM(RTRIM(CodArticulo)) = 'PPERS' AND ISNULL(borrar,0) = 0
UNION ALL SELECT 'Tablas de solicitudes', COUNT(*) FROM sys.tables WHERE name LIKE 'SolicitudesVendedor%'          -- 6
UNION ALL SELECT 'Columnas tela/copias', COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('dbo.SolicitudesVendedorArchivos') AND name IN ('Material','CodArticulo','CodStock','Copias')   -- 4
UNION ALL SELECT 'IntegracionPedidos', COUNT(*) FROM sys.tables WHERE name = 'IntegracionPedidos'                  -- 1
UNION ALL SELECT 'Rol Diseñador', COUNT(*) FROM dbo.Roles WHERE NombreRol = N'Diseñador'                           -- 1
UNION ALL SELECT 'Menú', COUNT(*) FROM dbo.Modulos WHERE Ruta IN ('/ventas/solicitudes','/ventas/bandeja-diseno'); -- 2
```

## 2. ¿Rompe algo si actualizo PRIMERO la base y DESPUÉS el sistema?

**No rompe nada de lo que funciona hoy.** El sistema actual no conoce esas tablas ni esas columnas: no las lee ni las escribe, así que para él es como si no existieran. El artículo PPERS nace oculto (`Mostrar = 0`) y no aparece en ningún selector.

**Lo único que se va a notar** entre que corrés el script 2 y desplegás el sistema nuevo:

- En el menú **Ventas** aparecen dos ítems nuevos — **"Solicitudes"** y **"Bandeja de Diseño"** — para los roles Admin, Ventas, Administración y Atención al Cliente (el menú se arma desde la base). Como el sistema viejo todavía no tiene esas pantallas, al entrar **abre una pantalla de área vacía**. No da error, no guarda nada, no afecta a ninguna otra pantalla. Hay que cerrar sesión y volver a entrar para verlos (el menú se carga al loguear).
- Aparece el rol "Diseñador" en la pantalla de Usuarios. Nadie lo tiene asignado: no cambia nada.

Para que ni eso se vea: correr los 3 scripts **justo antes** de desplegar, en la misma ventana de mantenimiento.

**El orden inverso (sistema primero, base después) SÍ da errores**, aunque acotados: las pantallas de Solicitudes fallarían con "Invalid object name 'SolicitudesVendedor'" hasta correr los scripts. El resto del sistema seguiría andando igual. Por eso: **base primero**.

## 3. Deploy del sistema

1. Backend. Archivos nuevos + `backend/server.js` (montaje de `/api/solicitudes-vendedor` y `/api/external/pedidos-prenda`, cada uno en su propio `try/catch`). No hay dependencias npm nuevas (`sharp`, `pdf-lib`, `axios`, `express-rate-limit` ya estaban).
2. Frontend (build). Pantallas nuevas de Ventas + 16 líneas visuales en `src/components/production/EmbBandeja.jsx` (rótulo de etapa de diseño en la bandeja de Bordado).
3. Cerrar sesión y volver a entrar (menú y, para los diseñadores, el rol viajan en el token).
4. Asignar el rol **"Diseñador"** a quien corresponda, desde la pantalla de Usuarios.

Lo que **no** se tocó: `prendasOrdersController` (creador de pedidos), `webOrdersController` (subida de archivos), `ordersController`, `embBoardController`, `OrderDetailModal` (la ficha del ojito), `PrendaOrderForm` (página de pedido de prenda).

## 4. Variables `.env` (solo cuando exista el sistema externo)

Sin estas variables la puerta externa responde **503 (apagada)**; la conversión desde la Solicitud funciona igual, no las necesita.

| Variable | Valor |
|---|---|
| `PEDIDOS_EXTERNOS_API_KEY` | clave de 24 caracteres o más |
| `PEDIDOS_EXTERNOS_USUARIO_ID` | `Usuarios.UserID` a nombre del cual entran esos pedidos |
| `PEDIDOS_EXTERNOS_ENABLED=0` | apagado de emergencia (reiniciar el backend) |

## 5. Primer uso en producción — con cuidado

1. Crear una Solicitud de prueba con un cliente interno, **un** producto personalizado, cobro "por cada área".
2. Convertirla y revisar el pedido en cada área (Sublimación, Corte, Costura, Bordado, TPU, Estampado) y su cotización.
3. Si algo no está bien, el pedido se cancela como cualquier otro. La Solicitud queda con el número de ese pedido (hoy no hay "deshacer conversión").

## 6. Pendientes conocidos (no bloquean el deploy)

- Comparar un pedido convertido contra uno igual cargado a mano en "Pedido de prenda" (en local no había ninguno personalizado con bordado/estampado para comparar).
- P-14: precio establecido con más de un producto por solicitud (hoy se bloquea con un mensaje claro).
- Confirmar la cuenta de parches de TPU (prendas × estampados por prenda).
- Corte y Costura cargados **desde la página** nacen con cantidad 0 (preexistente, no es de este deploy).

## 7. Agregado 23/09 — Ficha de ingreso a producción (checklist de la maqueta)

- **SQL:** el mismo `scripts/add_conversion_solicitud_pedido.sql` (paso 3) ahora agrega también
  `FichaJson`, `FechaEntrega` y `FechaEntregaHasta` a `SolicitudesVendedor`. Si ya lo corriste antes del
  23/09, **volvé a correrlo**: solo agrega lo que falta.
- **Si el sistema se despliega antes de correr ese SQL, no rompe:** el backend detecta si las columnas
  existen; sin ellas las pantallas funcionan igual, pero la ficha (muestra, plazo, fecha de entrega,
  indicaciones) no se guarda y queda un aviso en el log `[SOLICITUDES] Falta correr…`.
- Archivos: `backend/services/solicitudesVendedorChecklist.js` (nuevo) y `src/components/pages/ventas/checklistSolicitud.js`
  (nuevo) tienen las MISMAS reglas — si se cambia una, se cambia la otra.

## 8. Agregado 24/09 — Hojas para imprimir, calendario y "¿se llega a la fecha?"

- Sin SQL nuevo. Rutas nuevas: `GET /api/solicitudes-vendedor/calendario`, `GET /api/solicitudes-vendedor/:id/plazo`; pantalla `/ventas/solicitudes/:id/imprimir?tipo=taller|diseno`.
- El plazo usa el motor de Planificación en modo **solo lectura** (`calcularSituacion` + `calcularFechaCompromiso`); no guarda nada.
- Corte y Costura hoy **no tienen capacidad cargada** (Configuración → Equipos): la estimación no les suma días y lo avisa en pantalla. Cargarla mejora la precisión.
