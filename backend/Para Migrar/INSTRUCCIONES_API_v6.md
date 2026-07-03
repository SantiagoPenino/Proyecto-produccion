# Instrucciones de Integración - API WMS Stock (Versión v6.0.0)

Esta es la nueva versión de la API de Stock. Es totalmente autónoma y se conecta directamente a la base de datos de Amazon utilizando la firma de transacción segura `#WmsSecureTx_v16`.

## Cómo ejecutar la API en el servidor

1. Copiar el archivo `api_articulos_stock_v6.js` en cualquier carpeta del servidor.
2. Instalar los paquetes necesarios de Node:
   ```bash
   npm install express cors
   ```
3. Iniciar el servicio:
   ```bash
   node api_articulos_stock_v6.js
   ```
   *La API quedará escuchando localmente en el puerto `3005`.*

## Endpoints disponibles para la integración

### 1. Buscar artículos y variantes
* **Método:** `GET`
* **Ruta:** `/api/articulos`
* **Parámetros de consulta:** `search` (opcional, ej. `?search=Short`)
* **Descripción:** Devuelve una lista de variantes que coinciden con la búsqueda, indicando el stock disponible de cada una.

### 2. Descontar stock de Ventas
* **Método:** `POST`
* **Ruta:** `/api/articulos/descontar`
* **Cuerpo de la petición (JSON):**
  ```json
  {
    "variante_id": 410,
    "cantidad": 5
  }
  ```
* **Descripción:** Descuenta la cantidad especificada de la variante en el almacén de Ventas. Si hay faltante, creará automáticamente una solicitud de reposición (`wms_solicitudes`) por la diferencia.

### 3. Confirmar recepción de remito
* **Método:** `POST`
* **Ruta:** `/api/remitos/recibir`
* **Cuerpo de la petición (JSON):**
  ```json
  {
    "codigo_remito": "WEB-123456"
  }
  ```
* **Descripción:** Confirma la recepción del remito especificado actualizando el stock disponible.

### 4. Obtener listado de inventario
* **Método:** `GET`
* **Ruta:** `/api/inventory/variants`
* **Descripción:** Devuelve una lista con todo el inventario agrupado por variante y almacén.
