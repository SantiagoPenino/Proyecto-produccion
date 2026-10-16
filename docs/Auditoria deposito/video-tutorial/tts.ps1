# Genera un WAV por escena del guion con la voz Sabina (es-MX) y escribe duraciones.json
$dir = $PSScriptRoot
New-Item -ItemType Directory -Force "$dir\audio" | Out-Null
Add-Type -AssemblyName System.Speech
$guion = Get-Content "$dir\guion.json" -Raw -Encoding UTF8 | ConvertFrom-Json
$dur = @{}
foreach ($e in $guion) {
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice('Microsoft Sabina Desktop')
  $synth.Rate = 0
  $out = "$dir\audio\$($e.id).wav"
  $synth.SetOutputToWaveFile($out)
  $synth.Speak($e.voz)
  $synth.Dispose()
  $f = Get-Item $out
  $fs = [System.IO.File]::OpenRead($f.FullName); $b = New-Object byte[] 44; $null = $fs.Read($b, 0, 44); $fs.Close()
  $bps = [BitConverter]::ToInt32($b, 28)
  $seg = [math]::Round((($f.Length - 44) / $bps), 2)
  $dur[$e.id] = $seg
  "{0}: {1} s" -f $e.id, $seg
}
($dur | ConvertTo-Json) | Out-File "$dir\audio\duraciones.json" -Encoding utf8
"TOTAL: {0} s" -f (($dur.Values | Measure-Object -Sum).Sum)
