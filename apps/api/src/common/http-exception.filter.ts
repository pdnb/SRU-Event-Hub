import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Prisma } from '../generated/prisma/client';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'VALIDATION_ERROR',
  429: 'TOO_MANY_REQUESTS',
};

/**
 * Converts every error into the standard envelope
 * `{ success:false, error:{ code, message, details?, requestId } }`.
 * Stack traces and internal messages are never sent to clients (spec §8);
 * unexpected errors are logged server-side with the request id.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = req.id ? String(req.id) : undefined;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'เกิดข้อผิดพลาดภายในระบบ กรุณาลองใหม่อีกครั้ง';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      code = STATUS_CODES[status] ?? 'ERROR';
      if (typeof body === 'string') message = body;
      else if (body && typeof body === 'object') {
        const b = body as Record<string, unknown>;
        if (typeof b.code === 'string') code = b.code;
        if (Array.isArray(b.message)) {
          // class-validator output
          code = 'VALIDATION_ERROR';
          status = HttpStatus.UNPROCESSABLE_ENTITY;
          message = 'ข้อมูลไม่ถูกต้อง';
          details = b.message;
        } else if (typeof b.message === 'string') message = b.message;
        if (b.details !== undefined) details = b.details;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        status = HttpStatus.CONFLICT;
        code = 'DUPLICATE';
        message = 'ข้อมูลซ้ำกับที่มีอยู่แล้ว';
      } else if (exception.code === 'P2025') {
        status = HttpStatus.NOT_FOUND;
        code = 'NOT_FOUND';
        message = 'ไม่พบข้อมูล';
      } else if (exception.code === 'P2003') {
        status = HttpStatus.CONFLICT;
        code = 'REFERENCE_CONSTRAINT';
        message = 'ไม่สามารถดำเนินการได้ เนื่องจากมีข้อมูลอื่นอ้างอิงอยู่';
      }
    }

    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId, path: req.url },
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json({
      success: false,
      error: { code, message, ...(details !== undefined ? { details } : {}), requestId },
    });
  }
}
