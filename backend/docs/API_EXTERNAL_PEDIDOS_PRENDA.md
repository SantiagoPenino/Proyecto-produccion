# API Externa — Ingreso de pedidos de prenda

Documentación de integración para que un sistema externo ingrese un **pedido de prenda** y que entre a
producción igual que si se cargara a mano en *Ventas → Pedido de prenda*.

Alcance actual: **"Fabricar prendas a la medida"** con producción principal **Sublimación** —
producto terminado o personalizado, cobro por área o precio establecido, corte, costura, bordado,
DTF, TPU (con su estampado) y tela del cliente. Otros modos responden `MODO_NO_HABILITADO`.

---

## 1. Resumen

| | |
|---|---|
| **Base** | `http://<host>:5000/api/external/pedidos-prenda` |
| **Autenticación** | Header `x-api-key` |
| **Formato** | JSON |
| **Archivos** | Se mandan **por enlace** (https o Google Drive). No se suben por esta API. |
| **Modelo** | Asíncrono: el `POST` contesta enseguida; el resultado se consulta con `GET /:idExterno` |
| **Límite** | 60 pedidos por minuto |

| Método | Ruta | Para qué |
|---|---|---|
| `POST` | `/` | Ingresar un pedido |
| `GET` | `/:idExterno` | Estado y resultado de un pedido |
| `POST` | `/:idExterno/reintentar-archivos` | Volver a pasar a producción los archivos que fallaron |
| `GET` | `/catalogo/telas` | Telas de sublimación válidas |
| `GET` | `/catalogo/servicios` | Variantes y materiales válidos de Bordado, DTF y TPU |
| `GET` | `/catalogo/productos-terminados` | Productos terminados que se pueden fabricar |
| `GET` | `/catalogo/clientes/:codCliente/bobinas` | Bobinas de tela que ese cliente tiene disponibles |

Clientes: `GET /api/external/clientes` (ya existente, misma lógica de key propia de esa API).

---

## 2. Autenticación

```
x-api-key: <CLAVE_ACORDADA>
```

- Variable del servidor: `PEDIDOS_EXTERNOS_API_KEY` (mínimo 24 caracteres). **Sin valor por defecto.**
- Sin key configurada, o con `PEDIDOS_EXTERNOS_ENABLED=0`, toda la API responde **503** (apagada).
- Key incorrecta → **401**.
- Los pedidos entran a nombre del usuario interno `PEDIDOS_EXTERNOS_USUARIO_ID`.
- La clave no debe exponerse en frontends ni repos públicos.

---

## 3. Ingresar un pedido — `POST /`

### 3.1 No se duplica: `idExterno`

`idExterno` es el identificador del pedido **en tu sistema** (hasta 100 caracteres) y es obligatorio.
Mandar dos veces el mismo `idExterno` **no crea dos pedidos**: devuelve el que ya existe. Si la
llamada se corta por la red, **reintentá con el mismo `idExterno`**. Un pedido `RECHAZADO` o en
`ERROR` (nunca llegó a crearse) se puede reenviar corregido con el mismo `idExterno`.

### 3.2 Body

```jsonc
{
  "idExterno": "DISENO-2026-000123",
  "cliente": { "codCliente": 1234 },          // o { "idReact": 55 } o { "idCliente": "ACME" }
  "nombreTrabajo": "Camisetas Verano 2026",
  "notas": "Entregar antes del 15",
  "modo": "FABRICAR",
  "servicioPrincipal": "sublimacion",

  "producto": {
    "tipoFabricacion": "PERSONALIZADO",       // "TERMINADO" | "PERSONALIZADO"
    "proIdProducto": null,                    // solo TERMINADO (de /catalogo/productos-terminados)
    "cantidad": 50,                           // prendas
    "precio": { "modo": "POR_AREA" }          // solo PERSONALIZADO. O: { "modo": "ESTABLECIDO", "monto": 5000, "moneda": "UYU" }
  },

  // Producción principal: UN ítem por archivo. El archivo es siempre normal (sin escala ni raport).
  "impresion": {
    "items": [
      { "archivo":  { "url": "https://…/frente.pdf", "nombre": "frente.pdf", "anchoM": 1.50, "altoM": 2.00 },
        "material": { "codArticulo": "1558" },   // tela, de /catalogo/telas
        "copias": 1 }
    ]
  },

  // Opcionales
  "corte":   { "tipoMolde": "MOLDES CLIENTES", "origenTela": "TELA CLIENTE", "bobinaId": 143,
               "tizadas": [ { "url": "https://…", "nombre": "tizada.pdf" } ] },
  "costura": { "instrucciones": "doble costura" },

  "servicios": [
    { "tipo": "BORDADO", "variante": "Bordado sobre la prenda", "material": { "codArticulo": "…" },
      "prendas": 50, "ubicacion": "pecho izquierdo", "nota": "",
      "archivos": [ { "url": "…", "nombre": "logo.dst" } ],        // logos / ponchados
      "bocetos":  [ { "url": "…", "nombre": "ubicacion.png" } ] },

    { "tipo": "DTF", "material": { "codArticulo": "…" }, "ubicacion": "espalda",
      "archivos": [ { "url": "…", "nombre": "dtf.png", "anchoM": 0.55, "altoM": 1.20, "copias": 1 } ],   // cada archivo es un ítem; metros = alto × copias
      "bocetos":  [ { "url": "…", "nombre": "ubicacion.png" } ],
      "estampado": { "prendas": 50, "estampadosPorPrenda": 3, "origen": "Stock User" } },

    { "tipo": "TPU", "variante": "…", "material": { "codArticulo": "…" },
      "archivos": [ { "url": "…", "nombre": "tpu.png" } ],
      "estampado": { "prendas": 50, "estampadosPorPrenda": 1, "origen": "Stock User" } }
  ],

  "bocetos":            [ { "url": "…", "nombre": "boceto.png" } ],
  "planillas":          [ { "url": "…", "nombre": "talles.xlsx" } ],
  "archivosReferencia": [ { "url": "…", "nombre": "referencia.jpg" } ]
}
```

Reglas:

- **Precio:** el bloque `precio` solo aplica a `PERSONALIZADO`. `ESTABLECIDO` es el precio FINAL del
  pedido en esa moneda (`UYU` | `USD`): no se convierte ni se le suma nada. Un producto `TERMINADO`
  usa el precio del catálogo.
- **Medida de los archivos de la producción principal (y de DTF):** `anchoM` / `altoM` en metros. Si no se mandan, el servidor baja el
  archivo y lo mide. Se rechaza: imagen **sin DPI**, PDF de **más de 1 página**, archivo que no se
  puede leer. Formatos del arte: PNG, JPEG (solo sublimación) o PDF.
- **Ancho:** el archivo no puede exceder el ancho imprimible de la tela (ancho − 3 cm). Las telas de
  **medida fija** (`largoFijoM` > 0 en el catálogo) exigen ancho y alto exactos.
- **DTF:** el archivo se mide contra su material (el film): ancho ≤ ancho imprimible − 3 cm, y alto entre 0,10 m y 2,50 m. Si no mandás `anchoM`/`altoM`, el servidor lo mide.
- **Bordado y TPU no llevan medida y sus archivos son OPCIONALES:** lo que se mande viaja como logo / boceto de
  referencia. El ponchado de bordado y el arte de TPU se suben después desde la ficha de la orden en el área
  (Bordado queda en "Esperando requisitos: Matriz"; TPU sigue boceto → aprobación del cliente → arte).
- **Tela del cliente:** `corte.origenTela = "TELA CLIENTE"` exige `bobinaId` (de
  `/catalogo/clientes/:cod/bobinas`), el molde no puede ser `SUBLIMACION`, el ancho lo define la
  bobina y el largo total (Σ alto × copias) no puede superar sus metros. Los metros se descuentan
  de la bobina al crear el pedido.
- **Costura** requiere **Corte**. La **tizada** es el archivo de impresión de la sublimación: va en `impresion.items`,
  no en Corte (Corte trabaja por contraste sobre la tela ya sublimada). `corte.tizadas` es opcional y, si se manda,
  viaja a Corte solo como referencia.
- **Enlaces:** `https` públicos o de Google Drive (el archivo debe ser accesible para la cuenta de
  Drive del sistema). Tope por archivo: 500 MB.

### 3.3 Respuesta

```jsonc
// 202 — recibido, se está procesando
{ "success": true, "data": { "idExterno": "DISENO-2026-000123", "integracionId": 501, "estado": "PROCESANDO", … } }
```

---

## 4. Consultar el resultado — `GET /:idExterno`

```jsonc
{ "success": true, "data": {
    "idExterno": "DISENO-2026-000123",
    "estado": "CREADO",
    "noDocERP": 10994,
    "codigosOrden": ["SB-10994", "PRO-10994", "EMB-10994", "DF-10994", "EST-10994", "TWC-10994", "TWT-10994"],
    "archivos": [ { "nombre": "frente.pdf", "destino": "SB-10994_…_Archivo 1 de 1 (x1).pdf", "subido": true, "error": null } ],
    "errores": [],
    "archivosColgados": false
} }
```

| `estado` | Significado | Qué hacer |
|---|---|---|
| `PROCESANDO` | Se está validando / midiendo / creando | Volver a consultar en unos segundos |
| `RECHAZADO` | La validación encontró problemas. **No se creó nada** | Leer `errores`, corregir y reenviar con el mismo `idExterno` |
| `ERROR` | Falló la creación. **No se creó nada** | Reenviar con el mismo `idExterno`; si persiste, avisar |
| `PASANDO_ARCHIVOS` | **Pedido creado.** Se están pasando los archivos a producción | Volver a consultar. Las órdenes están en "Cargando…" hasta que lleguen sus archivos |
| `CREADO` | Pedido creado y todos los archivos en producción | Fin |
| `ERROR_ARCHIVOS` | Pedido creado, pero algún archivo no pasó | `POST /:idExterno/reintentar-archivos` |

`archivosColgados: true` = quedó en `PASANDO_ARCHIVOS` más de 15 minutos (el servidor se reinició a
mitad de camino): también se resuelve con `reintentar-archivos`.

Cada error trae un **código estable** (para decidir por programa) y un mensaje para leer:

```jsonc
{ "codigo": "ANCHO_EXCEDE_MATERIAL", "campo": "impresion.items[0].archivo",
  "mensaje": "\"frente.pdf\" mide 1.85m de ancho y excede el ancho imprimible de \"Dry Fit (1,83)\" (1.80m). Ajustá el archivo o elegí otra tela." }
```

Códigos: `MODO_NO_HABILITADO` · `SERVICIO_NO_HABILITADO` · `FALTA_NOMBRE_TRABAJO` · `FALTA_CLIENTE` ·
`CLIENTE_INEXISTENTE` · `CLIENTE_BLOQUEADO` · `FALTA_CANTIDAD` · `FALTA_PRODUCTO` ·
`PRODUCTO_INEXISTENTE` · `TIPO_FABRICACION_INVALIDO` · `FALTA_MODO_COBRO` · `FALTA_PRECIO` ·
`MONEDA_INVALIDA` · `FALTA_ARTE` · `ARCHIVO_SIN_ENLACE` · `ARCHIVO_SIN_NOMBRE` · `ARCHIVO_SIN_MEDIDA` ·
`ARCHIVO_NO_SE_PUDO_MEDIR` · `COPIAS_INVALIDAS` · `MATERIAL_INVALIDO` · `ANCHO_EXCEDE_MATERIAL` ·
`MEDIDA_FIJA` · `DTF_ALTO_MAXIMO` · `DTF_ALTO_MINIMO` · `FALTA_VARIANTE` · `SERVICIO_DESCONOCIDO` ·
`SERVICIO_REPETIDO` · `CORTE_SIN_MOLDE` · `CORTE_SIN_TELA` · `COSTURA_SIN_CORTE` ·
`TELA_CLIENTE_MOLDE` · `FALTA_BOBINA` · `BOBINA_NO_DISPONIBLE` · `BOBINA_SIN_METROS` ·
`CREADOR_DE_PEDIDOS` · `ARCHIVO_NO_PASO` · `ERROR_INTERNO`.

---

## 5. Ejemplo (cURL)

```bash
curl -X POST "http://<host>:5000/api/external/pedidos-prenda" \
  -H "x-api-key: $PEDIDOS_KEY" -H "Content-Type: application/json" \
  -d '{
    "idExterno": "DISENO-2026-000123",
    "cliente": { "codCliente": 1234 },
    "nombreTrabajo": "Camisetas Verano 2026",
    "modo": "FABRICAR", "servicioPrincipal": "sublimacion",
    "producto": { "tipoFabricacion": "PERSONALIZADO", "cantidad": 50, "precio": { "modo": "POR_AREA" } },
    "impresion": { "items": [ { "archivo": { "url": "https://drive.google.com/file/d/XXXX/view", "nombre": "frente.pdf" }, "material": { "codArticulo": "1558" }, "copias": 1 } ] }
  }'
```

```bash
curl "http://<host>:5000/api/external/pedidos-prenda/DISENO-2026-000123" -H "x-api-key: $PEDIDOS_KEY"
```

---

## 6. Para quien opera el servidor

| Variable `.env` | Para qué |
|---|---|
| `PEDIDOS_EXTERNOS_API_KEY` | La clave (≥ 24 caracteres). Sin ella la API queda apagada (503) |
| `PEDIDOS_EXTERNOS_USUARIO_ID` | `Usuarios.UserID` a nombre del cual entran los pedidos |
| `PEDIDOS_EXTERNOS_ENABLED` | `0` = apagado de emergencia, sin desplegar (reiniciar el backend) |
| `PEDIDOS_EXTERNOS_ORIGEN` | Nombre del sistema externo en `IntegracionPedidos.Origen` (por defecto `SISTEMA_EXTERNO`) |
| `PEDIDOS_EXTERNOS_MAX_MB` | Tope por archivo bajado de un enlace (por defecto 500) |

- SQL previo: `scripts/add_conversion_solicitud_pedido.sql` (tabla `IntegracionPedidos`).
- Auditoría: `SELECT * FROM dbo.IntegracionPedidos ORDER BY IntegracionID DESC` — guarda el pedido
  tal como llegó (`PedidoJson`), lo que se le entregó al creador de pedidos (`PayloadJson`), los
  archivos y los errores.
- Log: líneas `[PEDIDOS-SISTEMA]`.
- Esta API **no crea órdenes por su cuenta**: valida, traduce y llama al mismo creador de pedidos y a
  la misma subida de archivos que usa *Ventas → Pedido de prenda*.
