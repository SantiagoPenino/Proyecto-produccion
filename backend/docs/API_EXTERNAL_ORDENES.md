# API Externa — Órdenes de Depósito

Documentación de integración para consumir las órdenes (tabla `OrdenesDeposito`) desde un sistema externo.

---

## 1. Resumen

| | |
|---|---|
| **Método** | `GET` |
| **Ruta** | `/api/external/ordenes` |
| **Base URL** | `http://<host>:5000` (puerto por defecto `5000`) |
| **Autenticación** | Header `x-api-key` |
| **Formato respuesta** | JSON |
| **Paginado** | Sí (server-side, vía `page` / `pageSize`) |

> Reemplazar `<host>` por la IP o dominio del servidor donde corre el backend.

---

## 2. Autenticación

Toda petición **debe** incluir el header:

```
x-api-key: <CLAVE_ACORDADA>
```

- La clave la provee el equipo dueño del backend (variable `EXTERNAL_API_KEY` del servidor).
- Si falta o es incorrecta, el endpoint responde **HTTP 401** y no devuelve datos.
- No usa JWT ni login de usuario: es una clave fija pensada para integración servidor-a-servidor.

**No** se debe exponer esta clave en frontend, apps móviles ni repos públicos. Guardarla como variable de entorno/secreto en el sistema consumidor.

---

## 3. Parámetros (query string)

Todos son **opcionales** y **combinables**. Sin filtros, devuelve todas las órdenes paginadas.

| Parámetro | Tipo | Descripción | Ejemplo |
|---|---|---|---|
| `fechaDesde` | `string` (fecha) | Fecha de ingreso **desde** (inclusive). Formato `YYYY-MM-DD`. | `2026-06-01` |
| `fechaHasta` | `string` (fecha) | Fecha de ingreso **hasta** (inclusive). Formato `YYYY-MM-DD`. | `2026-06-18` |
| `idCliente` | `string` | Filtra por cliente. Coincidencia **parcial** sobre el código de cliente (`IDCliente`) o su nombre. | `Macaco` |
| `material` | `string` | Filtra por producto/material. Coincidencia **parcial** sobre descripción del artículo o su código. | `DTF` |
| `codigoOrden` | `string` | Filtra por número de orden. Coincidencia **parcial**. | `DTF-8` |
| `estado` | `string` | Filtra por nombre **exacto** del estado. | `Avisado` |
| `page` | `int` | Número de página (empieza en `1`). Default `1`. | `2` |
| `pageSize` | `int` | Cantidad de registros por página. Default `100`, **máximo `1000`**. | `200` |

**Notas:**
- `idCliente`, `material` y `codigoOrden` son búsquedas tipo "contiene" (LIKE), no exactas.
- `estado` es coincidencia exacta (debe llegar el nombre tal cual figura en el sistema, ej. `Pronto para entregar`, `Avisado`, `Ingresado`).
- Las fechas filtran sobre la fecha de **ingreso** de la orden.
- Si `page`/`pageSize` llegan inválidos, se usan los valores por defecto. Si `pageSize > 1000`, se topea a `1000`.

---

## 4. Respuesta

### 4.1 Estructura general (HTTP 200)

```json
{
  "success": true,
  "page": 1,
  "pageSize": 100,
  "total": 28615,
  "totalPages": 287,
  "count": 100,
  "data": [ /* array de órdenes */ ]
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `success` | `boolean` | `true` si la consulta fue exitosa. |
| `page` | `int` | Página actual devuelta. |
| `pageSize` | `int` | Tamaño de página aplicado. |
| `total` | `int` | Total de registros que cumplen los filtros (sin paginar). |
| `totalPages` | `int` | Cantidad total de páginas (`ceil(total / pageSize)`). |
| `count` | `int` | Cantidad de registros en **esta** página (`data.length`). |
| `data` | `array` | Lista de órdenes (ver 4.2). |

### 4.2 Objeto orden (cada elemento de `data`)

```json
{
  "codigoOrden": "XSB-63534",
  "idCliente": "RETTRO",
  "trabajo": "CAPASDEBARBERIA",
  "producto": "Microfibra RV Waterproof (1,50)",
  "codigoProducto": "1215",
  "modo": "Normal",
  "cantidad": 5.14,
  "estado": "Pronto para entregar",
  "fechaIngreso": "2026-06-16T20:17:13.307Z",
  "importe": 55.83,
  "moneda": "US$"
}
```

| Campo | Tipo | Descripción |
|---|---|---|
| `codigoOrden` | `string` | Número/código de la orden. |
| `idCliente` | `string` | Código/identificador del cliente. |
| `trabajo` | `string` | Nombre/descripción del trabajo. |
| `producto` | `string` | Producto/material (descripción del artículo). |
| `codigoProducto` | `string` | Código del artículo (para casar con catálogo). |
| `modo` | `string` | Modo de la orden (ej. `Normal`). |
| `cantidad` | `number` | Cantidad/magnitud. Decimal. |
| `estado` | `string` | Estado actual de la orden. |
| `fechaIngreso` | `string` (ISO 8601, UTC) | Fecha/hora de ingreso. Ej. `2026-06-16T20:17:13.307Z`. |
| `importe` | `number` | Importe / costo final de la orden. Decimal (2 posiciones). |
| `moneda` | `string` | Símbolo de la moneda del importe (ej. `US$`, `$`). |

> **Importante sobre `importe` + `moneda`:** el importe no significa lo mismo según la moneda. Siempre interpretar `importe` junto con `moneda` (puede haber órdenes en pesos y en dólares).

> Los campos de texto vienen **sin espacios sobrantes** (ya recortados en el servidor).

---

## 5. Códigos de estado HTTP

| Código | Significado | Cuerpo |
|---|---|---|
| `200` | OK | JSON con `success: true` y `data`. |
| `401` | API key inválida o faltante | `{ "error": "No autorizado. API Key inválida o faltante." }` |
| `500` | Error interno del servidor | `{ "error": "Error interno del servidor al obtener órdenes." }` |

---

## 6. Ejemplos

### 6.1 cURL

Primera página, 50 registros:
```bash
curl -H "x-api-key: <CLAVE_ACORDADA>" \
  "http://<host>:5000/api/external/ordenes?page=1&pageSize=50"
```

Filtrado por rango de fechas + cliente + material:
```bash
curl -H "x-api-key: <CLAVE_ACORDADA>" \
  "http://<host>:5000/api/external/ordenes?fechaDesde=2026-06-01&fechaHasta=2026-06-18&idCliente=Macaco&material=DTF&page=1&pageSize=100"
```

### 6.2 JavaScript (fetch / Node 18+)

```javascript
const BASE_URL = "http://<host>:5000";
const API_KEY = process.env.EXTERNAL_API_KEY; // nunca hardcodear

async function getOrdenes({ fechaDesde, fechaHasta, idCliente, material, estado, codigoOrden, page = 1, pageSize = 100 } = {}) {
  const params = new URLSearchParams();
  if (fechaDesde)  params.set("fechaDesde", fechaDesde);
  if (fechaHasta)  params.set("fechaHasta", fechaHasta);
  if (idCliente)   params.set("idCliente", idCliente);
  if (material)    params.set("material", material);
  if (estado)      params.set("estado", estado);
  if (codigoOrden) params.set("codigoOrden", codigoOrden);
  params.set("page", page);
  params.set("pageSize", pageSize);

  const res = await fetch(`${BASE_URL}/api/external/ordenes?${params}`, {
    headers: { "x-api-key": API_KEY }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

// Recorrer TODAS las páginas que cumplen el filtro
async function getTodas(filtros = {}) {
  const todas = [];
  let page = 1;
  while (true) {
    const r = await getOrdenes({ ...filtros, page, pageSize: 1000 });
    todas.push(...r.data);
    if (page >= r.totalPages) break;
    page++;
  }
  return todas;
}
```

### 6.3 Python (requests)

```python
import os
import requests

BASE_URL = "http://<host>:5000"
API_KEY = os.environ["EXTERNAL_API_KEY"]

def get_ordenes(**filtros):
    params = {k: v for k, v in filtros.items() if v is not None}
    params.setdefault("page", 1)
    params.setdefault("pageSize", 100)
    r = requests.get(
        f"{BASE_URL}/api/external/ordenes",
        headers={"x-api-key": API_KEY},
        params=params,
        timeout=30,
    )
    r.raise_for_status()
    return r.json()

def get_todas(**filtros):
    todas, page = [], 1
    while True:
        data = get_ordenes(**filtros, page=page, pageSize=1000)
        todas.extend(data["data"])
        if page >= data["totalPages"]:
            break
        page += 1
    return todas

# Ejemplo
resp = get_ordenes(fechaDesde="2026-06-01", fechaHasta="2026-06-18", idCliente="Macaco", material="DTF")
print(resp["total"], "órdenes; primera:", resp["data"][0] if resp["data"] else None)
```

---

## 7. Recomendaciones de integración

1. **Paginar siempre.** El total puede ser de decenas de miles de órdenes. Usar `pageSize` alto (hasta `1000`) y recorrer con `page` hasta `totalPages`.
2. **Filtrar por fecha** para sincronizaciones incrementales (ej. traer solo lo del día / última semana) en lugar de descargar todo cada vez.
3. **Reintentos:** ante `500` o errores de red, reintentar con backoff. El `401` no se reintenta (es problema de credencial).
4. **Guardar la API key como secreto** en el sistema consumidor (variable de entorno), nunca en código versionado.
5. **`importe` siempre junto a `moneda`** para no mezclar pesos y dólares.
6. **Casar productos** por `codigoProducto` si el sistema externo tiene su propio catálogo de artículos.

---

## 8. Checklist rápido para el agente integrador

- [ ] Tengo la **Base URL** (`http://<host>:5000`) y la **API key**.
- [ ] Envío el header `x-api-key` en cada request.
- [ ] Implemento **paginación** (`page` / `pageSize`, leer `totalPages`).
- [ ] Manejo `401` (credencial) y `500` (reintento).
- [ ] Interpreto `importe` con su `moneda`.
- [ ] Parseo `fechaIngreso` como ISO 8601 UTC.

---

## 9. Implementación (referencia interna)

- **Controller:** `backend/controllers/externalController.js` → función `getOrdenes`.
- **Ruta:** `backend/routes/externalRoutes.js` → `GET /ordenes` (montado en `/api/external` desde `server.js`).
- **Auth:** valida `x-api-key` contra `process.env.EXTERNAL_API_KEY`.
- Filtros parametrizados (sin concatenar valores del usuario) → sin riesgo de inyección SQL.
