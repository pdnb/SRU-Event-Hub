'use client';

import { Form } from 'antd';
import type { ReactElement } from 'react';
import { Controller, type Control, type FieldPath, type FieldValues } from 'react-hook-form';

/**
 * Binds a React Hook Form field to an Ant Design input and shows the Zod/server
 * error under it. `children` receives { value, onChange, onBlur }.
 */
export function RhfField<T extends FieldValues>({
  control,
  name,
  label,
  required,
  help,
  valuePropName = 'value',
  children,
}: {
  control: Control<T>;
  name: FieldPath<T>;
  label?: string;
  required?: boolean;
  help?: string;
  valuePropName?: 'value' | 'checked';
  children: (field: { value: unknown; onChange: (v: unknown) => void; onBlur: () => void; id: string }) => ReactElement;
}) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Form.Item
          label={label}
          required={required}
          htmlFor={name}
          validateStatus={fieldState.error ? 'error' : undefined}
          help={fieldState.error?.message ?? help}
        >
          {children({
            value: valuePropName === 'checked' ? Boolean(field.value) : field.value,
            onChange: (v: unknown) => {
              const isEvent = v && typeof v === 'object' && 'target' in (v as object);
              const t = isEvent ? (v as { target: { value?: unknown; checked?: boolean } }).target : null;
              field.onChange(t ? (valuePropName === 'checked' ? t.checked : t.value) : v);
            },
            onBlur: field.onBlur,
            id: name,
          })}
        </Form.Item>
      )}
    />
  );
}
