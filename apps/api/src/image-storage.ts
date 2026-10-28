import { S3ImageStorage } from '@block9/adapters'
import type { PrivateImageStoragePort } from '@block9/ports'
import { ApiFault } from './api-fault.js'

export const imageRetentionDays = (): number => {
  const days = Number(process.env.PHOTO_RETENTION_DAYS ?? 90)
  if (![30,90,180,365].includes(days)) throw new Error('PHOTO_RETENTION_DAYS must be 30, 90, 180 or 365')
  return days
}
export const imageStorageConfigured = () => Boolean(process.env.S3_BUCKET && process.env.S3_REGION)
let storage: PrivateImageStoragePort | undefined
export const imageStorage = (): PrivateImageStoragePort => {
  if (storage) return storage
  const bucket=process.env.S3_BUCKET?.trim(),region=process.env.S3_REGION?.trim(),endpoint=process.env.S3_ENDPOINT?.trim()
  if (!bucket || !region) throw new ApiFault(503,'configuration_error','Private photo storage is not configured')
  if (endpoint) {
    const url=new URL(endpoint)
    if (url.protocol!=='https:' && !(process.env.NODE_ENV!=='production' && ['localhost','127.0.0.1','minio'].includes(url.hostname))) throw new Error('S3 endpoint must use HTTPS')
  }
  const key=process.env.S3_ACCESS_KEY_ID,secret=process.env.S3_SECRET_ACCESS_KEY
  if (Boolean(key)!==Boolean(secret)) throw new Error('Both S3 credentials are required')
  storage=new S3ImageStorage(bucket,{region,endpoint,forcePathStyle:process.env.S3_FORCE_PATH_STYLE==='true',...(key&&secret?{credentials:{accessKeyId:key,secretAccessKey:secret}}:{})})
  return storage
}
export const storageUnavailable = () => new ApiFault(503,'dependency_unavailable','Photo storage is temporarily unavailable. Retry shortly.')
