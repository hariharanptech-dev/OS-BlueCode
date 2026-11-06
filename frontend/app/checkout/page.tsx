'use client';import {useRef,useState} from 'react';import {useSearchParams} from 'next/navigation';import {initiatePayment} from '@/lib/api/endpoints';import {checkoutSchema} from '@/lib/validation/schemas';import {submitPayuRedirect} from '@/lib/payu';import type {InitiateResponse} from '@/types';import {z} from 'zod';
export default function Checkout(){const planId=useSearchParams().get('plan')??'';const [terms,setTerms]=useState(false);const [busy,setBusy]=useState(false);const [err,setErr]=useState('');const [order,setOrder]=useState<InitiateResponse|null>(null);
 const key=useRef(crypto.randomUUID());
 async function start(){if(busy)return;const p=checkoutSchema.safeParse({planId,acceptTerms:terms});if(!p.success){setErr(p.error.issues[0]?.message??'Check your details');return;}
  setBusy(true);setErr('');
  try{const o=await initiatePayment({planId,idempotencyKey:key.current});setOrder(o);submitPayuRedirect(o.redirect);}catch(e){setErr((e as Error).message);setBusy(false);}}
 return <div className="max-w-md space-y-4"><h1 className="text-2xl font-semibold">Checkout</h1><p className="text-sm">Plan: {planId||'none selected'}</p>
 {order&&<p className="text-sm">Total payable: {order.currency} {order.total} (confirmed by server)</p>}
 <label className="flex gap-2 text-sm"><input type="checkbox" checked={terms} onChange={e=>setTerms(e.target.checked)}/>I accept the terms of service</label>
 {err&&<p role="alert" className="text-sm text-red-600">{err}</p>}
 <button onClick={start} disabled={busy||!planId} className="w-full rounded-field bg-signal p-2 text-white disabled:opacity-50">{busy?'Redirecting to PayU…':'Pay with PayU'}</button>
 <p className="text-xs opacity-70">The amount is calculated by our server. Card details are entered on PayU, never here.</p></div>;}
