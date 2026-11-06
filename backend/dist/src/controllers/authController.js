"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authController = void 0;
const schemas_1 = require("../validators/schemas");
const auth_1 = require("../middleware/auth");
const errors_1 = require("../utils/errors");
const authController = (svc) => ({
    register: async (req, res) => res.status(201).json({ user: await svc.register(schemas_1.registerSchema.parse(req.body)) }),
    login: async (req, res) => {
        const { email, password } = schemas_1.loginSchema.parse(req.body);
        const user = await svc.login(email, password);
        await new Promise((ok, bad) => req.session.regenerate((e) => (e ? bad(e) : ok()))); // prevent session fixation
        req.session.userId = user.id;
        res.json({ user, csrfToken: (0, auth_1.ensureCsrfToken)(req) });
    },
    logout: (req, res) => req.session.destroy(() => { res.clearCookie('bc.sid'); res.status(204).end(); }),
    me: async (req, res) => {
        const user = req.session.userId ? await svc.me(req.session.userId) : null;
        if (!user)
            throw (0, errors_1.unauthorized)();
        res.json({ user, csrfToken: (0, auth_1.ensureCsrfToken)(req) });
    },
});
exports.authController = authController;
