'use client';import {useForm} from 'react-hook-form';import {zodResolver} from '@hookform/resolvers/zod';import {useState} from 'react';import {z} from 'zod';
import {forgotPassword} from '@/lib/api/endpoints';import {Field,Btn} from '@/components/ui/Field';
const s=z.object({email:z.string().email('Enter a valid email address')});type F=z.infer<typeof s>;
export default function Forgot(){const [done,setDone]=useState(false);const [err,setErr]=useState('');const {register,handleSubmit,formState:{errors,isSubmitting}}=useForm<F>({resolver:zodResolver(s)});
 if(done)return <p role="status" className="max-w-sm">If an account exists for that email, a reset link is on its way.</p>;
 return <form onSubmit={handleSubmit(async v=>{setErr('');try{await forgotPassword(v);setDone(true);}catch(e){setErr((e as Error).message);}})} noValidate className="max-w-sm space-y-4"><h1 className="text-2xl font-semibold">Reset your password</h1>{err&&<p role="alert" className="text-sm text-red-600">{err}</p>}<Field label="Email" type="email" error={errors.email?.message} {...register('email')}/><Btn busy={isSubmitting}>Send reset link</Btn></form>;}
