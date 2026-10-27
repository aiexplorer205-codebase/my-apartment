import { afterAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { validateProductionConfig } from '../scripts/validate-production.mjs'

const directory = mkdtempSync(join(tmpdir(), 'myapartment-deploy-'))
const environmentFile = join(directory, 'fixture.env')
const password = 'test-only-db-password-01234567890123456789'
const fixture: Record<string, string> = {
  POSTGRES_PASSWORD: password,
  POSTGRES_PLATFORM_URL: `postgresql://postgres:${password}@postgres:5432/myapartment_platform_db`,
  POSTGRES_TENANT_URL: `postgresql://postgres:${password}@postgres:5432/myapartment_tenant_template`,
  LOGIN_HOST: 'login.block9.online', RESIDENT_HOST: 'app.block9.online',
  ADMIN_HOST: 'admin.block9.online', OPERATOR_HOST: 'ops.block9.online',
  ACME_EMAIL: 'deploy@block9.online', AUTH0_DOMAIN: 'pilot.auth0.com',
  AUTH0_ISSUER: 'https://pilot.auth0.com/', AUTH0_AUDIENCE: 'https://api.block9.online',
  OPERATOR_IDS: 'auth0|test-operator', OPERATOR_ID: 'auth0|test-operator',
  CORS_ORIGINS: 'https://app.block9.online,https://admin.block9.online,https://ops.block9.online:8443',
  RESEND_API_KEY: 'test-only-resend-key', RESEND_FROM: 'no-reply@block9.online',
  AUTH0_MGMT_CLIENT_ID: 'test-mgmt', AUTH0_MGMT_CLIENT_SECRET: 'test-mgmt-secret',
}
for (const name of ['API', 'LOGIN', 'RESIDENT', 'ADMIN', 'OPERATOR', 'CADDY']) fixture[`${name}_IMAGE`] = `registry.invalid/${name.toLowerCase()}@sha256:${'a'.repeat(64)}`
for (const [index, name] of ['RESIDENT', 'ADMIN', 'OPERATOR'].entries()) {
  fixture[`AUTH0_${name}_CLIENT_ID`] = `test-${name}`
  fixture[`AUTH0_${name}_CLIENT_SECRET`] = `test-${name}-client-secret`
  fixture[`AUTH0_${name}_SECRET`] = String(index + 1).repeat(64)
}
writeFileSync(environmentFile, '')
afterAll(() => rmSync(directory, { recursive: true, force: true }))

function render() {
  const result = spawnSync('docker', ['compose', '--env-file', environmentFile, '-f', 'compose.yaml', '-f', 'compose.production.yaml', 'config', '--format', 'json'], {
    encoding: 'utf8', env: { ...process.env, ...fixture, COMPOSE_PROFILES: '' },
  })
  // Fixture values only; never read a real environment file or start containers.
  if (result.status !== 0) throw new Error('Deployment fixture requires Docker Compose >= 2.24.4 (no daemon needed)')
  return JSON.parse(result.stdout)
}

describe('production deployment boundaries', () => {
  it('removes inherited local ports/builds and validates production settings', () => {
    const config = render()
    expect(validateProductionConfig(config)).toEqual([])
    for (const name of ['postgres', 'redis', 'api', 'login-web', 'resident-web', 'admin-web', 'operator-web']) expect(config.services[name].ports ?? []).toEqual([])
    expect(config.services['reverse-proxy']?.profiles ?? ['local-only']).toContain('local-only')
    expect(config.services.worker?.profiles ?? ['local-only']).toContain('local-only')
  })

  it('rejects an accidentally exposed operator port', () => {
    const config = render()
    config.services.edge.ports.find((port: { target: number }) => port.target === 8443).host_ip = '0.0.0.0'
    expect(validateProductionConfig(config)).toContain('edge: only public 80/443 and loopback 8443 permitted')
    config.services['operator-web'].ports = [{ target: 3000, published: '3101' }]
    expect(validateProductionConfig(config)).toContain('operator-web: host ports forbidden')
  })

  it('rejects mutable releases, reused session secrets, and wrong database credentials', () => {
    const config = render()
    config.services.api.image = 'registry.invalid/api:latest'
    config.services['admin-web'].environment.AUTH0_SECRET = config.services['resident-web'].environment.AUTH0_SECRET
    config.services.api.environment.POSTGRES_PLATFORM_URL = 'postgresql://postgres:wrong@postgres:5432/myapartment_platform_db'
    const errors = validateProductionConfig(config)
    expect(errors).toContain('api: immutable image digest required')
    expect(errors).toContain('web: independent session secrets required')
    expect(errors).toContain('api: POSTGRES_PLATFORM_URL must match the private database and password')
  })

  it('fails closed on placeholder authentication or mismatched web origins', () => {
    const config = render()
    config.services.api.environment.AUTH0_DOMAIN = 'example.auth0.com'
    config.services.api.environment.CORS_ORIGINS = '*'
    config.services['operator-web'].environment.APP_BASE_URL = 'http://localhost:3101'
    const errors = validateProductionConfig(config)
    expect(errors).toContain('api: configure AUTH0_DOMAIN')
    expect(errors).toContain('api: CORS must match the three authenticated HTTPS origins')
    expect(errors).toContain('operator-web: incorrect HTTPS origin')
  })

  it('does not print secret values when validation fails', () => {
    const file = join(directory, 'invalid.env')
    writeFileSync(file, Object.entries({ ...fixture, AUTH0_ADMIN_SECRET: 'invalid-test-secret-never-print' }).map(([key, value]) => `${key}=${value}`).join('\n'), { mode: 0o600 })
    const environment = { ...process.env }
    for (const key of Object.keys(fixture)) delete environment[key]
    const result = spawnSync(process.execPath, ['scripts/validate-production.mjs', file], { encoding: 'utf8', env: environment })
    expect(result.status).toBe(1)
    expect(result.stdout + result.stderr).not.toContain('invalid-test-secret-never-print')
    expect(result.stderr).toContain('admin-web: generate a session secret')
  })
})

describe('production backup recovery', () => {
  function backup(uploadFails: boolean) {
    const log = join(directory, `backup-${uploadFails}.log`)
    // Exercise maintenance/recovery ordering without a daemon, network, or live data.
    const docker = `#!/bin/sh
printf '%s\\n' "$*" >> "$BACKUP_TEST_LOG"
case "$*" in
  *"ps -q --status running"*) echo fixture-container ;;
  *"pg_dumpall -U postgres"*) echo 'fixture SQL dump' ;;
esac
`
    writeFileSync(join(directory, 'docker'), docker, { mode: 0o700 })
    writeFileSync(join(directory, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o700 })
    writeFileSync(join(directory, 'aws'), '#!/bin/sh\ncat >/dev/null\nexit "$BACKUP_TEST_UPLOAD_STATUS"\n', { mode: 0o700 })
    const result = spawnSync('bash', ['scripts/backup-production.sh', 's3://test-backup-bucket/database'], {
      encoding: 'utf8', env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, BACKUP_TEST_LOG: log, BACKUP_TEST_UPLOAD_STATUS: uploadFails ? '1' : '0' },
    })
    return { result, commands: readFileSync(log, 'utf8') }
  }

  it('quiesces writers before dumping and waits for healthy apps afterward', () => {
    const { result, commands } = backup(false)
    expect(result.status).toBe(0)
    expect(commands.indexOf('stop -t 60')).toBeLessThan(commands.indexOf('pg_dumpall -U postgres'))
    expect(commands.indexOf('pg_dumpall -U postgres')).toBeLessThan(commands.indexOf('start --wait'))
    expect(result.stdout).toContain('Backup uploaded:')
  })

  it('propagates upload failure and still restarts the apps', () => {
    const { result, commands } = backup(true)
    expect(result.status).not.toBe(0)
    expect(commands).toContain('start --wait api login-web resident-web admin-web operator-web')
    expect(result.stdout).not.toContain('Backup uploaded:')
  })
})
