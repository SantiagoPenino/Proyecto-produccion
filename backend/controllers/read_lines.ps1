$f = 'C:\Users\Santiago\Desktop\proyecto\Proyecto-produccion\backend\controllers\logisticsController.js'
$lines = [System.IO.File]::ReadAllLines($f)
$start = 1330
$end = 1450
for ($i = $start; $i -le $end; $i++) {
    Write-Output ($i.ToString() + ': ' + $lines[$i-1])
}
