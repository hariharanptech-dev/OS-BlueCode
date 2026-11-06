'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { getMe, changePassword, logout } from '@/lib/api/endpoints';
import { registerSchema } from '@/lib/validation/schemas';
import { Field, Btn } from '@/components/ui/Field';
import { User, KeyRound, LogOut, CheckCircle2, AlertCircle } from 'lucide-react';

const s = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: registerSchema.shape.password,
});
type F = z.infer<typeof s>;

export default function Settings() {
  const me = useQuery({ queryKey: ['me'], queryFn: getMe });
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<F>({ resolver: zodResolver(s) });

  return (
    <div className="max-w-md mx-auto space-y-6">
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-ink">Account Settings</h1>
        <p className="mt-1 text-sm muted">Manage your profile security and password.</p>
      </div>

      {/* Profile Overview */}
      <div className="card space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-tint text-signal">
            <User className="h-5 w-5" />
          </div>
          <div>
            <h2 className="font-bold text-ink text-base">{me.data?.name ?? 'Loading…'}</h2>
            <p className="text-xs muted">{me.data?.email ?? ''}</p>
          </div>
        </div>
      </div>

      {/* Change Password Card */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2 border-b border-line pb-3">
          <KeyRound className="h-4 w-4 text-signal" />
          <h2 className="font-bold text-ink">Change Password</h2>
        </div>

        {msg && (
          <div role="status" className="rounded-lg bg-ok/10 p-3 text-xs font-semibold text-ok border border-ok/20 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            <span>{msg}</span>
          </div>
        )}

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
            setMsg('');
            try {
              await changePassword(v);
              setMsg('Your password was updated successfully.');
              reset();
            } catch (e) {
              setErr((e as Error).message);
            }
          })}
          className="space-y-4"
        >
          <Field
            label="Current Password"
            secret
            error={errors.currentPassword?.message}
            {...register('currentPassword')}
          />
          <Field
            label="New Password"
            secret
            error={errors.newPassword?.message}
            {...register('newPassword')}
          />
          <Btn busy={isSubmitting}>Update Password</Btn>
        </form>
      </div>

      {/* Session Management */}
      <div className="card p-4 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-ink">Sign Out</h3>
          <p className="text-xs muted">End your active authenticated session.</p>
        </div>
        <button
          className="btn-quiet !w-auto text-xs py-2 px-3.5 flex items-center gap-1.5 text-warn hover:bg-warn/10 hover:border-warn/30"
          onClick={async () => {
            await logout().catch(() => {});
            window.location.href = '/login';
          }}
        >
          <LogOut className="h-3.5 w-3.5" />
          Log out
        </button>
      </div>
    </div>
  );
}
