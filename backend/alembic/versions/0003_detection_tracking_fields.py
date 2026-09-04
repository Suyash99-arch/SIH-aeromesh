"""Add detection and track evidence fields."""

from alembic import op
import sqlalchemy as sa


revision = "0003_detection_tracking_fields"
down_revision = "0002_processing_job_lifecycle"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    detection_columns = {column["name"] for column in inspector.get_columns("detections")}
    track_columns = {column["name"] for column in inspector.get_columns("tracks")}
    for name, column in {
        "timestamp": sa.Column("timestamp", sa.Float()),
        "evidence_key": sa.Column("evidence_key", sa.Text()),
    }.items():
        if name not in detection_columns:
            op.add_column("detections", column)
    for name, column in {
        "first_frame": sa.Column("first_frame", sa.String(length=100)),
        "last_frame": sa.Column("last_frame", sa.String(length=100)),
        "first_timestamp": sa.Column("first_timestamp", sa.Float()),
        "last_timestamp": sa.Column("last_timestamp", sa.Float()),
        "detection_count": sa.Column("detection_count", sa.Integer(), nullable=False, server_default="0"),
        "average_confidence": sa.Column("average_confidence", sa.Float()),
        "trajectory_2d": sa.Column("trajectory_2d", sa.JSON()),
    }.items():
        if name not in track_columns:
            op.add_column("tracks", column)


def downgrade() -> None:
    for table, columns in {
        "tracks": ("trajectory_2d", "average_confidence", "detection_count", "last_timestamp", "first_timestamp", "last_frame", "first_frame"),
        "detections": ("evidence_key", "timestamp"),
    }.items():
        inspector = sa.inspect(op.get_bind())
        existing = {column["name"] for column in inspector.get_columns(table)}
        for column in columns:
            if column in existing:
                op.drop_column(table, column)