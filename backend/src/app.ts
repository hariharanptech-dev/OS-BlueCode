import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import session from 'express-session';
import connectPg from 'connect-pg-simple';
import { Pool } from 'pg';
import { PrismaClient } from '@prisma/client';
import { AppConfig } from './config';
import { PrismaPaymentRepository } from './repositories/prismaPaymentRepository';
import { PayuClient } from './integrations/payu/client';
import { PaymentService } from './services/paymentService';
import { SubscriptionService } from './services/subscriptionService';
import { AuthService } from './services/authService';
import { authController } from './controllers/authController';
import { paymentController, planController, subscriptionController } from './controllers/paymentController';
import { buildRoutes } from './routes';
import { globalLimiter } from './middleware/rateLimit';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

export function createApp(cfg: AppConfig) {
  const db = new PrismaClient();
  const repo = new PrismaPaymentRepository(db);
  const gateway = new PayuClient(cfg.payu);
  const payments = new PaymentService(repo, gateway, cfg.payu, { backendUrl: cfg.backendUrl });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: cfg.frontendUrl, credentials: true, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'] }));
  app.use(globalLimiter);
  app.use(express.json({ limit: '10kb' }));

  const PgStore = connectPg(session);
  app.use(session({
    name: 'bc.sid', secret: cfg.sessionSecret, resave: false, saveUninitialized: false,
    store: new PgStore({ pool: new Pool({ connectionString: cfg.databaseUrl }), createTableIfMissing: true }),
    cookie: { httpOnly: true, secure: cfg.isProd, sameSite: 'lax', maxAge: 7 * 86_400_000 },
  }));

  app.get('/healthz', (_q, r) => r.json({ ok: true }));
  app.use('/api/v1', buildRoutes({
    auth: authController(new AuthService(db)), plans: planController(repo as any),
    subs: subscriptionController(new SubscriptionService(repo)), pay: paymentController(payments, cfg),
  }));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
