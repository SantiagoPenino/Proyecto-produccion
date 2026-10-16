-- =====================================================================
-- DIAGNÓSTICO DE SOLO LECTURA — Configurador de Productos
-- Correr contra PRODUCCIÓN. No modifica nada.
-- Las 17 tablas que crea docs/migrations/configurador_productos.sql
-- (secciones A-W) + las columnas que agrega sobre tablas existentes.
-- =====================================================================

SELECT '01. ProductoTerminadoServicios (A)' AS Item,
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProductoTerminadoServicios') THEN 'EXISTE' ELSE 'FALTA' END AS Estado
UNION ALL
SELECT '02. ProductoTerminadoServicios.Modo (A)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ProductoTerminadoServicios' AND COLUMN_NAME='Modo') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '03. ProductoTerminadoServicios.Cobro (A)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ProductoTerminadoServicios' AND COLUMN_NAME='Cobro') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '04. TecnicaOpciones (B)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='TecnicaOpciones') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '05. ProductoTecnicaOpciones (C)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProductoTecnicaOpciones') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '06. ProductoVentaConfig (D)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProductoVentaConfig') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '07. ProductoVentaConfig.EsCombo (L)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ProductoVentaConfig' AND COLUMN_NAME='EsCombo') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '08. ProductoVentaConfig.Familia (M)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ProductoVentaConfig' AND COLUMN_NAME='Familia') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '09. ProductoVentaConfig.CodigoCorto (V)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='ProductoVentaConfig' AND COLUMN_NAME='CodigoCorto') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '10. ProductoOrigenVariantes (E)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProductoOrigenVariantes') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '11. ComponenteOpciones (H)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ComponenteOpciones') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '12. ProductoComponentes (I)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProductoComponentes') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '13. ProductoApliques (J)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProductoApliques') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '14. ProductoComboItems (K)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProductoComboItems') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '15. ProductoComboItemServicios (L)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProductoComboItemServicios') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '16. ComponenteOpcionPiezas (U)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ComponenteOpcionPiezas') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '17. ProductoVariantes (V)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProductoVariantes') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '18. CosturasISO (W)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='CosturasISO') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '19. ProductoFichaDiseno (W)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProductoFichaDiseno') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '20. ProductoFichaDisenoAnotaciones (W)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProductoFichaDisenoAnotaciones') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '21. ProductoFichaDisenoExtra (W)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProductoFichaDisenoExtra') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
SELECT '22. ProductoFichaDisenoCosturas (W)',
    CASE WHEN EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME='ProductoFichaDisenoCosturas') THEN 'EXISTE' ELSE 'FALTA' END
UNION ALL
-- StockArt 2.2.1.4 "Combos y Promos" (sección L/Q) — dato, no esquema, pero
-- lo necesita cualquier combo para existir como categoría.
SELECT '23. StockArt CodStock=2.2.1.4 (Combos y Promos, dato)',
    CASE WHEN EXISTS (SELECT 1 FROM dbo.StockArt WHERE LTRIM(RTRIM(CodStock))='2.2.1.4') THEN 'EXISTE' ELSE 'FALTA' END

ORDER BY Item;

-- Si esto da TODO 'FALTA', el script configurador_productos.sql nunca corrió en
-- este entorno (0 aplicado). Si da una MEZCLA de EXISTE/FALTA, corrió parcial —
-- correr el .sql completo de nuevo es seguro igual (es idempotente, cada sección
-- chequea IF NOT EXISTS antes de crear).
