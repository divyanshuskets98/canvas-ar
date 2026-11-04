# Optional: download the two on-device ML models so the app works fully offline.
# Run from the "Canvas AR" folder:  powershell -ExecutionPolicy Bypass -File tools\fetch-models.ps1
$ErrorActionPreference = "Stop"
$dir = Join-Path $PSScriptRoot "..\models"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$models = @{
  "efficientnet_lite0.tflite" = "https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite";
  "efficientdet_lite0.tflite" = "https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite"
}
foreach ($m in $models.GetEnumerator()) {
  Write-Host "Downloading $($m.Key)..."
  Invoke-WebRequest -Uri $m.Value -OutFile (Join-Path $dir $m.Key)
}
Write-Host "Done. Models saved to $dir"
