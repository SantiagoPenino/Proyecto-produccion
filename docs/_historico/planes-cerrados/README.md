# Planes y análisis cerrados

| Documento | Qué es | Por qué está cerrado |
|---|---|---|
| `DISENO_separar_impresion_terminaciones_ecouv.md` (23/07) | Separar Impresión y Terminaciones de ECOUV en locales distintos | El propio documento concluye que el mecanismo ya estaba implementado |
| `dtf-tinta-blanca-propuesta.md` (01/07) | Propuesta de generar la capa de tinta blanca de DTF con Python | La capa blanca se implementó en `dtfBlancoService.js`; la propuesta quedó vieja |
| `fix-socket-lentitud.md` (24/06) | Lentitud por la ráfaga de eventos de socket | Documenta el arreglo del 24/06 |
| `consulta-cliente-revision-prototipo.md` (02/09) | Revisión del prototipo «Consulta al cliente» | El plan vigente es `docs/consultas-cliente-plan.md` |
| `plan-gasto-por-sector.md` (24/09) | Gasto en insumos por sector en /stock | Implementado: `PanelGastoSectores` en `StockGestionPage.jsx` |
| `reversas-contables-investigacion.md` (28/08) | Por qué las -R1 generaban una reversa contable | Se sacó esa reversa de `logisticsController.js` (queda el comentario) |
| `ventas-por-vendedor-por-documento.md` (01/10) | Ventas por vendedor sobre documentos; las notas de crédito restan | Implementado el 01/10 |
| `st-borrar-solicitudes-prueba.sql` | Borra **todas** las solicitudes de Servicio Técnico | Era para limpiar las pruebas. **No correrlo:** hoy las solicitudes son reales |

**Quedaron en `docs/`**, porque siguen abiertos: `capacidad-planta-plan.md` (Yoania trabaja en las fechas prometidas), `tienda-retiro-encomienda-y-billetera.md` (documenta el problema de que la caja imputa dos veces), `disenadores-portal-plan.md` y `analisis-cpu-sql-2026-09-23.md` (los cita el código).
