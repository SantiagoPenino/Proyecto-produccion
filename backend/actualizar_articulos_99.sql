-- SCRIPT PARA ACTUALIZAR DESCRIPCIÓN E IDREACT DE ARTÍCULOS CON CÓDIGO '99'
-- Este script actualiza únicamente los campos Descripcion e IDProdReact en dbo.Articulos
-- para los ProIdProducto que originalmente corresponden al CodArticulo = '99' en [PARA ARTICULOS].

BEGIN TRY
    BEGIN TRAN;

    UPDATE dbo.Articulos SET Descripcion = 'Frontlight 3,20 Brillo (reverso blanco)', IDProdReact = 8 WHERE ProIdProducto = 298;
    UPDATE dbo.Articulos SET Descripcion = 'Frontlight 3,20 Mate (reverso blanco)', IDProdReact = 9 WHERE ProIdProducto = 299;
    UPDATE dbo.Articulos SET Descripcion = 'Frontlight 3,20 Brillo (reverso gris)', IDProdReact = 10 WHERE ProIdProducto = 300;
    UPDATE dbo.Articulos SET Descripcion = 'Frontlight 3,20 Mate (reverso gris)', IDProdReact = 11 WHERE ProIdProducto = 301;
    UPDATE dbo.Articulos SET Descripcion = 'Frontlight 1,60 Mate (reverso gris)', IDProdReact = 12 WHERE ProIdProducto = 302;
    UPDATE dbo.Articulos SET Descripcion = 'Frontlight 1,60 Brillo (reverso gris)', IDProdReact = 13 WHERE ProIdProducto = 303;
    UPDATE dbo.Articulos SET Descripcion = 'Frontlight 1,60 Mate (reverso blanco)', IDProdReact = 14 WHERE ProIdProducto = 304;
    UPDATE dbo.Articulos SET Descripcion = 'Frontlight 1,60 Brillo (reverso blanco)', IDProdReact = 15 WHERE ProIdProducto = 305;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo brillo 1,52 (Adhesivo Gris)', IDProdReact = 16 WHERE ProIdProducto = 306;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo brillo 1,52 (Adhesivo Transparente)', IDProdReact = 17 WHERE ProIdProducto = 307;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo mate 1,52 (Adhesivo Gris)', IDProdReact = 18 WHERE ProIdProducto = 308;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo brillo 1,37 (Adhesivo Gris)', IDProdReact = 19 WHERE ProIdProducto = 309;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo brillo 1,37 (Adhesivo Transparente)', IDProdReact = 20 WHERE ProIdProducto = 310;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo Brillo 1,37 (Adhesivo Blanco)', IDProdReact = 21 WHERE ProIdProducto = 311;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo Brillo 1,0 (Adhesivo Blanco)', IDProdReact = 22 WHERE ProIdProducto = 312;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo Vehicular (1,52)', IDProdReact = 23 WHERE ProIdProducto = 313;
    UPDATE dbo.Articulos SET Descripcion = 'Canvas 1,52', IDProdReact = 24 WHERE ProIdProducto = 314;
    UPDATE dbo.Articulos SET Descripcion = 'Canvas Brillo 1,27', IDProdReact = 25 WHERE ProIdProducto = 315;
    UPDATE dbo.Articulos SET Descripcion = 'Banner Pet semibrillo (0,91)', IDProdReact = 26 WHERE ProIdProducto = 316;
    UPDATE dbo.Articulos SET Descripcion = 'Banner Pet mate (0,91)', IDProdReact = 27 WHERE ProIdProducto = 317;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo Microperforado 1,50', IDProdReact = 66 WHERE ProIdProducto = 318;
    UPDATE dbo.Articulos SET Descripcion = 'Lona para Pasacalles 0,80', IDProdReact = 36 WHERE ProIdProducto = 319;
    UPDATE dbo.Articulos SET Descripcion = 'PET Backlight (0,91)', IDProdReact = 67 WHERE ProIdProducto = 320;
    UPDATE dbo.Articulos SET Descripcion = 'Frontlight 3,20 Brillo (Reverso Negro)', IDProdReact = 68 WHERE ProIdProducto = 321;
    UPDATE dbo.Articulos SET Descripcion = 'Frontlight 3,20 Mate (Reverso Negro)', IDProdReact = 69 WHERE ProIdProducto = 322;
    UPDATE dbo.Articulos SET Descripcion = 'Frontlight 1,60 Brillo (Reverso Negro)', IDProdReact = 70 WHERE ProIdProducto = 323;
    UPDATE dbo.Articulos SET Descripcion = 'Frontlight 1,60 Mate (Reverso Negro)', IDProdReact = 71 WHERE ProIdProducto = 324;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo Microperforado 1,52 (Reverso Negro)', IDProdReact = 72 WHERE ProIdProducto = 325;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo Microperforado 0,98 (Reverso Negro)', IDProdReact = 73 WHERE ProIdProducto = 326;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo Brillo 1,52 (Adhesivo Blanco)', IDProdReact = 74 WHERE ProIdProducto = 327;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo Mate 1,52 (Adhesivo Blanco)', IDProdReact = 75 WHERE ProIdProducto = 328;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo Vehicular 1,52 (Adhesivo Gris)', IDProdReact = 76 WHERE ProIdProducto = 329;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo brillo 1,37 (adhesivo translúcido/blanco)', IDProdReact = 77 WHERE ProIdProducto = 330;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo Brillo 0,91 (Adhesivo Blanco)', IDProdReact = 78 WHERE ProIdProducto = 331;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo Mate 0,91 (Adhesivo Blanco)', IDProdReact = 79 WHERE ProIdProducto = 332;
    UPDATE dbo.Articulos SET Descripcion = 'Canvas Mate 0,91', IDProdReact = 80 WHERE ProIdProducto = 333;
    UPDATE dbo.Articulos SET Descripcion = 'Roll up aluminio + (Banner Pet mate - 0,91)', IDProdReact = 85 WHERE ProIdProducto = 334;
    UPDATE dbo.Articulos SET Descripcion = 'Lona Backligth 1,60', IDProdReact = 88 WHERE ProIdProducto = 335;
    UPDATE dbo.Articulos SET Descripcion = 'Lona Backligth 3,20', IDProdReact = 89 WHERE ProIdProducto = 336;
    UPDATE dbo.Articulos SET Descripcion = 'Roll up aluminio + (Banner Pet mate - 0,91) ARMADO', IDProdReact = 85 WHERE ProIdProducto = 337;
    UPDATE dbo.Articulos SET Descripcion = 'Canvas Brillo 0,91', IDProdReact = 80 WHERE ProIdProducto = 338;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo Brillo 1,52(Adhesivo Gris)', IDProdReact = 16 WHERE ProIdProducto = 339;
    UPDATE dbo.Articulos SET Descripcion = 'Papel Fotográfico (0,87)', IDProdReact = 91 WHERE ProIdProducto = 340;
    UPDATE dbo.Articulos SET Descripcion = 'Vinilo brillo 1,52 (adhesivo translúcido/blanco)', IDProdReact = 96 WHERE ProIdProducto = 341;
    UPDATE dbo.Articulos SET Descripcion = 'Columnera 0,77 x 0,50 + Palo', IDProdReact = 97 WHERE ProIdProducto = 342;
    UPDATE dbo.Articulos SET Descripcion = 'Pasacalles 0,77 x 1,00 + Palo', IDProdReact = 98 WHERE ProIdProducto = 343;
    UPDATE dbo.Articulos SET Descripcion = 'Pasacalles 0,77 x 2,00 + Palo', IDProdReact = 99 WHERE ProIdProducto = 344;
    UPDATE dbo.Articulos SET Descripcion = 'Pasacalles 0,77 x 3,00 + Palo', IDProdReact = 100 WHERE ProIdProducto = 345;
    UPDATE dbo.Articulos SET Descripcion = 'Canvas Mate 1,27', IDProdReact = 24 WHERE ProIdProducto = 346;
    UPDATE dbo.Articulos SET Descripcion = 'Canvas Mate 1,52', IDProdReact = 25 WHERE ProIdProducto = 347;
    UPDATE dbo.Articulos SET Descripcion = 'Pasacalles 0,77 x 3,00', IDProdReact = 100 WHERE ProIdProducto = 348;
    UPDATE dbo.Articulos SET Descripcion = 'Cuadro canvas 25 x 25', IDProdReact = 121 WHERE ProIdProducto = 349;
    UPDATE dbo.Articulos SET Descripcion = 'Cuadro canvas 40 x 40', IDProdReact = 122 WHERE ProIdProducto = 350;
    UPDATE dbo.Articulos SET Descripcion = 'Cuadro canvas 60 x 60', IDProdReact = 123 WHERE ProIdProducto = 351;
    UPDATE dbo.Articulos SET Descripcion = 'Cuadro canvas 80 x 80', IDProdReact = 124 WHERE ProIdProducto = 352;
    UPDATE dbo.Articulos SET Descripcion = 'Cuadro canvas 1,00 x 1,00', IDProdReact = 125 WHERE ProIdProducto = 353;
    UPDATE dbo.Articulos SET Descripcion = 'Cuadro canvas 1,20 x 1,20', IDProdReact = 126 WHERE ProIdProducto = 354;
    UPDATE dbo.Articulos SET Descripcion = 'Cuadro canvas 35 x 15', IDProdReact = 133 WHERE ProIdProducto = 355;
    UPDATE dbo.Articulos SET Descripcion = 'Cuadro canvas 50 x 30', IDProdReact = 140 WHERE ProIdProducto = 356;
    UPDATE dbo.Articulos SET Descripcion = 'Cuadro canvas 70 x 50', IDProdReact = 141 WHERE ProIdProducto = 357;
    UPDATE dbo.Articulos SET Descripcion = 'Cuadro canvas 1,10 x 50', IDProdReact = 142 WHERE ProIdProducto = 358;
    UPDATE dbo.Articulos SET Descripcion = 'Cuadro canvas 1,20 x 80', IDProdReact = 143 WHERE ProIdProducto = 359;

    COMMIT TRAN;
    PRINT '✅ Descripciones e IDProdReact de artículos actualizados correctamente.';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    PRINT '❌ ERROR al actualizar artículos: ' + ERROR_MESSAGE();
END CATCH
GO
