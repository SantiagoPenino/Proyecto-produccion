# Estructura de Datos y Plan Backend ("JHONSON") - Revisión 2

Este documento detalla la estructura JSON final que enviará el frontend y cómo el backend debe procesarla, incorporando las últimas decisiones de arquitectura: **Prioridad por Código** y **Flujo de Fechas**.

## 1. Estructura JSON ("JHONSON") Actualizada

El frontend enviará un objeto agrupado por servicios (`payload.services`), donde cada clave es un Área/Proceso.

### Ejemplo Completo: Impresión Directa + Corte + Costura
Caso: Lona Frontlit con Corte y Costura.

```json
{
  "clientInfo": {
    "cliente": "Juan Perez",
    "prioridad": "Alta",
    "fechaEntrega": "2023-12-01"
  },
  "generalNote": "Pedido urgente.",
  "services": {
    /* SERVICIO PRINCIPAL (IMPRESION) */
    "IMD": {
      "areaId": "DIRECTA", 
      "cabecera": {
        "material": "Lona Frontlit",   // Descripción (Informativo)
        "codArticulo": "1560",         // ID ERP (Prioridad 2)
        "codStock": "1.1.11.1"         // ID Variante (Prioridad 1 - ÚSALO PARA BUSCAR)
      },
      "sublineas": [
        {
          "archivoPrincipal": { "name": "Gigantografia.pdf", "width": 3.2, "height": 1.5 },
          "archivoDorso": { "name": "Gigantografia_DORSO.pdf" }, // Sufijo _DORSO añadido automáticamente
          "cantidad": 10,
          "nota": "Ojo con colores [TWINFACE]"
        }
      ]
    },

    /* SERVICIO SECUNDARIO (CORTE) */
    "TWC": {
      "areaId": "TWC",
      "cabecera": {
        "material": "Corte Laser por prenda",
        "codArticulo": "111",
        "codStock": "1.1.6.1"
      },
      "sublineas": [
        {
          "cantidad": 10,
          "tizadaFiles": [{ "name": "Molderia.zip" }],
          "nota": "Corte habilitado. Molde: MOLDES CLIENTES."
        }
      ],
      "metadata": { "moldType": "MOLDES CLIENTES" }
    },

    /* SERVICIO TERCIARIO (COSTURA) */
    "TWT": {
      "areaId": "TWT",
      "cabecera": {
        "material": "Costura Standard",
        "codArticulo": "112",
        "codStock": "1.1.7.1"
      },
      "sublineas": [
        {
          "cantidad": 10,
          "nota": "Costura ruedo simple"
        }
      ]
    }
  }
}
```

---

## 2. Lógica de Backend (`ordersController.js`)

Al recibir este JSON en `createOrder`, el backend debe ejecutar los siguientes pasos dentro de una transacción única:

### A. Prioridad de Datos (Code First)
Para cada servicio, no confíes ciegamente en la descripción `material`.
1.  Lee `codStock` (ej. `1.1.11.1`).
2.  Si existe, busca en tu tabla de Materiales/StockArt usando ese código para obtener la descripción oficial actual.
3.  Si no existe `codStock`, usa `codArticulo` (`1560`).
4.  Si no existen códigos, usa `material` como fallback.

### B. Gestión de Fechas (Activar Entrada)
El sistema debe determinar cuál es el **Primer Proceso** para habilitar su fecha de ingreso.

**Regla de Negocio:**
*   El primer servicio del JSON (o el marcado explícitamente como Principal/IMD) recibe `FechaHabilitacion = GETDATE()` (Hoy).
*   Los servicios dependientes (TWC, TWT) reciben `FechaHabilitacion = NULL` (o una fecha futura estimada).
*   **Excepción:** Si el pedido es SOLO CORTE (sin Impresión), entonces TWC es el primero y recibe `GETDATE()`.

**Implementación Sugerida:**
```javascript
let isFirstService = true;
for (const [key, svc] of Object.entries(services)) {
    // Determinar Fecha Habilitación
    const fechaHabilitacion = isFirstService ? new Date() : null;
    
    // ... Insertar Orden con fechaHabilitacion ...
    
    isFirstService = false; // Los siguientes son dependientes
}
```

### C. Identificación de Archivos (Dorso)
El Frontend ya envía `_DORSO` en el nombre del archivo.
Al insertar en `ArchivosOrden`:
1.  Detectar si el nombre contiene `_DORSO`.
2.  Si es así, puedes establecer `TipoArchivo = 'IMPRESION_DORSO'` o dejarlo como 'IMPRESION' pero el nombre ya indica la cara.
3.  El `ArchivoID` generado se asocia a la `OrdenID` del servicio correspondiente (`IMD` en este caso).

### D. Vinculación (IdCabezalERP)
Generar un ID único (`GroupId`) al inicio de la transacción y guardarlo en el campo `IdCabezalERP` de **todas** las órdenes creadas en este ciclo. Esto permitirá agruparlas visualmente como un solo "Pedido Integral".
