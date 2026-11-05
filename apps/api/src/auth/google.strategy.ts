import { CanActivate, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';
import { AppError } from '../common/errors';
import type { Env } from '../config/env';

/** 404s the Google routes when the provider is not configured. */
@Injectable()
export class GoogleEnabledGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}
  canActivate() {
    if (!this.config.get('GOOGLE_CLIENT_ID', { infer: true })) {
      throw new AppError('PROVIDER_DISABLED', 'ยังไม่ได้เปิดใช้งานการเข้าสู่ระบบด้วย Google', 404);
    }
    return true;
  }
}

export interface GoogleProfile {
  sub: string;
  email: string;
  emailVerified: boolean;
  name: string;
  hd?: string;
}

/**
 * Google OAuth 2.0 / OpenID Connect. Registered only when GOOGLE_CLIENT_ID and
 * GOOGLE_CLIENT_SECRET are configured (see AuthModule). `state` is enabled to
 * protect the redirect flow against CSRF.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(config: ConfigService<Env, true>) {
    super({
      clientID: config.get('GOOGLE_CLIENT_ID', { infer: true })!,
      clientSecret: config.get('GOOGLE_CLIENT_SECRET', { infer: true })!,
      callbackURL: config.get('GOOGLE_CALLBACK_URL', { infer: true })!,
      scope: ['openid', 'email', 'profile'],
      state: true,
    });
  }

  validate(_at: string, _rt: string, profile: Profile): GoogleProfile {
    const json = profile._json as { sub: string; email?: string; email_verified?: boolean; hd?: string };
    return {
      sub: json.sub ?? profile.id,
      email: json.email ?? profile.emails?.[0]?.value ?? '',
      emailVerified: json.email_verified === true,
      name: profile.displayName,
      hd: json.hd,
    };
  }
}
