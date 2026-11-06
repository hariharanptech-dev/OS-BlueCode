# Backend Architecture
Layers: routes → controllers → services → repositories → Prisma/PostgreSQL; `integrations/payu` isolates all gateway specifics behind the `PayuGateway` interface and pure hash functions.

- `PaymentService` depends on a `PaymentRepository` interface, so business rules are tested with an in-memory repo (`tests/core`) and run in production on `PrismaPaymentRepository`.
- Atomicity lives in the repository: `succeedAndActivate` = CAS to SUCCESS + create Subscription in one DB transaction; `Subscription.paymentId` is UNIQUE so double activation cannot commit.
- Subscription rule: start = max(now, current active expiry); expiry = start + `Plan.durationDays`.
- Shared entities (agree with the database module before changing): User, Plan, Payment, Subscription, PaymentEvent, IdempotencyRecord — UUID ids, money in integer paise. Schema: `prisma/schema.prisma`.
