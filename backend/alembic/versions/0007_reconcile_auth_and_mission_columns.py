"""Reconcile persisted auth and mission columns with current models."""

from alembic import op
import sqlalchemy as sa

from backend.models import Base


revision = "0007_reconcile_auth_and_mission_columns"
down_revision = "0006_users_and_security"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()

    # Create tables missing from an older/partially initialized database.
    # Existing tables are left intact; only absent tables/columns are added.
    Base.metadata.create_all(bind)

    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    additions = {
        "missions": (
            sa.Column("created_by", sa.String(length=120), nullable=True),
            sa.Column("owner_id", sa.String(length=64), nullable=True),
            sa.Column("organization_name", sa.String(length=255), nullable=True),
        ),
        "users": (
            sa.Column("portal_type", sa.String(length=50), server_default="INDIVIDUAL", nullable=False),
            sa.Column("organization_name", sa.String(length=255), nullable=True),
            sa.Column("department", sa.String(length=255), nullable=True),
            sa.Column("mfa_enabled", sa.Boolean(), server_default=sa.false(), nullable=False),
            sa.Column("mfa_secret", sa.String(length=255), nullable=True),
            sa.Column("guest_expires_at", sa.DateTime(), nullable=True),
        ),
    }

    for table_name, columns in additions.items():
        if table_name not in tables:
            continue
        present = {column["name"] for column in inspector.get_columns(table_name)}
        for column in columns:
            if column.name not in present:
                op.add_column(table_name, column)
                present.add(column.name)

    # create_all() does not repair indexes on tables which already existed.
    # Check each index against the live schema before creating it, so rerunning
    # this reconciliation on a partially upgraded database is safe.
    inspector = sa.inspect(bind)
    for table in Base.metadata.sorted_tables:
        if table.name not in set(inspector.get_table_names()):
            continue
        existing = {item["name"] for item in inspector.get_indexes(table.name)}
        for index in table.indexes:
            if not index.name or index.name in existing:
                continue
            op.create_index(
                index.name,
                table.name,
                [column.name for column in index.columns],
                unique=index.unique,
            )
            existing.add(index.name)


def downgrade() -> None:
    # This schema repair is intentionally forward-only to prevent loss of
    # mission ownership and authentication data during an accidental downgrade.
    pass
