import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import { catchError, from, map, Observable, of, switchMap, throwError } from 'rxjs';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IDEMPOTENT } from './decorators';
import { AppError } from './errors';

const KEY_RE = /^[A-Za-z0-9_\-:.]{8,100}$/;
const TTL_HOURS = 24;

/**
 * Idempotency-Key support (spec §4.6 / §8).
 *  - first request: reserves (scope,key) row, runs the handler, stores the result
 *  - retry with same body: returns the stored result without re-executing
 *  - retry while first is still running: 409 IDEMPOTENCY_IN_PROGRESS
 *  - same key, different body: 422 IDEMPOTENCY_KEY_REUSED
 *  - handler error: reservation is removed so the client may retry
 * The scope includes the actor (user id or IP) so keys cannot collide across users.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const opts = this.reflector.get<{ required: boolean } | undefined>(IDEMPOTENT, ctx.getHandler());
    if (!opts) return next.handle();

    const req = ctx.switchToHttp().getRequest();
    const res = ctx.switchToHttp().getResponse();
    const key = req.headers['idempotency-key'] as string | undefined;
    if (!key) {
      if (opts.required) {
        throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'ต้องระบุ Idempotency-Key', HttpStatus.BAD_REQUEST);
      }
      return next.handle();
    }
    if (!KEY_RE.test(key)) {
      throw new AppError('IDEMPOTENCY_KEY_INVALID', 'รูปแบบ Idempotency-Key ไม่ถูกต้อง');
    }

    const actor = req.user?.id ?? `ip:${req.ip}`;
    const scope = `${req.method} ${req.route?.path ?? req.path} ${actor}`.slice(0, 200);
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ params: req.params, body: req.body ?? null }))
      .digest('hex');

    return from(this.reserve(scope, key, requestHash)).pipe(
      switchMap((existing) => {
        if (existing) {
          res.status(existing.status);
          res.setHeader('Idempotent-Replayed', 'true');
          return of(existing.body);
        }
        return next.handle().pipe(
          // Persist before responding so an immediate retry is replayed, not rejected.
          switchMap((body) =>
            from(
              this.prisma.idempotencyKey.update({
                where: { scope_key: { scope, key } },
                data: {
                  responseStatus: res.statusCode,
                  responseBody: (body ?? null) as Prisma.InputJsonValue,
                },
              }),
            ).pipe(map(() => body)),
          ),
          catchError((err) => {
            return from(
              this.prisma.idempotencyKey.deleteMany({ where: { scope, key } }).catch(() => undefined),
            ).pipe(switchMap(() => throwError(() => err)));
          }),
        );
      }),
    );
  }

  private async reserve(scope: string, key: string, requestHash: string) {
    try {
      await this.prisma.idempotencyKey.create({
        data: { scope, key, requestHash, expiresAt: new Date(Date.now() + TTL_HOURS * 3600_000) },
      });
      return null;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') throw e;
    }
    const row = await this.prisma.idempotencyKey.findUnique({ where: { scope_key: { scope, key } } });
    if (!row) throw new AppError('IDEMPOTENCY_IN_PROGRESS', 'คำขอนี้กำลังดำเนินการ', HttpStatus.CONFLICT);
    if (row.requestHash !== requestHash) {
      throw new AppError(
        'IDEMPOTENCY_KEY_REUSED',
        'Idempotency-Key นี้ถูกใช้กับคำขออื่นแล้ว',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (row.responseStatus == null) {
      throw new AppError('IDEMPOTENCY_IN_PROGRESS', 'คำขอนี้กำลังดำเนินการ', HttpStatus.CONFLICT);
    }
    return { status: row.responseStatus, body: row.responseBody };
  }
}
