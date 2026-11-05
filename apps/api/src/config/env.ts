import { plainToInstance, Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const toBool = ({ value }: { value: unknown }) => value === true || value === 'true' || value === '1';

/**
 * Environment contract. The process refuses to start when a required value is
 * missing or malformed, so misconfiguration fails fast instead of at runtime.
 * Secrets are only ever read from the environment (never hard-coded).
 */
export class Env {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: 'development' | 'test' | 'production' = 'development';

  @IsString()
  DATABASE_URL!: string;

  @IsString()
  REDIS_URL!: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  API_PORT = 4000;

  @IsUrl({ require_tld: false })
  WEB_PUBLIC_URL!: string;

  @IsString()
  CORS_ORIGINS!: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY = 0;

  @IsString()
  @MinLength(32, { message: 'JWT_ACCESS_SECRET must be at least 32 characters' })
  JWT_ACCESS_SECRET!: string;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(60)
  JWT_ACCESS_TTL = 900;

  @Transform(({ value }) => Number(value))
  @IsInt()
  @Min(1)
  JWT_REFRESH_TTL_DAYS = 14;

  @Transform(toBool)
  @IsBoolean()
  COOKIE_SECURE = false;

  @IsOptional()
  @IsString()
  COOKIE_DOMAIN?: string;

  @IsString()
  @MinLength(40, { message: 'FIELD_ENCRYPTION_KEY must be 32 bytes, base64 encoded' })
  FIELD_ENCRYPTION_KEY!: string;

  @IsOptional() @IsString() GOOGLE_CLIENT_ID?: string;
  @IsOptional() @IsString() GOOGLE_CLIENT_SECRET?: string;
  @IsOptional() @IsString() GOOGLE_CALLBACK_URL?: string;
  @IsOptional() @IsString() GOOGLE_ALLOWED_DOMAINS?: string;

  @IsOptional() @IsString() S3_ENDPOINT?: string;
  @IsOptional() @IsString() S3_REGION?: string;
  @IsOptional() @IsString() S3_ACCESS_KEY?: string;
  @IsOptional() @IsString() S3_SECRET_KEY?: string;
  @IsOptional() @IsString() S3_BUCKET_PUBLIC?: string;
  @IsOptional() @IsString() S3_BUCKET_PRIVATE?: string;
}

export function validateEnv(raw: Record<string, unknown>): Env {
  const env = plainToInstance(Env, raw, { enableImplicitConversion: false });
  const errors = validateSync(env, { skipMissingProperties: false, whitelist: false });
  if (errors.length) {
    const msg = errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`);
    throw new Error(`Invalid environment configuration:\n  ${msg.join('\n  ')}`);
  }
  if (env.NODE_ENV === 'production' && raw.THROTTLE_DISABLED === 'true') {
    throw new Error('THROTTLE_DISABLED is not allowed in production');
  }
  if (env.NODE_ENV === 'production' && !env.COOKIE_SECURE) {
    throw new Error('COOKIE_SECURE must be true in production (HTTPS only)');
  }
  return env;
}
