# Blue Code OS frontend (partial first build)

Next.js 14 (App Router), strict TypeScript, Tailwind, React Hook Form + Zod, TanStack Query.

## Run
    npm install
    cp .env.example .env.local
    npm run dev        # also: npm run typecheck, npm test, npm run build

## Built
All screens from the brief: landing, register, login, forgot/reset password, pricing, checkout, payment result, dashboard, subscription, billing (paginated), settings. Mock mode via NEXT_PUBLIC_USE_MOCK=true. Docs: API_CONTRACT, FRONTEND_ARCHITECTURE, DESIGN_SYSTEM, ROUTE_AND_COMPONENT_MAP.

## Not done
shadcn/ui, receipts, monthly/yearly toggle, rendering tests. Route guards (client-side AuthGate), plan comparison table and a visual redesign are done.

## Status
Never installed, built or tested (no network here). Run `npm install && npm run typecheck && npm test && npm run build` yourself.
