FROM python:3.11-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
WORKDIR /app
RUN apt-get update \
    && apt-get install --no-install-recommends -y ffmpeg libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*
COPY services/analysis-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY services/analysis-service/app ./app
RUN groupadd --system home_rehab_motion && useradd --system --gid home_rehab_motion --home-dir /app home_rehab_motion \
    && chown -R home_rehab_motion:home_rehab_motion /app
USER home_rehab_motion
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
