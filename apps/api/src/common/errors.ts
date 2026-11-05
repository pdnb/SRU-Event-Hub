import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Domain error with a stable machine-readable `code` (clients switch on it)
 * and a Thai human-readable message.
 */
export class AppError extends HttpException {
  constructor(
    public readonly code: string,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly details?: unknown,
  ) {
    super({ code, message, details }, status);
  }
}

export const Errors = {
  notFound: (what = 'ข้อมูล') => new AppError('NOT_FOUND', `ไม่พบ${what}`, HttpStatus.NOT_FOUND),
  forbidden: (msg = 'ไม่มีสิทธิ์ดำเนินการ') => new AppError('FORBIDDEN', msg, HttpStatus.FORBIDDEN),
  conflict: (code: string, msg: string) => new AppError(code, msg, HttpStatus.CONFLICT),
  invalidState: (msg: string) => new AppError('INVALID_STATE', msg, HttpStatus.CONFLICT),
  validation: (msg: string, details?: unknown) =>
    new AppError('VALIDATION_ERROR', msg, HttpStatus.UNPROCESSABLE_ENTITY, details),
};
