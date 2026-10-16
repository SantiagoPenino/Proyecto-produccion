-- ════════════════════════════════════════════════════════════════════
--  CONFIGURADOR — Costuras como PASO A PASO de confección (05-oct-2026)
-- ════════════════════════════════════════════════════════════════════
--  Antes: cada costura de la ficha de diseño era solo "Unión + código ISO".
--  Ahora: cada fila es un PASO de la secuencia de costura de la prenda:
--    Etapa (texto libre) · Operación · Costura (ISO) · Máquina · Qué piezas une ·
--    Tiempo (min por prenda) · Observaciones · Imagen.
--
--  Cambios:
--    A. dbo.MaquinasCostura (NUEVA): tipos de máquina del taller
--       (recta, overlock 4 hilos, recubridora…). Son TIPOS, no las
--       máquinas físicas de ConfigEquipos (ahí Costura tiene una sola
--       fila genérica "COSTURA 1").
--    B. dbo.CosturasISO + Descripcion, ImagenUrl, MaquinaCosturaID
--       (máquina típica: se propone sola al elegir la costura en un paso).
--       Se cargan descripción, imagen y máquina de las 16 costuras ISO
--       que ya existen — SOLO donde están vacías (no pisa lo cargado a mano).
--       Las imágenes son esquemas SVG que van con el frontend en
--       public/costuras-iso/iso-XXX.svg (se publican con el build).
--    C. dbo.ProductoFichaDisenoCosturas + Etapa, Descripcion,
--       MaquinaCosturaID, TiempoMin, Observaciones, ImagenUrl;
--       CodigoISO pasa a aceptar NULL (pasos sin costura: planchado,
--       control, cortar hilos).
--
--  Idempotente: se puede correr más de una vez. El backend funciona
--  ANTES y DESPUÉS de correrlo (detecta las columnas nuevas).
-- ════════════════════════════════════════════════════════════════════

-- ── A. Catálogo de máquinas de costura ──────────────────────────────
IF OBJECT_ID('dbo.MaquinasCostura', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.MaquinasCostura (
        MaquinaCosturaID INT IDENTITY(1,1) PRIMARY KEY,
        Nombre           VARCHAR(100) NOT NULL,
        Descripcion      VARCHAR(300) NULL,
        Activo           BIT NOT NULL DEFAULT 1,
        Orden            INT NULL,
        CONSTRAINT UQ_MaquinasCostura_Nombre UNIQUE (Nombre)
    );
END
GO

-- Seed: solo agrega las que falten (por nombre)
MERGE dbo.MaquinasCostura AS t
USING (VALUES
    ('Recta 1 aguja',                 'Pespunte recto (ISO 301). Etiquetas, bolsillos, cierres, vistas, pespuntes.', 1),
    ('Recta 2 agujas',                'Dos pespuntes rectos paralelos (ISO 301). Pespunte doble decorativo, cintura.', 2),
    ('Overlock 3 hilos',              'Sobrehilado de bordes y unión liviana (ISO 503/504/505).', 3),
    ('Overlock 4 hilos',              'Unión principal en punto: hombros, costados, mangas (ISO 512/514).', 4),
    ('Overlock 5 hilos (safety)',     'Cadeneta + overlock en una pasada (ISO 516). Unión resistente en tejido plano.', 5),
    ('Recubridora (collareta)',       'Ruedos, bocamangas, ribetes y tapacosturas (ISO 406/407/602/605).', 6),
    ('Flatseamer (4 agujas)',         'Costura plana sin relieve (ISO 607). Ropa deportiva y térmica.', 7),
    ('Zigzag',                        'Zigzag (ISO 304). Elásticos, apliques, refuerzos.', 8),
    ('Cadeneta / multiaguja',         'Cadeneta (ISO 101/401). Hilván, cinturas con elástico, costuras largas.', 9),
    ('Dobladillo invisible',          'Puntada invisible (ISO 103). Ruedos que no se ven del derecho.', 10),
    ('Atracadora',                    'Atraques (presillas) de refuerzo en bolsillos, trabillas y puntas de cierre.', 11),
    ('Ojaladora',                     'Ojales para botones.', 12),
    ('Botonera',                      'Pegado de botones.', 13),
    ('Plancha',                       'Planchado intermedio y final, termofijado de etiquetas.', 14),
    ('Manual (mesa)',                 'Operaciones a mano: cortar hilos, dar vuelta, control de calidad, doblado y embolsado.', 15)
) AS s (Nombre, Descripcion, Orden)
ON t.Nombre = s.Nombre
WHEN NOT MATCHED THEN INSERT (Nombre, Descripcion, Orden) VALUES (s.Nombre, s.Descripcion, s.Orden);
GO

-- ── B. CosturasISO: descripción, imagen y máquina típica ────────────
IF COL_LENGTH('dbo.CosturasISO', 'Descripcion') IS NULL
    ALTER TABLE dbo.CosturasISO ADD Descripcion VARCHAR(500) NULL;
IF COL_LENGTH('dbo.CosturasISO', 'ImagenUrl') IS NULL
    ALTER TABLE dbo.CosturasISO ADD ImagenUrl VARCHAR(500) NULL;
IF COL_LENGTH('dbo.CosturasISO', 'MaquinaCosturaID') IS NULL
    ALTER TABLE dbo.CosturasISO ADD MaquinaCosturaID INT NULL;
GO

-- Asegura las 16 costuras ISO (agrega las que falten por código)
MERGE dbo.CosturasISO AS t
USING (VALUES
    ('ISO 101', 'Cadeneta 1 hilo (hilván)'),
    ('ISO 103', 'Puntada invisible (dobladillo)'),
    ('ISO 301', 'Pespunte recto (lockstitch)'),
    ('ISO 304', 'Zigzag'),
    ('ISO 401', 'Cadeneta 2 hilos'),
    ('ISO 406', 'Recubridora (coverstitch)'),
    ('ISO 407', 'Recubridora 3 agujas'),
    ('ISO 503', 'Overlock 2 hilos'),
    ('ISO 504', 'Overlock 3 hilos'),
    ('ISO 505', 'Overlock 3 hilos ancho'),
    ('ISO 512', 'Safety 4 hilos (falso safety)'),
    ('ISO 514', 'Overlock 4 hilos'),
    ('ISO 516', 'Safety 5 hilos'),
    ('ISO 602', 'Recubridora 2 agujas'),
    ('ISO 605', 'Recubridora 3 agujas con recubierto superior'),
    ('ISO 607', 'Flatlock 4 agujas')
) AS s (CodigoISO, Nombre)
ON t.CodigoISO = s.CodigoISO
WHEN NOT MATCHED THEN INSERT (CodigoISO, Nombre, Activo) VALUES (s.CodigoISO, s.Nombre, 1);
GO

-- Datos de cada costura: solo completa lo que está vacío
;WITH d (CodigoISO, Descripcion, Maquina) AS (
    SELECT * FROM (VALUES
    ('ISO 101', 'Hilván temporal de 1 hilo: fija piezas antes de la costura definitiva y se saca después.', 'Cadeneta / multiaguja'),
    ('ISO 103', 'Dobladillo invisible: del derecho casi no se ve. Ruedos de pantalón y pollera.', 'Dobladillo invisible'),
    ('ISO 301', 'Pespunte recto, igual de los dos lados. No estira. Etiquetas, bolsillos, cierres, vistas y pespuntes decorativos.', 'Recta 1 aguja'),
    ('ISO 304', 'Zigzag: acompaña el estiramiento. Pegado de elásticos, apliques y refuerzos.', 'Zigzag'),
    ('ISO 401', 'Cadeneta de 2 hilos: elástica y resistente. Costuras largas, cinturas y entrepiernas.', 'Cadeneta / multiaguja'),
    ('ISO 406', 'Recubridora 2 agujas: dos pespuntes arriba y rulo abajo. Ruedos de remera, bocamangas, ribetes de cuello.', 'Recubridora (collareta)'),
    ('ISO 407', 'Recubridora 3 agujas: tres pespuntes arriba y rulo abajo. Ruedos anchos y pegado de elástico.', 'Recubridora (collareta)'),
    ('ISO 503', 'Overlock 2 hilos: sobrehilado liviano del borde (no une piezas).', 'Overlock 3 hilos'),
    ('ISO 504', 'Overlock 3 hilos: sobrehilado de bordes y unión de punto liviano.', 'Overlock 3 hilos'),
    ('ISO 505', 'Overlock 3 hilos ancho: sobrehilado de telas que se deshilachan.', 'Overlock 3 hilos'),
    ('ISO 512', 'Falso safety 4 hilos: unión resistente en tejido de punto.', 'Overlock 4 hilos'),
    ('ISO 514', 'Overlock 4 hilos: unión principal de prendas de punto (hombros, costados, mangas).', 'Overlock 4 hilos'),
    ('ISO 516', 'Safety 5 hilos: cadeneta + overlock en una pasada. Unión resistente en tejido plano.', 'Overlock 5 hilos (safety)'),
    ('ISO 602', 'Recubridora 2 agujas con hilo decorativo arriba (collareta): tapacosturas y ribetes.', 'Recubridora (collareta)'),
    ('ISO 605', 'Recubridora 3 agujas con recubierto superior: ribeteado y tapacosturas en ropa deportiva.', 'Recubridora (collareta)'),
    ('ISO 607', 'Flatlock 4 agujas: costura plana sin relieve, cubierta arriba y abajo. Ropa deportiva y térmica.', 'Flatseamer (4 agujas)')
    ) v (CodigoISO, Descripcion, Maquina)
)
UPDATE c SET
    c.Descripcion      = ISNULL(c.Descripcion, d.Descripcion),
    c.ImagenUrl        = ISNULL(c.ImagenUrl, '/costuras-iso/' + LOWER(REPLACE(d.CodigoISO, ' ', '-')) + '.svg'),
    c.MaquinaCosturaID = ISNULL(c.MaquinaCosturaID, m.MaquinaCosturaID)
FROM dbo.CosturasISO c
INNER JOIN d ON d.CodigoISO = c.CodigoISO
LEFT JOIN dbo.MaquinasCostura m ON m.Nombre = d.Maquina;
GO

-- ── C. Pasos de costura del producto ────────────────────────────────
IF COL_LENGTH('dbo.ProductoFichaDisenoCosturas', 'Etapa') IS NULL
    ALTER TABLE dbo.ProductoFichaDisenoCosturas ADD Etapa VARCHAR(60) NULL;            -- texto libre (ej. "Preparación", "Armado de la vaina")
IF COL_LENGTH('dbo.ProductoFichaDisenoCosturas', 'Descripcion') IS NULL
    ALTER TABLE dbo.ProductoFichaDisenoCosturas ADD Descripcion VARCHAR(500) NULL;     -- qué piezas une
IF COL_LENGTH('dbo.ProductoFichaDisenoCosturas', 'MaquinaCosturaID') IS NULL
    ALTER TABLE dbo.ProductoFichaDisenoCosturas ADD MaquinaCosturaID INT NULL;
IF COL_LENGTH('dbo.ProductoFichaDisenoCosturas', 'TiempoMin') IS NULL
    ALTER TABLE dbo.ProductoFichaDisenoCosturas ADD TiempoMin DECIMAL(7,2) NULL;       -- minutos por prenda
IF COL_LENGTH('dbo.ProductoFichaDisenoCosturas', 'Observaciones') IS NULL
    ALTER TABLE dbo.ProductoFichaDisenoCosturas ADD Observaciones VARCHAR(500) NULL;
IF COL_LENGTH('dbo.ProductoFichaDisenoCosturas', 'ImagenUrl') IS NULL
    ALTER TABLE dbo.ProductoFichaDisenoCosturas ADD ImagenUrl VARCHAR(500) NULL;       -- foto propia del paso (si no, la de la costura)
GO
-- Etapa es texto libre de hasta 60 (una versión anterior de este script la creaba de 20)
IF COL_LENGTH('dbo.ProductoFichaDisenoCosturas', 'Etapa') < 60
    ALTER TABLE dbo.ProductoFichaDisenoCosturas ALTER COLUMN Etapa VARCHAR(60) NULL;
GO
-- Pasos sin costura (planchado, control, cortar hilos)
IF EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
           WHERE TABLE_NAME = 'ProductoFichaDisenoCosturas' AND COLUMN_NAME = 'CodigoISO' AND IS_NULLABLE = 'NO')
    ALTER TABLE dbo.ProductoFichaDisenoCosturas ALTER COLUMN CodigoISO VARCHAR(20) NULL;
GO

-- ── D. Verificación ─────────────────────────────────────────────────
SELECT 'MaquinasCostura' AS Tabla, COUNT(*) AS Filas FROM dbo.MaquinasCostura
UNION ALL SELECT 'CosturasISO con imagen', COUNT(*) FROM dbo.CosturasISO WHERE ImagenUrl IS NOT NULL
UNION ALL SELECT 'CosturasISO con máquina', COUNT(*) FROM dbo.CosturasISO WHERE MaquinaCosturaID IS NOT NULL
UNION ALL SELECT 'Pasos de costura cargados', COUNT(*) FROM dbo.ProductoFichaDisenoCosturas;

SELECT c.CodigoISO, c.Nombre, m.Nombre AS Maquina, c.ImagenUrl
FROM dbo.CosturasISO c LEFT JOIN dbo.MaquinasCostura m ON m.MaquinaCosturaID = c.MaquinaCosturaID
ORDER BY c.CodigoISO;
GO
