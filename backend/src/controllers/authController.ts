import { Request, Response } from 'express';
import { AuthService } from '../services/authService';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '../validators/schemas';
import { ensureCsrfToken } from '../middleware/auth';
import { unauthorized } from '../utils/errors';

export const authController = (svc: AuthService) => ({
  register: async (req: Request, res: Response) => {
    const user = await svc.register(registerSchema.parse(req.body));
    res.status(201).json({ id: user.id, email: user.email, name: user.name, user });
  },
  login: async (req: Request, res: Response) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await svc.login(email, password);
    await new Promise<void>((ok, bad) => req.session.regenerate((e) => (e ? bad(e) : ok()))); // prevent session fixation
    req.session.userId = user.id;
    const csrfToken = ensureCsrfToken(req);
    res.json({ id: user.id, email: user.email, name: user.name, user, csrfToken });
  },
  logout: (req: Request, res: Response) =>
    req.session.destroy(() => {
      res.clearCookie('bc.sid');
      res.status(204).end();
    }),
  me: async (req: Request, res: Response) => {
    const user = req.session.userId ? await svc.me(req.session.userId) : null;
    if (!user) throw unauthorized();
    const csrfToken = ensureCsrfToken(req);
    res.json({ id: user.id, email: user.email, name: user.name, user, csrfToken });
  },
  forgotPassword: async (req: Request, res: Response) => {
    const { email } = forgotPasswordSchema.parse(req.body);
    res.json(await svc.forgotPassword(email));
  },
  resetPassword: async (req: Request, res: Response) => {
    const { token, password } = resetPasswordSchema.parse(req.body);
    res.json(await svc.resetPassword(token, password));
  },
  changePassword: async (req: Request, res: Response) => {
    const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
    res.json(await svc.changePassword(req.session.userId!, currentPassword, newPassword));
  },
});
