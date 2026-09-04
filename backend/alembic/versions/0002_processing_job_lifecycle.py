"""Add processing job lifecycle fields."""

from alembic import op
import sqlalchemy as sa


revision = "0002_processing_job_lifecycle"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {column["name"] for column in inspector.get_columns("processing_jobs")}
    columns = [
        sa.Column("stage", sa.String(length=80), nullable=False, server_default="QUEUED"),
        sa.Column("progress_percent", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("message", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
    ]
    for column in columns:
        if column.name not in existing:
            op.add_column("processing_jobs", column)


def downgrade() -> None:
    for column in ("completed_at", "started_at", "created_at", "error_message", "message", "progress_percent", "stage"):
        inspector = sa.inspect(op.get_bind())
        if column in {item["name"] for item in inspector.get_columns("processing_jobs")}:
            op.drop_column("processing_jobs", column)