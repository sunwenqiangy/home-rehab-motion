"""FastAPI 应用入口"""

import json
import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.health import router as health_router
from app.api.analysis import router as analysis_router
from app.core.config import settings

class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            'timestamp': self.formatTime(record, '%Y-%m-%dT%H:%M:%SZ'),
            'level': record.levelname,
            'logger': record.name,
            'message': record.getMessage(),
        }
        if record.exc_info:
            payload['exception'] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


logging.basicConfig(level=logging.INFO, stream=sys.stdout)
if settings.is_production:
    for handler in logging.getLogger().handlers:
        handler.setFormatter(JsonFormatter())
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理"""
    settings.assert_production_ready()
    logger.info('Analysis service starting on port %d', settings.analysis_port)
    yield
    logger.info('Analysis service shutting down')


app = FastAPI(
    title='home-rehab-motion-analysis-service',
    version='0.2.0',
    lifespan=lifespan,
)

# ─── 注册路由 ──────────────────────────────────────────
app.include_router(health_router, prefix='/health', tags=['health'])
app.include_router(analysis_router, prefix='/analysis', tags=['analysis'])


@app.get('/')
def root() -> dict:
    return {
        'name': 'home-rehab-motion-analysis-service',
        'version': '0.2.0',
        'status': 'ok',
    }
