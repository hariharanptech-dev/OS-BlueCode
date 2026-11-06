'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import Link from 'next/link';
import { z } from 'zod';
import { registerSchema } from '@/lib/validation/schemas';
import { register as signUp } from '@/lib/api/endpoints';
import { Field, Btn } from '@/components/ui/Field';
import { UserPlus, AlertCircle } from 'lucide-react';

type F = z.infer<typeof registerSchema>;

export default function Register() {
  const [err, setErr] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<F>({ resolver: zodResolver(registerSchema) });

  const go = async (v: F) => {
    setErr('');
    try {
      await signUp(v);
      window.location.href = '/pricing';
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="max-w-sm mx-auto space-y-6">
      <div className="text-center space-y-1">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-tint text-signal mb-3">
          <UserPlus className="h-6 w-6" />
        </div>
        <h1 className="text-2xl font-extrabold text-ink tracking-tight">Create Account</h1>
        <p className="text-sm muted">Join Blue Code OS and activate your environment</p>
      </div>

      <div className="card space-y-5">
        {err && (
          <div role="alert" className="rounded-lg bg-warn/10 p-3 text-xs font-semibold text-warn border border-warn/20 flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{err}</span>
          </div>
        )}

        <form onSubmit={handleSubmit(go)} noValidate className="space-y-4">
          <Field
            label="Full Name"
            autoComplete="name"
            placeholder="John Doe"
            error={errors.name?.message}
            {...register('name')}
          />
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
            autoComplete="new-password"
            placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
            error={errors.password?.message}
            {...register('password')}
          />
          <Btn busy={isSubmitting}>{isSubmitting ? 'Creating account…' : 'Create Account'}</Btn>
        </form>

        <div className="pt-2 border-t border-line text-center text-xs muted">
          Already have an account?{' '}
          <Link className="font-semibold text-signal hover:underline" href="/login">
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}
