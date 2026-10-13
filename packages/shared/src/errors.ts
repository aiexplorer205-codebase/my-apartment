export class DomainError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DomainError'
    this.code = code
  }
}

export class AuthorizationError extends DomainError {
  constructor(message = 'Authorization failed') {
    super('AUTHORIZATION_FAILED', message)
  }
}

export class NotFoundError extends DomainError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} was not found`)
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super('VALIDATION_FAILED', message)
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super('CONFLICT', message)
  }
}
