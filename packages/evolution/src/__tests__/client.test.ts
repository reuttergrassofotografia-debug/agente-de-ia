import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('EvolutionClient.sendText', () => {
  beforeEach(() => { mockFetch.mockReset() })

  it('POSTs to correct endpoint with apikey header', async () => {
    const { EvolutionClient } = await import('../client.js')
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })

    const client = new EvolutionClient('https://api.example.com', 'global-key')
    await client.sendText('my-instance', '5511999999999', 'Hello!')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/message/sendText/my-instance',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'global-key' }),
        body: JSON.stringify({ number: '5511999999999', text: 'Hello!' }),
      }),
    )
  })

  it('throws on non-ok response', async () => {
    const { EvolutionClient } = await import('../client.js')
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal error' })

    const client = new EvolutionClient('https://api.example.com', 'key')
    await expect(client.sendText('inst', '123', 'hi')).rejects.toThrow('Evolution API error 500')
  })
})

describe('extractMessageText', () => {
  it('extracts conversation text', async () => {
    const { extractMessageText } = await import('../client.js')
    const payload = {
      event: 'messages.upsert', instance: 'inst',
      data: {
        key: { remoteJid: '5511@s.whatsapp.net', fromMe: false, id: 'ID1' },
        message: { conversation: 'Hello there' },
        pushName: 'User',
      },
    }
    expect(extractMessageText(payload)).toBe('Hello there')
  })

  it('extracts extendedTextMessage text', async () => {
    const { extractMessageText } = await import('../client.js')
    const payload = {
      event: 'messages.upsert', instance: 'inst',
      data: {
        key: { remoteJid: '5511@s.whatsapp.net', fromMe: false, id: 'ID2' },
        message: { extendedTextMessage: { text: 'Extended hello' } },
        pushName: 'User',
      },
    }
    expect(extractMessageText(payload)).toBe('Extended hello')
  })

  it('returns null for non-text messages', async () => {
    const { extractMessageText } = await import('../client.js')
    const payload = {
      event: 'messages.upsert', instance: 'inst',
      data: {
        key: { remoteJid: '5511@s.whatsapp.net', fromMe: false, id: 'ID3' },
        message: {},
        pushName: 'User',
      },
    }
    expect(extractMessageText(payload)).toBeNull()
  })
})
