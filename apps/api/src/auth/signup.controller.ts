import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Public, ReqMeta, type RequestMeta } from '../common/decorators';
import { SignupService } from './signup.service';

class SignupDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(10, { message: 'รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร' }) @MaxLength(200) password!: string;
  @IsString() @MinLength(2) @MaxLength(300) displayName!: string;
  @IsOptional() @Matches(/^(0\d{8,9})?$/, { message: 'เบอร์โทรศัพท์ไม่ถูกต้อง' }) phone?: string;
}

class EmailDto {
  @IsEmail() @MaxLength(254) email!: string;
}

class VerifyDto {
  @IsString() @MinLength(20) @MaxLength(200) token!: string;
}

/** Self sign-up + e-mail verification (external users / group coordinators). */
@ApiTags('auth')
@Controller('auth')
export class SignupController {
  constructor(private readonly signup: SignupService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'สมัครสมาชิก (บุคคลภายนอก) — ต้องยืนยันอีเมลก่อนเข้าสู่ระบบ' })
  @Post('register')
  @HttpCode(202)
  register(@Body() dto: SignupDto, @ReqMeta() m: RequestMeta) {
    return this.signup.register(dto, m);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('resend-verification')
  @HttpCode(202)
  resend(@Body() dto: EmailDto, @ReqMeta() m: RequestMeta) {
    return this.signup.resend(dto.email, m);
  }

  /** POST so the token never lands in URLs / access logs (the page reads it from the URL fragment). */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify-email')
  @HttpCode(200)
  verify(@Body() dto: VerifyDto, @ReqMeta() m: RequestMeta) {
    return this.signup.verify(dto.token, m);
  }
}
