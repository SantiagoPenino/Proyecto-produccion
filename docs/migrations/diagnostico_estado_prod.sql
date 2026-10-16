-- =====================================================================
-- DIAGNÓSTICO DE SOLO LECTURA — correr contra PRODUCCIÓN para saber qué
-- migraciones ya están aplicadas y cuáles faltan antes del próximo deploy.
-- No modifica nada. Cada fila dice EXISTE o FALTA.
-- =====================================================================

------------------------------------------------------------------
-- 🔴 BLOQUEANTE — si falta alguna de estas, un flujo de uso diario
-- completo se rompe apenas se despliega el código nuevo.
------------------------------------------------------------------

SELECT '1. Ordenes.ComboItemID (combos)' AS Item,
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Ordenes' AND COLUMN_NAME='ComboItemID') THEN 'EXISTE' ELSE 'FALTA' END AS Estado
UNION ALL
SELECT '2. Ordenes.ComboPedidoNoDocERP (combos)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Ordenes' AND COLUMN_NAME='ComboPedidoNoDocERP') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '3. Ordenes.PrendaClienteID (bordado_origen_prendas.sql)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Ordenes' AND COLUMN_NAME='PrendaClienteID') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '4. Tabla InventarioPrendasCliente (bordado_origen_prendas.sql)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='InventarioPrendasCliente') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '5. ArchivosOrden.Piezas (medicion_tizada / bordado_origen_prendas)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArchivosOrden' AND COLUMN_NAME='Piezas') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '6. ArchivosOrden.MetrosCorte',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArchivosOrden' AND COLUMN_NAME='MetrosCorte') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '7. ArchivosOrden.PiezasTrabajadas',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArchivosOrden' AND COLUMN_NAME='PiezasTrabajadas') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '8. ArchivosOrden.PiezasControladas',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArchivosOrden' AND COLUMN_NAME='PiezasControladas') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '9. ArchivosOrden.PuntadasEstimadas',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArchivosOrden' AND COLUMN_NAME='PuntadasEstimadas') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '10. ArchivosOrden.PaletaBordado',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArchivosOrden' AND COLUMN_NAME='PaletaBordado') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '11. ArchivosReferencia.Piezas',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArchivosReferencia' AND COLUMN_NAME='Piezas') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '12. ArchivosReferencia.MetrosCorte',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ArchivosReferencia' AND COLUMN_NAME='MetrosCorte') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '13. DocumentosContables.DocCliNombreFantasia',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='DocumentosContables' AND COLUMN_NAME='DocCliNombreFantasia') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '14. DocumentosContablesDetalle.DcdDescuentoPct',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='DocumentosContablesDetalle' AND COLUMN_NAME='DcdDescuentoPct') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '15. DocumentosContables.CfeFechaDgi',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='DocumentosContables' AND COLUMN_NAME='CfeFechaDgi') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '16. Pagos.PagIdCheque',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Pagos' AND COLUMN_NAME='PagIdCheque') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '17. PedidosCobranzaDetalle.EsHermanaConsolidada',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='PedidosCobranzaDetalle' AND COLUMN_NAME='EsHermanaConsolidada') THEN 'EXISTE' ELSE 'FALTA' END

------------------------------------------------------------------
-- 🟡 SEGUNDO GRUPO — sin riesgo de romper nada hoy, pero conviene
-- tenerlas para que las features nuevas funcionen bien.
------------------------------------------------------------------

UNION ALL
SELECT '18. Tabla Sectores',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='Sectores') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '19. Tabla SectorMapeo',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='SectorMapeo') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '20. Tabla ArticuloClasificacion',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ArticuloClasificacion') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '21. DocumentosContablesDetalle.DcdArea',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='DocumentosContablesDetalle' AND COLUMN_NAME='DcdArea') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '22. DocumentosContablesDetalle.DcdVariante',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='DocumentosContablesDetalle' AND COLUMN_NAME='DcdVariante') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '23. DocumentosContablesDetalle.DcdProIdProducto',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='DocumentosContablesDetalle' AND COLUMN_NAME='DcdProIdProducto') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '24. SP SP_EstamparAreaLineasDocumento',
    CASE WHEN EXISTS (SELECT 1 FROM sys.procedures WHERE name='SP_EstamparAreaLineasDocumento') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '25. Tabla ConfigHorarioLaboral',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ConfigHorarioLaboral') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '26. Tabla HistoricoCapacidadDiaria',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='HistoricoCapacidadDiaria') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '27. ConfigEquipos.Cabezales',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ConfigEquipos' AND COLUMN_NAME='Cabezales') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '28. ConfigEquipos.VelocidadValor',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ConfigEquipos' AND COLUMN_NAME='VelocidadValor') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '29. ConfigEquipos.MinutosPreparacion',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ConfigEquipos' AND COLUMN_NAME='MinutosPreparacion') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '30. Configurador: tabla ProductoTerminadoServicios',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProductoTerminadoServicios') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '31. Configurador: tabla ProductoVariantes',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProductoVariantes') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '32. Configurador: tabla ProductoComboItems',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProductoComboItems') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '33. Configurador: tabla ProductoComboItemServicios',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProductoComboItemServicios') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '34. DocumentosContables.CfeTipoCFE',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='DocumentosContables' AND COLUMN_NAME='CfeTipoCFE') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '35. SP_RegistrarMovimiento tiene parametro @MovFecha',
    CASE WHEN EXISTS (
        SELECT 1 FROM sys.parameters p JOIN sys.procedures pr ON p.object_id = pr.object_id
        WHERE pr.name = 'SP_RegistrarMovimiento' AND p.name = '@MovFecha'
    ) THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '36. Tabla EnvioEmail',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='EnvioEmail') THEN 'EXISTE' ELSE 'FALTA' END

ORDER BY Item;

-- NOTA: el Configurador de Productos tiene 15+ tablas en total (configurador_productos.sql,
-- secciones A-W) — acá solo se chequean 4 representativas (30-33). Si esas 4 EXISTEN, es
-- altísimamente probable que el script completo ya haya corrido; si FALTAN, hay que correr
-- todo el archivo (no solo esas 4).
--
-- NOTA 2: no incluye verificación de ecouv_variantes_terminaciones.sql (la memoria dice que
-- ya se aplicó en prod el 28-jul-2026) ni los 9 índices de performance de contabilidad (no
-- son bloqueantes, solo afectan velocidad) — si querés que los agregue también, avisame.
