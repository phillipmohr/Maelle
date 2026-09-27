/**
 * Attachment storage (IRDR-455): raw MIME and attachments go to the Supabase Storage bucket
 * `attachments` (created by the foundation migration). Without Supabase credentials an in-memory
 * store is used (tests, dev server). Paths: raw/{ticketId}/{messageId}.eml and
 * tickets/{ticketId}/{messageId}/{index}-{filename}.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { isSupabaseConfigured, useServiceDb } from '../utils/supabase'
import type { AttachmentStore } from './types'

export class MemoryAttachmentStore implements AttachmentStore {
  readonly kind = 'memory' as const
  readonly files = new Map<string, { data: Buffer; contentType?: string }>()
  /** Tests: make the next put fail (simulates storage outage / crash mid-ingest). */
  failNextPut: Error | null = null

  async put(path: string, data: Buffer, contentType?: string): Promise<void> {
    if (this.failNextPut) {
      const e = this.failNextPut
      this.failNextPut = null
      throw e
    }
    this.files.set(path, { data: Buffer.from(data), contentType })
  }

  async get(path: string): Promise<Buffer | null> {
    return this.files.get(path)?.data ?? null
  }
}

export function createSupabaseAttachmentStore(
  client: Pick<SupabaseClient, 'storage'>,
  bucket = 'attachments',
): AttachmentStore {
  return {
    kind: 'supabase',
    async put(path, data, contentType) {
      const { error } = await client.storage.from(bucket).upload(path, data, {
        contentType: contentType ?? 'application/octet-stream',
        upsert: true,
      })
      if (error) throw new Error(`storage upload failed for ${path}: ${error.message}`)
    },
    async get(path) {
      const { data, error } = await client.storage.from(bucket).download(path)
      if (error) {
        if (/not found|404|does not exist/i.test(error.message)) return null
        throw new Error(`storage download failed for ${path}: ${error.message}`)
      }
      return Buffer.from(await data.arrayBuffer())
    },
  }
}

const g = globalThis as unknown as { __maelleMemoryStore?: MemoryAttachmentStore }

/** Supabase Storage when configured, else one in-memory store per process. */
export function createAttachmentStore(): AttachmentStore {
  if (isSupabaseConfigured()) return createSupabaseAttachmentStore(useServiceDb())
  if (!g.__maelleMemoryStore) g.__maelleMemoryStore = new MemoryAttachmentStore()
  return g.__maelleMemoryStore
}

/** A storage-safe file name: ASCII letters, digits, dot, dash, underscore; never empty. */
export function safeFileName(name: string | undefined | null, fallback = 'attachment'): string {
  const base = (name ?? '')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 100)
  return base || fallback
}
