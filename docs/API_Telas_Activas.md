# API Externa — Consulta de Telas Activas

Documentación técnica para consumo externo.

## 1. Datos de conexión

| Campo | Valor |
|---|---|
| Método | `GET` |
| URL | `https://user.com.uy/api/external/telas` |
| URL local (pruebas) | `http://localhost:5000/api/external/telas` |
| Header requerido | `x-api-key` |
| Valor del header | `user-ext-2024-clave-segura` |
| Body | No lleva |
| Query params | No lleva |

Es todo lo que se necesita: método + URL + un único header. No hay usuario, contraseña ni token que expire.

## 2. Autenticación

Cada request debe incluir el siguiente header HTTP:

```
x-api-key: user-ext-2024-clave-segura
```

Si falta el header o el valor es incorrecto, la API responde `401 Unauthorized`:

```json
{
  "error": "No autorizado. API Key inválida o faltante."
}
```

## 3. Cómo probarlo

### 3.1 Con curl (terminal)

```bash
curl -H "x-api-key: user-ext-2024-clave-segura" \
  https://user.com.uy/api/external/telas
```

### 3.2 Con Postman / Insomnia

1. Crear una request nueva, método GET.
2. URL: `https://user.com.uy/api/external/telas`
3. Ir a la pestaña Headers (no Auth, no Body).
4. Agregar: Key = `x-api-key`, Value = `user-ext-2024-clave-segura`
5. Send. Debería responder `200 OK` con el JSON de las telas.

## 4. Ejemplos de código

### 4.1 JavaScript (fetch)

```javascript
const res = await fetch('https://user.com.uy/api/external/telas', {
  method: 'GET',
  headers: { 'x-api-key': 'user-ext-2024-clave-segura' }
});
const json = await res.json();
console.log(json.data);
```

### 4.2 Python (requests)

```python
import requests

respuesta = requests.get(
    'https://user.com.uy/api/external/telas',
    headers={'x-api-key': 'user-ext-2024-clave-segura'}
)
datos = respuesta.json()
print(datos['data'])
```

### 4.3 PHP (curl)

```php
$ch = curl_init('https://user.com.uy/api/external/telas');
curl_setopt($ch, CURLOPT_HTTPHEADER, ['x-api-key: user-ext-2024-clave-segura']);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$respuesta = json_decode(curl_exec($ch), true);
print_r($respuesta['data']);
```

## 5. Respuesta

Ejemplo de respuesta exitosa (200 OK):

```json
{
  "success": true,
  "count": 31,
  "data": [
    {
      "id": 484,
      "codigoArticulo": "484",
      "descripcion": "Adis brillo Rajman (1,58)",
      "moneda": "USD",
      "precioBase": 9
    }
  ]
}
```

### 5.1 Campos de cada tela

| Campo | Tipo | Descripción |
|---|---|---|
| `id` | number | ID interno del artículo |
| `codigoArticulo` | string | Código del artículo |
| `descripcion` | string | Nombre de la tela (incluye ancho, ej. "(1,60)") |
| `moneda` | string | `"USD"` o `"UYU"` |
| `precioBase` | number \| null | Precio base cargado (puede venir vacío) |

## 6. Errores

| Código | Motivo | Qué revisar |
|---|---|---|
| 401 | Falta o es incorrecto `x-api-key` | Verificar el header exacto |
| 500 | Error interno del servidor | Reintentar; si persiste, avisar |

---

**Nota:** esta URL de producción (`user.com.uy`) requiere que el endpoint ya esté deployado en el servidor. Si todavía no se hizo el deploy, la API no va a responder hasta entonces.
