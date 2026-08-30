# AeroMesh ML workspace

The shipped detector is **YOLO11n pretrained on COCO / Microsoft COCO** and is run locally by `SinglePass3D/backend/inference.py`. It is not aerial-specific and has not been fine-tuned.

`configs/detection.yaml` is the contract for an optional future, licensed aerial dataset. Training and validation must only be run after real labelled train/validation data is placed beneath `ml/datasets`; no validation metric should be reported otherwise.
