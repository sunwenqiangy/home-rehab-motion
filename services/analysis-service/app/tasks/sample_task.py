from app.tasks.celery_app import celery_app


@celery_app.task(name='analysis.sample')
def sample_analysis_task(video_id: int) -> dict:
    return {
        'video_id': video_id,
        'status': 'queued',
    }
