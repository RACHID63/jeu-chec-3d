import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createAuthRouter } from './auth-handler.js';
import { createGamesRouter } from './games-handler.js';

// ============================================================================
// CONFIGURATION DU SERVEUR WEB (VPS & DÉVELOPPEMENT)
// ============================================================================

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

async function startServer(): Promise<void> {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // Routes des parties sauvegardées (historique de coups jusqu'à 128 Ko)
  app.use('/api/games', express.json({ limit: '128kb' }), createGamesRouter());

  app.use(express.json({ limit: '16kb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Routes d'authentification, récupération par e-mail SMTP et statistiques joueur
  app.use('/api/auth', createAuthRouter({ defaultPort: PORT }));

  // ==========================================================================
  // SERVEUR FRONTEND (VITE EN DÉVELOPPEMENT, DIST STATIQUE SUR VPS)
  // ==========================================================================

  const distDir = path.resolve(process.cwd(), 'dist');
  const distIndex = path.resolve(distDir, 'index.html');
  const useProdDist =
    process.env.NODE_ENV === 'production' ||
    (process.env.NODE_ENV !== 'development' &&
      process.env.DISABLE_HMR !== 'true' &&
      fs.existsSync(distIndex));

  if (useProdDist && fs.existsSync(distIndex)) {
    app.use(express.static(distDir));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api/')) {
        res.status(404).json({ error: 'Route API introuvable.' });
        return;
      }
      res.sendFile(distIndex);
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, HOST, () => {
    console.log(`Échecs Antiques 3D démarré sur http://${HOST}:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Échec du démarrage du serveur:', err);
  process.exit(1);
});
