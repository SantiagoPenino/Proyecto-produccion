USE [SecureAppDB];
GO

DELETE FROM [MetodosPagos];


INSERT INTO [MetodosPagos] (MPaIdMetodoPago, MPaDescripcionMetodo, MPaActivo) VALUES (1, 'Efectivo', 1);
INSERT INTO [MetodosPagos] (MPaIdMetodoPago, MPaDescripcionMetodo, MPaActivo) VALUES (4, 'Tarjeta de Crédito', 1);
INSERT INTO [MetodosPagos] (MPaIdMetodoPago, MPaDescripcionMetodo, MPaActivo) VALUES (3, 'Tarjeta de Débito', 1);
INSERT INTO [MetodosPagos] (MPaIdMetodoPago, MPaDescripcionMetodo, MPaActivo) VALUES (8, 'Descuento de sueldo', 1);
INSERT INTO [MetodosPagos] (MPaIdMetodoPago, MPaDescripcionMetodo, MPaActivo) VALUES (5, 'Mercado pago', 1);
INSERT INTO [MetodosPagos] (MPaIdMetodoPago, MPaDescripcionMetodo, MPaActivo) VALUES (9, 'Pago en Linea Handy', 1);
INSERT INTO [MetodosPagos] (MPaIdMetodoPago, MPaDescripcionMetodo, MPaActivo) VALUES (7, 'Rollo por adelantado', 1);
INSERT INTO [MetodosPagos] (MPaIdMetodoPago, MPaDescripcionMetodo, MPaActivo) VALUES (6, 'Take (BROU)', 1);
INSERT INTO [MetodosPagos] (MPaIdMetodoPago, MPaDescripcionMetodo, MPaActivo) VALUES (2, 'Transferencia BROU', 1);
INSERT INTO [MetodosPagos] (MPaIdMetodoPago, MPaDescripcionMetodo, MPaActivo) VALUES (10, 'Transferencia Santander', 1);
INSERT INTO [MetodosPagos] (MPaIdMetodoPago, MPaDescripcionMetodo, MPaActivo) VALUES (11, 'Cheques', 1);


PRINT '¡Métodos de pago importados correctamente!';
