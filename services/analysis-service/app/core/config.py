from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    node_env: str = Field(default='development', alias='NODE_ENV')
    analysis_port: int = Field(default=8000, alias='ANALYSIS_PORT')
    celery_broker_url: str = Field(default='redis://127.0.0.1:6379/1', alias='CELERY_BROKER_URL')
    celery_result_backend: str = Field(default='redis://127.0.0.1:6379/2', alias='CELERY_RESULT_BACKEND')
    analysis_callback_url: str = Field(
        default='http://127.0.0.1:3000/api/videos/internal/analysis-callback',
        alias='ANALYSIS_CALLBACK_URL',
    )
    analysis_internal_token: str = Field(default='', alias='ANALYSIS_INTERNAL_TOKEN')
    # 主服务数据库（分析结果直写主库）
    database_url: str = Field(
        default='mysql+aiomysql://root@127.0.0.1:3306/home_rehab_motion',
        alias='DATABASE_URL',
    )
    # OSS 配置
    oss_endpoint: str = Field(default='', alias='OSS_ENDPOINT')
    oss_bucket: str = Field(default='home-rehab-motion-assets', alias='OSS_BUCKET')
    oss_access_key_id: str = Field(default='', alias='OSS_ACCESS_KEY_ID')
    oss_access_key_secret: str = Field(default='', alias='OSS_ACCESS_KEY_SECRET')
    oss_public_base_url: str = Field(default='', alias='OSS_PUBLIC_BASE_URL')
    local_storage_root: str = Field(default=str(ROOT_DIR / '.local-storage'), alias='LOCAL_STORAGE_ROOT')
    # S3 兼容存储（MinIO）额外配置
    # OSS_ACCESS_KEY / OSS_SECRET_KEY 为 MinIO 别名，fallback 到 OSS_ACCESS_KEY_ID/SECRET
    oss_access_key: str = Field(default='', alias='OSS_ACCESS_KEY')
    oss_secret_key: str = Field(default='', alias='OSS_SECRET_KEY')
    # 是否强制使用 path style（MinIO 必须 true，阿里云 OSS 为 false）
    oss_force_path_style: bool = Field(default=True, alias='OSS_FORCE_PATH_STYLE')
    # MediaPipe
    sample_fps: int = Field(default=10, alias='SAMPLE_FPS')
    model_complexity: int = Field(default=1, alias='MODEL_COMPLEXITY')
    # 分析超时
    analysis_timeout_seconds: int = Field(default=600, alias='ANALYSIS_TIMEOUT_SECONDS')
    # 是否允许无真实上传视频时回退样例视频
    allow_sample_video_fallback: bool = Field(default=False, alias='ALLOW_SAMPLE_VIDEO_FALLBACK')
    # 是否允许无 mediapipe 时使用 mock 关键点
    allow_mock_keypoints_fallback: bool = Field(default=False, alias='ALLOW_MOCK_KEYPOINTS_FALLBACK')

    @property
    def is_production(self) -> bool:
        return self.node_env == 'production'

    def assert_production_ready(self) -> None:
        if not self.is_production:
            return

        errors: list[str] = []
        internal_token = self.analysis_internal_token.strip()
        if len(internal_token) < 32 or internal_token in {'home-rehab-motion-internal-token', 'replace-with-your-secret'}:
            errors.append('ANALYSIS_INTERNAL_TOKEN 必须配置至少 32 位的非默认密钥')
        if self.allow_sample_video_fallback or self.allow_mock_keypoints_fallback:
            errors.append('生产环境禁止启用样例视频或 Mock 关键点回退')
        if not self.analysis_callback_url.startswith('https://'):
            errors.append('ANALYSIS_CALLBACK_URL 必须使用 HTTPS')
        if not self.oss_endpoint.startswith('https://'):
            errors.append('OSS_ENDPOINT 必须使用 HTTPS')
        if not self.oss_bucket or not self.oss_access_key_id or not self.oss_access_key_secret:
            errors.append('OSS 私有存储配置不完整')
        if self.oss_public_base_url:
            errors.append('生产环境不得配置 OSS_PUBLIC_BASE_URL')
        if errors:
            raise RuntimeError(f"生产环境配置校验失败：{'；'.join(errors)}")

    model_config = SettingsConfigDict(
        # 依次查找当前目录和项目根目录的 .env，后者优先级更高（覆盖前者）
        # 这样不论从哪个目录启动服务，都能正确加载 /home_rehab_motion/.env 中的配置
        env_file=(str(ROOT_DIR / '.env'), '.env'),
        extra='ignore',
    )


settings = Settings()
