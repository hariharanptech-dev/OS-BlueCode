'use client';import {useForm} from 'react-hook-form';import {zodResolver} from '@hookform/resolvers/zod';import {useState} from 'react';import Link from 'next/link';import {z} from 'zod';
import {registerSchema} from '@/lib/validation/schemas';import {register as signUp} from '@/lib/api/endpoints';import {Field,Btn} from '@/components/ui/Field';
type F=z.infer<typeof registerSchema>;
export default function Register(){const [err,setErr]=useState('');const {register,handleSubmit,formState:{errors,isSubmitting}}=useForm<F>({resolver:zodResolver(registerSchema)});
 const go=async(v:F)=>{setErr('');try{await signUp(v);window.location.href='/pricing';}catch(e){setErr((e as Error).message);}};
 return <form onSubmit={handleSubmit(go)} noValidate className="max-w-sm space-y-4"><h1 className="text-2xl font-semibold">Create your account</h1>{err&&<p role="alert" className="text-sm text-red-600">{err}</p>}
 <Field label="Full name" autoComplete="name" error={errors.name?.message} {...register('name')}/><Field label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')}/><Field label="Password" secret autoComplete="new-password" error={errors.password?.message} {...register('password')}/>
 <Btn busy={isSubmitting}>{isSubmitting?'Creating account…':'Create account'}</Btn><p className="text-sm">Have an account? <Link className="underline" href="/login">Log in</Link></p></form>;}
