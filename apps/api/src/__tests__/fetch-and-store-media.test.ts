import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@agente/db'

function makeMockDb(uploadError: unknown = null) {
  const upload = vi.fn(async () => ({ error: uploadError }))
  const storageFrom = vi.fn(() => ({ upload }))
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
  const from = vi.fn((table: string) => (table === 'messages' ? { update } : {}))
  const db = { storage: { from: storageFrom }, from } as unknown as SupabaseClient<Database>
  return { db, upload, storageFrom, update, from }
}

describe('fetchAndStoreMedia', () => {
  beforeEach(() => {
    process.env['EVOLUTION_API_URL'] = 'https://evo.test'
    process.env['EVOLUTION_API_KEY'] = 'test-key'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('downloads media, uploads it, and records the path on the message', async () => {
    const { fetchAndStoreMedia } = await import('../lib/fetch-and-store-media.js')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ base64: Buffer.from('fake-audio').toString('base64'), mimetype: 'audio/ogg' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { db, upload, update, storageFrom } = makeMockDb()

    await fetchAndStoreMedia(db, 'test-instance', 'ev-msg-1', 'msg-db-1')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://evo.test/chat/getBase64FromMediaMessage/test-instance',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: { key: { id: 'ev-msg-1' } } }),
      }),
    )
    expect(storageFrom).toHaveBeenCalledWith('whatsapp-media')
    expect(upload).toHaveBeenCalledWith('msg-db-1', expect.any(Buffer), { contentType: 'audio/ogg' })
    expect(update).toHaveBeenCalledWith({ media_path: 'msg-db-1', media_mimetype: 'audio/ogg' })
  })

  it('does nothing when the Evolution API request fails', async () => {
    const { fetchAndStoreMedia } = await import('../lib/fetch-and-store-media.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    const { db, upload, update } = makeMockDb()

    await fetchAndStoreMedia(db, 'test-instance', 'ev-msg-1', 'msg-db-1')

    expect(upload).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('does not update the message when the storage upload fails', async () => {
    const { fetchAndStoreMedia } = await import('../lib/fetch-and-store-media.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ base64: Buffer.from('x').toString('base64'), mimetype: 'image/jpeg' }),
    })))
    const { db, update } = makeMockDb(new Error('bucket full'))

    await fetchAndStoreMedia(db, 'test-instance', 'ev-msg-1', 'msg-db-1')

    expect(update).not.toHaveBeenCalled()
  })

  it('never throws even if fetch itself rejects', async () => {
    const { fetchAndStoreMedia } = await import('../lib/fetch-and-store-media.js')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const { db } = makeMockDb()

    await expect(fetchAndStoreMedia(db, 'test-instance', 'ev-msg-1', 'msg-db-1')).resolves.toBeUndefined()
  })
})
