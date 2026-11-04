#!/usr/bin/env sh
# Optional: download the on-device ML models for offline use.  sh tools/fetch-models.sh
set -e
cd "$(dirname "$0")/.." && mkdir -p models
curl -L -o models/efficientnet_lite0.tflite https://storage.googleapis.com/mediapipe-models/image_classifier/efficientnet_lite0/float32/1/efficientnet_lite0.tflite
curl -L -o models/efficientdet_lite0.tflite https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite
echo "Done."
