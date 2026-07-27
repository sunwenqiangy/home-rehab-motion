#!/usr/bin/env bash
# 分析服务启动脚本

set -e

cd "$(dirname "$0")"

# ─── 启动 FastAPI ─────────────────────────────────────
start_api() {
    echo "Starting FastAPI server..."
    uvicorn app.main:app --host 0.0.0.0 --port "${ANALYSIS_PORT:-8000}" --reload
}

# ─── 启动 Celery Worker ───────────────────────────────
start_worker() {
    echo "Starting Celery worker..."
    celery -A app.tasks.celery_app:celery_app worker \
        --loglevel=info \
        --concurrency=2 \
        --queues=analysis \
        --hostname=analysis-worker@%h
}

# ─── 启动 Celery Beat（可选，用于定时任务）──────────
start_beat() {
    echo "Starting Celery beat..."
    celery -A app.tasks.celery_app:celery_app beat --loglevel=info
}

case "${1:-api}" in
    api)     start_api ;;
    worker)  start_worker ;;
    beat)    start_beat ;;
    all)
        start_worker &
        start_api
        ;;
    *)
        echo "Usage: $0 {api|worker|beat|all}"
        exit 1
        ;;
esac
