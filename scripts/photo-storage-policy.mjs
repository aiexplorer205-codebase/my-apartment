export function photoStoragePolicy(origins) {
  if (!Array.isArray(origins) || !origins.length || origins.some(origin => {
    try { const url = new URL(origin); return url.origin !== origin || (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname)) } catch { return true }
  })) throw new Error('Set exact HTTPS S3_ALLOWED_ORIGINS (localhost is allowed for development)')
  return {
    lifecycle: { Rules: [
      { ID: 'myapartment-staging', Status: 'Enabled', Filter: { Prefix: 'staging/' }, Expiration: { Days: 1 }, AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 } },
      ...[30,90,180,365].map(days => ({ ID: `myapartment-photos-${days}d`, Status: 'Enabled', Filter: { Prefix: `media/retention-${days}d/` }, Expiration: { Days: days } })),
    ] },
    cors: { CORSRules: [{ ID: 'myapartment-private-images', AllowedOrigins: origins, AllowedMethods: ['PUT','GET','HEAD'], AllowedHeaders: ['content-type','x-amz-meta-sha256'], ExposeHeaders: ['ETag'], MaxAgeSeconds: 300 }] },
  }
}

export function mergePhotoStoragePolicy(existingLifecycle, existingCors, desired) {
  const foreign = (existingLifecycle.Rules ?? []).filter(rule => !rule.ID?.startsWith('myapartment-'))
  for (const rule of foreign) {
    if (rule.Status !== 'Enabled') continue
    const prefix = rule.Filter?.Prefix ?? rule.Prefix
    if (typeof prefix !== 'string' || ['staging/','media/'].some(managed => prefix.startsWith(managed) || managed.startsWith(prefix))) {
      throw new Error('Existing lifecycle overlaps media retention; use a dedicated bucket')
    }
  }
  const cors = (existingCors.CORSRules ?? []).filter(rule => rule.ID !== 'myapartment-private-images')
  const approved = new Set(desired.cors.CORSRules[0].AllowedOrigins)
  if (cors.some(rule => rule.AllowedOrigins?.some(origin => !approved.has(origin)))) throw new Error('Existing CORS allows unapproved origins; use a dedicated bucket')
  return { lifecycle: { Rules: [...foreign,...desired.lifecycle.Rules] }, cors: { CORSRules: [...cors,...desired.cors.CORSRules] } }
}
