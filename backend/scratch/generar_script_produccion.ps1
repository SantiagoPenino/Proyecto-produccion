$FUENTE  = "SecureAppDB2205"
$SERVIDOR = "."
$SALIDA  = "c:\Integracion\User-Macrosoft\Proyecto-produccion\backend\3-Script-Produccion-Autocontenido.sql"

$TABLAS = @(
    "SecuenciaDocumentos","SINCRO-ARTICULOS","ConfiguracionPrecios",
    "TesoreriaBancos","Config_TiposDocumento","Config_CuentasEgreso",
    "CondicionesPago","TiposMovimiento","Cont_PlanCuentas",
    "Cont_TiposTransaccion","Cont_EventosContables","Cont_ReglasEventos",
    "Cont_ReglasContables","Cont_ReglasAsiento","Articulos",
    "PreciosBase","PerfilesPrecios","PreciosEspeciales",
    "PreciosEspecialesItems","ConfigEstados","Modulos"
)

function Format-Value {
    param($val, $dataType)
    if ($null -eq $val -or $val -is [System.DBNull]) { return "NULL" }
    $dt = $dataType.ToUpper()
    $inv = [System.Globalization.CultureInfo]::InvariantCulture
    switch -Wildcard ($dt) {
        "INT"         { return ([int64]$val).ToString($inv) }
        "BIGINT"      { return ([int64]$val).ToString($inv) }
        "SMALLINT"    { return ([int16]$val).ToString($inv) }
        "TINYINT"     { return ([byte]$val).ToString($inv) }
        "BIT"         { $bv = if ($val) { "1" } else { "0" }; return $bv }
        "FLOAT"       { return ([double]$val).ToString("G17", $inv) }
        "REAL"        { return ([float]$val).ToString("G9", $inv) }
        "MONEY"       { return ([decimal]$val).ToString("F4", $inv) }
        "SMALLMONEY"  { return ([decimal]$val).ToString("F4", $inv) }
        "DECIMAL"     { return ([decimal]$val).ToString($inv) }
        "NUMERIC"     { return ([decimal]$val).ToString($inv) }
        "DATETIME*"   { return "'" + ([datetime]$val).ToString("yyyy-MM-dd HH:mm:ss", $inv) + "'" }
        "DATE"        { return "'" + ([datetime]$val).ToString("yyyy-MM-dd", $inv) + "'" }
        "SMALLDATETIME" { return "'" + ([datetime]$val).ToString("yyyy-MM-dd HH:mm:ss", $inv) + "'" }
        default {
            $s = $val.ToString().Replace("'", "''")
            return "'" + $s + "'"
        }
    }
}

function Get-ColInfo {
    param($tabla)
    $q = "SELECT c.COLUMN_NAME, c.DATA_TYPE, c.CHARACTER_MAXIMUM_LENGTH, c.NUMERIC_PRECISION, c.NUMERIC_SCALE, c.IS_NULLABLE, c.COLUMN_DEFAULT, CAST(sc.is_identity AS INT) AS IsIdentity FROM INFORMATION_SCHEMA.COLUMNS c JOIN sys.objects so ON so.name = c.TABLE_NAME AND so.type = 'U' JOIN sys.columns sc ON sc.object_id = so.object_id AND sc.name = c.COLUMN_NAME WHERE c.TABLE_NAME = '" + $tabla + "' ORDER BY c.ORDINAL_POSITION"
    return @(Invoke-Sqlcmd -Query $q -ServerInstance $SERVIDOR -Database $FUENTE)
}

function Get-PKCols {
    param($tabla)
    $q = "SELECT kcu.COLUMN_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu ON tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME AND tc.TABLE_NAME = kcu.TABLE_NAME WHERE tc.CONSTRAINT_TYPE = 'PRIMARY KEY' AND tc.TABLE_NAME = '" + $tabla + "' ORDER BY kcu.ORDINAL_POSITION"
    $rows = Invoke-Sqlcmd -Query $q -ServerInstance $SERVIDOR -Database $FUENTE
    return @($rows | ForEach-Object { "[" + $_.COLUMN_NAME + "]" })
}

function Build-ColDef {
    param($col)
    $name = "[" + $col.COLUMN_NAME + "]"
    $dt = $col.DATA_TYPE.ToUpper()
    $typeDef = switch ($dt) {
        "VARCHAR"  { "VARCHAR(" + $col.CHARACTER_MAXIMUM_LENGTH + ")" }
        "NVARCHAR" { if ($col.CHARACTER_MAXIMUM_LENGTH -eq -1) { "NVARCHAR(MAX)" } else { "NVARCHAR(" + $col.CHARACTER_MAXIMUM_LENGTH + ")" } }
        "CHAR"     { "CHAR(" + $col.CHARACTER_MAXIMUM_LENGTH + ")" }
        "NCHAR"    { "NCHAR(" + $col.CHARACTER_MAXIMUM_LENGTH + ")" }
        "DECIMAL"  { "DECIMAL(" + $col.NUMERIC_PRECISION + "," + $col.NUMERIC_SCALE + ")" }
        "NUMERIC"  { "NUMERIC(" + $col.NUMERIC_PRECISION + "," + $col.NUMERIC_SCALE + ")" }
        default    { $dt }
    }
    $nullable = if ($col.IS_NULLABLE -eq "YES") { "NULL" } else { "NOT NULL" }
    $identity = if ([int]($col.IsIdentity) -gt 0) { " IDENTITY(1,1)" } else { "" }
    $default  = ""
    $defVal   = if ($col.COLUMN_DEFAULT) { $col.COLUMN_DEFAULT.ToString().Trim() } else { "" }
    if ($defVal -ne "" -and [int]($col.IsIdentity) -eq 0) {
        $default = " DEFAULT " + $defVal
    }
    return "    " + $name + " " + $typeDef + $identity + $default + " " + $nullable
}

# ── Inicio ──────────────────────────────────────────────────
$out = [System.Text.StringBuilder]::new()

$null = $out.AppendLine("-- ================================================================")
$null = $out.AppendLine("-- SCRIPT AUTOCONTENIDO PARA PRODUCCION")
$null = $out.AppendLine("-- Generado: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"))
$null = $out.AppendLine("-- Fuente  : " + $FUENTE)
$null = $out.AppendLine("-- Destino : SecureAppDB (produccion)")
$null = $out.AppendLine("-- Tablas  : " + $TABLAS.Count)
$null = $out.AppendLine("-- ================================================================")
$null = $out.AppendLine("USE [SecureAppDB];")
$null = $out.AppendLine("GO")
$null = $out.AppendLine("SET NOCOUNT ON;")
$null = $out.AppendLine("SET XACT_ABORT ON;")
$null = $out.AppendLine("")
$null = $out.AppendLine("-- Deshabilitar FK constraints para permitir DROP/CREATE de tablas referenciadas")
$null = $out.AppendLine("EXEC sp_MSforeachtable 'ALTER TABLE ? NOCHECK CONSTRAINT ALL';")
$null = $out.AppendLine("GO")
$null = $out.AppendLine("")

$total = $TABLAS.Count
$idx   = 0

foreach ($tabla in $TABLAS) {
    $idx++
    Write-Host ("[$idx/$total] " + $tabla + " ...")

    $null = $out.AppendLine("-- ================================================================")
    $null = $out.AppendLine("-- [" + $idx + "/" + $total + "] " + $tabla)
    $null = $out.AppendLine("-- ================================================================")
    $null = $out.AppendLine("PRINT '>>> [" + $idx + "/" + $total + "] " + $tabla + "';")
    $null = $out.AppendLine("BEGIN TRY")
    $null = $out.AppendLine("    BEGIN TRAN;")
    $null = $out.AppendLine("")

    $cols = @(Get-ColInfo $tabla)
    if ($cols.Count -eq 0) {
        Write-Warning ("  Sin columnas: " + $tabla)
        $null = $out.AppendLine("    -- TABLA NO ENCONTRADA EN FUENTE")
        $null = $out.AppendLine("    ROLLBACK TRAN;")
        $null = $out.AppendLine("END TRY")
        $null = $out.AppendLine("BEGIN CATCH")
        $null = $out.AppendLine("    IF @@TRANCOUNT > 0 ROLLBACK TRAN;")
        $null = $out.AppendLine("    PRINT '    ERROR " + $tabla + ": ' + ERROR_MESSAGE();")
        $null = $out.AppendLine("END CATCH")
        $null = $out.AppendLine("GO")
        $null = $out.AppendLine("")
        continue
    }

    $identityCols = $cols | Where-Object { [int]($_.IsIdentity) -gt 0 }
    $hasIdentity   = @($identityCols).Count -gt 0
    # Debug: show first col's IsIdentity raw value
    $dbg = $cols[0].IsIdentity
    Write-Host ("  [DBG] " + $tabla + " cols=" + $cols.Count + " firstIsIdentity='" + $dbg + "' type=" + $dbg.GetType().Name + " hasIdentity=" + $hasIdentity)
    $pkCols      = Get-PKCols $tabla

    # Tablas que tienen FK externas entrantes - no se pueden dropear, usar DELETE+INSERT
    $TABLAS_FK = @('Articulos', 'Modulos')
    $usarDelete = $TABLAS_FK -contains $tabla

    if ($usarDelete) {
        # Para tablas referenciadas por FK: DELETE + RESEED + INSERT
        $null = $out.AppendLine("    -- Tabla con FK entrantes: DELETE + INSERT (no DROP)")
        $null = $out.AppendLine("    DELETE FROM [dbo].[$tabla];")
        if ($hasIdentity) {
            $null = $out.AppendLine("    DBCC CHECKIDENT ('[dbo].[$tabla]', RESEED, 0) WITH NO_INFOMSGS;")
        }
    } else {
        # DROP + CREATE TABLE normal
        $null = $out.AppendLine("    IF OBJECT_ID('dbo.[$tabla]', 'U') IS NOT NULL")
        $null = $out.AppendLine("        DROP TABLE [dbo].[$tabla];")
        $null = $out.AppendLine("")

        $null = $out.AppendLine("    CREATE TABLE [dbo].[$tabla] (")
        $colDefs = @()
        foreach ($col in $cols) { $colDefs += Build-ColDef $col }
        if ($pkCols.Count -gt 0) {
            $pkList     = $pkCols -join ", "
            $safeNombre = ($tabla -replace "-","_")
            $colDefs += "    CONSTRAINT [PK_$safeNombre] PRIMARY KEY CLUSTERED ($pkList)"
        }
        $null = $out.AppendLine(($colDefs -join ",`r`n"))
        $null = $out.AppendLine("    );")
    }
    $null = $out.AppendLine("")

    # Datos
    try {
        $data = Invoke-Sqlcmd -Query ("SELECT * FROM [dbo].[" + $tabla + "] WITH(NOLOCK)") -ServerInstance $SERVIDOR -Database $FUENTE
    } catch {
        Write-Warning ("  Error datos " + $tabla + ": " + $_)
        $data = @()
    }

    $rowCount = if ($data) { @($data).Count } else { 0 }
    $null = $out.AppendLine("    -- INSERT (" + $rowCount + " filas)")

    if ($rowCount -gt 0) {
        if ($hasIdentity) {
            $null = $out.AppendLine("    SET IDENTITY_INSERT [dbo].[" + $tabla + "] ON;")
        }

        $colNames = "[" + (($cols | ForEach-Object { $_.COLUMN_NAME }) -join "], [") + "]"
        $batch    = [System.Collections.Generic.List[string]]::new()

        foreach ($row in $data) {
            $vals = @()
            foreach ($col in $cols) {
                $vals += Format-Value $row.($col.COLUMN_NAME) $col.DATA_TYPE
            }
            $batch.Add("        (" + ($vals -join ", ") + ")")

            if ($batch.Count -ge 500) {
                $null = $out.AppendLine("    INSERT INTO [dbo].[" + $tabla + "] (" + $colNames + ") VALUES")
                $null = $out.AppendLine(($batch -join ",`r`n") + ";")
                $batch.Clear()
            }
        }

        if ($batch.Count -gt 0) {
            $null = $out.AppendLine("    INSERT INTO [dbo].[" + $tabla + "] (" + $colNames + ") VALUES")
            $null = $out.AppendLine(($batch -join ",`r`n") + ";")
        }

        if ($hasIdentity) {
            $null = $out.AppendLine("    SET IDENTITY_INSERT [dbo].[" + $tabla + "] OFF;")
        }
    }

    $null = $out.AppendLine("")
    $null = $out.AppendLine("    COMMIT TRAN;")
    $null = $out.AppendLine("    PRINT '    OK " + $tabla + " (" + $rowCount + " filas)';")
    $null = $out.AppendLine("END TRY")
    $null = $out.AppendLine("BEGIN CATCH")
    $null = $out.AppendLine("    IF @@TRANCOUNT > 0 ROLLBACK TRAN;")
    if ($hasIdentity) {
        $null = $out.AppendLine("    SET IDENTITY_INSERT [dbo].[" + $tabla + "] OFF;")
    }
    $null = $out.AppendLine("    PRINT '    ERROR " + $tabla + ": ' + ERROR_MESSAGE();")
    $null = $out.AppendLine("END CATCH")
    $null = $out.AppendLine("GO")
    $null = $out.AppendLine("")
}

$null = $out.AppendLine("-- Rehabilitar FK constraints")
$null = $out.AppendLine("EXEC sp_MSforeachtable 'ALTER TABLE ? WITH CHECK CHECK CONSTRAINT ALL';")
$null = $out.AppendLine("GO")
$null = $out.AppendLine("")
$null = $out.AppendLine("-- ================================================================")
$null = $out.AppendLine("PRINT '================================================================';")
$null = $out.AppendLine("PRINT ' SCRIPT COMPLETADO';")
$null = $out.AppendLine("PRINT ' Tablas: " + $total + "';")
$null = $out.AppendLine("PRINT '================================================================';")
$null = $out.AppendLine("GO")

[System.IO.File]::WriteAllText($SALIDA, $out.ToString(), [System.Text.Encoding]::UTF8)

Write-Host ""
Write-Host "=========================================="
Write-Host " Script generado:"
Write-Host " $SALIDA"
$tamano = [System.IO.FileInfo]::new($SALIDA).Length
Write-Host (" Tamanio: " + [Math]::Round($tamano/1KB, 1) + " KB")
Write-Host "=========================================="
