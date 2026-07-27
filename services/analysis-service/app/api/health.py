from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from app.db.session import sync_engine

router = APIRouter()


def _response(status: str, **extra: object) -> dict:
    return {
        'service': 'analysis-service',
        'status': status,
        **extra,
    }


@router.get('/', summary='健康检查')
@router.get('', summary='健康检查（无尾部斜杠）', include_in_schema=False)
def health_check() -> dict:
    return _response('ok')


@router.get('/live', summary='存活检查')
def liveness_check() -> dict:
    return _response('ok')


@router.get('/ready', summary='就绪检查')
def readiness_check() -> dict:
    try:
        with sync_engine.connect() as connection:
            connection.execute(text('SELECT 1'))
    except Exception:
        raise HTTPException(
            status_code=503,
            detail=_response('unavailable', checks={'database': 'unavailable'}),
        )

    return _response('ok', checks={'database': 'ok'})
