import { Module, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { Env } from '../config/env';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { GoogleEnabledGuard, GoogleStrategy } from './google.strategy';
import { JwtStrategy } from './jwt.strategy';
import { SignupController } from './signup.controller';
import { SignupService } from './signup.service';

/** Google strategy is only instantiated when credentials are configured. */
const optionalGoogle: Provider = {
  provide: 'GOOGLE_STRATEGY',
  inject: [ConfigService],
  useFactory: (config: ConfigService<Env, true>) =>
    config.get('GOOGLE_CLIENT_ID', { infer: true }) && config.get('GOOGLE_CLIENT_SECRET', { infer: true })
      ? new GoogleStrategy(config)
      : null,
};

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256', issuer: 'sru-event-hub', audience: 'sru-event-hub-api' },
      }),
    }),
  ],
  controllers: [AuthController, SignupController],
  providers: [AuthService, SignupService, JwtStrategy, optionalGoogle, GoogleEnabledGuard],
  exports: [AuthService, SignupService],
})
export class AuthModule {}
