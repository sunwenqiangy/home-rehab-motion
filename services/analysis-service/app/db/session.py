"""数据库连接与会话管理"""

import logging
from contextlib import contextmanager
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

logger = logging.getLogger(__name__)

# 同步引擎（Celery worker 中使用）
sync_engine = create_engine(
    settings.database_url.replace('+aiomysql', '+pymysql'),
    pool_pre_ping=True,
    pool_size=5,
    max_overflow=10,
    echo=False,
)

SyncSessionFactory = sessionmaker(bind=sync_engine, autocommit=False, autoflush=False)


def get_sync_session() -> Session:
    """获取同步数据库会话（用于 Celery worker）"""
    return SyncSessionFactory()


@contextmanager
def sync_session_scope() -> Generator[Session, None, None]:
    """同步会话上下文管理器，自动提交/回滚"""
    session = get_sync_session()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


# ─── FastAPI 异步引擎（可选，用于 API 查询） ──────────

try:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

    async_database_url = settings.database_url
    if '+pymysql' in async_database_url:
        async_database_url = async_database_url.replace('+pymysql', '+aiomysql')

    if '+aiomysql' not in async_database_url:
        raise ImportError('async mysql driver url not configured')

    async_engine = create_async_engine(
        async_database_url,
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=10,
        echo=False,
    )

    AsyncSessionFactory = async_sessionmaker(bind=async_engine, class_=AsyncSession, expire_on_commit=False)

    async def get_async_session() -> Generator[AsyncSession, None, None]:
        """获取异步数据库会话（用于 FastAPI 依赖注入）"""
        async with AsyncSessionFactory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

except (ImportError, Exception) as exc:
    logger.warning('async session unavailable: %s', exc)
    async_engine = None
    AsyncSessionFactory = None
