import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@nivasa/shared': path.resolve(root, 'packages/shared/src/index.ts'),
      '@nivasa/config': path.resolve(root, 'packages/config/src/index.ts'),
      '@nivasa/domain': path.resolve(root, 'packages/domain/src/index.ts'),
      '@nivasa/application': path.resolve(root, 'packages/application/src/index.ts'),
      '@nivasa/contracts': path.resolve(root, 'packages/contracts/src/index.ts'),
      '@nivasa/ports': path.resolve(root, 'infrastructure/ports/src/index.ts'),
      '@nivasa/adapters': path.resolve(root, 'infrastructure/adapters/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
  },
})
