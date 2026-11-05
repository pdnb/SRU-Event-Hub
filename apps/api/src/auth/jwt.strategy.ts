import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../config/env';
import { ACCESS_COOKIE } from './cookies';
import type { AccessTokenPayload, AuthUser } from './auth.types';
import { AuthService } from './auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<Env, true>,
    private readonly auth: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (req: Request) => req?.cookies?.[ACCESS_COOKIE] ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
      algorithms: ['HS256'],
      issuer: 'sru-event-hub',
      audience: 'sru-event-hub-api',
    });
  }

  /** Permissions are reloaded per request so revoked roles / suspensions apply immediately. */
  async validate(payload: AccessTokenPayload): Promise<AuthUser | null> {
    if (payload.typ !== 'access') return null;
    return this.auth.loadAuthUser(payload.sub);
  }
}
