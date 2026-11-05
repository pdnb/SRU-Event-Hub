import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Validates a setting value before it is saved; returns an error message or null. */
export type SettingValidator = (value: unknown) => string | null;

const validators = new Map<string, SettingValidator>();

/** Feature modules register stricter checks for structured settings (templates, mappings…). */
export function registerSettingValidator(key: string, fn: SettingValidator) {
  validators.set(key, fn);
}

export function validateSetting(key: string, value: unknown): string | null {
  return validators.get(key)?.(value) ?? null;
}

/**
 * Reads `system_settings` with a short in-process cache. A missing or invalid value falls back to
 * the caller's default, so a bad edit can never take a finance document offline.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);
  private readonly cache = new Map<string, { value: unknown; at: number }>();
  private static readonly TTL_MS = 30_000;

  constructor(private readonly prisma: PrismaService) {}

  async get<T>(key: string, fallback: T, check?: (v: unknown) => v is T): Promise<T> {
    const hit = this.cache.get(key);
    let value: unknown;
    if (hit && Date.now() - hit.at < SettingsService.TTL_MS) {
      value = hit.value;
    } else {
      value = (await this.prisma.systemSetting.findUnique({ where: { key } }))?.value;
      this.cache.set(key, { value, at: Date.now() });
    }
    if (value === undefined || value === null) return fallback;
    if (check && !check(value)) {
      this.logger.warn({ key }, 'Setting has an invalid shape – using the built-in default');
      return fallback;
    }
    return value as T;
  }

  invalidate(key?: string) {
    if (key) this.cache.delete(key);
    else this.cache.clear();
  }
}
