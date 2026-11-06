'use client';import {useForm} from 'react-hook-form';import {zodResolver} from '@hookform/resolvers/zod';import {useState,Suspense} from 'react';import {useSearchParams} from 'next/navigation';import {z} from 'zod';
import {resetPassword} from '@/lib/api/endpoints';import {registerSchema} from '@/lib/validation/schemas';import {Field,Btn} from '@/components/ui/Field';
const s=z.object({password:registerSchema.shape.password});type F=z.infer<typeof s>;
function ResetContent(){const token=useSearchParams().get('token')??'';const [ok,setOk]=useState(false);const [err,setErr]=useState('');const {register,handleSubmit,formState:{errors,isSubmitting}}=useForm<F>({resolver:zodResolver(s)});
 if(!token)return <p role="alert">This reset link is missing its token. Request a new one.</p>;
 if(ok)return <p role="status">Password updated. You can now log in.</p>;
 return <form onSubmit={handleSubmit(async v=>{setErr('');try{await resetPassword({token,password:v.password});setOk(true);}catch(e){setErr((e as Error).message);}})} noValidate className="max-w-sm space-y-4"><h1 className="text-2xl font-semibold">Choose a new password</h1>{err&&<p role="alert" className="text-sm text-red-600">{err}</p>}<Field label="New password" secret error={errors.password?.message} {...register('password')}/><Btn busy={isSubmitting}>Update password</Btn></form>;}
export default function Reset(){return <Suspense fallback={<p role="status">Loading…</p>}><ResetContent /></Suspense>;}
