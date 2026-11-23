import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createApp } from './server/app.js';
import { config } from './server/config.js';

async function startServer() {
  const { app, server } = createApp();

  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
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

  server.listen(config.port, '0.0.0.0', () => {
    console.log(`SAATH server listening on http://0.0.0.0:${config.port}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start SAATH server:', err);
  process.exit(1);
});
