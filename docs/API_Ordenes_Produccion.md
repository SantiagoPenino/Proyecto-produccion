# API Externa — Órdenes de producción con sus archivos

Documentación técnica para consumo externo. Devuelve las órdenes de producción con:
- su código;
- la fecha y hora en que se creó;
- lo que se pidió: material, variante, código de artículo, cantidad y unidad;
- la cantidad de archivos;
- los metros y las copias de cada archivo;
- la máquina;
- si tuvo fallas.

## 1. Datos de conexión

| Campo | Valor |
|---|---|
| Método | `GET` |
| URL | `https://user.com.uy/api/external/ordenes-produccion` |
| URL local (pruebas) | `http://localhost:5000/api/external/ordenes-produccion` |
| Header requerido | `x-api-key` (la misma clave que `/api/external/ordenes`; se pasa por privado) |
| Body | No lleva |

Si falta el header o la clave es incorrecta, responde `401`:

```json
{ "error": "No autorizado. API Key inválida o faltante." }
```

## 2. Parámetros (query, todos opcionales)

| Parámetro | Ejemplo | Descripción |
|---|---|---|
| `codigoOrden` | `DTF-36131` | Una orden puntual. Es exacto: `DTF-3613` no trae `DTF-36131`. |
| `fechaDesde` | `2026-10-01` | Fecha de creación de la orden, desde ese día inclusive (día de Uruguay). Formato `AAAA-MM-DD`. |
| `fechaHasta` | `2026-10-21` | Fecha de creación de la orden, hasta ese día inclusive (día de Uruguay). Formato `AAAA-MM-DD`. |
| `page` | `1` | Página (arranca en 1). Por defecto 1. |
| `pageSize` | `100` | Órdenes por página. Por defecto 100, máximo 1000. |

Vienen ordenadas de la más nueva a la más vieja.

## 3. Ejemplo

```bash
curl -H "x-api-key: LA_CLAVE" \
  "https://user.com.uy/api/external/ordenes-produccion?codigoOrden=DTF-36131"
```

```json
{
  "success": true,
  "page": 1,
  "pageSize": 100,
  "total": 1,
  "totalPages": 1,
  "count": 1,
  "data": [
    {
      "codigoOrden": "DTF-36131",
      "fechaCreacion": "2026-10-19T17:46:44-03:00",
      "material": "DTF textil COMUN",
      "variante": "DTF Textil",
      "codigoArticulo": "48",
      "cantidadPedida": 3.55,
      "unidad": "m",
      "cantidadArchivos": 2,
      "archivos": [
        { "archivoId": 61280, "nombre": "DTF-36131_..._Archivo 1 de 2 (x3).pdf", "metros": 1.05, "copias": 3 },
        { "archivoId": 61281, "nombre": "DTF-36131_..._Archivo 2 de 2 (x1).pdf", "metros": 0.4, "copias": 1 }
      ],
      "maquina": "DTF-2",
      "tuvoFallas": false
    }
  ]
}
```

## 4. Campos de cada orden

| Campo | Tipo | Descripción |
|---|---|---|
| `codigoOrden` | string | Código de la orden (ej. `DTF-36131`). Las reposiciones por falla interna terminan en `-F…` y vienen como órdenes aparte. |
| `fechaCreacion` | string | Fecha y hora en que se creó la orden, en hora de Uruguay, formato ISO 8601 con su desfase: `2026-10-19T17:46:44-03:00` = 19/10/2026 a las 17:46:44. Cualquier lenguaje lo lee directo, por ejemplo `new Date(...)` en JavaScript o `datetime.fromisoformat(...)` en Python. |
| `material` | string \| null | El material que se pidió (ej. `DTF textil COMUN`, `Frontlight Brillo hasta 3.17`). Es uno por orden. |
| `variante` | string \| null | La variante o línea del producto (ej. `DTF Textil`, `Sublimacion Tela`). |
| `codigoArticulo` | string \| null | Código del artículo pedido (ej. `48`). |
| `cantidadPedida` | number \| null | Cuánto se pidió, en la `unidad` de al lado. En las órdenes por metro suele coincidir con la suma de los archivos (ver 4.2), con diferencias mínimas por redondeo. En las reposiciones (`-R…`) es lo repuesto, no lo de la orden original. |
| `unidad` | string \| null | Unidad de `cantidadPedida`, con el código que usa el sistema: `m` (metros), `u` (unidades); otros, como `prend` o `baj`, dependen del servicio. |
| `cantidadArchivos` | number | Cuántos archivos tiene, sin contar los cancelados. |
| `archivos` | array | Un elemento por archivo (ver abajo). Vacío si la orden no tiene archivos. |
| `maquina` | string \| null | Máquina donde se imprime o se imprimió (ej. `DTF-2`). `null` si todavía no se asignó. |
| `tuvoFallas` | boolean \| null | `true`: se le registró alguna falla. `false`: ya pasó por control, o está finalizada, sin fallas. `null`: todavía no se controló, así que no se sabe. |

### 4.1 Campos de cada archivo

| Campo | Tipo | Descripción |
|---|---|---|
| `archivoId` | number | ID interno del archivo. |
| `nombre` | string | Nombre del archivo. |
| `metros` | number \| null | Metros de **una** copia (para el total, ver 4.2). `null` si el archivo no lleva metros (por ejemplo, algunos servicios). |
| `copias` | number \| null | Cantidad de copias. |

No incluye las órdenes canceladas ni los archivos cancelados. El material es el de la orden: todos sus archivos son del mismo material.

### 4.2 Cómo sacar los metros totales

La API no manda los metros totales de los archivos: se calculan con los datos de cada uno.

- **Total de un archivo** = `metros × copias`.
- **Total de la orden** = la suma de los totales de sus archivos.
- Un archivo con `metros` en `null` no lleva metros y suma 0.
- Si `copias` viene en `null`, se toma como 1.

Con el ejemplo de arriba:

| Archivo | metros | copias | Total |
|---|---|---|---|
| 1 de 2 | 1,05 | 3 | 1,05 × 3 = 3,15 |
| 2 de 2 | 0,4 | 1 | 0,4 × 1 = 0,4 |
| **Orden** | | | **3,15 + 0,4 = 3,55 m** (igual a `cantidadPedida`) |

En JavaScript:

```javascript
const totalArchivo = (a) => (a.metros ?? 0) * (a.copias ?? 1);
const totalOrden = (orden) => orden.archivos.reduce((suma, a) => suma + totalArchivo(a), 0);

// totalOrden(json.data[0]) → 3.55
```

## 5. Errores

| Código | Motivo |
|---|---|
| 400 | Fecha con formato distinto de `AAAA-MM-DD`. |
| 401 | Falta `x-api-key` o la clave es incorrecta. |
| 500 | Error interno; reintentar y, si sigue, avisar. |

---

**Nota:** la URL de producción responde recién cuando el endpoint esté deployado.
