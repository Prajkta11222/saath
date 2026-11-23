import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app.js';
import { config } from './server/config.js';

async function startServer() {
  const { app, server, db } = createApp();

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (req, res) => {
        if (req.path.startsWith('/api')) {
          res.status(404).json({ error: 'Endpoint not found', code: 'not_found' });
          return;
        }
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR !== 'true',
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const serverInstance = server.listen(config.port, '0.0.0.0', () => {
    console.log(`SAATH server listening on http://0.0.0.0:${config.port}`);
  });

  const shutdown = () => {
    console.log('Shutting down SAATH server gracefully...');
    serverInstance.close(() => {
      try {
        db.close();
      } catch {}
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('Failed to start SAATH server:', err);
  process.exit(1);
});
