# TIZADA PRO por API — puesta en marcha (prueba desde la Solicitud)

Recorrido: en la solicitud, producto del catálogo con molde de TIZADA → **Diseños** + **Lista de talles** →
"Generar tizada en TIZADA PRO" → TIZADA arma la tizada → **aviso** (o sondeo) → cada PDF (uno por tela) queda
como **diseño pronto** de la producción principal con su tela, ancho y metros; la ficha técnica como referencia;
y la producción principal pasa a **Diseñado** con la marca **"Diseño automático · TIZADA PRO"**.

## 1. Base de datos (una vez)
1. `scripts/add_tizadapro_envios.sql` — crea `TizadaProEnvios` (genérica por `Origen`: SOLICITUD hoy, PORTAL en la fase 2). No toca nada existente.
   (Antes tienen que estar los scripts de Solicitudes. Se puede correr más de una vez.)

## 2. Nuestro .env (backend/.env, bloque `TIZADAPRO_*`)
| Clave | Para qué | Valor para probar |
|---|---|---|
| `TIZADAPRO_API_ACTIVA` | Prende todo lo que sale hacia TIZADA | `1` |
| `TIZADAPRO_API_URL` | API de TIZADA, termina en `/api/externo/v1` | `http://192.168.0.101:8050/api/externo/v1` |
| `TIZADAPRO_AVISO_URL` | Nuestra dirección del aviso (viaja en cada pedido) | `http://192.168.0.193:5000/api/integracion/tizadapro/aviso` |
| `TIZADAPRO_API_LLAVE` | La llave `tzp_…` que crea TIZADA | (la que pasen) |
| `TIZADAPRO_ENVIO_MODO` | `MANUAL` (botón) o `AL_ENVIAR_A_DISENO` (sale sola al mandar a Diseño) | `MANUAL` |
| `TIZADAPRO_VALIDAR_ANTES` | Revisar en TIZADA antes de mandar | `1` |
| `TIZADAPRO_AVISO_ACTIVO` | Aceptar el aviso firmado de TIZADA | `1` |
| `TIZADAPRO_SONDEO_SEGUNDOS` | Preguntar nosotros si el aviso no llega (0 = no) | `60` |
| `TIZADAPRO_PDF_MODO` | `copiar` (Drive→Drive) · `enlace` · `bajar` | `copiar` |
| `TIZADAPRO_MESAS_MODO`, `TIZADAPRO_SI_PIEZAS_EN_BLANCO`, `TIZADAPRO_REFERENCIA_PREFIJO`, `TIZADAPRO_API_TIMEOUT_MS` | Opciones del pedido | ver comentarios del .env |

Reiniciar el backend después de cambiar el .env (el log dice `[TIZADAPRO-API] Integración prendida → …`).

## 3. Del lado de TIZADA (lo hace quien administra TIZADA — guía de TIZADA, sección 1)
1. TIZADA 1.0.48 o posterior, Node 20+, "El robot: Prendido".
2. Crear la llave para nosotros (Integraciones › Llaves del otro sistema) y pasárnosla.
3. **Aviso**: HAY que cargarlo en TIZADA (Integraciones › Aviso al otro sistema › Guardar) con
   `http://192.168.0.193:5000/api/integracion/tizadapro/aviso`. TIZADA usa la dirección que tiene configurada e ignora
   la `aviso_url` del pedido (alarma real «aviso-url-no-permitida», 05-oct). Llega firmado con la llave; un GET a esa
   dirección contesta `{ ok: true }` para probar que llega. El firewall de esta PC tiene que dejar entrar el puerto 5000.
   Sin aviso igual funciona: el sondeo pregunta cada `TIZADAPRO_SONDEO_SEGUNDOS`.
   **Plantilla base**: cada molde tiene que tener en TIZADA su plantilla base cargada; si no, el arte se frena con
   «primero subí la plantilla base» (pasó con Camiseta Goes 2026 en el primer envío real).
4. Drive (para `TIZADAPRO_PDF_MODO=copiar`): que TIZADA deje los PDF en una carpeta que nuestra cuenta de
   Google pueda leer (la misma cuenta, o la carpeta compartida con la nuestra). Si no se puede copiar,
   se bajan de la API de TIZADA (comprobando sha256) y se suben a nuestro Drive.
5. Red: nuestro servidor llega a la API de TIZADA, y TIZADA llega a nuestra dirección del aviso (HTTPS).

## 4. Qué viaja
- **Referencia**: `SOL-<solicitud>-P<producto>-<intento>` (única; un reintento usa el intento siguiente).
- **Diseños**: nombre (JUGADOR, GOLERO…), modelo (`variable` = la clave `v_…` de `ProductoModelos`),
  tela (id = nuestro `ProIdProducto`), telas por pieza (de "Piezas y telas"), arte `.ai`/`.pdf` en `artes/`.
- **Planilla**: una fila por prenda con las columnas de la planilla del molde + `diseno`.
- **Vuelve**: por cada tela un PDF → diseño pronto `SOL-12-P34-1_Dry_Fit_3.21m.pdf`
  (alto = `consumo_cm`/100, ancho = ancho de la tela, tela = nuestro artículo, 1 copia).

## 5. Probar
`backend` → smoke con TIZADA simulado: 29/29 (solicitud temporal, se borra sola).
Con TIZADA real: solicitud → producto del catálogo con molde → Diseños + Lista de talles → Guardar →
"Revisar en TIZADA" → "Generar tizada en TIZADA PRO" → esperar (la pantalla pregunta cada 15 s).
