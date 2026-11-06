import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { BadgesModule } from './badges/badges.module';
import { CertificatesModule } from './certificates/certificates.module';
import { CheckinModule } from './checkin/checkin.module';
import { EvaluationsModule } from './evaluations/evaluations.module';
import { NotificationsModule } from './notifications/notifications.module';
import { VenuesModule } from './venues/venues.module';
import { CsrfGuard, JwtAuthGuard, PermissionsGuard } from './auth/guards';
import { CategoriesModule } from './categories/categories.module';
import { CommonModule } from './common/common.module';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { ResponseEnvelopeInterceptor } from './common/response.interceptor';
import { Env, validateEnv } from './config/env';
import { RedisThrottlerStorage } from './common/redis-throttler.storage';
import { EventsModule } from './events/events.module';
import { GroupsModule } from './groups/groups.module';
import { HealthController } from './health/health.controller';
import { OrganizationsModule } from './organizations/organizations.module';
import { PrismaModule } from './prisma/prisma.module';
import { PaymentsModule } from './payments/payments.module';
import { RegistrationsModule } from './registrations/registrations.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }),
    // Structured JSON logs with a request id; secrets and cookies are redacted.
    LoggerModule.forRoot({
      pinoHttp: {
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];
          const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]', 'req.body.password', 'req.body.token', 'req.body.accountNo'],
          censor: '[redacted]',
        },
        autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
        transport: process.env.NODE_ENV === 'development' ? { target: 'pino/file', options: { destination: 1 } } : undefined,
      },
    }),
    // Default rate limit; endpoints tighten it with @Throttle.
    // Counters live in Redis so all API replicas share one limit (in-memory only when throttling is off).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const disabled = process.env.THROTTLE_DISABLED === 'true';
        return {
          throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }],
          // Only for automated e2e runs (many requests from one IP). Refused in production by validateEnv.
          skipIf: () => disabled,
          ...(disabled ? {} : { storage: new RedisThrottlerStorage(config.get('REDIS_URL', { infer: true })) }),
        };
      },
    }),
    PrismaModule,
    CommonModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    CategoriesModule,
    EventsModule,
    RegistrationsModule,
    PaymentsModule,
    GroupsModule,
    CheckinModule,
    BadgesModule,
    EvaluationsModule,
    CertificatesModule,
    VenuesModule,
    NotificationsModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
