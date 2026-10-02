import logging
import os
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


def get_database_url() -> str | None:
    raw = os.getenv("DATABASE_URL", "").strip()
    if not raw:
        return None
    # Fix Render / Heroku legacy postgres:// schema to SQLAlchemy 2.0 compatible postgresql://
    if raw.startswith("postgres://"):
        raw = "postgresql://" + raw[len("postgres://"):]
    return raw


def create_database_engine(database_url: str | None = None):
    url = database_url or get_database_url()
    if not url:
        return None
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, future=True, pool_pre_ping=True, connect_args=connect_args)


_cached_engine = None
_cached_db_url = None

def get_configured_engine():
    """Resolve DATABASE_URL lazily with singleton caching so engine and connection pools are reused."""
    global _cached_engine, _cached_db_url
    url = get_database_url()
    if not url:
        return None
    if _cached_engine is not None and _cached_db_url == url:
        return _cached_engine
    _cached_engine = create_database_engine(url)
    _cached_db_url = url
    return _cached_engine


@contextmanager
def session_scope(database_engine=None) -> Iterator[Session]:
    active_engine = database_engine or get_configured_engine()
    if active_engine is None:
        raise RuntimeError("DATABASE_URL is not configured")
    factory = sessionmaker(bind=active_engine, autoflush=False, autocommit=False, expire_on_commit=False)
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def init_database(database_engine=None) -> None:
    active_engine = database_engine or get_configured_engine()
    if active_engine is None:
        raise RuntimeError("DATABASE_URL is not configured")
    from .models import Base as ModelBase

    ModelBase.metadata.create_all(active_engine)


def run_database_migrations(database_url: str | None = None) -> bool:
    """Run Alembic database migrations programmatically at startup."""
    url = database_url or get_database_url()
    if not url:
        return False
    try:
        from alembic import command
        from alembic.config import Config
        root_dir = Path(__file__).resolve().parent.parent
        alembic_cfg_path = root_dir / "alembic.ini"
        if not alembic_cfg_path.exists():
            alembic_cfg_path = Path(__file__).resolve().parent / "alembic.ini"
        if alembic_cfg_path.exists():
            alembic_cfg = Config(str(alembic_cfg_path))
            alembic_cfg.set_main_option("sqlalchemy.url", url)
            command.upgrade(alembic_cfg, "head")
            logger.info("Alembic database migrations applied successfully")
            return True
    except Exception as exc:
        logger.warning("Alembic programmatic migration skipped: %s; creating tables via metadata", exc)
        try:
            init_database()
            return True
        except Exception as e:
            logger.error("Failed to initialize database tables: %s", e)
            return False
    return False


def check_database(database_engine=None) -> bool:
    active_engine = database_engine or get_configured_engine()
    if active_engine is None:
        return False
    try:
        with active_engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return True
    except Exception:
        return False
