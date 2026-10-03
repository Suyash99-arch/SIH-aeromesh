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


def normalize_database_url(url: str | None) -> str | None:
    """
    Normalize DATABASE_URL for SQLAlchemy 2.0 and psycopg v3 driver.
    Rewrites legacy 'postgres://' and standard 'postgresql://' to 'postgresql+psycopg://'.
    Preserves existing 'postgresql+psycopg://' and other schemes (like sqlite://).
    """
    if not url:
        return None
    trimmed = str(url).strip()
    if not trimmed:
        return None
    if trimmed.startswith("postgres://"):
        return "postgresql+psycopg://" + trimmed[len("postgres://"):]
    if trimmed.startswith("postgresql://"):
        return "postgresql+psycopg://" + trimmed[len("postgresql://"):]
    if trimmed.startswith("postgresql+psycopg2://"):
        return "postgresql+psycopg://" + trimmed[len("postgresql+psycopg2://"):]
    return trimmed


def mask_database_url(url: str | None) -> str:
    """
    Safely mask credentials in a database URL so it can be logged or returned in error messages.
    """
    if not url:
        return ""
    try:
        from urllib.parse import urlsplit, urlunsplit
        parts = urlsplit(str(url).strip())
        if parts.password:
            netloc = parts.netloc.replace(f":{parts.password}@", ":***@")
            return urlunsplit((parts.scheme, netloc, parts.path, parts.query, parts.fragment))
        return str(url).strip()
    except Exception:
        return "<sanitized-url>"


def validate_production_database_url(url: str | None) -> tuple[bool, str]:
    """
    Validate that DATABASE_URL is configured correctly for production.
    Returns (is_valid, error_message).
    Ensures URL is present, uses a PostgreSQL scheme, and prevents password leakage.
    """
    if not url or not str(url).strip():
        return False, "DATABASE_URL is missing. Production requires a PostgreSQL database (e.g. Render Postgres). JSON storage fallback is strictly forbidden."
    
    raw = str(url).strip()
    normalized = normalize_database_url(raw)
    masked = mask_database_url(normalized)
    
    try:
        from urllib.parse import urlsplit
        scheme = urlsplit(raw).scheme.lower()
    except Exception as exc:
        return False, f"DATABASE_URL format is invalid: {exc}. [Sanitized URL: {masked}]"
        
    valid_schemes = {"postgres", "postgresql", "postgresql+psycopg", "postgresql+psycopg2"}
    if scheme not in valid_schemes:
        return False, (
            f"DATABASE_URL scheme '{scheme}' is invalid. Production requires a PostgreSQL database "
            f"(e.g., 'postgresql://user:pass@host:5432/dbname' or 'postgresql+psycopg://...'). [Sanitized URL: {masked}]. "
            f"JSON storage fallback is strictly forbidden."
        )
    return True, ""


def get_database_url() -> str | None:
    raw = os.getenv("DATABASE_URL", "").strip()
    if not raw:
        if os.getenv("ENVIRONMENT", "development").lower() != "production":
            data_dir = Path(__file__).resolve().parent.parent / "data"
            data_dir.mkdir(parents=True, exist_ok=True)
            db_file = data_dir / "aeromesh.db"
            return f"sqlite:///{db_file.as_posix()}"
        return None
    return normalize_database_url(raw)


def create_database_engine(database_url: str | None = None):
    url = normalize_database_url(database_url) if database_url else get_database_url()
    if not url:
        return None
    connect_args = {"check_same_thread": False, "timeout": 30.0} if url.startswith("sqlite") else {}
    engine = create_engine(url, future=True, pool_pre_ping=True, connect_args=connect_args)
    if url.startswith("sqlite"):
        from sqlalchemy import event
        @event.listens_for(engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.close()
    return engine


_cached_engine = None
_cached_db_url = None

def get_configured_engine():
    """Resolve DATABASE_URL lazily with singleton caching so engine and connection pools are reused."""
    global _cached_engine, _cached_db_url
    url = get_database_url()
    if not url:
        _cached_engine = None
        _cached_db_url = None
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
