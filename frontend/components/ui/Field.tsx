'use client';import {forwardRef,useState,type InputHTMLAttributes,type ButtonHTMLAttributes} from 'react';import {Eye,EyeOff,Loader2} from 'lucide-react';
type P=InputHTMLAttributes<HTMLInputElement>&{label:string;error?:string;secret?:boolean};
export const Field=forwardRef<HTMLInputElement,P>(function Field({label,error,secret,...r},ref){
 const [show,setShow]=useState(false);
 return <div><label className="block text-sm font-semibold">{label}<span className="relative mt-1.5 block"><input ref={ref} aria-invalid={!!error} type={secret&&!show?'password':secret?'text':r.type??'text'} className={`input ${secret?'pr-11':''} ${error?'!border-warn':''}`} {...r}/>
 {secret&&<button type="button" aria-label={show?'Hide password':'Show password'} onClick={()=>setShow(!show)} className="absolute right-3 top-3 muted hover:opacity-100">{show?<EyeOff className="h-5 w-5"/>:<Eye className="h-5 w-5"/>}</button>}</span></label>
 {error&&<p role="alert" className="mt-1 text-sm text-warn">{error}</p>}</div>;});
export function Btn({busy,children,...r}:{busy?:boolean}&ButtonHTMLAttributes<HTMLButtonElement>){return <button {...r} disabled={busy||r.disabled} className="btn">{busy&&<Loader2 aria-hidden className="mr-2 h-4 w-4 animate-spin"/>}{children}</button>;}
