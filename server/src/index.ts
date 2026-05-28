import express from 'express';
import cors from 'cors';
import { env } from './env';
import healthRouter from './routes/health';
import authRouter from './routes/auth';
import channelsRouter from './routes/channels';
import brandkitsRouter from './routes/brandkits';
import botRouter from './routes/bot';
import sourcesRouter from './routes/sources';
import postsRouter from './routes/posts';
import { startScheduler } from './lib/scheduler';

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/health',   healthRouter);
app.use('/api/auth',     authRouter);
app.use('/api/channels',  channelsRouter);
app.use('/api/brandkits', brandkitsRouter);
app.use('/api/bot',       botRouter);
app.use('/api/sources',   sourcesRouter);
app.use('/api/posts',     postsRouter);

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(env.PORT, () => {
  console.log(
    `[content-factory-api] Running on port ${env.PORT} (${env.NODE_ENV})`
  );
  startScheduler();
});

export default app;
