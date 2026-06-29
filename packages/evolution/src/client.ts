import type { WebhookPayload, QrCodeResponse, ConnectionStateResponse } from './types.js'

export { type WebhookPayload }

export class EvolutionClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        apikey: this.apiKey,
        ...options.headers,
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Evolution API error ${res.status}: ${body}`)
    }
    return res.json() as Promise<T>
  }

  async sendText(instanceName: string, to: string, text: string): Promise<void> {
    await this.request(`/message/sendText/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({ number: to, text }),
    })
  }

  async sendMedia(instanceName: string, to: string, mediaBase64: string, mimetype: string, caption = ''): Promise<void> {
    const mediatype = mimetype.startsWith('image/') ? 'image' : mimetype.startsWith('video/') ? 'video' : 'document'
    await this.request(`/message/sendMedia/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({ number: to, mediatype, mimetype, caption, media: mediaBase64 }),
    })
  }

  async sendAudio(instanceName: string, to: string, audioBase64: string): Promise<void> {
    await this.request(`/message/sendWhatsAppAudio/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({ number: to, audio: audioBase64, encoding: true }),
    })
  }

  async getQrCode(instanceName: string): Promise<{ base64: string; status: string }> {
    const data = await this.request<QrCodeResponse>(`/instance/connect/${instanceName}`)
    return { base64: data.base64, status: data.status }
  }

  async getConnectionState(instanceName: string): Promise<'open' | 'close' | 'connecting'> {
    const data = await this.request<ConnectionStateResponse>(`/instance/connectionState/${instanceName}`)
    return data.instance.state
  }

  async createInstance(instanceName: string, webhookUrl: string, webhookSecret: string): Promise<void> {
    await this.request('/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName,
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: false,
          events: ['MESSAGES_UPSERT'],
          headers: { apikey: webhookSecret },
        },
      }),
    })
  }

  async deleteInstance(instanceName: string): Promise<void> {
    await this.request(`/instance/delete/${instanceName}`, { method: 'DELETE' })
  }
}

export function extractMessageText(payload: WebhookPayload): string | null {
  const msg = payload.data.message
  return msg.conversation ?? msg.extendedTextMessage?.text ?? null
}
