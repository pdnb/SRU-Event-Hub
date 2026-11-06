import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { CurrentUser, Public, ReqMeta, type RequestMeta } from '../common/decorators';
import { AppError } from '../common/errors';
import type { Env } from '../config/env';
import { AuthService, IssuedTokens } from './auth.service';
import { SignupService } from './signup.service';
import type { AuthUser } from './auth.types';
import { clearAuthCookies, CookieConfig, REFRESH_COOKIE, setAuthCookies } from './cookies';
import { GoogleEnabledGuard, type GoogleProfile } from './google.strategy';

class LoginDto {
  /** Username or e-mail */
  @IsString()
  @MinLength(1)
  @MaxLength(254)
  username!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password!: string;
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly cookieCfg: CookieConfig;

  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
    private readonly signup: SignupService,
  ) {
    this.cookieCfg = {
      secure: config.get('COOKIE_SECURE', { infer: true }),
      domain: config.get('COOKIE_DOMAIN', { infer: true }),
      accessTtlSec: config.get('JWT_ACCESS_TTL', { infer: true }),
      refreshTtlDays: config.get('JWT_REFRESH_TTL_DAYS', { infer: true }),
    };
  }

  private respond(res: Response, t: IssuedTokens) {
    setAuthCookies(res, this.cookieCfg, t.accessToken, t.refreshToken);
    // Tokens are delivered as httpOnly cookies only; the body carries no secrets.
    return { expiresIn: t.expiresIn };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'เข้าสู่ระบบด้วย Username/Email และรหัสผ่าน' })
  async login(@Body() dto: LoginDto, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.login(dto.username, dto.password, meta));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @ReqMeta() meta: RequestMeta, @Res({ passthrough: true }) res: Response) {
    try {
      return this.respond(res, await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], meta));
    } catch (e) {
      clearAuthCookies(res, this.cookieCfg);
      throw e;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearAuthCookies(res, this.cookieCfg);
    return { loggedOut: true };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roles: user.grants.map((g) => ({ code: g.code, organizationId: g.organizationId, scope: g.scope })),
      permissions: [...user.permissions].sort(),
    };
  }

  @Public()
  @Get('providers')
  providers() {
    return { google: Boolean(this.config.get('GOOGLE_CLIENT_ID', { infer: true })), selfRegistration: this.signup.enabled };
  }

  @Public()
  @Get('google')
  @UseGuards(GoogleEnabledGuard, AuthGuard('google'))
  google() {
    /* redirects to Google */
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleEnabledGuard, AuthGuard('google'))
  async googleCallback(@Req() req: Request, @ReqMeta() meta: RequestMeta, @Res() res: Response) {
    const web = this.config.get('WEB_PUBLIC_URL', { infer: true });
    try {
      const tokens = await this.auth.loginWithGoogle(req.user as unknown as GoogleProfile, meta);
      setAuthCookies(res, this.cookieCfg, tokens.accessToken, tokens.refreshToken);
      res.redirect(`${web}/admin`);
    } catch (e) {
      const code = e instanceof AppError ? e.code : 'LOGIN_FAILED';
      res.redirect(`${web}/login?error=${encodeURIComponent(code)}`);
    }
  }
}
