import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { RealtimeAdapter } from './checkin/realtime.adapter';
import type { Env } from './config/env';

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService<Env, true>);
  app.useLogger(app.get(Logger));

  app.set('trust proxy', config.get('TRUST_PROXY', { infer: true }));
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });

  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }).split(',').map((o) => o.trim()),
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'Idempotent-Replayed', 'Content-Disposition'],
  });

  // All routes live under /api/v1 (spec §8).
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  // Socket.IO (real-time check-in counters): CORS allow-list + Redis fan-out across replicas.
  app.useWebSocketAdapter(new RealtimeAdapter(app));
  app.enableShutdownHooks();

  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('SRU Event Hub API')
        .setDescription('ระบบบริหารจัดการกิจกรรม มหาวิทยาลัยราชภัฏสุราษฎร์ธานี — REST API v1')
        .setVersion('1.0')
        .addBearerAuth()
        .addCookieAuth('sru_at')
        .build(),
    );
    SwaggerModule.setup('api/docs', app, doc, { jsonDocumentUrl: 'api/docs/openapi.json' });
  }
  return app;
}

async function bootstrap() {
  const app = await createApp();
  const port = app.get(ConfigService<Env, true>).get('API_PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
}

if (require.main === module) void bootstrap();
