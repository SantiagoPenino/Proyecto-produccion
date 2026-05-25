$r = Invoke-Sqlcmd -Query "SELECT c.COLUMN_NAME, CAST(sc.is_identity AS INT) AS IsIdentity FROM INFORMATION_SCHEMA.COLUMNS c JOIN sys.objects so ON so.name = c.TABLE_NAME AND so.type = 'U' JOIN sys.columns sc ON sc.object_id = so.object_id AND sc.name = c.COLUMN_NAME WHERE c.TABLE_NAME = 'SecuenciaDocumentos' ORDER BY c.ORDINAL_POSITION" -ServerInstance "." -Database "SecureAppDB2205"
$first = $r[0]
Write-Host ("COLUMN_NAME: " + $first.COLUMN_NAME)
Write-Host ("IsIdentity value: " + $first.IsIdentity)
Write-Host ("IsIdentity type: " + $first.IsIdentity.GetType().FullName)
Write-Host ("cast int: " + [int]($first.IsIdentity))
Write-Host ("gt 0: " + ([int]($first.IsIdentity) -gt 0))
Write-Host ""
Write-Host "All rows:"
$r | ForEach-Object { Write-Host ($_.COLUMN_NAME + " -> " + $_.IsIdentity + " [" + $_.IsIdentity.GetType().Name + "]") }
