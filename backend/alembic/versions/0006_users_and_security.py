"""Add users table and mission created_by field for Phase 10 security."""

from alembic import op
import sqlalchemy as sa


revision = "0006_users_and_security"
down_revision = "0005_metric_calibration_and_measurements"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = inspector.get_table_names()

    if "users" not in tables:
        op.create_table(
            "users",
            sa.Column("id", sa.String(length=64), primary_key=True),
            sa.Column("email", sa.String(length=255), unique=True, index=True, nullable=False),
            sa.Column("hashed_password", sa.String(length=255), nullable=False),
            sa.Column("full_name", sa.String(length=255), nullable=True),
            sa.Column("role", sa.String(length=50), server_default="OPERATOR", nullable=False),
            sa.Column("is_active", sa.Boolean(), server_default=sa.text("1"), nullable=False),
            sa.Column("created_at", sa.DateTime(), server_default=sa.func.now(), nullable=False),
        )

    if "missions" in tables:
        mission_columns = {column["name"] for column in inspector.get_columns("missions")}
        if "created_by" not in mission_columns:
            op.add_column("missions", sa.Column("created_by", sa.String(length=120), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = inspector.get_table_names()

    if "missions" in tables:
        mission_columns = {column["name"] for column in inspector.get_columns("missions")}
        if "created_by" in mission_columns:
            op.drop_column("missions", "created_by")

    if "users" in tables:
        op.drop_table("users")
