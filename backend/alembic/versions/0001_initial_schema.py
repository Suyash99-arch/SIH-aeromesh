"""Create the Phase 2 mission persistence schema."""

from alembic import op

from backend.models import Base


revision = "0001_initial_schema"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        import os

        postgis_enabled = os.getenv("AEROMESH_POSTGIS", "1").strip().lower() not in ("0", "false", "off", "no")
        if postgis_enabled:
            op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    Base.metadata.create_all(bind)


def downgrade() -> None:
    Base.metadata.drop_all(op.get_bind())
