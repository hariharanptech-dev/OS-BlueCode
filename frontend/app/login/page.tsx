'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { loginSchema } from '@/lib/validation/schemas';
import { login } from '@/lib/api/endpoints';
import { Field, Btn } from '@/components/ui/Field';
import { Lock, AlertCircle } from 'lucide-react';

type F = z.infer<typeof loginSchema>;

export default function Login() {
  const [err, setErr] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<F>({ resolver: zodResolver(loginSchema) });

  return (
    <div className="max-w-sm mx-auto space-y-6">
      <div className="text-center space-y-1">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-tint text-signal mb-3">
          <Lock className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-extrabold text-ink tracking-tight">Sign In</h1>
        <p className="text-sm muted">Access your Blue Code OS workspace</p>
      </div>

      <div className="card space-y-5">
        {err && (
          <div role="alert" className="rounded-lg bg-warn/10 p-3 text-xs font-semibold text-warn border border-warn/20 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        <form
          noValidate
          onSubmit={handleSubmit(async (v) => {
            setErr('');
            try {
              await login(v);
              window.location.href = '/dashboard';
            } catch (e) {
              setErr((e as Error).message);
            }
          })}
          className="space-y-4"
        >
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            error={errors.email?.message}
            {...register('email')}
          />
          <Field
            label="Password"
            secret
            autoComplete="current-password"
            placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
            error={errors.password?.message}
            {...register('password')}
          />
          <Btn busy={isSubmitting}>{isSubmitting ? 'Signing in…' : 'Sign in'}</Btn>
        </form>

        <div className="pt-2 border-t border-line text-center space-y-2 text-xs">
          <div>
            <Link className="font-semibold text-signal hover:underline" href="/forgot-password">
              Forgot your password?
            </Link>
          </div>
          <div className="muted">
            Don't have an account?{' '}
            <Link className="font-semibold text-signal hover:underline" href="/register">
              Sign up
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
