"""Add 3D spatial fusion fields to tracks and detections."""

from alembic import op
import sqlalchemy as sa


revision = "0004_spatial_fusion_3d_fields"
down_revision = "0003_detection_tracking_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    detection_columns = {column["name"] for column in inspector.get_columns("detections")}
    track_columns = {column["name"] for column in inspector.get_columns("tracks")}

    for name, column in {
        "camera_image_id": sa.Column("camera_image_id", sa.Integer()),
        "reprojection_error": sa.Column("reprojection_error", sa.Float()),
    }.items():
        if name not in detection_columns:
            op.add_column("detections", column)

    for name, column in {
        "position_3d": sa.Column("position_3d", sa.JSON()),
        "coordinate_system": sa.Column("coordinate_system", sa.String(length=80), server_default="LOCAL_ARBITRARY"),
        "association_status": sa.Column("association_status", sa.String(length=50), server_default="INSUFFICIENT_EVIDENCE"),
        "association_confidence": sa.Column("association_confidence", sa.Float()),
        "reprojection_error": sa.Column("reprojection_error", sa.Float()),
        "motion_state": sa.Column("motion_state", sa.String(length=50), server_default="UNKNOWN"),
        "trajectory_3d": sa.Column("trajectory_3d", sa.JSON()),
        "evidence_count": sa.Column("evidence_count", sa.Integer(), nullable=False, server_default="0"),
    }.items():
        if name not in track_columns:
            op.add_column("tracks", column)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table, columns in {
        "tracks": (
            "evidence_count", "trajectory_3d", "motion_state", "reprojection_error",
            "association_confidence", "association_status", "coordinate_system", "position_3d"
        ),
        "detections": ("reprojection_error", "camera_image_id"),
    }.items():
        existing = {column["name"] for column in inspector.get_columns(table)}
        for column in columns:
            if column in existing:
                op.drop_column(table, column)
