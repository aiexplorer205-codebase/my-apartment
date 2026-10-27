import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function validateProductionConfig(config) {
  const errors = []
  const services = config.services ?? {}
  const required = (value) => typeof value === 'string' && value.trim() !== '' && !/example\.|replace|placeholder|localhost|myapartment\.local/i.test(value)
  const apps = ['api', 'login-web', 'resident-web', 'admin-web', 'operator-web']
  for (const name of [...apps, 'edge']) {
    const service = services[name] ?? {}
    if (!/@sha256:[a-f0-9]{64}$/.test(service.image ?? '')) errors.push(`${name}: immutable image digest required`)
    if (service.build) errors.push(`${name}: build must be removed`)
    if (name !== 'edge' && service.ports?.length) errors.push(`${name}: host ports forbidden`)
  }
  for (const name of ['postgres', 'redis']) {
    if (services[name]?.ports?.length) errors.push(`${name}: host ports forbidden`)
  }
  const bindings = services.edge?.ports ?? []
  if (bindings.length !== 3 || !bindings.some((port) => Number(port.target) === 8443 && String(port.published) === '8443' && port.host_ip === '127.0.0.1') ||
    bindings.some((port) => ![80, 443, 8443].includes(Number(port.target)) || (Number(port.target) !== 8443 && String(port.published) !== String(port.target)))) {
    errors.push('edge: only public 80/443 and loopback 8443 permitted')
  }
  const api = services.api?.environment ?? {}
  for (const key of ['AUTH0_DOMAIN', 'AUTH0_ISSUER', 'AUTH0_AUDIENCE', 'AUTH0_MGMT_CLIENT_ID', 'AUTH0_MGMT_CLIENT_SECRET', 'AUTH0_ADMIN_CLIENT_ID', 'AUTH0_ADMIN_CLIENT_SECRET', 'AUTH0_RESIDENT_CLIENT_ID', 'AUTH0_RESIDENT_CLIENT_SECRET', 'RESEND_API_KEY', 'RESEND_FROM', 'OPERATOR_IDS']) {
    if (!required(api[key])) errors.push(`api: configure ${key}`)
  }
  if (api.NODE_ENV !== 'production' || api.AUTH0_OTP_ENABLED !== 'true') errors.push('api: production and OTP must be enabled')
  if (api.AUTH0_ISSUER !== `https://${api.AUTH0_DOMAIN}/`) errors.push('api: issuer must match Auth0 domain with trailing slash')
  if (!(api.OPERATOR_IDS ?? '').split(',').map((value) => value.trim()).includes(api.OPERATOR_ID)) errors.push('api: primary operator must appear in OPERATOR_IDS')
  const password = services.postgres?.environment?.POSTGRES_PASSWORD ?? ''
  if (!required(password) || password.length < 32) errors.push('postgres: unique password of at least 32 characters required')
  for (const [key, database] of [['POSTGRES_PLATFORM_URL', 'myapartment_platform_db'], ['POSTGRES_TENANT_URL', 'myapartment_tenant_template']]) {
    try {
      const url = new URL(api[key])
      if (url.protocol !== 'postgresql:' || url.hostname !== 'postgres' || url.port !== '5432' || url.pathname !== `/${database}` || decodeURIComponent(url.username) !== 'postgres' || decodeURIComponent(url.password) !== password) throw new Error()
    } catch { errors.push(`api: ${key} must match the private database and password`) }
  }
  const edge = services.edge?.environment ?? {}
  const hosts = ['LOGIN_HOST', 'RESIDENT_HOST', 'ADMIN_HOST', 'OPERATOR_HOST'].map((key) => edge[key])
  if (hosts.some((host) => !required(host) || !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) || new Set(hosts).size !== 4) errors.push('edge: four distinct real DNS hostnames required')
  if (!required(edge.ACME_EMAIL) || !edge.ACME_EMAIL.includes('@')) errors.push('edge: certificate contact email required')
  const secrets = []
  for (const [name, host] of [['resident-web', edge.RESIDENT_HOST], ['admin-web', edge.ADMIN_HOST], ['operator-web', edge.OPERATOR_HOST]]) {
    const env = services[name]?.environment ?? {}
    const origin = `https://${host}${name === 'operator-web' ? ':8443' : ''}`
    if (env.APP_BASE_URL !== origin) errors.push(`${name}: incorrect HTTPS origin`)
    for (const key of ['AUTH0_CLIENT_ID', 'AUTH0_CLIENT_SECRET']) if (!required(env[key])) errors.push(`${name}: configure ${key}`)
    if (!/^[a-f0-9]{64,}$/i.test(env.AUTH0_SECRET ?? '')) errors.push(`${name}: generate a session secret with openssl rand -hex 32`)
    secrets.push(env.AUTH0_SECRET)
    if (env.NODE_ENV !== 'production') errors.push(`${name}: production required`)
  }
  if (new Set(secrets).size !== 3) errors.push('web: independent session secrets required')
  if (services['operator-web']?.environment?.OPERATOR_WEB_PRIVATE_INGRESS !== 'true') errors.push('operator: private ingress required')
  const expectedOrigins = [`https://${edge.RESIDENT_HOST}`, `https://${edge.ADMIN_HOST}`, `https://${edge.OPERATOR_HOST}:8443`].sort()
  if (JSON.stringify((api.CORS_ORIGINS ?? '').split(',').map((value) => value.trim()).sort()) !== JSON.stringify(expectedOrigins)) errors.push('api: CORS must match the three authenticated HTTPS origins')
  return errors
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = spawnSync('docker', ['compose', '--env-file', process.argv[2] ?? '.env.production', '-f', 'compose.yaml', '-f', 'compose.production.yaml', 'config', '--format', 'json'], { encoding: 'utf8' })
  // Rendered config contains credentials: never echo stdout or stderr.
  if (result.status !== 0) {
    console.error('Production Compose configuration could not be rendered. Check required variables, file permissions, and Compose version. No configuration values were printed.')
    process.exit(1)
  }
  let errors
  try { errors = validateProductionConfig(JSON.parse(result.stdout)) } catch { errors = ['Invalid Compose configuration'] }
  if (errors.length) {
    console.error(errors.join('\n'))
    process.exit(1)
  }
  console.log('Production configuration checks passed. Cloud, restore, security, and load gates still require verification.')
}
