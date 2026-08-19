import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import type { TrainingActionType } from '@home-rehab-motion/shared-types';

export type AnalysisEnqueueResult = {
  task_id: string;
  video_id: number;
  status: string;
};

@Injectable()
export class AnalysisService {
  private readonly logger = new Logger(AnalysisService.name);
  private readonly analysisServiceUrl =
    process.env.ANALYSIS_SERVICE_URL || 'http://127.0.0.1:8000';
  // submit 只负责投递 Celery 消息，不执行视频分析；快速失败后由协调器异步补投。
  private readonly requestTimeoutMs = Number(process.env.ANALYSIS_REQUEST_TIMEOUT_MS || 5_000);
  private readonly internalToken = process.env.ANALYSIS_INTERNAL_TOKEN || '';

  private postJson<T>(urlString: string, payload: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlString);
      const body = JSON.stringify(payload);
      const requester = url.protocol === 'https:' ? httpsRequest : httpRequest;

      const req = requester(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            ...(this.internalToken ? { 'X-Internal-Token': this.internalToken } : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            if ((res.statusCode || 500) >= 400) {
              reject(
                new Error(
                  data || `request failed with status ${res.statusCode || 500}`,
                ),
              );
              return;
            }
            try {
              resolve(JSON.parse(data || '{}') as T);
            } catch (error) {
              reject(error);
            }
          });
        },
      );

      req.setTimeout(this.requestTimeoutMs, () => {
        req.destroy(new Error(`analysis request timed out after ${this.requestTimeoutMs}ms`));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  private getJson<T>(urlString: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlString);
      const requester = url.protocol === 'https:' ? httpsRequest : httpRequest;

      const req = requester(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          method: 'GET',
          headers: this.internalToken ? { 'X-Internal-Token': this.internalToken } : undefined,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            if ((res.statusCode || 500) >= 400) {
              reject(
                new Error(
                  data || `request failed with status ${res.statusCode || 500}`,
                ),
              );
              return;
            }
            try {
              resolve(JSON.parse(data || '{}') as T);
            } catch (error) {
              reject(error);
            }
          });
        },
      );

      req.setTimeout(this.requestTimeoutMs, () => {
        req.destroy(new Error(`analysis request timed out after ${this.requestTimeoutMs}ms`));
      });
      req.on('error', reject);
      req.end();
    });
  }

  async getKeyframes(videoId: number): Promise<Record<string, unknown>> {
    return this.getJson<Record<string, unknown>>(
      `${this.analysisServiceUrl}/analysis/keypoints?video_id=${videoId}`,
    );
  }

  async enqueueVideo(params: {
    videoId: number;
    actionType: TrainingActionType;
    analysisRunId: string;
    videoKey?: string | null;
    sampleFps?: number;
    sigmaMultiplier?: number;
  }): Promise<AnalysisEnqueueResult> {
    const thresholdConfig: Record<string, number> = {};
    if (typeof params.sigmaMultiplier === 'number' && Number.isFinite(params.sigmaMultiplier)) {
      thresholdConfig.sigma_multiplier = params.sigmaMultiplier;
      thresholdConfig.sigmaMultiplier = params.sigmaMultiplier;
    }

    const canonicalPayload = {
      video_id: params.videoId,
      action_type: params.actionType,
      analysis_run_id: params.analysisRunId,
      video_key: params.videoKey || undefined,
      sample_fps:
        typeof params.sampleFps === 'number' && Number.isFinite(params.sampleFps)
          ? Math.max(5, Math.min(30, Math.round(params.sampleFps)))
          : undefined,
      threshold_config: Object.keys(thresholdConfig).length > 0 ? thresholdConfig : undefined,
    };

    const submitUrl = `${this.analysisServiceUrl}/analysis/submit`;
    const startedAt = Date.now();
    this.logger.log(
      `Submitting analysis task: videoId=${params.videoId}, actionType=${params.actionType}, `
      + `hasVideoKey=${Boolean(params.videoKey)}, sampleFps=${canonicalPayload.sample_fps ?? 'default'}, url=${submitUrl}`,
    );

    try {
      const result = await this.postJson<AnalysisEnqueueResult>(submitUrl, canonicalPayload);
      this.logger.log(
        `Analysis task accepted: videoId=${params.videoId}, taskId=${result.task_id}, `
        + `status=${result.status}, elapsedMs=${Date.now() - startedAt}`,
      );
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Analysis task submit failed: videoId=${params.videoId}, actionType=${params.actionType}, `
        + `elapsedMs=${Date.now() - startedAt}, error=${reason}`,
      );
      throw new ServiceUnavailableException({
        code: 'ANALYSIS_QUEUE_UNAVAILABLE',
        message: '分析服务暂时繁忙，请稍后重试。视频已安全保存，无需重新拍摄。',
        detail: reason,
      });
    }
  }
}
