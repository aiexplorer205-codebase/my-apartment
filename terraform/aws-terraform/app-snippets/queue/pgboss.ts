import PgBoss from 'pg-boss';
import type { JobQueue } from './index';

export async function createPgBossQueue(connectionString: string): Promise<JobQueue> {
  const boss = new PgBoss(connectionString);
  boss.on('error', (err) => console.error('[pg-boss]', err));

  // pg-boss 10+ requires queues to exist before use
  const ensure = async (name: string) => {
    await boss.createQueue(name);
  };

  return {
    start: async () => {
      await boss.start();
    },
    stop: async () => {
      await boss.stop();
    },
    enqueue: async (name, data, opts) => {
      await ensure(name);
      await boss.send(name, data as object, opts?.delaySeconds ? { startAfter: opts.delaySeconds } : {});
    },
    process: async (name, handler) => {
      await ensure(name);
      // pg-boss 10 hands the handler an array of jobs
      await boss.work(name, async (jobs) => {
        for (const job of jobs) await handler(job.data as never);
      });
    },
    schedule: async (name, cron, tz, data) => {
      await ensure(name);
      await boss.schedule(name, cron, (data ?? {}) as object, { tz });
    },
  };
}
