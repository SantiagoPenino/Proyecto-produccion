$FUENTE   = "SecureAppDB2205"
$SERVIDOR = "."

$q = "SELECT c.COLUMN_NAME, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH, c.NUMERIC_PRECISION, c.NUMERIC_SCALE, c.IS_NULLABLE, c.COLUMN_DEFAULT, CAST(sc.is_identity AS INT) AS IsIdentity FROM INFORMATION_SCHEMA.COLUMNS c JOIN sys.objects so ON so.name = c.TABLE_NAME AND so.type = 'U' JOIN sys.columns sc ON sc.object_id = so.object_id AND sc.name = c.COLUMN_NAME WHERE c.TABLE_NAME = 'SecuenciaDocumentos' ORDER BY c.ORDINAL_POSITION"

$cols = Invoke-Sqlcmd -Query $q -ServerInstance $SERVIDOR -Database $FUENTE

Write-Host "Tipo de cols: $($cols.GetType().Name)"
Write-Host "Count: $(@($cols).Count)"

$colArr = @($cols)
Write-Host "colArr[0].IsIdentity = $($colArr[0].IsIdentity) tipo=$($colArr[0].IsIdentity.GetType().Name)"

# Simular el Where-Object
$identities = $colArr | Where-Object { [int]($_.IsIdentity) -gt 0 }
Write-Host "identities count: $(@($identities).Count)"

$hasIdentity = (@($identities)).Count -gt 0
Write-Host "hasIdentity: $hasIdentity"
