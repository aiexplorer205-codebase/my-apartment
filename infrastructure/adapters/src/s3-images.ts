import { DeleteObjectCommand, DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { PrivateImageStoragePort } from '@block9/ports'

export class S3ImageStorage implements PrivateImageStoragePort {
  private readonly client: S3Client
  constructor(private readonly bucket: string, options: ConstructorParameters<typeof S3Client>[0]) {
    this.client = new S3Client({ ...options, requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', maxAttempts: 2 })
  }
  async presignUpload(key: string, size: number, sha256: string) {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: 'image/webp', ContentLength: size, Metadata: { sha256 } })
    const url = await getSignedUrl(this.client, command, { expiresIn: 300, signableHeaders: new Set(['content-type', 'content-length']), unhoistableHeaders: new Set(['x-amz-meta-sha256']) })
    return { url, headers: { 'Content-Type': 'image/webp', 'x-amz-meta-sha256': sha256 } }
  }
  async readStaged(key: string, maximumBytes: number): Promise<Uint8Array> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: AbortSignal.timeout(10000) })
    if (!response.Body) throw new Error('Missing upload')
    const stream = response.Body as AsyncIterable<Uint8Array> & { destroy?: () => void }
    try {
      if (!response.ContentLength || response.ContentLength > maximumBytes || response.ContentType !== 'image/webp') throw new Error('Invalid uploaded object')
      const chunks: Uint8Array[] = []; let size = 0
      for await (const chunk of stream) {
        size += chunk.length
        if (size > maximumBytes) throw new Error('Upload too large')
        chunks.push(chunk)
      }
      return Buffer.concat(chunks)
    } finally { stream.destroy?.() }
  }
  async putImage(key: string, body: Uint8Array) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: 'image/webp', CacheControl: 'private, no-store', ContentDisposition: 'inline; filename="photo.webp"' }), { abortSignal: AbortSignal.timeout(10000) })
  }
  async presignImage(key: string, expiresIn: number) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key, ResponseContentType: 'image/webp', ResponseCacheControl: 'private, no-store', ResponseContentDisposition: 'inline; filename="photo.webp"' }), { expiresIn })
  }
  async deleteObject(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }), { abortSignal: AbortSignal.timeout(10000) })
  }
  async deletePrefix(prefix: string) {
    if (!prefix.endsWith('/') || prefix.length < 20) throw new Error('Invalid deletion prefix')
    // Always list the first page: deleting while walking a continuation token can
    // skip keys on some S3-compatible providers. This loop is safely retryable.
    for (;;) {
      const page = await this.client.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, MaxKeys: 1000 }), { abortSignal: AbortSignal.timeout(10000) })
      if (!page.Contents?.length) return
      const result = await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: page.Contents.map(object => ({ Key: object.Key! })), Quiet: true } }), { abortSignal: AbortSignal.timeout(10000) })
      if (result.Errors?.length) throw new Error('Storage deletion incomplete')
    }
  }
}
