import type { NextFunction, Request, Response } from 'express';

type Bucket = { count: number; resetAt: number };
type Options = { windowMs: number; max: number; key?: (req: Request) => string; skip?: (req: Request) => boolean };

export function rateLimit(options: Options) {
  const buckets = new Map<string, Bucket>();
  return (req: Request, res: Response, next: NextFunction): void => {
    if (options.skip?.(req)) { next(); return; }
    const now = Date.now();
    const key = options.key?.(req) ?? req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const current = buckets.get(key);
    const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + options.windowMs } : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    res.setHeader('RateLimit-Limit', String(options.max));
    res.setHeader('RateLimit-Remaining', String(Math.max(0, options.max - bucket.count)));
    res.setHeader('RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));
    if (bucket.count > options.max) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      res.status(429).json({ error: 'Слишком много запросов. Попробуйте позже.' });
      return;
    }
    if (buckets.size > 10_000) for (const [id, value] of buckets) if (value.resetAt <= now) buckets.delete(id);
    next();
  };
}
