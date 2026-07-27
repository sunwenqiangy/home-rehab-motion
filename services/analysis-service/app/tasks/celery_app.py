"""Celery 应用配置"""

from celery import Celery

from app.core.config import settings

celery_app = Celery(
    'home-rehab-motion-analysis',
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=['app.tasks.analyze_video', 'app.tasks.sample_task'],
)

celery_app.conf.update(
    task_default_queue='analysis',
    task_serializer='json',
    result_serializer='json',
    accept_content=['json'],
    timezone='Asia/Shanghai',
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    broker_connection_retry_on_startup=True,
    beat_schedule={
        'retry-pending-callbacks-every-minute': {
            'task': 'analysis.retry_pending_callbacks',
            'schedule': 60.0,
        },
    },
    task_routes={
        'analysis.analyze_video': {'queue': 'analysis'},
        'analysis.sample': {'queue': 'analysis'},
        'analysis.retry_pending_callbacks': {'queue': 'analysis'},
    },
)
