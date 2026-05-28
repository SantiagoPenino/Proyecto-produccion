-- SCRIPT PARA RESTAURAR ARTÍCULOS CON CÓDIGO '99' EN PRODUCCIÓN
-- Este script actualiza o inserta de forma segura los artículos que originalmente tenían el CodArticulo = '99'
-- con sus descripciones y valores correctos (evitando que queden sobreescritos con el mismo nombre).

BEGIN TRY
    BEGIN TRAN;

    -- 1. Habilitar la inserción de claves primarias explícitas (identity)
    SET IDENTITY_INSERT dbo.Articulos ON;

    -- 2. Ejecutar MERGE con los valores empotrados
    MERGE INTO dbo.Articulos AS target
    USING (
        VALUES 
        (298, '99                  ', 8, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 3,20 Brillo (reverso blanco)                                                             ', 1, 0, 0, 2, 'LOF320ECOBB', NULL, NULL),
        (299, '99                  ', 9, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 3,20 Mate (reverso blanco)                                                               ', 1, NULL, NULL, 2, 'LOF160ECOBM', NULL, NULL),
        (300, '99                  ', 10, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 3,20 Brillo (reverso gris)                                                               ', 1, 0, 0, 2, 'LOF320ECOGB', NULL, NULL),
        (301, '99                  ', 11, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 3,20 Mate (reverso gris)                                                                 ', 1, NULL, NULL, 2, 'LOF320ECOGM', NULL, NULL),
        (302, '99                  ', 12, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 1,60 Mate (reverso gris)                                                                 ', 1, 0, 0, 2, 'LOF160ECOGM', NULL, NULL),
        (303, '99                  ', 13, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 1,60 Brillo (reverso gris)                                                               ', 1, 0, 0, 2, 'LOF160ECOGB', NULL, NULL),
        (304, '99                  ', 14, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 1,60 Mate (reverso blanco)                                                               ', 1, 0, 0, 2, 'LOF160ECOBM', NULL, NULL),
        (305, '99                  ', 15, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 1,60 Brillo (reverso blanco)                                                             ', 1, 0, 0, 2, 'LOF160ECOBB', NULL, NULL),
        (306, '99                  ', 16, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo brillo 1,52 (Adhesivo Gris)                                                                  ', 1, 0, 0, 2, 'Vin152BriEcoG', NULL, NULL),
        (307, '99                  ', 17, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo brillo 1,52 (Adhesivo Transparente)                                                          ', 1, 0, 0, 2, 'Vin152BriEcoAT', NULL, NULL),
        (308, '99                  ', 18, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo mate 1,52 (Adhesivo Gris)                                                                    ', 1, 0, 0, 2, 'Vin137MatEcoG', NULL, NULL),
        (309, '99                  ', 19, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo brillo 1,37 (Adhesivo Gris)                                                                  ', 1, 0, 0, 2, 'Vin137BriEcoG', NULL, NULL),
        (310, '99                  ', 20, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo brillo 1,37 (Adhesivo Transparente)                                                          ', 1, 0, 0, 2, 'Vin137BriAdTEco', NULL, NULL),
        (311, '99                  ', 21, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Brillo 1,37 (Adhesivo Blanco)                                                                ', 1, 0, 0, 2, 'Vin137BriEcoB', NULL, NULL),
        (312, '99                  ', 22, '1       ', '1.3                 ', '1.1.3.2             ', 'Vinilo Brillo 1,0 (Adhesivo Blanco)                                                                 ', 1, NULL, NULL, 2, 'Vin100BriEcoB', NULL, NULL),
        (313, '99                  ', 23, '1       ', '1.3                 ', '1.1.3.2             ', 'Vinilo Vehicular (1,52)                                                                             ', 1, NULL, NULL, 2, 'Vin152VehiEcoB', NULL, NULL),
        (314, '99                  ', 24, '1       ', '1.3                 ', '1.1.3.2             ', 'Canvas 1,52                                                                                         ', 1, NULL, NULL, 2, 'CAN152ECO', NULL, NULL),
        (315, '99                  ', 25, '1       ', '1.3                 ', '1.1.3.2             ', 'Canvas Brillo 1,27                                                                                  ', 1, NULL, NULL, 2, 'CAN127ECO', NULL, NULL),
        (316, '99                  ', 26, '1       ', '1.3                 ', '1.1.3.2             ', 'Banner Pet semibrillo (0,91)                                                                        ', 1, NULL, NULL, 2, 'BaPetSem091', NULL, NULL),
        (317, '99                  ', 27, '1       ', '1.3                 ', '1.1.3.2             ', 'Banner Pet mate (0,91)                                                                              ', 1, NULL, NULL, 2, 'BaPetMatt137', NULL, NULL),
        (318, '99                  ', 66, '1       ', '1.3                 ', '1.1.3.2             ', 'Vinilo Microperforado 1,50                                                                          ', 1, NULL, NULL, 2, 'Vin152MicroEcoB', NULL, NULL),
        (319, '99                  ', 36, '1       ', '1.3                 ', '1.1.3.1             ', 'Lona para Pasacalles 0,80                                                                           ', 1, 0, 0, 2, 'LOF160ECONM', NULL, NULL),
        (320, '99                  ', 67, '1       ', '1.3                 ', '1.1.3.1             ', 'PET Backlight (0,91)                                                                                ', 1, 0, 0, 2, NULL, NULL, NULL),
        (321, '99                  ', 68, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 3,20 Brillo (Reverso Negro)                                                              ', 1, 0, 0, 2, 'LOF160ECONB', NULL, NULL),
        (322, '99                  ', 69, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 3,20 Mate (Reverso Negro)                                                                ', 1, 0, 0, 2, 'LOF320ECONM', NULL, NULL),
        (323, '99                  ', 70, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 1,60 Brillo (Reverso Negro)                                                              ', 1, 0, 0, 2, 'LOF160ECONB', NULL, NULL),
        (324, '99                  ', 71, '1       ', '1.3                 ', '1.1.3.1             ', 'Frontlight 1,60 Mate (Reverso Negro)                                                                ', 1, 0, 0, 2, 'LOF160ECONM', NULL, NULL),
        (325, '99                  ', 72, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Microperforado 1,52 (Reverso Negro)                                                          ', 1, 0, 0, 2, 'Vin152MicroEcoN', NULL, NULL),
        (326, '99                  ', 73, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Microperforado 0,98 (Reverso Negro)                                                          ', 1, 0, 0, 2, 'Vin98MicroEcoN', NULL, NULL),
        (327, '99                  ', 74, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Brillo 1,52 (Adhesivo Blanco)                                                                ', 1, 0, 0, 2, 'Vin152MatAdTEco', NULL, NULL),
        (328, '99                  ', 75, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Mate 1,52 (Adhesivo Blanco)                                                                  ', 1, 0, 0, 2, 'Vin137MatAdTEco', NULL, NULL),
        (329, '99                  ', 76, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Vehicular 1,52 (Adhesivo Gris)                                                               ', 1, 0, 0, 2, 'Vin152VehiEcoG', NULL, NULL),
        (330, '99                  ', 77, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo brillo 1,37 (adhesivo translúcido/blanco)                                                    ', 1, 0, 0, 2, 'Vin137BriAdTEco', NULL, NULL),
        (331, '99                  ', 78, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Brillo 0,91 (Adhesivo Blanco)                                                                ', 1, 0, 0, 2, 'Vin91BriEcoG', NULL, NULL),
        (332, '99                  ', 79, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Mate 0,91 (Adhesivo Blanco)                                                                  ', 1, 0, 0, 2, 'Vin91BriEcoB', NULL, NULL),
        (333, '99                  ', 80, '1       ', '1.3                 ', '1.1.3.1             ', 'Canvas Mate 0,91                                                                                    ', 1, 0, 0, 2, 'CAN90ECO', NULL, NULL),
        (334, '99                  ', 85, '1       ', '1.3                 ', '1.1.3.1             ', 'Roll up aluminio + (Banner Pet mate - 0,91)                                                         ', 1, 0, 0, 2, 'R-A-UP-', NULL, NULL),
        (335, '99                  ', 88, '1       ', '1.3                 ', '1.1.3.1             ', 'Lona Backligth 1,60                                                                                 ', 1, 0, 0, 2, 'Balight160', NULL, NULL),
        (336, '99                  ', 89, '1       ', '1.3                 ', '1.1.3.1             ', 'Lona Backligth 3,20                                                                                 ', 1, 0, 0, 2, 'Balight320', NULL, NULL),
        (337, '99                  ', 85, '1       ', '1.3                 ', '1.1.3.1             ', 'Roll up aluminio + (Banner Pet mate - 0,91) ARMADO                                                  ', 1, NULL, NULL, 2, 'R-A-UP-', NULL, NULL),
        (338, '99                  ', 80, '1       ', '1.3                 ', '1.1.3.1             ', 'Canvas Brillo 0,91                                                                                  ', 1, 0, 0, 2, 'CAN90ECO', NULL, NULL),
        (339, '99                  ', 16, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo Brillo 1,52(Adhesivo Gris)                                                                   ', 1, 0, 0, 2, 'Vin152BriEcoG', NULL, NULL),
        (340, '99                  ', 91, '1       ', '1.3                 ', '1.1.3.1             ', 'Papel Fotográfico (0,87)                                                                            ', 1, NULL, NULL, 2, 'P-F-', NULL, NULL),
        (341, '99                  ', 96, '1       ', '1.3                 ', '1.1.3.1             ', 'Vinilo brillo 1,52 (adhesivo translúcido/blanco)                                                    ', 1, 0, 0, 2, '1', NULL, NULL),
        (342, '99                  ', 97, '1       ', '1.3                 ', '1.1.3.1             ', 'Columnera 0,77 x 0,50 + Palo                                                                        ', 1, 0, 0, 1, '1', NULL, NULL),
        (343, '99                  ', 98, '1       ', '1.3                 ', '1.1.3.1             ', 'Pasacalles 0,77 x 1,00 + Palo                                                                       ', 1, 0, 0, 1, '1', NULL, NULL),
        (344, '99                  ', 99, '1       ', '1.3                 ', '1.1.3.1             ', 'Pasacalles 0,77 x 2,00 + Palo                                                                       ', 1, 0, 0, 1, '1', NULL, NULL),
        (345, '99                  ', 100, '1       ', '1.3                 ', '1.1.3.1             ', 'Pasacalles 0,77 x 3,00 + Palo                                                                       ', 1, 0, 0, 1, '1', NULL, NULL),
        (346, '99                  ', 24, '1       ', '1.3                 ', '1.1.3.1             ', 'Canvas Mate 1,27                                                                                    ', 1, 0, 0, 2, 'CAN152ECO', NULL, NULL),
        (347, '99                  ', 25, '1       ', '1.3                 ', '1.1.3.1             ', 'Canvas Mate 1,52                                                                                    ', 1, 0, 0, 2, 'CAN127ECO', NULL, NULL),
        (348, '99                  ', 100, '1       ', '1.3                 ', '1.1.3.1             ', 'Pasacalles 0,77 x 3,00                                                                              ', 1, 0, 0, 1, '1', NULL, NULL),
        (349, '99                  ', 121, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 25 x 25                                                                               ', 1, 0, 0, 1, '1', NULL, NULL),
        (350, '99                  ', 122, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 40 x 40                                                                               ', 1, 0, 0, 1, '1', NULL, NULL),
        (351, '99                  ', 123, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 60 x 60                                                                               ', 1, 0, 0, 1, '1', NULL, NULL),
        (352, '99                  ', 124, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 80 x 80                                                                               ', 1, 0, 0, 1, '1', NULL, NULL),
        (353, '99                  ', 125, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 1,00 x 1,00                                                                           ', 1, 0, 0, 1, '1', NULL, NULL),
        (354, '99                  ', 126, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 1,20 x 1,20                                                                           ', 1, 0, 0, 1, '1', NULL, NULL),
        (355, '99                  ', 133, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 35 x 15                                                                               ', 1, 0, 0, 1, '1', NULL, NULL),
        (356, '99                  ', 140, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 50 x 30                                                                               ', 1, 0, 0, 1, '1', NULL, NULL),
        (357, '99                  ', 141, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 70 x 50                                                                               ', 1, NULL, NULL, 1, '1', NULL, NULL),
        (358, '99                  ', 142, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 1,10 x 50                                                                             ', 1, 0, 0, 1, '1', NULL, NULL),
        (359, '99                  ', 143, '1       ', '1.3                 ', '1.1.3.1             ', 'Cuadro canvas 1,20 x 80                                                                             ', NULL, NULL, NULL, 1, '1', NULL, NULL)
    ) AS source (
        ProIdProducto, CodArticulo, IDProdReact, SupFlia, Grupo, CodStock, 
        Descripcion, Mostrar, anchoimprimible, LLEVAPAPEL, MonIdMoneda, 
        ProCodigoOdooProducto, UniIdUnidad, borrar
    )
    ON (target.ProIdProducto = source.ProIdProducto)
    WHEN MATCHED THEN
        UPDATE SET 
            target.CodArticulo = source.CodArticulo,
            target.IDProdReact = source.IDProdReact,
            target.SupFlia = source.SupFlia,
            target.Grupo = source.Grupo,
            target.CodStock = source.CodStock,
            target.Descripcion = source.Descripcion,
            target.Mostrar = source.Mostrar,
            target.anchoimprimible = source.anchoimprimible,
            target.LLEVAPAPEL = source.LLEVAPAPEL,
            target.MonIdMoneda = source.MonIdMoneda,
            target.ProCodigoOdooProducto = source.ProCodigoOdooProducto,
            target.UniIdUnidad = source.UniIdUnidad,
            target.borrar = source.borrar
    WHEN NOT MATCHED THEN
        INSERT (
            ProIdProducto, CodArticulo, IDProdReact, SupFlia, Grupo, CodStock, 
            Descripcion, Mostrar, anchoimprimible, LLEVAPAPEL, MonIdMoneda, 
            ProCodigoOdooProducto, UniIdUnidad, borrar
        )
        VALUES (
            source.ProIdProducto, source.CodArticulo, source.IDProdReact, source.SupFlia, source.Grupo, source.CodStock, 
            source.Descripcion, source.Mostrar, source.anchoimprimible, source.LLEVAPAPEL, source.MonIdMoneda, 
            source.ProCodigoOdooProducto, source.UniIdUnidad, source.borrar
        );

    SET IDENTITY_INSERT dbo.Articulos OFF;

    COMMIT TRAN;
    PRINT '✅ Artículos con CodArticulo = 99 restaurados correctamente.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    IF (SELECT OBJECTPROPERTY(OBJECT_ID('dbo.Articulos'), 'TableHasIdentity')) = 1
    BEGIN
        SET IDENTITY_INSERT dbo.Articulos OFF;
    END
    PRINT '❌ ERROR al restaurar artículos: ' + ERROR_MESSAGE();
END CATCH
GO
