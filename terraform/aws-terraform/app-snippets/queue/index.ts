// Switch queue backend with ONE env var: QUEUE_BACKEND=pgboss (default) | redis
// Install only what you use: `npm i pg-boss`  and/or  `npm i bullmq ioredis`.
// Adapter sketches: check method names against the pg-boss (10+) and BullMQ (5.16+) docs you install.

export type JobHandler<T = unknown> = (data: T) => Promise<void>;

export interface JobQueue {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Run a job once, optionally after a delay */
  enqueue<T>(name: string, data: T, opts?: { delaySeconds?: number }): Promise<void>;
  /** Register a worker for a queue (call this in the worker process only) */
  process<T>(name: string, handler: JobHandler<T>): Promise<void>;
  /** Recurring job, cron expression plus IANA timezone, e.g. 'Asia/Kolkata' */
  schedule(name: string, cron: string, tz: string, data?: unknown): Promise<void>;
}

export async function createQueue(): Promise<JobQueue> {
  const backend = process.env.QUEUE_BACKEND ?? 'pgboss';

  if (backend === 'redis') {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('QUEUE_BACKEND=redis needs REDIS_URL');
    return (await import('./bullmq')).createBullQueue(url);
  }

  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('QUEUE_BACKEND=pgboss needs DATABASE_URL');
  return (await import('./pgboss')).createPgBossQueue(dbUrl);
}

/*
Usage in your app and worker:

  const queue = await createQueue();
  await queue.start();

  // web app: enqueue
  await queue.enqueue('notify-completion', { taskId, tenantId });

  // worker.ts: process + schedule
  await queue.process('notify-completion', async (job: { taskId: string; tenantId: string }) => { ... });
  await queue.schedule('generate-task-occurrences', '0 5 * * *', 'Asia/Kolkata');
  await queue.process('generate-task-occurrences', async () => { ... });
*/
