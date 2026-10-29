import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import type { JobQueue } from './index';

export async function createBullQueue(redisUrl: string): Promise<JobQueue> {
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queues = new Map<string, Queue>();
  const workers: Worker[] = [];

  const queue = (name: string): Queue => {
    let q = queues.get(name);
    if (!q) {
      q = new Queue(name, { connection });
      queues.set(name, q);
    }
    return q;
  };

  return {
    start: async () => {},
    stop: async () => {
      await Promise.all(workers.map((w) => w.close()));
      await Promise.all([...queues.values()].map((q) => q.close()));
      connection.disconnect();
    },
    enqueue: async (name, data, opts) => {
      await queue(name).add(name, data, {
        delay: (opts?.delaySeconds ?? 0) * 1000,
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
    },
    process: async (name, handler) => {
      workers.push(new Worker(name, async (job) => handler(job.data), { connection }));
    },
    schedule: async (name, cron, tz, data) => {
      // BullMQ 5.16+; on older versions use queue.add with { repeat: { pattern, tz } }
      await queue(name).upsertJobScheduler(`${name}:cron`, { pattern: cron, tz }, { name, data: data ?? {} });
    },
  };
}
