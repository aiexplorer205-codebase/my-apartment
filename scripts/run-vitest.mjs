import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2).flatMap((arg) =>
  arg === '--runInBand'
    ? ['--maxWorkers=1', '--minWorkers=1']
    : [arg],
)
const vitestCli = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
const result = spawnSync(process.execPath, [vitestCli, 'run', ...args], {
  stdio: 'inherit',
})

if (result.error) {
  console.error(result.error)
  process.exitCode = 1
} else {
  process.exitCode = result.status ?? 1
}
