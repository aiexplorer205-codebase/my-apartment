import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@block9/shared': path.resolve(root, 'packages/shared/src/index.ts'),
      '@block9/config': path.resolve(root, 'packages/config/src/index.ts'),
      '@block9/domain': path.resolve(root, 'packages/domain/src/index.ts'),
      '@block9/application': path.resolve(root, 'packages/application/src/index.ts'),
      '@block9/contracts': path.resolve(root, 'packages/contracts/src/index.ts'),
      '@block9/app-platform': path.resolve(root, 'packages/app-platform/src/index.ts'),
      '@block9/ports': path.resolve(root, 'infrastructure/ports/src/index.ts'),
      '@block9/adapters': path.resolve(root, 'infrastructure/adapters/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    ...(process.env.MYAPARTMENT_DATABASE_TESTS === '1' ? { maxWorkers: 2, minWorkers: 1, hookTimeout: 30000 } : {}),
    include: ['tests/**/*.spec.ts', 'packages/app-platform/tests/**/*.spec.ts'],
  },
})
