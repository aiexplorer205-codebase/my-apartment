export type HttpStatus = 200 | 201 | 202 | 400 | 401 | 403 | 404 | 409 | 429 | 500

export interface ApiErrorResponse {
  error: string
  message: string
  requestId?: string
}

export interface HealthResponse {
  status: 'ok'
  service: string
  version: string
}

export interface OpenApiBootstrap {
  openapi: '3.1.0'
  info: {
    title: string
    version: string
  }
  servers?: Array<{ url: string; description?: string }>
  tags?: Array<{ name: string; description?: string }>
  paths: Record<string, unknown>
  components?: {
    schemas?: Record<string, unknown>
    securitySchemes?: Record<string, unknown>
  }
}
