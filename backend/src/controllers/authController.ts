import { Request, Response } from 'express';
import { AuthService } from '../services/authService';
import { loginSchema, registerSchema } from '../validators/schemas';
import { ensureCsrfToken } from '../middleware/auth';
import { unauthorized } from '../utils/errors';

export const authController = (svc: AuthService) => ({
  register: async (req: Request, res: Response) => res.status(201).json({ user: await svc.register(registerSchema.parse(req.body)) }),
  login: async (req: Request, res: Response) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await svc.login(email, password);
    await new Promise<void>((ok, bad) => req.session.regenerate((e) => (e ? bad(e) : ok()))); // prevent session fixation
    req.session.userId = user.id;
    res.json({ user, csrfToken: ensureCsrfToken(req) });
  },
  logout: (req: Request, res: Response) => req.session.destroy(() => { res.clearCookie('bc.sid'); res.status(204).end(); }),
  me: async (req: Request, res: Response) => {
    const user = req.session.userId ? await svc.me(req.session.userId) : null;
    if (!user) throw unauthorized();
    res.json({ user, csrfToken: ensureCsrfToken(req) });
  },
});
