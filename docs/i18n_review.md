# i18n Translation & Terminology Review

This document logs translation decisions and terminology pairings between English and Hindi across the AEROMESH platform.

## Standardized Terminology Pairs

| Domain / Term | English Source | Hindi Translation | Technical Rationale |
|---|---|---|---|
| Platform Brand | AEROMESH | AEROMESH | Retained as proper noun / brand name |
| Architecture | Single-Pass Drone Aerial Reconstruction | सिंगल-पास ड्रोन एरियल पुनर्निर्माण | Direct technical equivalent; "पुनर्निर्माण" is standard photogrammetric reconstruction |
| Spatial AI | AI-to-3D Spatial Intelligence | AI-से-3D स्थानिक इंटेलिजेंस | Retained AI & 3D as global technical abbreviations; "स्थानिक" is exact Hindi for spatial |
| Photogrammetry | Structure-from-Motion (COLMAP Point Cloud) | स्ट्रक्चर-फ्रॉम-मोशन (COLMAP पॉइंट क्लाउड) | COLMAP is proper name; "स्ट्रक्चर-फ्रॉम-मोशन" transliteration preserves CV literature parity |
| Surface Mesh | Dense Surface Reconstruction & Poisson Meshing | सघन सतह पुनर्निर्माण एवं प्वासों मेशिंग | Poisson surface reconstruction mathematically denoted; "सघन" for dense |
| Detections | YOLO Aerial Object Detection & SAHI Tiling | YOLO एरियल ऑब्जेक्ट डिटेक्शन एवं SAHI टाइलिंग | YOLO and SAHI retained as established AI model/framework acronyms |
| Keyframes | Keyframe Extraction & Camera Calibration | कीफ्रेम निष्कर्षण एवं कैमरा अंशांकन | "निष्कर्षण" for extraction; "अंशांकन" for camera calibration |
| Multi-view Fusion | 3D AI-to-Mesh Spatial Fusion & Ray Casting | 3D AI-से-मेश स्थानिक संलयन एवं रे कास्टिंग | "स्थानिक संलयन" is exact scientific Hindi for spatial fusion |
| Reprojection Error | Mean Reprojection Error | पुनर्प्रक्षेपण त्रुटि (Reprojection Error) | Exact photogrammetry term; retained parenthetical for military/scientific operators |
| Invariants | Unique Tracks | अद्वितीय स्थानिक ट्रैक्स (Unique Tracks) | Mathematical terminology for distinct tracked identifiers |
| Units & Metrics | Meters, Kilometers, Pixels, FPS | m, km, px, FPS | Standard SI and display unit notations preserved internationally |

## Review & Clarification Notes
- Technical model class names (`van`, `truck`, `bus`, `pedestrian`, `tricycle`, `awning-tricycle`) are defined by `aeromesh_yolo.pt` model weights. In classification tables and raw telemetry, the Latin class names are retained to maintain deterministic parity with YOLO output tokens.
- Acronyms such as `GPS`, `CPU`, `GPU`, `RAM`, `CUDA`, `UUID`, `PDF`, `CSV`, `JSON`, `GeoJSON`, `LAS`, `PLY`, `OBJ`, `GLB` are preserved as uppercase Latin tokens per ISO/NATO conventions and will not trigger i18n audit failures.
