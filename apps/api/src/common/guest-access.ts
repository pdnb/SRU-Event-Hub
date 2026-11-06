import { HttpStatus } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Guest (no login) access to one registration: reference number + the access token handed out at
 * registration. Unknown reference and wrong token give the same error so references cannot be enumerated.
 */
export async function guestRegistrationId(prisma: PrismaService, referenceNo: string, token: string): Promise<string> {
  const reg = await prisma.registration.findUnique({ where: { referenceNo: referenceNo.trim().toUpperCase() }, select: { id: true, accessTokenHash: true } });
  const given = Buffer.from(createHash('sha256').update(token).digest('hex'));
  if (!reg?.accessTokenHash || !timingSafeEqual(Buffer.from(reg.accessTokenHash), given)) {
    throw new AppError('NOT_FOUND', 'ไม่พบข้อมูลการลงทะเบียน', HttpStatus.NOT_FOUND);
  }
  return reg.id;
}
