# CPU de SQL Server — análisis del informe del 23/09/2026

Fuente: `Desktop/informe-sql.txt` (medido en producción, ~13 h desde el arranque de SQL). Las lecturas de abajo se
midieron en la base **local** con `SET STATISTICS IO`: sirven para comparar, no son las de producción.

## Las 4 consultas del informe

La medición tomó las 6 más caras (5.922 s); el archivo trae el texto de 4 (5.682 s = 72 % de toda la CPU de SQL).
Las otras 2 suman 240 s.

| # | CPU prod | Llamadas | Qué es | Dónde |
|---|---|---|---|---|
| 1 | 2.506 s (32 %) | 15.809 | Kanban de lotes por área | `rollsController.getBoardData` |
| 2 | 1.277 s (16 %) | 20.195 | Planilla de producción por área | `ordersController.getOrdersByArea` |
| 3 | 1.006 s (13 %) | 19.119 | Portal, "Mi Fábrica": lista paginada | `webOrdersController.getClientOrders` |
| 4 | 894 s (11 %) | 19.113 | Portal, "Mi Fábrica": contadores (solo página 1) | ídem |

## Correcciones al informe

- **La #1 no lee 145 MB por `Ordenes` ni por `NOT LIKE '%-F%'`/`ISNULL(AreaID)`**: esas dos condiciones son de la #3 y
  la #4, no de la #1. Lo que recorre una tabla entera en cada llamada es la subconsulta `TotalCopias` (suma de copias
  para el avance en MIMAKI): como `Copias` no está en el índice de `ArchivosOrden`, SQL prefiere leer esa tabla
  completa. Local, área DF: 3.185 de las 3.557 lecturas de `ArchivosOrden` son de esa subconsulta.
- El índice `Ordenes (AreaID, Estado)` que recomienda **ya existe** en producción desde el 31/08
  (`IX_Ordenes_AreaID_Estado`, con 19 columnas incluidas). Crear los índices por `Estado` que sugiere el DMV no
  arregla la #1.
- En la #3 y la #4, el `NOT LIKE '%-F%'` y el `ISNULL(AreaID,'')` no impiden usar índice: la búsqueda es por
  `CodCliente`; esas condiciones filtran las filas de ese cliente.
- Una reescritura de la #1 sin el `OR` (dos ramas por separado) se probó y **lee más** (Ordenes 1.001 → 3.167). No va.

## Propuesta, en orden de impacto

### 1. Índice de `ArchivosOrden` (solo SQL, sin código) — la #1 — APLICADO EN PRODUCCIÓN 23/09 (verificado)

Ampliar el índice existente con `Copias` y `Observaciones` (`Observaciones` es corta: promedio 38 bytes, máximo 372
en local). Medido en local con un índice de prueba, mismo resultado exacto:

| Área | Lecturas de ArchivosOrden hoy | Con el índice | Baja |
|---|---|---|---|
| DF (23 órdenes) | 3.557 | 583 | −84 % |
| SB (213 órdenes) | 5.075 | 967 | −81 % |

```sql
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_ArchivosOrden_OrdenID' AND object_id = OBJECT_ID('dbo.ArchivosOrden'))
    CREATE NONCLUSTERED INDEX IX_ArchivosOrden_OrdenID ON dbo.ArchivosOrden (OrdenID)
        INCLUDE (EstadoArchivo, Copias, Observaciones) WITH (DROP_EXISTING = ON);
ELSE
    CREATE NONCLUSTERED INDEX IX_ArchivosOrden_OrdenID ON dbo.ArchivosOrden (OrdenID)
        INCLUDE (EstadoArchivo, Copias, Observaciones);
```

Mientras se reconstruye, las escrituras a `ArchivosOrden` esperan unos segundos: correrlo en un momento tranquilo.

#### 1b. Medido en producción después del índice (23/09, kanban DF, una ejecución)

`ArchivosOrden` 840 · `Ordenes` 1.045 · **`Rollos` 30.658**. El índice funcionó; lo que queda es el `OR` del filtro:
SQL recorre todas las órdenes de DF que alguna vez tuvieron lote y, por cada una, va a `Rollos` a ver si ese lote
sigue activo. **Aplicado 23/09 en `getBoardData` (sin deployar):** dos ramas con `UNION ALL`, una que parte de los lotes
activos del área y trae sus órdenes, y otra con las pendientes sin lote. Local, las 9 áreas con resultado idéntico;
DF 36.488 → 1.423 lecturas, SB 27.357 → 5.099. **En producción, DF: 32.543 → 2.622 (Rollos 30.658 → 25)**, mismas
70 órdenes.

### 2. Portal: recarga por eventos de toda la planta — la #3 y la #4 (código) — HECHO 23/09, sin deployar

Implementado en `backend/utils/avisosOrdenesPortal.js`: el portal se suscribe con su token (`portal:suscribir`),
deja de recibir los dos avisos generales y recibe `portal:mis_ordenes` solo cuando cambia una orden de su cliente
(ráfagas juntas cada 500 ms, una consulta por ráfaga). Planta y diseñadores sin cambios. `FactoryView.jsx` escucha
el aviso nuevo y los generales (para el que no queda suscripto). Lo de abajo es el diagnóstico original.

`FactoryView.jsx` recarga la página 1 (lista + contadores) con cada `server:ordersUpdated` / `server:order_updated`,
que el backend emite a **todos** los sockets cuando cambia cualquier orden. Cada cliente con "Mi Fábrica" abierta
recarga hasta una vez cada 8 s aunque el cambio no sea suyo; también pide `consultas` en cada recarga. Arreglo:
emitir esos eventos a la sala del cliente afectado (o mandar su `CodCliente` en el evento y que el portal ignore
los ajenos). Además, la lista recorre `Ordenes` entera en cada llamada (~4.470 lecturas fijas en local, sea el
cliente chico o grande): segundo paso, con índice cubriente o paginando primero las claves.

### 3. Planilla — la #2

Costo moderado por llamada (el detalle de archivos en JSON); pesa por la cantidad de llamadas (refrescos por evento).
Mismo tipo de arreglo que el punto 2, para después.

## Menor

`Rollos (AreaID)` aparece con 55.795 usos, pero la tabla es chica. En local ya existe `IX_Rollos_AreaID_Estado`;
en producción no está verificado.
