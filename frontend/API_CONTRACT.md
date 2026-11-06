# API contract (base /api/v1, cookie session, credentials: include)
Agreed: POST /auth/register, /auth/login, /auth/logout; GET /auth/me; GET /plans, /plans/:planId; GET /subscriptions/me; POST /payments/initiate {planId, idempotencyKey}; GET /payments/:orderId/status; GET /payments/history?page=n. POST /payments/payu/callback is server-only.
Response shapes the frontend assumes: see types/index.ts (Plan, InitiateResponse, StatusResponse, Subscription, History).
PROPOSED, needs backend confirmation (not in agreed contract): POST /auth/forgot-password {email}; POST /auth/reset-password {token,password}; POST /auth/change-password {currentPassword,newPassword}; `?page=n` and {items,page,pageCount} for history.
Rules: user identity from session only; amounts come from backend; payment success only from /status.
