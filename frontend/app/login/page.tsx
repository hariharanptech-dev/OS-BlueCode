'use client';import {useForm} from 'react-hook-form';import {zodResolver} from '@hookform/resolvers/zod';import {useState} from 'react';import Link from 'next/link';import {z} from 'zod';
import {loginSchema} from '@/lib/validation/schemas';import {login} from '@/lib/api/endpoints';import {Field,Btn} from '@/components/ui/Field';
type F=z.infer<typeof loginSchema>;
export default function Login(){const [err,setErr]=useState('');const {register,handleSubmit,formState:{errors,isSubmitting}}=useForm<F>({resolver:zodResolver(loginSchema)});
 return <form noValidate onSubmit={handleSubmit(async v=>{setErr('');try{await login(v);window.location.href='/dashboard';}catch(e){setErr((e as Error).message);}})} className="space-y-4"><h1 className="text-2xl font-extrabold">Welcome back</h1>{err&&<p role="alert" className="rounded-field bg-warn/10 p-3 text-sm text-warn">{err}</p>}
 <Field label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')}/><Field label="Password" secret autoComplete="current-password" error={errors.password?.message} {...register('password')}/>
 <Btn busy={isSubmitting}>{isSubmitting?'Logging in…':'Log in'}</Btn><p className="text-sm"><Link className="underline" href="/forgot-password">Forgot password?</Link> · <Link className="underline" href="/register">New here? Sign up</Link></p></form>;}
