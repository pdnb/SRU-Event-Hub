import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { ACCESS_COOKIE } from '../auth/cookies';
import type { AccessTokenPayload } from '../auth/auth.types';
import { AuthService } from '../auth/auth.service';
import { EventAccessService } from './event-access.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const room = (eventId: string) => `event:${eventId}`;

export interface CheckinBroadcast {
  eventId: string;
  kind: 'CHECK_IN' | 'CHECK_OUT' | 'UNDO' | 'ATTENDANCE' | 'SYNC';
  count?: number;
  at: string;
}

function readCookie(header: string | undefined, name: string): string | undefined {
  return header
    ?.split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/**
 * Real-time check-in notifications (namespace `/checkin`).
 *
 * Authentication uses the same access token as REST (httpOnly cookie, or `auth.token` for non-browser
 * clients). A socket only receives updates for events it subscribed to, and each subscription is
 * authorised with `checkin:view` on that event, re-reading permissions at that moment.
 * Messages carry no personal data — clients refetch the stats endpoint (which is access-checked).
 */
@WebSocketGateway({ namespace: '/checkin' })
export class CheckinGateway implements OnGatewayConnection {
  private readonly logger = new Logger(CheckinGateway.name);
  @WebSocketServer() server?: Namespace;

  constructor(
    private readonly jwt: JwtService,
    private readonly auth: AuthService,
    private readonly access: EventAccessService,
  ) {}

  async handleConnection(socket: Socket) {
    const token =
      (typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : undefined) ??
      readCookie(socket.handshake.headers.cookie, ACCESS_COOKIE);
    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token ?? '', { algorithms: ['HS256'], issuer: 'sru-event-hub', audience: 'sru-event-hub-api' });
      if (payload.typ !== 'access') throw new Error('not an access token');
      socket.data.userId = payload.sub;
    } catch {
      socket.emit('error', { code: 'UNAUTHORIZED' });
      socket.disconnect(true);
    }
  }

  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: { eventId?: unknown }) {
    const eventId = typeof body?.eventId === 'string' && UUID.test(body.eventId) ? body.eventId : null;
    if (!eventId || !socket.data.userId) return { ok: false, code: 'VALIDATION_ERROR' };
    const user = await this.auth.loadAuthUser(String(socket.data.userId));
    if (!user) return { ok: false, code: 'UNAUTHORIZED' };
    try {
      await this.access.assert(user, 'checkin:view', eventId);
    } catch {
      return { ok: false, code: 'FORBIDDEN' };
    }
    await socket.join(room(eventId));
    return { ok: true };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: { eventId?: unknown }) {
    if (typeof body?.eventId === 'string') await socket.leave(room(body.eventId));
    return { ok: true };
  }

  /** Fire-and-forget; a failed broadcast never fails the check-in itself. */
  notify(msg: Omit<CheckinBroadcast, 'at'>) {
    try {
      this.server?.to(room(msg.eventId)).emit('checkin', { ...msg, at: new Date().toISOString() } satisfies CheckinBroadcast);
    } catch (e) {
      this.logger.warn(`broadcast failed: ${(e as Error).message}`);
    }
  }
}
