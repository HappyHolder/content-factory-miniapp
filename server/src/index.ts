import express from 'express';
import cors from 'cors';
import fs from 'fs';
import { env } from './env';
import healthRouter from './routes/health';
import authRouter from './routes/auth';
import channelsRouter from './routes/channels';
import brandkitsRouter from './routes/brandkits';
import botRouter from './routes/bot';
import sourcesRouter from './routes/sources';
import postsRouter from './routes/posts';
import chatRouter from './routes/chat';
import adminRouter from './routes/admin';
import promoRouter from './routes/promo';
import paymentsRouter from './routes/payments';
import stylesRouter from './routes/styles';
import ogRouter from './routes/og';
import { startScheduler } from './lib/scheduler';

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Static file storage (replaces Vercel Blob) ─────────────────────────────────
// Serve uploaded/generated files at /uploads. In production nginx serves this
// path directly from the same volume for speed; this handler is the dev server
// and a safe fallback. The directory is created on boot so static serving works
// before the first upload.
fs.mkdirSync(env.STORAGE_DIR, { recursive: true });
app.use('/uploads', express.static(env.STORAGE_DIR, {
  maxAge: '30d',
  immutable: true,
  // Stored-XSS guard: never serve uploaded HTML/SVG as executable content.
  // (In production Caddy does the same; this covers the dev server and is a
  // defense-in-depth fallback.) Templates are only fetched server-side.
  setHeaders: (res, filePath) => {
    if (/\.(html?|xhtml|svg)$/i.test(filePath)) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment');
      res.setHeader('X-Content-Type-Options', 'nosniff');
    }
  },
}));

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/health',   healthRouter);
app.use('/api/auth',     authRouter);
app.use('/api/channels',  channelsRouter);
app.use('/api/brandkits', brandkitsRouter);
app.use('/api/bot',       botRouter);
app.use('/api/sources',   sourcesRouter);
app.use('/api/posts',     postsRouter);
app.use('/api/chat',      chatRouter);
app.use('/api/admin',     adminRouter);
app.use('/api/promo',     promoRouter);
app.use('/api/payments',  paymentsRouter);
app.use('/api/styles',    stylesRouter);
app.use('/api/og',        ogRouter);

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(env.PORT, () => {
  console.log(
    `[publium-api] Running on port ${env.PORT} (${env.NODE_ENV})`
  );
  startScheduler();
});

export default app;
