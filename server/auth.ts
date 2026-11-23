import crypto from 'node:crypto';
import type Database from 'better-sqlite3';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { UserRow } from './serializers.js';

export interface SessionRecord {
  userId: number;
  role: 'citizen' | 'operator';
  createdAt: number;
}

export interface AuthedRequest extends Request {
  user?: UserRow;
  authToken?: string;
}

export class SessionStore {
  private sessions = new Map<string, SessionRecord>();

  create(userId: number, role: 'citizen' | 'operator'): string {
    const token = crypto.randomBytes(32).toString('hex');
    this.sessions.set(token, { userId, role, createdAt: Date.now() });
    return token;
  }

  get(token: string | undefined): SessionRecord | undefined {
    if (!token) return undefined;
    return this.sessions.get(token);
  }

  delete(token: string | undefined): void {
    if (token) {
      this.sessions.delete(token);
    }
  }

  clear(): void {
    this.sessions.clear();
  }
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPasswordHash(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, keyHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    // Still perform fixed-length dummy compare to reduce timing variance
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export function isOperatorPasswordConfigured(db: Database.Database): {
  mode: 'env' | 'claimed' | 'unclaimed';
} {
  if (config.operatorPasswordEnv) {
    return { mode: 'env' };
  }
  const row = db.prepare('SELECT id FROM operator_credentials WHERE id = 1').get();
  return { mode: row ? 'claimed' : 'unclaimed' };
}

export function verifyOperatorPasscode(db: Database.Database, candidate: string): boolean {
  if (!candidate) return false;
  if (config.operatorPasswordEnv) {
    return constantTimeEquals(candidate, config.operatorPasswordEnv);
  }
  const row = db
    .prepare('SELECT password_hash FROM operator_credentials WHERE id = 1')
    .get() as { password_hash: string } | undefined;
  if (!row) {
    return false;
  }
  return verifyPasswordHash(candidate, row.password_hash);
}

export function extractBearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    return header.slice(7).trim();
  }
  return undefined;
}

export function createAuthMiddlewares(db: Database.Database, store: SessionStore) {
  const attachUser = (req: AuthedRequest, _res: Response, next: NextFunction) => {
    const token = extractBearerToken(req);
    const session = store.get(token);
    if (session) {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId) as
        | UserRow
        | undefined;
      if (user) {
        req.user = user;
        req.authToken = token;
      }
    }
    next();
  };

  const requireAuth = (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required. Please sign in first.', code: 'unauthorized' });
      return;
    }
    next();
  };

  const requireOperator = (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required. Please sign in as an operator.', code: 'unauthorized' });
      return;
    }
    if (req.user.role !== 'operator') {
      res.status(403).json({ error: 'Operator authorization required.', code: 'forbidden' });
      return;
    }
    next();
  };

  return { attachUser, requireAuth, requireOperator };
}
