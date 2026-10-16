/*
  add_DocCliNombreFantasia.sql
  ---------------------------------------------------------------------------
  Nombre de fantasía DEL COMPROBANTE (snapshot por documento).

  Problema que resuelve:
    El PDF imprimía "NOMBRE FANTASÍA: <alias de la ficha del cliente>"
    (Clientes.IDCliente). Al facturar a un TERCERO —se cambian Nombre/RUT/
    Dirección/Ciudad en el panel DGI— igual salía el alias del titular de la
    cuenta, filtrando el nombre de otro cliente en la factura del tercero.

  Con esta columna, la fantasía se congela en el documento igual que
  DocCliNombre/DocCliDocumento/DocCliDireccion/DocCliCiudad:
    - vacía  => el PDF NO dibuja la línea de fantasía
    - cargada => se imprime exactamente eso, sin tocar la ficha del cliente

  No afecta al CFE: DGI recibe razón social + RUT (rznSocRecep), no la fantasía.
  Idempotente: se puede correr más de una vez.
*/

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.DocumentosContables')
      AND name = 'DocCliNombreFantasia'
)
BEGIN
    ALTER TABLE dbo.DocumentosContables
        ADD DocCliNombreFantasia NVARCHAR(200) NULL;
    PRINT 'OK: columna DocCliNombreFantasia agregada a dbo.DocumentosContables.';
END
ELSE
BEGIN
    PRINT 'SIN CAMBIOS: dbo.DocumentosContables.DocCliNombreFantasia ya existía.';
END
GO

-- Verificación
SELECT name, system_type_name = TYPE_NAME(user_type_id), max_length, is_nullable
FROM sys.columns
WHERE object_id = OBJECT_ID('dbo.DocumentosContables')
  AND name IN ('DocCliNombre','DocCliDocumento','DocCliDireccion','DocCliCiudad','DocCliNombreFantasia');
GO

/*
  Documentos históricos: quedan con NULL => no imprimen línea de fantasía.
  NO se hace backfill con el alias del cliente a propósito: ese dato era
  justamente el que estaba mal en las facturas a terceros.
*/
