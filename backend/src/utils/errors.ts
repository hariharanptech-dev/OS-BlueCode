export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const badRequest = (m: string, c = 'BAD_REQUEST') => new AppError(400, c, m);
export const unauthorized = () => new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
export const notFound = (m = 'Not found') => new AppError(404, 'NOT_FOUND', m);
export const conflict = (m: string, c = 'CONFLICT') => new AppError(409, c, m);
