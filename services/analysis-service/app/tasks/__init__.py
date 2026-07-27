"""Celery task package."""

from app.tasks.analyze_video import analyze_video  # noqa: F401
from app.tasks.sample_task import sample_analysis_task  # noqa: F401
