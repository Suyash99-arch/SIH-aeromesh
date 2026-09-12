import os
from pathlib import Path
import numpy as np
import open3d as o3d
import pycolmap
import json

MISSIONS_DIR = Path("data/missions")

def optimize_mission_3d(m_dir_or_id):
    if isinstance(m_dir_or_id, Path):
        m_base = m_dir_or_id
        mission_id = m_base.name
    else:
        mission_id = m_dir_or_id
        m_base = MISSIONS_DIR / mission_id

    m_dir = m_base / "reconstruction"
    if not m_dir.exists():
        return False

    model_dir = m_dir / "model" / "0"
    if not model_dir.exists():
        model_dir = m_dir / "model"
    if not (model_dir / "points3D.bin").exists() and not (model_dir / "points3D.txt").exists():
        return False

    print(f"\n==========================================")
    print(f"Optimizing 3D Reconstruction: {mission_id}")
    print(f"==========================================")

    try:
        rec = pycolmap.Reconstruction(str(model_dir))
        pts = np.array([p.xyz for p in rec.points3D.values()])
        cols = np.array([p.color / 255.0 for p in rec.points3D.values()])
    except Exception as e:
        print(f"Failed to load PyCOLMAP reconstruction for {mission_id}: {e}")
        return False

    if len(pts) < 15:
        print(f"Too few points: {len(pts)}")
        return False

    print(f"Input SfM points: {len(pts):,}")

    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(pts)
    pcd.colors = o3d.utility.Vector3dVector(cols)

    # 1. Statistical outlier filtering
    pcd_clean, _ = pcd.remove_statistical_outlier(nb_neighbors=min(30, max(5, len(pts)-1)), std_ratio=1.6)
    pts_clean = np.asarray(pcd_clean.points)
    cols_clean = np.asarray(pcd_clean.colors)

    # 2. Camera centers
    cams = [img.projection_center() for img in rec.images.values()]
    cam_mean = np.mean(cams, axis=0) if len(cams) > 0 else np.mean(pts_clean, axis=0) + np.array([0.0, -10.0, 0.0])

    # 3. Adaptive normal estimation oriented towards camera sightlines
    dists_nn = pcd_clean.compute_nearest_neighbor_distance()
    avg_d = float(np.mean(dists_nn)) if len(dists_nn) > 0 else 0.8
    search_radius = max(avg_d * 3.0, 1.2)

    pcd_clean.estimate_normals(search_param=o3d.geometry.KDTreeSearchParamHybrid(radius=search_radius, max_nn=45))
    pcd_clean.orient_normals_towards_camera_location(camera_location=cam_mean)

    # Export high-density point cloud
    point_cloud_ply = m_dir / "point_cloud.ply"
    o3d.io.write_point_cloud(str(point_cloud_ply), pcd_clean, write_ascii=False)
    if (m_dir / "model" / "point_cloud.ply").parent.exists():
        o3d.io.write_point_cloud(str(m_dir / "model" / "point_cloud.ply"), pcd_clean, write_ascii=False)

    # 4. Multi-scale Poisson surface reconstruction with adaptive depth
    poisson_depth = 10 if len(pts) >= 1500 else 9
    mesh, densities = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(pcd_clean, depth=poisson_depth, linear_fit=True)
    d = np.asarray(densities)

    # 5. Distance and density trimming
    kdtree = o3d.geometry.KDTreeFlann(pcd_clean)
    verts = np.asarray(mesh.vertices)
    max_dist = max(avg_d * 3.2, 2.5)

    keep_dist = []
    for v in verts:
        _, idx, d2 = kdtree.search_knn_vector_3d(v, 1)
        keep_dist.append(np.sqrt(d2[0]) <= max_dist)
    keep_dist = np.array(keep_dist)
    density_thresh = np.percentile(d, 8) if len(d) > 0 else 0.0
    keep_mask = keep_dist & (d > density_thresh)

    mesh.remove_vertices_by_mask(~keep_mask)
    mesh.remove_degenerate_triangles()
    mesh.remove_duplicated_triangles()
    mesh.remove_duplicated_vertices()
    mesh.remove_non_manifold_edges()

    # 6. Connected component filtering
    triangle_clusters, num_triangles, _ = mesh.cluster_connected_triangles()
    triangle_clusters = np.asarray(triangle_clusters)
    num_triangles = np.asarray(num_triangles)

    if len(num_triangles) > 0:
        min_cluster_size = max(40, int(len(mesh.triangles) * 0.008))
        valid_clusters = np.where(num_triangles >= min_cluster_size)[0]
        if len(valid_clusters) == 0:
            valid_clusters = [np.argmax(num_triangles)]
        mesh.remove_triangles_by_mask(~np.isin(triangle_clusters, valid_clusters))
        mesh.remove_unreferenced_vertices()

    # 7. Photogrammetric vertex color assignment & feature-preserving smoothing
    v_final = np.asarray(mesh.vertices)
    v_cols = []
    for v in v_final:
        _, idx, _ = kdtree.search_knn_vector_3d(v, 1)
        v_cols.append(cols_clean[idx[0]])
    mesh.vertex_colors = o3d.utility.Vector3dVector(np.array(v_cols))

    # Taubin smoothing: eliminates sensor noise without shrinking volumes or destroying sharp roof/wall edges
    if len(mesh.vertices) > 200:
        mesh = mesh.filter_smooth_taubin(number_of_iterations=3)

    mesh.compute_vertex_normals()
    mesh.compute_triangle_normals()

    # 8. Save final Float32 PLY mesh
    mesh_ply = m_dir / "mesh.ply"
    o3d.io.write_triangle_mesh(str(mesh_ply), mesh, write_vertex_colors=True)
    if (m_dir / "model" / "mesh.ply").parent.exists():
        o3d.io.write_triangle_mesh(str(m_dir / "model" / "mesh.ply"), mesh, write_vertex_colors=True)

    print(f"[OK] {mission_id} Surface Mesh: {len(mesh.vertices):,} vertices, {len(mesh.triangles):,} faces")

    # 9. Update metadata JSON if exists
    meta_json = m_dir / "reconstruction_metadata.json"
    if meta_json.exists():
        try:
            with open(meta_json, "r") as f:
                meta = json.load(f)
            meta["mesh_vertex_count"] = len(mesh.vertices)
            meta["mesh_face_count"] = len(mesh.triangles)
            meta["vertex_count"] = len(mesh.vertices)
            meta["face_count"] = len(mesh.triangles)
            meta["sparse_point_count"] = len(pts)
            meta["status"] = "AVAILABLE"
            meta["mesh_status"] = "AVAILABLE"
            with open(meta_json, "w") as f:
                json.dump(meta, f, indent=2)
            print("[OK] Metadata JSON updated")
        except Exception as e:
            print("Metadata update notice:", e)
    return True

def main():
    # 1. First process core named missions
    core_missions = ["north-ridge", "downtown-grid", "harbor-district", "river-approach"]
    for m in core_missions:
        try:
            optimize_mission_3d(m)
        except Exception as e:
            print(f"Error optimizing {m}: {e}")

    # 2. Process all other mission subfolders
    for item in MISSIONS_DIR.iterdir():
        if item.is_dir() and item.name not in core_missions:
            try:
                optimize_mission_3d(item)
            except Exception as e:
                print(f"Error optimizing {item.name}: {e}")

if __name__ == "__main__":
    main()


