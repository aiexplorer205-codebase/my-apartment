export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogContext = Record<string, string | number | boolean | null | undefined>

export interface Logger {
  debug(message: string, context?: LogContext): void
  info(message: string, context?: LogContext): void
  warn(message: string, context?: LogContext): void
  error(message: string, context?: LogContext): void
}

const REDACTED_VALUE = '[REDACTED]'
const SENSITIVE_KEY_PATTERN = /(secret|token|password|key|api[_-]?key|connection|string|dsn|cookie|authorization|jwt)/i

export class ConsoleLogger implements Logger {
  debug(message: string, context: LogContext = {}): void {
    console.debug('[debug]', redact(message, context))
  }

  info(message: string, context: LogContext = {}): void {
    console.info('[info]', redact(message, context))
  }

  warn(message: string, context: LogContext = {}): void {
    console.warn('[warn]', redact(message, context))
  }

  error(message: string, context: LogContext = {}): void {
    console.error('[error]', redact(message, context))
  }
}

function redact(message: string, context: LogContext): Record<string, unknown> {
  const safeContext: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(context)) {
    const shouldRedact = SENSITIVE_KEY_PATTERN.test(key)
    safeContext[key] = shouldRedact ? REDACTED_VALUE : value
  }

  return {
    message: redactDangerousText(message),
    ...safeContext,
  }
}

function redactDangerousText(value: string): string {
  return value
    .replace(/([A-Za-z0-9_-]*?(?:secret|token|password|api[_-]?key|connection|string|dsn|authorization)[A-Za-z0-9_-]*?=)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(postgres(?:ql)?:\/\/[^\s]+|redis:\/\/[^\s]+|mongodb:\/\/[^\s]+)/gi, '[REDACTED_CONNECTION_STRING]')
    .replace(/(Authorization:\s*Bearer\s+)[A-Za-z0-9._-]+/gi, '$1[REDACTED]')
}
