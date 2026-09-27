/**
 * Where reply attachments (the chargeback timeline) are stored. The executor sends attachments from
 * the reply draft's `storagePath`, so the store only needs `put`. Supabase Storage in production
 * (bucket `attachments`, created by the foundation migration), memory in tests and the dev server.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface StoredAttachment {
  storagePath: string
  sizeBytes: number
  contentType: string
}

export interface AttachmentStore {
  readonly kind: 'supabase' | 'memory'
  put(path: string, body: Buffer | string, contentType: string): Promise<StoredAttachment>
}

export const ATTACHMENTS_BUCKET = 'attachments'

export function createMemoryAttachmentStore(): AttachmentStore & {
  files: Map<string, { body: Buffer; contentType: string }>
} {
  const files = new Map<string, { body: Buffer; contentType: string }>()
  return {
    kind: 'memory',
    files,
    async put(path, body, contentType) {
      const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body
      files.set(path, { body: buf, contentType })
      return { storagePath: path, sizeBytes: buf.byteLength, contentType }
    },
  }
}

export function createSupabaseAttachmentStore(
  client: Pick<SupabaseClient, 'storage'>,
): AttachmentStore {
  return {
    kind: 'supabase',
    async put(path, body, contentType) {
      const buf = typeof body === 'string' ? Buffer.from(body, 'utf8') : body
      const { error } = await client.storage
        .from(ATTACHMENTS_BUCKET)
        .upload(path, buf, { contentType, upsert: true })
      if (error) throw new Error(`Storage upload failed: ${error.message}`)
      return { storagePath: path, sizeBytes: buf.byteLength, contentType }
    },
  }
}
