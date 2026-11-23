import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type Database from 'better-sqlite3';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { SessionStore } from './auth.js';
import { config } from './config.js';
import { initDatabase } from './db.js';
import { UserRow } from './serializers.js';
import { createAuthRouter } from './routes/auth.js';
import { createHelpRouter } from './routes/help.js';
import { createIncidentsRouter } from './routes/incidents.js';
import { createOperatorRouter } from './routes/operator.js';
import { createRoutesApiRouter } from './routes/routes_api.js';
import { createSosRouter } from './routes/sos.js';
import { seedDatabase } from './seed.js';

export interface CreateAppOptions {
  dbPath?: string;
  enableSocketIO?: boolean;
  enableRateLimit?: boolean;
}

export interface SaathAppContext {
  app: express.Express;
  server: http.Server;
  db: Database.Database;
  io: SocketIOServer | null;
  store: SessionStore;
}

export function createApp(options: CreateAppOptions = {}): SaathAppContext {
  const db = initDatabase(options.dbPath || config.sqlitePath);
  seedDatabase(db, false);

  const app = express();
  app.set('trust proxy', 1);
  const server = http.createServer(app);
  const store = new SessionStore();

  let io: SocketIOServer | null = null;
  if (options.enableSocketIO !== false) {
    io = new SocketIOServer(server, {
      cors: { origin: false },
    });

    io.on('connection', (socket) => {
      socket.join('public');

      const joinWithToken = (token?: string) => {
        // Leave prior user/operator rooms before joining new ones
        for (const room of socket.rooms) {
          if (room.startsWith('user:') || room === 'operators') {
            socket.leave(room);
          }
        }
        const session = store.get(token);
        if (session) {
          const user = db.prepare('SELECT id, role FROM users WHERE id = ?').get(session.userId) as
            | Pick<UserRow, 'id' | 'role'>
            | undefined;
          if (user) {
            socket.join(`user:${user.id}`);
            if (user.role === 'operator') {
              socket.join('operators');
            }
          }
        }
      };

      const initialToken =
        typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : undefined;
      joinWithToken(initialToken);

      socket.on('auth:sync', (payload: { token?: string }) => {
        joinWithToken(typeof payload?.token === 'string' ? payload.token : undefined);
      });
    });
  }

  app.use(express.json({ limit: '1mb' }));

  // Serve uploaded JPG/PNG evidence safely with strict path confinement
  fs.mkdirSync(config.uploadsDir, { recursive: true });
  app.get('/uploads/:filename', (req, res) => {
    const filename = path.basename(req.params.filename || '');
    if (!/^[a-zA-Z0-9._-]+$/.test(filename)) {
      res.status(400).json({ error: 'Invalid filename.', code: 'invalid_filename' });
      return;
    }
    const resolved = path.resolve(config.uploadsDir, filename);
    if (!resolved.startsWith(config.uploadsDir + path.sep) || !fs.existsSync(resolved)) {
      res.status(404).json({ error: 'File not found.', code: 'not_found' });
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.sendFile(resolved);
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api', createAuthRouter(db, store));
  app.use('/api', createIncidentsRouter(db, store, io, { enableRateLimit: options.enableRateLimit }));
  app.use('/api', createSosRouter(db, store, io, { enableRateLimit: options.enableRateLimit }));
  app.use('/api', createHelpRouter(db, store, io));
  app.use('/api', createRoutesApiRouter(db));
  app.use('/api', createOperatorRouter(db, store, io));

  // API JSON error fallback (never expose stack traces)
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.', code: 'not_found' });
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('[SAATH Server Error]', err.message);
    res.status(500).json({ error: 'An unexpected server error occurred.', code: 'internal_error' });
  });

  return { app, server, db, io, store };
}
