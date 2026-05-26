import express from 'express';
import cors from 'cors';
import { env } from './env';
import healthRouter from './routes/health';

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/api/health', healthRouter);

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(env.PORT, () => {
  console.log(
    `[content-factory-api] Running on port ${env.PORT} (${env.NODE_ENV})`
  );
});

export default app;
