from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

from backend.database import get_database_url
from backend.models import Base


config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

import alembic.ddl.impl
from sqlalchemy import Table, MetaData, Column, String, PrimaryKeyConstraint

def _patched_version_table_impl(self, *, version_table: str, version_table_schema: str | None, version_table_pk: bool, **kw):
    vt = Table(
        version_table,
        MetaData(),
        Column("version_num", String(128), nullable=False),
        schema=version_table_schema,
    )
    if version_table_pk:
        vt.append_constraint(PrimaryKeyConstraint("version_num", name=f"{version_table}_pkc"))
    return vt

alembic.ddl.impl.DefaultImpl.version_table_impl = _patched_version_table_impl

target_metadata = Base.metadata


def run_migrations_offline():
    url = config.get_main_option("sqlalchemy.url") or get_database_url()
    if not url:
        raise RuntimeError("DATABASE_URL must be configured for migrations")
    context.configure(url=url, target_metadata=target_metadata, literal_binds=True, dialect_opts={"paramstyle": "named"}, version_num_length=128)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    url = config.get_main_option("sqlalchemy.url") or get_database_url()
    if not url:
        raise RuntimeError("DATABASE_URL must be configured for migrations")
    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = url
    connectable = engine_from_config(configuration, prefix="sqlalchemy.", poolclass=pool.NullPool)
    with connectable.connect() as connection:
        try:
            from sqlalchemy import text
            connection.execute(text("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(128)"))
            connection.commit()
        except Exception:
            connection.rollback()
        context.configure(connection=connection, target_metadata=target_metadata, version_num_length=128)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
