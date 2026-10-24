import type { CachePort, PortFailure, QueuePort } from '@block9/ports'
import { ok, err, type Result } from '@block9/shared'

export class RedisCacheAdapter implements CachePort {
  private readonly cache = new Map<string, unknown>()

  async get<T>(key: string): Promise<T | undefined> {
    return this.cache.get(key) as T | undefined
  }

  async set<T>(key: string, value: T, _ttlSeconds: number): Promise<void> {
    this.cache.set(key, value)
  }

  async del(key: string): Promise<void> {
    this.cache.delete(key)
  }
}

export class BullMqQueueAdapter implements QueuePort {
  async enqueue(jobName: string, payload: Record<string, unknown>): Promise<Result<string, PortFailure>> {
    if (!jobName) {
      return err<PortFailure>({ name: 'PortFailure', code: 'UNAUTHORIZED' } as PortFailure)
    }
    return ok(`${jobName}:${JSON.stringify(payload)}`) as Result<string, PortFailure>
  }

  async drain(): Promise<void> {
    return undefined
  }
}
