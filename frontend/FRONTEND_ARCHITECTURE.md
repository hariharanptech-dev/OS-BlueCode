# Architecture
Next.js App Router, client pages using TanStack Query for reads and React Hook Form + Zod for writes. All HTTP goes through lib/api/client.ts (typed ApiError, same-origin /api/v1, proxied to BACKEND_URL via next.config.mjs). Mock mode (NEXT_PUBLIC_USE_MOCK=true) swaps in lib/mock.ts, shows a banner, and never reports payment success.
Payments: checkout sends planId + per-page idempotencyKey; backend returns total and PayU redirect fields; lib/payu.ts submits them. Result page polls /status.
Known gaps: no receipt links, no monthly/yearly toggle, no rendering tests. Route guard: AuthGate (client-side, 401 -> /login) wraps dashboard, subscription, billing and settings; the backend remains the real authority.
