"""Persistence: templates -> pages -> elements (SQLite by default, Postgres with DATABASE_URL)."""
from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Iterator

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, create_engine, event, exc, inspect
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker

from .config import settings


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Template(Base):
    __tablename__ = "templates"

    id: Mapped[str] = mapped_column(String(32), primary_key=True)
    name: Mapped[str] = mapped_column(String(255))
    # The account the template belongs to (a Supabase Auth user id). NULL = made without sign-in.
    owner_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    original_filename: Mapped[str] = mapped_column(String(255), default="")
    page_count: Mapped[int] = mapped_column(Integer, default=0)
    fonts: Mapped[list] = mapped_column(JSON, default=list)
    warnings: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    pages: Mapped[list["Page"]] = relationship(
        back_populates="template", cascade="all, delete-orphan", order_by="Page.index",
        passive_deletes=True,   # the database cascades: rows that are not loaded need no query
    )


class Page(Base):
    __tablename__ = "pages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    template_id: Mapped[str] = mapped_column(ForeignKey("templates.id", ondelete="CASCADE"), index=True)
    index: Mapped[int] = mapped_column(Integer)
    width: Mapped[float] = mapped_column(Float)
    height: Mapped[float] = mapped_column(Float)
    rotation: Mapped[int] = mapped_column(Integer, default=0)
    preview: Mapped[str | None] = mapped_column(String(512), nullable=True)
    scanned: Mapped[bool] = mapped_column(Boolean, default=False)
    # Detected table grids. NULL = imported before table detection existed.
    tables: Mapped[list | None] = mapped_column(JSON, nullable=True)

    template: Mapped[Template] = relationship(back_populates="pages")
    elements: Mapped[list["Element"]] = relationship(
        back_populates="page", cascade="all, delete-orphan", order_by="Element.z",
        passive_deletes=True,
    )


class Element(Base):
    __tablename__ = "elements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    page_id: Mapped[int] = mapped_column(ForeignKey("pages.id", ondelete="CASCADE"), index=True)
    z: Mapped[int] = mapped_column(Integer, default=0)
    type: Mapped[str] = mapped_column(String(16))
    # Everything else about the element (position, style, content ...) as it
    # appears in the template JSON.
    data: Mapped[dict] = mapped_column(JSON)

    page: Mapped[Page] = relationship(back_populates="elements")


settings.data_dir.mkdir(parents=True, exist_ok=True)
IS_SQLITE = settings.database_url.startswith("sqlite")
if IS_SQLITE:
    engine = create_engine(settings.database_url, connect_args={"check_same_thread": False})
else:
    # A hosted database: connections are slow to open and may be dropped while idle.
    # Sessions always end their own transaction (see get_db), so the pool's extra
    # ROLLBACK on every return would only be one more round trip.
    engine = create_engine(settings.database_url, pool_size=5, max_overflow=5, pool_recycle=900,
                           pool_reset_on_return=None)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)
# Reads need no transaction: on a distant database, BEGIN and ROLLBACK are two round trips saved.
ReadSession = sessionmaker(bind=engine.execution_options(isolation_level="AUTOCOMMIT"), expire_on_commit=False)


if IS_SQLITE:
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_connection, _record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()


if not IS_SQLITE:
    IDLE_BEFORE_PING = 30   # seconds

    @event.listens_for(engine, "connect")
    @event.listens_for(engine, "checkin")
    def _note_use(_dbapi_connection, record) -> None:
        record.info["used"] = time.monotonic()

    @event.listens_for(engine, "checkout")
    def _ping_if_idle(dbapi_connection, record, _proxy) -> None:
        """Like pool_pre_ping, but only for a connection that has sat unused: a
        ping costs a full round trip, and one used seconds ago is still alive."""
        if time.monotonic() - record.info.get("used", 0.0) < IDLE_BEFORE_PING:
            return
        try:
            autocommit, dbapi_connection.autocommit = dbapi_connection.autocommit, True
            dbapi_connection.execute("SELECT 1")
            dbapi_connection.autocommit = autocommit
        except Exception as error:   # the pool opens a fresh connection and tries again
            raise exc.DisconnectionError() from error


def init_db() -> None:
    Base.metadata.create_all(engine)
    # create_all does not add columns to tables that already exist
    inspector = inspect(engine)
    page_columns = {column["name"] for column in inspector.get_columns("pages")}
    template_columns = {column["name"] for column in inspector.get_columns("templates")}
    with engine.begin() as connection:
        if "tables" not in page_columns:
            connection.exec_driver_sql("ALTER TABLE pages ADD COLUMN tables JSON")
        if "owner_id" not in template_columns:
            connection.exec_driver_sql("ALTER TABLE templates ADD COLUMN owner_id VARCHAR(64)")
            connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_templates_owner_id ON templates (owner_id)")
        if engine.dialect.name == "postgresql":
            # Supabase publishes the public schema through its REST API. With row level
            # security on and no policies, only this backend (the table owner) gets in.
            for table in Base.metadata.sorted_tables:
                connection.exec_driver_sql(f'ALTER TABLE "{table.name}" ENABLE ROW LEVEL SECURITY')


def get_db() -> Iterator[Session]:
    with SessionLocal() as session:
        yield session


def get_read_db() -> Iterator[Session]:
    """A session for endpoints that only read (each statement stands alone)."""
    with ReadSession() as session:
        yield session
