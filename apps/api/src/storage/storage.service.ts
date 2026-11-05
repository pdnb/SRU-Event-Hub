import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomUUID } from 'node:crypto';
import type { Env } from '../config/env';
import { AppError } from '../common/errors';

export type AllowedKind = 'jpg' | 'png' | 'pdf';

const MIME: Record<AllowedKind, string> = { jpg: 'image/jpeg', png: 'image/png', pdf: 'application/pdf' };

/**
 * Detects the real file type from its leading bytes. The client-supplied
 * Content-Type and file name are never trusted (spec §9: magic-number check).
 */
export function sniffFileKind(buf: Buffer): AllowedKind | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  return null;
}

export interface StoredObject {
  bucket: string;
  objectKey: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

/** S3-compatible object storage (SeaweedFS locally, any S3 in production). */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  readonly privateBucket: string;
  readonly publicBucket: string;

  constructor(private readonly config: ConfigService<Env, true>) {
    this.privateBucket = config.get('S3_BUCKET_PRIVATE', { infer: true }) ?? 'sru-private';
    this.publicBucket = config.get('S3_BUCKET_PUBLIC', { infer: true }) ?? 'sru-public';
    this.client = new S3Client({
      endpoint: config.get('S3_ENDPOINT', { infer: true }),
      region: config.get('S3_REGION', { infer: true }) ?? 'ap-southeast-1',
      forcePathStyle: config.get('S3_FORCE_PATH_STYLE', { infer: true }),
      credentials: {
        accessKeyId: config.get('S3_ACCESS_KEY', { infer: true }) ?? '',
        secretAccessKey: config.get('S3_SECRET_KEY', { infer: true }) ?? '',
      },
    });
  }

  /** Validates type + size, then stores under an unguessable key. Returns metadata for the `files` table. */
  async putValidated(
    buf: Buffer,
    opts: { prefix: string; allowed: AllowedKind[]; maxBytes: number; isPrivate?: boolean },
  ): Promise<StoredObject> {
    if (!buf.length) throw new AppError('FILE_EMPTY', 'ไม่พบไฟล์', HttpStatus.BAD_REQUEST);
    if (buf.length > opts.maxBytes) {
      throw new AppError('FILE_TOO_LARGE', `ไฟล์มีขนาดเกิน ${(opts.maxBytes / 1_000_000).toFixed(0)} MB`, HttpStatus.PAYLOAD_TOO_LARGE);
    }
    const kind = sniffFileKind(buf);
    if (!kind || !opts.allowed.includes(kind)) {
      throw new AppError('FILE_TYPE_NOT_ALLOWED', `รองรับเฉพาะไฟล์ ${opts.allowed.map((k) => k.toUpperCase()).join(', ')}`, HttpStatus.UNSUPPORTED_MEDIA_TYPE);
    }
    const sha256 = createHash('sha256').update(buf).digest('hex');
    const bucket = opts.isPrivate === false ? this.publicBucket : this.privateBucket;
    const now = new Date();
    const objectKey = `${opts.prefix}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomUUID()}.${kind}`;
    await this.client.send(
      new PutObjectCommand({ Bucket: bucket, Key: objectKey, Body: buf, ContentType: MIME[kind], ContentLength: buf.length }),
    );
    return { bucket, objectKey, mimeType: MIME[kind], sizeBytes: buf.length, sha256 };
  }

  /** Short-lived signed URL for a private object (default 5 minutes). */
  presignGet(bucket: string, objectKey: string, ttlSec = 300, downloadName?: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        ...(downloadName ? { ResponseContentDisposition: `inline; filename="${encodeURIComponent(downloadName)}"` } : {}),
      }),
      { expiresIn: ttlSec },
    );
  }

  /** Streams an object's bytes (used when the browser cannot reach the storage host directly). */
  async getBytes(bucket: string, objectKey: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
}
