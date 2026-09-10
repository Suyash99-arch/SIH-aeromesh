"""Add metric calibration table and enhance measurement integrity fields."""

from alembic import op
import sqlalchemy as sa


revision = "0005_metric_calibration_and_measurements"
down_revision = "0004_spatial_fusion_3d_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = inspector.get_table_names()

    if "calibrations" not in tables:
        op.create_table(
            "calibrations",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("calibration_id", sa.String(length=80), unique=True, index=True, nullable=False),
            sa.Column("mission_id", sa.String(length=36), sa.ForeignKey("missions.id", ondelete="CASCADE"), index=True, nullable=False),
            sa.Column("method", sa.String(length=80), nullable=False),
            sa.Column("scale_factor", sa.Float(), nullable=False),
            sa.Column("unit", sa.String(length=20), server_default="m", nullable=False),
            sa.Column("reference_points", sa.JSON(), nullable=False),
            sa.Column("known_value", sa.Float(), nullable=True),
            sa.Column("reconstructed_value", sa.Float(), nullable=True),
            sa.Column("source_evidence", sa.Text(), nullable=True),
            sa.Column("confidence", sa.Float(), server_default="1.0", nullable=False),
            sa.Column("coordinate_system", sa.String(length=50), server_default="LOCAL_ARBITRARY", nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("1"), nullable=False),
            sa.Column("uncertainty", sa.Float(), nullable=True),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )

    if "measurements" in tables:
        measurement_columns = {column["name"] for column in inspector.get_columns("measurements")}
        for name, column in {
            "measurement_status": sa.Column("measurement_status", sa.String(length=50), server_default="RELATIVE"),
            "unit": sa.Column("unit", sa.String(length=50), server_default="relative_units"),
            "scale_status": sa.Column("scale_status", sa.String(length=50), server_default="RELATIVE_SCALE"),
            "metric_available": sa.Column("metric_available", sa.Boolean(), server_default=sa.text("0")),
            "calibration_id": sa.Column("calibration_id", sa.String(length=80), nullable=True),
            "uncertainty": sa.Column("uncertainty", sa.Float(), nullable=True),
            "source_coordinates": sa.Column("source_coordinates", sa.JSON(), nullable=True),
        }.items():
            if name not in measurement_columns:
                op.add_column("measurements", column)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = inspector.get_table_names()

    if "measurements" in tables:
        existing = {column["name"] for column in inspector.get_columns("measurements")}
        for col in ["source_coordinates", "uncertainty", "calibration_id", "metric_available", "scale_status", "unit", "measurement_status"]:
            if col in existing:
                op.drop_column("measurements", col)

    if "calibrations" in tables:
        op.drop_table("calibrations")
