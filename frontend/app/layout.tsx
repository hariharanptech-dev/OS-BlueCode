import './globals.css';
import type { ReactNode } from 'react';
import Providers from './providers';
import Link from 'next/link';
import { Manrope } from 'next/font/google';
import { Boxes } from 'lucide-react';

const font = Manrope({ 
  subsets: ['latin'], 
  weight: ['400', '500', '600', '700', '800'], 
  display: 'swap', 
  preload: false,
  variable: '--font-manrope'
});

export const metadata = {
  title: 'Blue Code OS',
  description: 'Blue Code OS subscriptions, simple and secure.',
};

export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={font.className}>
        {process.env.NEXT_PUBLIC_USE_MOCK === 'true' && (
          <p role="status" className="bg-caution p-1.5 text-center text-xs font-semibold text-white">
            Mock mode: development data only
          </p>
        )}
        <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur-md">
          <nav aria-label="Main" className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5">
            <Link href="/" className="flex items-center gap-2.5 font-extrabold text-ink tracking-tight text-lg">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-signal text-white shadow-sm">
                <Boxes aria-hidden className="h-5 w-5" />
              </span>
              <span>Blue Code OS</span>
            </Link>
            <div className="flex items-center gap-1.5 text-sm font-semibold">
              <Link className="rounded-lg px-3 py-2 text-ink hover:bg-tint transition-colors" href="/pricing">
                Pricing
              </Link>
              <Link className="rounded-lg px-3 py-2 text-ink hover:bg-tint transition-colors" href="/dashboard">
                Dashboard
              </Link>
              <Link className="rounded-lg px-3 py-2 text-ink hover:bg-tint transition-colors" href="/login">
                Log in
              </Link>
              <Link
                className="ml-1 rounded-lg bg-signal px-4 py-2 font-bold text-white shadow-sm hover:brightness-105 transition-all"
                href="/register"
              >
                Get started
              </Link>
            </div>
          </nav>
        </header>
        <main className="mx-auto min-h-[75vh] max-w-6xl px-4 py-10 md:py-14">
          <Providers>{children}</Providers>
        </main>
        <footer className="border-t border-line py-8 text-center text-xs muted">
          Payments are securely processed by PayU (MID: 13844503) — supports Google Pay, UPI, Cards, NetBanking. We never see or store your payment details.
        </footer>
      </body>
    </html>
  );
}
