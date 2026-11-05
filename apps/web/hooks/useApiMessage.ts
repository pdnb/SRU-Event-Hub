'use client';

import { App } from 'antd';
import { ApiError } from '@sru/api-client';

/** Consistent success/error toasts for mutations. */
export function useApiMessage() {
  const { message } = App.useApp();
  return {
    success: (text: string) => message.success(text),
    error: (err: unknown) => message.error(err instanceof ApiError ? err.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่'),
  };
}
