Optional model files. If efficientnet_lite0.tflite and efficientdet_lite0.tflite are placed here
(run tools/fetch-models.ps1 on Windows or tools/fetch-models.sh), the app loads them locally.
Then set localModels: true in js/config.js. Otherwise it downloads them from Google's MediaPipe model storage on first scan, and if that
fails it falls back to pixel-level scene analysis only.
