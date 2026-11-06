"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthService = void 0;
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const errors_1 = require("../utils/errors");
const DUMMY = bcryptjs_1.default.hashSync('not-a-real-password', 12); // equalises timing for unknown emails
class AuthService {
    db;
    constructor(db) {
        this.db = db;
    }
    async register(i) {
        if (await this.db.user.findUnique({ where: { email: i.email } }))
            throw new errors_1.AppError(409, 'EMAIL_TAKEN', 'Unable to register with these details');
        const u = await this.db.user.create({ data: { email: i.email, name: i.name, phone: i.phone, passwordHash: await bcryptjs_1.default.hash(i.password, 12) } });
        return { id: u.id, email: u.email, name: u.name };
    }
    async login(email, password) {
        const u = await this.db.user.findUnique({ where: { email } });
        const ok = await bcryptjs_1.default.compare(password, u?.passwordHash ?? DUMMY);
        if (!u || !ok)
            throw new errors_1.AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
        return { id: u.id, email: u.email, name: u.name };
    }
    async me(id) { return this.db.user.findUnique({ where: { id }, select: { id: true, email: true, name: true } }); }
}
exports.AuthService = AuthService;
