declare namespace NodeJS {
  interface ProcessEnv {
    PORT?: string;
    DATABASE_URL?: string;
    REDIS_URL?: string;
    ANALYSIS_SERVICE_URL?: string;
    ANALYSIS_CALLBACK_URL?: string;
    ANALYSIS_INTERNAL_TOKEN?: string;
  }
}
