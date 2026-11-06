"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const helmet_1 = __importDefault(require("helmet"));
const cors_1 = __importDefault(require("cors"));
const express_session_1 = __importDefault(require("express-session"));
const connect_pg_simple_1 = __importDefault(require("connect-pg-simple"));
const pg_1 = require("pg");
const client_1 = require("@prisma/client");
const prismaPaymentRepository_1 = require("./repositories/prismaPaymentRepository");
const client_2 = require("./integrations/payu/client");
const paymentService_1 = require("./services/paymentService");
const subscriptionService_1 = require("./services/subscriptionService");
const authService_1 = require("./services/authService");
const authController_1 = require("./controllers/authController");
const paymentController_1 = require("./controllers/paymentController");
const routes_1 = require("./routes");
const rateLimit_1 = require("./middleware/rateLimit");
const errorHandler_1 = require("./middleware/errorHandler");
function createApp(cfg) {
    const db = new client_1.PrismaClient();
    const repo = new prismaPaymentRepository_1.PrismaPaymentRepository(db);
    const gateway = new client_2.PayuClient(cfg.payu);
    const payments = new paymentService_1.PaymentService(repo, gateway, cfg.payu, { backendUrl: cfg.backendUrl });
    const app = (0, express_1.default)();
    app.disable('x-powered-by');
    app.set('trust proxy', 1);
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)({ origin: cfg.frontendUrl, credentials: true, methods: ['GET', 'POST'], allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'Idempotency-Key'] }));
    app.use(rateLimit_1.globalLimiter);
    app.use(express_1.default.json({ limit: '10kb' }));
    const PgStore = (0, connect_pg_simple_1.default)(express_session_1.default);
    app.use((0, express_session_1.default)({
        name: 'bc.sid', secret: cfg.sessionSecret, resave: false, saveUninitialized: false,
        store: new PgStore({ pool: new pg_1.Pool({ connectionString: cfg.databaseUrl }), createTableIfMissing: true }),
        cookie: { httpOnly: true, secure: cfg.isProd, sameSite: 'lax', maxAge: 7 * 86_400_000 },
    }));
    app.get('/healthz', (_q, r) => r.json({ ok: true }));
    app.use('/api/v1', (0, routes_1.buildRoutes)({
        auth: (0, authController_1.authController)(new authService_1.AuthService(db)), plans: (0, paymentController_1.planController)(repo),
        subs: (0, paymentController_1.subscriptionController)(new subscriptionService_1.SubscriptionService(repo)), pay: (0, paymentController_1.paymentController)(payments, cfg),
    }));
    app.use(errorHandler_1.notFoundHandler);
    app.use(errorHandler_1.errorHandler);
    return app;
}
