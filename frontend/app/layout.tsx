import './globals.css';import type {ReactNode} from 'react';import Providers from './providers';import Link from 'next/link';import {Manrope} from 'next/font/google';import {Boxes} from 'lucide-react';
const font=Manrope({subsets:['latin'],weight:['400','500','600','700','800']});
export const metadata={title:'Blue Code OS',description:'Blue Code OS subscriptions, simple and secure.'};
export default function Root({children}:{children:ReactNode}){return <html lang="en"><body className={font.className}>
{process.env.NEXT_PUBLIC_USE_MOCK==='true'&&<p role="status" className="bg-caution p-1 text-center text-xs font-semibold text-paper">Mock mode: development data only</p>}
<header className="sticky top-0 z-10 border-b border-line bg-paper/85 backdrop-blur"><nav aria-label="Main" className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
<Link href="/" className="flex items-center gap-2 font-extrabold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-signal text-paper"><Boxes aria-hidden className="h-5 w-5"/></span>Blue Code OS</Link>
<div className="flex items-center gap-1 text-sm font-semibold"><Link className="rounded-lg px-3 py-2 hover:bg-tint" href="/pricing">Pricing</Link><Link className="rounded-lg px-3 py-2 hover:bg-tint" href="/dashboard">Dashboard</Link><Link className="rounded-lg px-3 py-2 hover:bg-tint" href="/login">Log in</Link><Link className="ml-1 rounded-lg bg-signal px-4 py-2 text-paper" href="/register">Get started</Link></div></nav></header>
<main className="mx-auto min-h-[70vh] max-w-6xl px-4 py-10 md:py-14"><Providers>{children}</Providers></main>
<footer className="border-t border-line py-8 text-center text-sm muted">Payments are processed by PayU. We never see or store your card details.</footer></body></html>;}
