"""SQLAlchemy ORM 模型 — 与主服务 Prisma schema 对齐

分析服务直写主库的以下 4 张表：
- analysis_task
- motion_feature_result
- rep_evaluation_result
- video_evaluation_result

以及读取 training_video 和 standard_action_template。
"""

from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, relationship


class Base(DeclarativeBase):
    """ORM 基类"""

    pass


class TrainingVideo(Base):
    __tablename__ = 'training_video'

    video_id = Column(BigInteger, primary_key=True, autoincrement=True)
    user_id = Column(BigInteger, nullable=False)
    action_type = Column(String(30), nullable=False)
    source_type = Column(String(20))
    video_key = Column(String(255))
    video_key_720p = Column(String(255))
    duration = Column(Float)
    resolution = Column(String(20))
    upload_time = Column(DateTime, default=datetime.utcnow)
    analysis_status = Column(String(30), default='pending')
    quality_status = Column(String(20))
    quality_score = Column(Float)
    quality_issues = Column(JSON)
    fail_reason = Column(String(255))
    model_version = Column(String(20))
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    analysis_task = relationship('AnalysisTask', back_populates='video', uselist=False)
    analysis_runs = relationship('AnalysisRun', back_populates='video')
    motion_feature_results = relationship('MotionFeatureResult', back_populates='video')
    rep_evaluation_results = relationship('RepEvaluationResult', back_populates='video')
    video_evaluation_result = relationship(
        'VideoEvaluationResult',
        back_populates='video',
        uselist=False,
    )


class AnalysisRun(Base):
    __tablename__ = 'analysis_run'

    analysis_run_id = Column(String(36), primary_key=True)
    video_id = Column(BigInteger, ForeignKey('training_video.video_id'), nullable=False)
    provider_task_id = Column(String(64))
    status = Column(String(30), default='queued')
    fail_reason = Column(String(255))
    started_at = Column(DateTime)
    finished_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    video = relationship('TrainingVideo', back_populates='analysis_runs')


class AnalysisTask(Base):
    __tablename__ = 'analysis_task'

    task_id = Column(BigInteger, primary_key=True, autoincrement=True)
    video_id = Column(BigInteger, ForeignKey('training_video.video_id'), unique=True, nullable=False)
    provider_task_id = Column(String(64))
    analysis_run_id = Column(String(36))
    task_status = Column(String(30), default='pending')
    retry_count = Column(Integer, default=0)
    fail_reason = Column(String(255))
    callback_status = Column(String(20), default='pending')
    callback_attempt_count = Column(Integer, default=0)
    callback_last_error = Column(String(255))
    callback_next_retry_at = Column(DateTime)
    callback_payload = Column(JSON)
    callback_url = Column(String(512))
    started_at = Column(DateTime)
    finished_at = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    video = relationship('TrainingVideo', back_populates='analysis_task')


class StandardActionTemplate(Base):
    __tablename__ = 'standard_action_template'

    template_id = Column(BigInteger, primary_key=True, autoincrement=True)
    action_type = Column(String(30), nullable=False)
    version = Column(String(20), nullable=False)
    description = Column(Text)
    reference_stats = Column(JSON)
    threshold_config = Column(JSON)
    status = Column(Integer, default=1)
    created_by = Column(String(50))
    created_at = Column(DateTime, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint('action_type', 'version', name='uk_action_template_type_version'),
    )


class MotionFeatureResult(Base):
    __tablename__ = 'motion_feature_result'

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    video_id = Column(BigInteger, ForeignKey('training_video.video_id'), nullable=False, index=True)
    rep_id = Column(Integer)
    feature_code = Column(String(50), nullable=False)
    feature_value = Column(Float)
    unit = Column(String(20))
    confidence = Column(Float)
    compare_label = Column(String(20))
    deviation_sigma = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)

    video = relationship('TrainingVideo', back_populates='motion_feature_results')


class RepEvaluationResult(Base):
    __tablename__ = 'rep_evaluation_result'

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    video_id = Column(BigInteger, ForeignKey('training_video.video_id'), nullable=False, index=True)
    rep_id = Column(Integer, nullable=False)
    accuracy_score = Column(Float)
    stability_score = Column(Float)
    control_score = Column(Float)
    duration_score = Column(Float)
    total_score = Column(Float)
    grade = Column(String(20))
    valid_flag = Column(Boolean, default=True)
    compensation_types = Column(JSON)
    hold_duration = Column(Float)
    created_at = Column(DateTime, default=datetime.utcnow)

    video = relationship('TrainingVideo', back_populates='rep_evaluation_results')


class VideoEvaluationResult(Base):
    __tablename__ = 'video_evaluation_result'

    video_id = Column(BigInteger, ForeignKey('training_video.video_id'), primary_key=True)
    total_reps = Column(Integer, default=0)
    valid_reps = Column(Integer, default=0)
    average_score = Column(Float)
    grade = Column(String(20))
    accuracy_avg = Column(Float)
    stability_avg = Column(Float)
    control_avg = Column(Float)
    duration_avg = Column(Float)
    avg_hold_duration = Column(Float)
    main_issues = Column(JSON)
    advice_summary = Column(JSON)
    confidence_score = Column(Float)
    analysis_version = Column(String(20))
    created_at = Column(DateTime, default=datetime.utcnow)

    video = relationship('TrainingVideo', back_populates='video_evaluation_result')
