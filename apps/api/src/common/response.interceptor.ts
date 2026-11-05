import { CallHandler, ExecutionContext, Injectable, NestInterceptor, StreamableFile } from '@nestjs/common';
import { map, Observable } from 'rxjs';
import { Paginated } from './pagination';

/**
 * Wraps handler results in `{ success: true, data, meta? }`.
 * Handlers return `Paginated` for lists; files/streams pass through untouched.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((result) => {
        if (result instanceof StreamableFile) return result;
        if (result instanceof Paginated) {
          return { success: true, data: result.items, meta: result.meta };
        }
        return { success: true, data: result ?? null };
      }),
    );
  }
}
