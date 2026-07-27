import { BadRequestException, Injectable } from '@nestjs/common';
import { createHash, createHmac } from 'crypto';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { mkdir, access, writeFile } from 'fs/promises';
import path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

export interface UploadedBinaryFile {
  originalname?: string;
  buffer?: Buffer;
  size?: number;
}

@Injectable()
export class StorageService {
  private readonly port = Number(process.env.PORT || 3000);
  private readonly bucketName = process.env.OSS_BUCKET || 'home-rehab-motion-assets';
  private readonly storageRoot = path.resolve(
    process.env.LOCAL_STORAGE_ROOT || path.resolve(REPO_ROOT, '.local-storage'),
    this.bucketName,
  );
  private readonly publicApiBaseUrl =
    process.env.PUBLIC_API_BASE_URL || `http://127.0.0.1:${this.port}/api`;

  private readonly uploadMode = process.env.STORAGE_UPLOAD_MODE || 'local_proxy';
  private readonly endpoint = (process.env.OSS_ENDPOINT || '').replace(/\/+$/, '');
  private readonly region = process.env.OSS_REGION || 'cn-beijing';
  private readonly accessKeyId = process.env.OSS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY || '';
  private readonly secretAccessKey = process.env.OSS_ACCESS_KEY_SECRET || process.env.OSS_SECRET_KEY || '';
  private readonly sessionToken = process.env.OSS_SESSION_TOKEN || '';
  private readonly forcePathStyle = process.env.OSS_FORCE_PATH_STYLE !== 'false';
  private readonly presignedExpiresSeconds = Number(process.env.OSS_PRESIGNED_EXPIRES_SECONDS || 900);
  private readonly skipDirectObjectCheck = process.env.STORAGE_SKIP_DIRECT_OBJECT_CHECK !== 'false';
  private readonly objectCheckTimeoutMs = Number(process.env.STORAGE_OBJECT_CHECK_TIMEOUT_MS || 4000);
  private readonly objectCheckExpiresSeconds = Number(process.env.STORAGE_OBJECT_CHECK_EXPIRES_SECONDS || 120);
  private readonly assetUploadMaxBytes = 20 * 1024 * 1024;
  private readonly videoUploadMaxBytes = 200 * 1024 * 1024;
  private readonly ossPublicBaseUrl = (process.env.OSS_PUBLIC_BASE_URL || '').replace(/\/+$/, '');

  buildVideoObjectKey(videoId: number) {
    return `videos/${videoId}/source`;
  }

  buildGuidanceAssetObjectKey(fileName = 'asset.png') {
    return `guidance/${Date.now()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
  }

  async createUploadTarget(videoId: number, objectKey: string) {
    if (this.isS3PostEnabled()) {
      const normalizedKey = this.normalizeObjectKey(objectKey);
      const keyWithExt = path.posix.extname(normalizedKey)
        ? normalizedKey
        : `${normalizedKey}.mp4`;

      return {
        uploadType: 's3_post' as const,
        uploadUrl: this.buildDirectUploadUrl(),
        objectKey: keyWithExt,
        uploadFields: this.buildPresignedPostFields(keyWithExt, this.videoUploadMaxBytes),
      };
    }

    return {
      uploadType: 'local_proxy' as const,
      uploadUrl: `${this.publicApiBaseUrl}/videos/${videoId}/upload`,
      objectKey,
    };
  }

  async createAssetUploadTarget(objectKey: string, mediaKind: 'image' | 'video' = 'image') {
    const normalizedKey = this.normalizeObjectKey(objectKey);
    const keyWithExt = path.posix.extname(normalizedKey)
      ? normalizedKey
      : `${normalizedKey}${this.resolveAssetExtension()}`;

    if (this.isS3PostEnabled()) {
      return {
        uploadType: 's3_post' as const,
        uploadUrl: this.buildDirectUploadUrl(),
        objectKey: keyWithExt,
        uploadFields: this.buildPresignedPostFields(
          keyWithExt,
          mediaKind === 'video' ? this.videoUploadMaxBytes : this.assetUploadMaxBytes,
        ),
        assetUrl: this.buildPublicAssetUrl(keyWithExt),
      };
    }

    return {
      uploadType: 'local_proxy' as const,
      uploadUrl: `${this.publicApiBaseUrl}/assets/upload`,
      objectKey: keyWithExt,
      assetUrl: `/oss-assets/${keyWithExt}`,
    };
  }

  async saveVideoFile(objectKey: string, file?: UploadedBinaryFile) {
    if (!file?.buffer || !file.buffer.length) {
      throw new BadRequestException('未接收到视频文件');
    }
    if ((file.size || file.buffer.length) > this.videoUploadMaxBytes) {
      throw new BadRequestException('视频不能超过 200MB');
    }
    if (!this.isSupportedVideo(file.originalname, file.buffer)) {
      throw new BadRequestException('仅支持有效的 MP4、MOV、M4V 或 AVI 视频文件');
    }

    const sanitizedKey = this.normalizeObjectKey(objectKey);
    const extension = this.resolveVideoExtension(file.originalname);
    const finalObjectKey = path.posix.extname(sanitizedKey)
      ? sanitizedKey
      : `${sanitizedKey}${extension}`;
    const absolutePath = this.resolveObjectPath(finalObjectKey);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.buffer);

    return {
      objectKey: finalObjectKey,
      absolutePath,
      size: file.size || file.buffer.length,
    };
  }

  async saveAssetFile(objectKey: string, file?: UploadedBinaryFile) {
    if (!file?.buffer || !file.buffer.length) {
      throw new BadRequestException('未接收到文件');
    }
    const isVideo = ['.mp4', '.mov', '.m4v'].includes(path.extname(file.originalname || '').toLowerCase());
    if (isVideo ? !this.isSupportedVideo(file.originalname, file.buffer) : !this.isSupportedImage(file.originalname, file.buffer)) {
      throw new BadRequestException(isVideo ? '教学视频格式无效' : '仅支持有效的 PNG、JPG、GIF 或 WebP 图片');
    }
    const maxBytes = isVideo ? this.videoUploadMaxBytes : this.assetUploadMaxBytes;
    if ((file.size || file.buffer.length) > maxBytes) {
      throw new BadRequestException(isVideo ? '教学视频不能超过 200MB' : '图片或动图不能超过 20MB');
    }

    const sanitizedKey = this.normalizeObjectKey(objectKey);
    const finalObjectKey = path.posix.extname(sanitizedKey)
      ? sanitizedKey
      : `${sanitizedKey}${this.resolveAssetExtension(file.originalname)}`;
    const absolutePath = this.resolveObjectPath(finalObjectKey);

    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, file.buffer);

    return {
      objectKey: finalObjectKey,
      absolutePath,
      size: file.size || file.buffer.length,
      assetUrl: `/oss-assets/${finalObjectKey}`,
    };
  }

  async objectExists(objectKey: string) {
    if (this.isS3PostEnabled()) {
      if (this.skipDirectObjectCheck) {
        return true;
      }
      return this.checkDirectObjectExists(objectKey);
    }

    try {
      await access(this.resolveObjectPath(objectKey));
      return true;
    } catch (_error) {
      return false;
    }
  }

  getAbsoluteObjectPath(objectKey: string) {
    return this.resolveObjectPath(objectKey);
  }

  getPublicObjectUrl(objectKey: string) {
    const normalizedKey = this.normalizeObjectKey(objectKey);
    if (this.isS3PostEnabled()) {
      return this.buildPresignedObjectUrl({
        objectKey: normalizedKey,
        method: 'GET',
        expiresSeconds: this.presignedExpiresSeconds,
      });
    }
    return `/oss-assets/${normalizedKey}`;
  }

  private isS3PostEnabled() {
    return this.uploadMode === 's3_post'
      && Boolean(this.endpoint)
      && Boolean(this.accessKeyId)
      && Boolean(this.secretAccessKey);
  }

  private buildDirectUploadUrl() {
    if (!this.endpoint) {
      throw new BadRequestException('未配置 OSS_ENDPOINT');
    }

    const endpointInfo = this.parseEndpoint();
    const bucketPath = this.forcePathStyle
      ? this.joinUrlPath(endpointInfo.basePath, this.bucketName)
      : endpointInfo.basePath || '/';
    const host = this.forcePathStyle
      ? endpointInfo.host
      : `${this.bucketName}.${endpointInfo.host}`;

    return `${endpointInfo.protocol}//${host}${bucketPath}`.replace(/\/+$/, '');
  }

  private buildPublicAssetUrl(objectKey: string) {
    if (this.ossPublicBaseUrl) {
      return `${this.ossPublicBaseUrl}/${objectKey}`;
    }
    return `/oss-assets/${objectKey}`;
  }

  private buildPresignedPostFields(objectKey: string, maxBytes: number) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.presignedExpiresSeconds * 1000).toISOString();
    const dateStamp = this.formatDateStamp(now);
    const amzDate = this.formatAmzDate(now);
    const algorithm = 'AWS4-HMAC-SHA256';
    const credential = `${this.accessKeyId}/${dateStamp}/${this.region}/s3/aws4_request`;

    const conditions: Array<Record<string, string> | [string, number, number]> = [
      { bucket: this.bucketName },
      { key: objectKey },
      { 'x-amz-algorithm': algorithm },
      { 'x-amz-credential': credential },
      { 'x-amz-date': amzDate },
      ['content-length-range', 1, maxBytes],
    ];

    if (this.sessionToken) {
      conditions.push({ 'x-amz-security-token': this.sessionToken });
    }

    const policy = Buffer.from(
      JSON.stringify({
        expiration: expiresAt,
        conditions,
      }),
    ).toString('base64');

    const signature = this.signPolicy(policy, dateStamp);

    const fields: Record<string, string> = {
      key: objectKey,
      policy,
      'x-amz-algorithm': algorithm,
      'x-amz-credential': credential,
      'x-amz-date': amzDate,
      'x-amz-signature': signature,
    };

    if (this.sessionToken) {
      fields['x-amz-security-token'] = this.sessionToken;
    }

    return fields;
  }

  private async checkDirectObjectExists(objectKey: string) {
    const targetUrl = this.buildPresignedHeadUrl(objectKey);
    const statusCode = await this.sendHeadRequest(targetUrl);
    return statusCode >= 200 && statusCode < 300;
  }

  private buildPresignedHeadUrl(objectKey: string) {
    return this.buildPresignedObjectUrl({
      objectKey,
      method: 'HEAD',
      expiresSeconds: this.objectCheckExpiresSeconds,
    });
  }

  private buildPresignedObjectUrl(params: {
    objectKey: string;
    method: 'GET' | 'HEAD';
    expiresSeconds: number;
  }) {
    const normalizedKey = this.normalizeObjectKey(params.objectKey);
    const endpointInfo = this.parseEndpoint();
    const encodedObjectKey = this.encodeUriPath(normalizedKey);

    const canonicalUri = this.forcePathStyle
      ? this.joinUrlPath(endpointInfo.basePath, this.bucketName, encodedObjectKey)
      : this.joinUrlPath(endpointInfo.basePath, encodedObjectKey);

    const host = this.forcePathStyle
      ? endpointInfo.host
      : `${this.bucketName}.${endpointInfo.host}`;

    const now = new Date();
    const dateStamp = this.formatDateStamp(now);
    const amzDate = this.formatAmzDate(now);
    const credential = `${this.accessKeyId}/${dateStamp}/${this.region}/s3/aws4_request`;

    const queryParams: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': credential,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(params.expiresSeconds),
      'X-Amz-SignedHeaders': 'host',
    };

    if (this.sessionToken) {
      queryParams['X-Amz-Security-Token'] = this.sessionToken;
    }

    const canonicalQuery = this.buildCanonicalQueryString(queryParams);
    const canonicalRequest = [
      params.method,
      canonicalUri,
      canonicalQuery,
      `host:${host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      `${dateStamp}/${this.region}/s3/aws4_request`,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const signature = this.signStringToSign(stringToSign, dateStamp);
    const finalQuery = `${canonicalQuery}&X-Amz-Signature=${signature}`;

    return `${endpointInfo.protocol}//${host}${canonicalUri}?${finalQuery}`;
  }

  private sendHeadRequest(urlString: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlString);
      const requester = url.protocol === 'https:' ? httpsRequest : httpRequest;

      const req = requester(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port,
          path: `${url.pathname}${url.search}`,
          method: 'HEAD',
          timeout: this.objectCheckTimeoutMs,
        },
        (res) => {
          resolve(res.statusCode || 500);
        },
      );

      req.on('timeout', () => {
        req.destroy(new Error('Object check timeout'));
      });
      req.on('error', reject);
      req.end();
    });
  }

  private signPolicy(policyBase64: string, dateStamp: string) {
    const kDate = this.hmac(Buffer.from(`AWS4${this.secretAccessKey}`, 'utf8'), dateStamp);
    const kRegion = this.hmac(kDate, this.region);
    const kService = this.hmac(kRegion, 's3');
    const kSigning = this.hmac(kService, 'aws4_request');
    return createHmac('sha256', kSigning).update(policyBase64).digest('hex');
  }

  private signStringToSign(stringToSign: string, dateStamp: string) {
    const kDate = this.hmac(Buffer.from(`AWS4${this.secretAccessKey}`, 'utf8'), dateStamp);
    const kRegion = this.hmac(kDate, this.region);
    const kService = this.hmac(kRegion, 's3');
    const kSigning = this.hmac(kService, 'aws4_request');
    return createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  }

  private hmac(key: Buffer, value: string) {
    return createHmac('sha256', key).update(value, 'utf8').digest();
  }

  private parseEndpoint() {
    if (!this.endpoint) {
      throw new BadRequestException('未配置 OSS_ENDPOINT');
    }

    const parsed = new URL(this.endpoint);
    const basePath = parsed.pathname === '/'
      ? ''
      : parsed.pathname.replace(/\/+$/, '');

    return {
      protocol: parsed.protocol,
      host: parsed.host,
      basePath,
    };
  }

  private buildCanonicalQueryString(params: Record<string, string>) {
    return Object.keys(params)
      .sort()
      .map((key) => `${this.encodeRfc3986(key)}=${this.encodeRfc3986(params[key])}`)
      .join('&');
  }

  private encodeUriPath(value: string) {
    return value
      .split('/')
      .map((segment) => this.encodeRfc3986(segment))
      .join('/');
  }

  private encodeRfc3986(value: string) {
    return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  }

  private joinUrlPath(...parts: string[]) {
    const merged = parts
      .filter(Boolean)
      .join('/')
      .replace(/\/+/g, '/');
    return merged.startsWith('/') ? merged : `/${merged}`;
  }

  private formatDateStamp(date: Date) {
    return [
      date.getUTCFullYear(),
      `${date.getUTCMonth() + 1}`.padStart(2, '0'),
      `${date.getUTCDate()}`.padStart(2, '0'),
    ].join('');
  }

  private formatAmzDate(date: Date) {
    const dateStamp = this.formatDateStamp(date);
    const hour = `${date.getUTCHours()}`.padStart(2, '0');
    const minute = `${date.getUTCMinutes()}`.padStart(2, '0');
    const second = `${date.getUTCSeconds()}`.padStart(2, '0');
    return `${dateStamp}T${hour}${minute}${second}Z`;
  }

  private normalizeObjectKey(objectKey: string) {
    const normalized = objectKey.replace(/\\/g, '/').replace(/^\/+/, '');
    if (!normalized || normalized.includes('..')) {
      throw new BadRequestException('无效的对象路径');
    }
    return normalized;
  }

  private resolveObjectPath(objectKey: string) {
    const normalized = this.normalizeObjectKey(objectKey);
    const absolutePath = path.resolve(this.storageRoot, normalized);
    if (!absolutePath.startsWith(this.storageRoot)) {
      throw new BadRequestException('对象路径越界');
    }
    return absolutePath;
  }

  getPrivateObjectUrl(objectKey: string) {
    const normalizedKey = this.normalizeObjectKey(objectKey);
    if (this.isS3PostEnabled()) {
      return this.buildPresignedObjectUrl({
        objectKey: normalizedKey,
        method: 'GET',
        expiresSeconds: this.presignedExpiresSeconds,
      });
    }
    if (process.env.NODE_ENV === 'production') {
      throw new BadRequestException('生产环境不允许暴露本地患者资产');
    }
    return `/oss-assets/${normalizedKey}`;
  }

  private isSupportedVideo(fileName: string | undefined, content: Buffer) {
    const extension = path.extname(fileName || '').toLowerCase();
    if (!['.mp4', '.mov', '.m4v', '.avi'].includes(extension) || content.length < 12) {
      return false;
    }
    const hasIsoBaseMediaHeader = content.subarray(4, 8).toString('ascii') === 'ftyp';
    const hasAviHeader = content.subarray(0, 4).toString('ascii') === 'RIFF'
      && content.subarray(8, 12).toString('ascii') === 'AVI ';
    return hasIsoBaseMediaHeader || hasAviHeader;
  }

  private isSupportedImage(fileName: string | undefined, content: Buffer) {
    const extension = path.extname(fileName || '').toLowerCase();
    if (content.length < 12) {
      return false;
    }
    const header = content.subarray(0, 12);
    const isPng = extension === '.png' && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isJpeg = ['.jpg', '.jpeg'].includes(extension) && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
    const isGif = extension === '.gif' && ['GIF87a', 'GIF89a'].includes(header.subarray(0, 6).toString('ascii'));
    const isWebp = extension === '.webp' && header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP';
    return isPng || isJpeg || isGif || isWebp;
  }

  private resolveVideoExtension(fileName?: string) {
    const extension = path.extname(fileName || '').toLowerCase();
    const allowedExtensions = new Set(['.mp4', '.mov', '.m4v', '.avi']);
    return allowedExtensions.has(extension) ? extension : '.mp4';
  }

  private resolveAssetExtension(fileName?: string) {
    const extension = path.extname(fileName || '').toLowerCase();
    const allowedExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4']);
    return allowedExtensions.has(extension) ? extension : '.png';
  }
}
