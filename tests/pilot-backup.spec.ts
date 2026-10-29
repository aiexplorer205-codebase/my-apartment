import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const directories: string[] = []
afterEach(() => { for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'pilot-backup-')); directories.push(dir)
  const stub = (name: string, script: string) => writeFileSync(join(dir, name), `#!/bin/sh\nset -eu\n${script}\n`, { mode: 0o700 })
  stub('docker', 'if [ "${BACKUP_TEST_FAIL:-}" = 1 ]; then exit 7; fi\nprintf synthetic-dump')
  // This stub checks orchestration only; it deliberately does not simulate encryption.
  stub('age', 'cat >/dev/null\nprintf encrypted-test-fixture')
  stub('rclone', 'cat > "$BACKUP_TEST_ARCHIVE"')
  const archive = join(dir, 'archive.tar')
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, BACKUP_AGE_RECIPIENT: 'test-recipient', BACKUP_REMOTE: 'test:private', BACKUP_TEST_ARCHIVE: archive }
  return { dir, archive, env }
}
describe('encrypted backup orchestration', () => {
  it('refuses missing encryption configuration before contacting storage', () => {
    const f = fixture()
    expect(() => execFileSync('bash', [resolve('scripts/backup-databases.sh')], { env: { ...f.env, BACKUP_AGE_RECIPIENT: '' }, stdio: 'pipe' })).toThrow()
    expect(existsSync(f.archive)).toBe(false)
  })
  it('does not upload a partial backup after a failed dump', () => {
    const f = fixture()
    expect(() => execFileSync('bash', [resolve('scripts/backup-databases.sh')], { env: { ...f.env, BACKUP_TEST_FAIL: '1' }, stdio: 'pipe' })).toThrow()
    expect(existsSync(f.archive)).toBe(false)
  })
  it('archives both encrypted dumps, roles and checksums', () => {
    const f = fixture()
    execFileSync('bash', [resolve('scripts/backup-databases.sh')], { env: f.env, stdio: 'pipe' })
    const entries = execFileSync('tar', ['-tf', f.archive], { encoding: 'utf8' })
    for (const file of ['myapartment_platform_db.dump.age', 'myapartment_app_db.dump.age', 'roles.sql.age', 'SHA256SUMS']) expect(entries).toContain(file)
    const contents = execFileSync('tar', ['-xOf', f.archive, './myapartment_platform_db.dump.age'], { encoding: 'utf8' })
    expect(contents).toBe('encrypted-test-fixture')
  })
})
