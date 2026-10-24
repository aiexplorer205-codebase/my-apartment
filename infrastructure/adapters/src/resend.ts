import type { EmailPort, PortFailure } from '@block9/ports'
import { ok, type Result } from '@block9/shared'

export class ResendEmailAdapter implements EmailPort {
  async sendTransactionEmail(_to: string, _template: string, _payload: Record<string, unknown>): Promise<Result<void, PortFailure>> {
    return ok(undefined) as Result<void, PortFailure>
  }
}
