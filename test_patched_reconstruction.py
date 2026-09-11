from pathlib import Path
from backend.reconstruction import run_reconstruction_pipeline

frames = Path(r".\SinglePass3D\input\f935bfe4\frames")
output = Path(r".\SinglePass3D\input\f935bfe4\colmap_test_patched")

result = run_reconstruction_pipeline(
    mission_id="f935bfe4",
    frames_dir=frames,
    output_dir=output,
    max_frames=40,
)

print("\n=== RECONSTRUCTION RESULT ===")
print("Success:", result.get("success"))
print("Status:", result.get("status"))
print("Registered cameras:", result.get("registered_cameras"))
print("Total images:", result.get("total_images"))
print("Sparse points:", result.get("sparse_point_count"))
print("Reprojection error:", result.get("mean_reprojection_error"))
print("Error:", result.get("error"))
