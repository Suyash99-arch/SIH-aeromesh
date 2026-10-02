import os
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


def get_database_url() -> str | None:
    value = os.getenv("DATABASE_URL", "").strip()
    return value or None


def create_database_engine(database_url: str | None = None):
    url = database_url or get_database_url()
    if not url:
        return None
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, future=True, pool_pre_ping=True, connect_args=connect_args)


engine = create_database_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False) if engine else None


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
