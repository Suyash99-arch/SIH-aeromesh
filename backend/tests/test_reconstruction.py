import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch
import numpy as np
import pytest

from backend.reconstruction import (
    assess_frame_quality,
    extract_frames_with_quality,
    run_reconstruction_pipeline,
    get_reconstruction_pointcloud_path,
    get_reconstruction_mesh_path,
    ScaleStatus,
    ReconstructionStatus,
)


def create_test_frame(pattern="checkerboard", brightness=128):
    """Create a synthetic 100x100 frame with predictable visual properties."""
    img = np.full((100, 100, 3), brightness, dtype=np.uint8)
    if pattern == "checkerboard":
        img[::10, :] = 0
        img[:, ::10] = 0
        img[5::10, 5::10] = 255
    elif pattern == "blank":
        pass  # Solid color, zero corners
    elif pattern == "blurred":
        import cv2
        img[::10, :] = 0
        img[:, ::10] = 0
        img = cv2.GaussianBlur(img, (25, 25), 0)
    return img


def test_frame_quality_filtering_detects_blur_and_exposure():
    # Good frame
    good = create_test_frame("checkerboard", 128)
    q_good = assess_frame_quality(good)
    assert q_good["accepted"] is True
    assert q_good["sharpness"] > 10.0
    assert 20.0 <= q_good["brightness"] <= 85.0
    assert q_good["feature_count"] > 20

    # Blurred frame
    blurred = create_test_frame("blurred", 128)
    q_blur = assess_frame_quality(blurred, min_sharpness=50.0)
    assert q_blur["accepted"] is False
    assert "low_sharpness" in q_blur["rejection_reasons"]

    # Low exposure frame (pitch black)
    dark = create_test_frame("checkerboard", 5)
    q_dark = assess_frame_quality(dark, min_brightness=20.0)
    assert q_dark["accepted"] is False
    assert "under_exposed" in q_dark["rejection_reasons"]

    # Overexposed frame (washed out white)
    bright = np.full((100, 100, 3), 245, dtype=np.uint8)
    q_bright = assess_frame_quality(bright, max_brightness=85.0)
    assert q_bright["accepted"] is False
    assert "over_exposed" in q_bright["rejection_reasons"]

    # Featureless frame
    blank = create_test_frame("blank", 128)
    q_blank = assess_frame_quality(blank, min_features=10)
    assert q_blank["accepted"] is False
    assert "insufficient_features" in q_blank["rejection_reasons"]


def test_frame_overlap_and_duplicate_filtering(tmp_path):
    # Simulate extraction with identical consecutive frames
    frame1 = create_test_frame("checkerboard", 128)
    frame2 = frame1.copy()  # duplicate
    frame3 = create_test_frame("checkerboard", 140)  # different enough

    from backend.reconstruction import is_near_duplicate
    assert is_near_duplicate(frame1, frame2, diff_threshold=2.0) is True
    assert is_near_duplicate(frame1, frame3, diff_threshold=2.0) is False


def test_monocular_scale_reports_relative_scale():
    from backend.reconstruction import evaluate_scale_and_georeference
    metadata = evaluate_scale_and_georeference(has_gps=False, has_rtk=False, has_gcps=False)
    assert metadata["scale_status"] == ScaleStatus.RELATIVE_SCALE.value
    assert metadata["georeferencing_status"] == "UNREFERENCED"
    assert metadata["coordinate_system"] == "LOCAL_ARBITRARY"
    assert metadata["scale_method"] == "MONOCULAR_SFM_ESTIMATED"
    assert "meters" not in metadata["coordinate_system"].lower()


def test_reconstruction_pipeline_mocked_success(tmp_path):
    # Mock pycolmap incremental_mapping and export
    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()
    for i in range(5):
        (frames_dir / f"frame_{i:04d}.jpg").write_bytes(b"dummy")

    output_dir = tmp_path / "recon"
    output_dir.mkdir()

    mock_recon = MagicMock()
    mock_recon.num_reg_images = lambda: 5
    mock_recon.num_points3D = lambda: 1250
    mock_recon.compute_mean_reprojection_error = lambda: 0.85
    mock_recon.compute_mean_track_length = lambda: 4.2

    # Fake export_PLY that creates an actual PLY file
    def fake_export_ply(path):
        Path(path).write_text("ply\nformat ascii 1.0\nelement vertex 1250\nend_header\n")
    mock_recon.export_PLY = fake_export_ply

    with patch("backend.reconstruction.has_pycolmap", True), \
         patch("backend.reconstruction.pycolmap.extract_features") as mock_extract, \
         patch("backend.reconstruction.pycolmap.match_sequential") as mock_match, \
         patch("backend.reconstruction.pycolmap.incremental_mapping", return_value={0: mock_recon}), \
         patch("backend.reconstruction.pycolmap.poisson_meshing", side_effect=Exception("CPU no normals")):

        result = run_reconstruction_pipeline(
            mission_id="test-recon-1",
            frames_dir=frames_dir,
            output_dir=output_dir,
            max_frames=5,
        )

        assert result["success"] is True
        assert result["status"] == ReconstructionStatus.SPARSE_RECONSTRUCTED.value
        assert result["sparse_point_count"] == 1250
        assert result["registered_cameras"] == 5
        assert result["mean_reprojection_error"] == 0.85
        assert result["scale"]["scale_status"] == ScaleStatus.RELATIVE_SCALE.value
        assert Path(result["point_cloud_path"]).exists()


def test_reconstruction_pipeline_failure_when_sfm_yields_no_points(tmp_path):
    frames_dir = tmp_path / "frames"
    frames_dir.mkdir()
    for i in range(5):
        (frames_dir / f"frame_{i:04d}.jpg").write_bytes(b"dummy")

    output_dir = tmp_path / "recon"
    output_dir.mkdir()

    with patch("backend.reconstruction.has_pycolmap", True), \
         patch("backend.reconstruction.pycolmap.extract_features"), \
         patch("backend.reconstruction.pycolmap.match_sequential"), \
         patch("backend.reconstruction.pycolmap.incremental_mapping", return_value={}):

        result = run_reconstruction_pipeline(
            mission_id="test-recon-fail",
            frames_dir=frames_dir,
            output_dir=output_dir,
            max_frames=5,
        )

        assert result["success"] is False
        assert result["status"] == ReconstructionStatus.FAILED.value
        assert result["sparse_point_count"] == 0
        assert "could not reconstruct" in result["error"].lower()


def test_reconstruction_pointcloud_and_mesh_path_resolvers(tmp_path, monkeypatch):
    import backend.reconstruction as recon_mod
    monkeypatch.setattr(recon_mod, "MISSIONS_DIR", tmp_path)

    mission_dir = tmp_path / "m1" / "reconstruction"
    mission_dir.mkdir(parents=True)
    ply_file = mission_dir / "point_cloud.ply"
    ply_file.write_text("ply...")

    assert get_reconstruction_pointcloud_path("m1") == ply_file
    assert get_reconstruction_mesh_path("m1") is None

    mesh_file = mission_dir / "mesh.ply"
    mesh_file.write_text("ply...")
    assert get_reconstruction_mesh_path("m1") == mesh_file


def test_compute_mesh_bounding_box(tmp_path):
    import struct
    from backend.reconstruction import _compute_mesh_bounding_box
    mesh_path = tmp_path / "test_mesh.ply"
    header = (
        "ply\nformat binary_little_endian 1.0\nelement vertex 2\n"
        "property float x\nproperty float y\nproperty float z\n"
        "property float value\nproperty uchar red\nproperty uchar green\nproperty uchar blue\n"
        "element face 0\nproperty list int int vertex_indices\nend_header\n"
    ).encode("latin1")
    v1 = struct.pack("<ffffBBB", 1.0, 2.0, 3.0, 0.5, 255, 0, 0)
    v2 = struct.pack("<ffffBBB", 4.0, 6.0, 8.0, 0.8, 0, 255, 0)
    mesh_path.write_bytes(header + v1 + v2)

    bbox = _compute_mesh_bounding_box(mesh_path)
    assert bbox is not None
    assert bbox["min"] == [1.0, 2.0, 3.0]
    assert bbox["max"] == [4.0, 6.0, 8.0]
    assert bbox["dimensions"] == [3.0, 4.0, 5.0]
