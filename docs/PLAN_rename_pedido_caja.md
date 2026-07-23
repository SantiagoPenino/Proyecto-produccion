# Plan: renombrar "Pedidos Caja" → "Borrador de Factura"

Estado: **pendiente**. Escrito el 23-jul-2026.
Lo único aplicado hasta ahora es el **rótulo en la bandeja CFE** (display puro, sin tocar
base ni lógica): `getTipoDocName` en `src/components/pages/ContabilidadBandejaCFE.jsx`.
Todo lo demás de este documento está sin hacer.

---

## 1. Qué se sabe de la base (escaneo de las 674 columnas de texto, 23-jul-2026)

| Tabla / columna | Filas | Acción |
|---|---|---|
| `DocumentosContables.DocTipo` | 2106 | **Renombrar** — es el cambio real |
| `Config_TiposDocumento.Detalle` (CodDocumento `'40'`) | 1 | **Renombrar** — define el nombre de los documentos nuevos |
| `SecuenciaDocumentos.SecTipoDoc` (`'PEDIDO_CAJA'`, SecId 12) | 1 | **Renombrar** |
| `Cont_EventosContables.EvtNombre` (`'40'`, `'41'`) | 2 | Renombrar (cosmético) |
| `MovimientosCuenta.MovConcepto` | 285 | **No tocar** — historia escrita ("Venta Pedidos Caja: PC-414") |
| `ColaEstadosCuenta.ColContenidoJSON` | 602 | **No tocar** — snapshots ya emitidos |
| `Tickets_Mensajes.TMenTexto` | 2 | **No tocar** — texto escrito por personas |
| Stored procedures / vistas | **0** | Nada: la base no decide nada por ese string |

### Restricción que no se puede pasar por alto

`DocumentosContables.DocTipo` es **`varchar(20)`**.

- `"Borrador Factura"` = 16 caracteres ✔
- `"Borrador de Factura"` = 19 caracteres ✔ (entra justo)
- Cualquier cosa más larga **se corta en silencio** — es exactamente lo que rompió las
  notas de crédito ("E-Ticket Nota De Credito" → `"E-Ticket Nota De Cre"`), que se
  emitieron a DGI como venta durante meses. Ver `project_bug_nc_emitidas_como_venta`.

**Decisión a tomar antes de empezar:** el valor guardado debe ser `'Borrador Factura'`
(16, con margen) aunque el rótulo visible diga "Borrador de Factura". Si se guarda el de
19 no hay margen para ningún sufijo futuro.

---

## 2. El riesgo real: la ventana entre deploy y UPDATE

No es el cambio en sí, es el orden:

- Si corre primero el SQL → el código viejo no reconoce los documentos renombrados.
- Si va primero el deploy → el código nuevo no reconoce los 2106 viejos.

En cualquiera de los dos casos, durante esa ventana los borradores **dejan de tratarse
como no-fiscales y aparecen como enviables a DGI**.

**Se elimina haciendo que el código acepte los dos nombres.** Con eso el orden deja de
importar, el SQL se puede correr cuando se quiera, y el rollback es solo el UPDATE inverso.

---

## 3. Paso 1 — Helper compartido (hacer PRIMERO, se puede subir solo)

Crear `backend/utils/tiposDocumento.js`:

```js
// Reconoce el borrador de caja por CUALQUIERA de sus nombres: el histórico
// ('Pedidos Caja', 'PedidoCaja', 'PC', 'PEDIDO_CAJA') y el nuevo ('Borrador Factura').
// Mientras las dos formas convivan, el orden entre el deploy y la migración no importa.
const esBorradorFactura = (tipo) => {
  if (!tipo) return false;
  const t = String(tipo).trim().toLowerCase();
  return t.includes('pedido') || t.includes('borrador') || t === 'pc';
};
module.exports = { esBorradorFactura, ETIQUETA: 'Borrador de Factura' };
```

Este paso es **puramente aditivo y seguro**: se puede subir sin tocar la base y sin que
cambie ningún comportamiento, siempre que los 9 puntos de abajo pasen a usarlo.

### Los 9 puntos de lógica que hoy comparan por texto

| Archivo | Línea | Qué decide |
|---|---|---|
| `backend/services/cajaService.js` | 527 | `CfeEstado = 'BORRADOR'` al crear |
| `backend/services/cajaService.js` | 1393, 1399-1401 | idem + `esPedidoCaja` |
| `backend/controllers/cajaController.js` | 1743-1744 | tipo y `CfeEstado` al crear |
| `backend/controllers/cfeController.js` | 93 | filtro del listado (`LIKE '%Pedido%'`) — es SQL, necesita el `OR` en la query |
| `backend/controllers/cfeController.js` | 304 | bloqueo "es borrador interno, no se envía a DGI" |
| `backend/controllers/cfeController.js` | 683 | derivación de `CfeEstado` |
| `backend/controllers/cfeController.js` | 1106, 1114 | idem al editar |
| `backend/controllers/contabilidadReportesController.js` | 76 | `RTRIM(DocTipo) = 'Pedidos Caja'` — SQL |
| `src/components/pages/ContabilidadBandejaCFE.jsx` | 71 | `isFiscalCfe` (decide si aparece "Enviar a DGI") |

Los dos que son SQL no pueden usar el helper JS: hay que ampliar la condición en la query
(`DocTipo LIKE '%Pedido%' OR DocTipo LIKE '%Borrador%'`).

> **Nota:** al **crear** el documento no se puede usar `CfeEstado='BORRADOR'` para decidir,
> porque es justo lo que se está calculando. Ahí el dato confiable es el **código del tipo**
> (`'40'` / `header.tipoDocumento === 'PC'`), que ya está disponible en esos puntos —
> en `cajaService.js:1392` se usa una línea antes de volver a adivinar por texto en la 1393.

---

## 4. Paso 2 — Rótulos (~18 lugares, cosmético)

| Archivo | Líneas |
|---|---|
| `src/components/pages/ContabilidadBandejaCFE.jsx` | 33 (**ya hecho**) |
| `src/utils/pdfGenerator.js` | 187, 785 |
| `src/utils/excelGenerator.js` | 176 |
| `src/components/pages/ContabilidadCuentasView.jsx` | 1418, 1424, 1557 |
| `src/components/pages/CajaPagoDeudaTab.jsx` | 227, 399, 572 |
| `src/components/pages/CajaTransaccionView.jsx` | 68 |
| `src/components/pages/CajaVentaDirectaTab.jsx` | 672, 702 |
| `src/components/pages/CajaPanelPago.jsx` | 400, 428, 1174 |
| `src/components/pages/CierreCicloPreviewModal.jsx` | 722 |
| `src/components/pages/customer-service/VentaRolloAdelantoPage.jsx` | 8, 151 |

Ojo con los selectores de caja: ahí el usuario **elige** el tipo de comprobante al cobrar
(`{ value: '40', label: 'Pedido Caja' }`). Cambiar ese texto cambia lo que lee el operador
al cobrar, no solo un reporte. Vale avisarle a la gente de caja antes.

---

## 5. Paso 3 — Migración de datos (subir DESPUÉS del paso 1)

```sql
BEGIN TRANSACTION;

-- 1) Nombre de los documentos NUEVOS
UPDATE dbo.Config_TiposDocumento
   SET Detalle = 'Borrador Factura'
 WHERE CodDocumento = '40';

-- 2) Tipo de secuencia
UPDATE dbo.SecuenciaDocumentos
   SET SecTipoDoc = 'BORRADOR_FACTURA'
 WHERE SecIdSecuencia = 12;

-- 3) Eventos contables (cosmético)
UPDATE dbo.Cont_EventosContables SET EvtNombre = 'Borrador Factura'     WHERE EvtCodigo = '40';
UPDATE dbo.Cont_EventosContables SET EvtNombre = 'Dev Borrador Factura' WHERE EvtCodigo = '41';

-- 4) Los 2106 históricos
UPDATE dbo.DocumentosContables
   SET DocTipo = 'Borrador Factura'
 WHERE RTRIM(DocTipo) IN ('Pedidos Caja', 'PedidoCaja', 'PC');

-- Verificación ANTES de confirmar
SELECT RTRIM(DocTipo) AS Tipo, ISNULL(CfeEstado,'(null)') AS Estado, COUNT(*) AS Cant
FROM dbo.DocumentosContables
WHERE RTRIM(DocTipo) IN ('Borrador Factura','Pedidos Caja','PedidoCaja','PC')
GROUP BY RTRIM(DocTipo), CfeEstado;
-- Esperado: 'Borrador Factura' BORRADOR = 2070, 'Borrador Factura' ANULADO = 36, y nada más.

COMMIT;   -- o ROLLBACK si el conteo no da
```

**Rollback:** el mismo UPDATE al revés (`SET DocTipo = 'Pedidos Caja' WHERE RTRIM(DocTipo) = 'Borrador Factura'`).
Como el código del paso 1 acepta los dos nombres, revertir los datos no obliga a revertir el deploy.

---

## 6. Verificación posterior

```bash
node backend/scripts/verificar_tipocfe_nc.js --todos
```

Ninguna fila debe cambiar de tipo de CFE por el rename. Y en la bandeja:
los 2070 borradores tienen que seguir **sin** el botón "Enviar a DGI".

Chequeo directo en la base — este número no puede moverse:

```sql
SELECT COUNT(*) FROM dbo.DocumentosContables WHERE CfeEstado = 'BORRADOR';  -- debe seguir dando 2070
```

---

## 7. Decisiones pendientes del usuario

1. **El número sigue siendo `PC-2552`.** La serie (`PC`) y el prefijo (`PC-`) viven en
   `SecuenciaDocumentos` y son independientes del nombre del tipo. ¿Se dejan, o los nuevos
   pasan a ser `BF-####`? Si se cambia, los viejos siguen siendo `PC-` y conviven.
2. **Los 285 `MovConcepto`** dicen "Venta Pedidos Caja: PC-414 (Favio Curbelo)".
   Recomendación: no tocarlos, describen cómo se llamaba el documento cuando ocurrió.
3. **Valor guardado:** `'Borrador Factura'` (16 ch) con rótulo visible "Borrador de Factura",
   que es lo que asume este plan. Si se prefiere guardar los 19 caracteres, queda sin margen.
