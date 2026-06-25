export interface WebhookPayload {
  event: string
  instance: string
  data: {
    key: {
      remoteJid: string
      fromMe: boolean
      id: string
    }
    message: {
      conversation?: string
      extendedTextMessage?: { text: string }
    }
    pushName?: string
  }
}

export interface QrCodeResponse {
  base64: string
  code: string
  status: string
}

export interface ConnectionStateResponse {
  instance: {
    state: 'open' | 'close' | 'connecting'
  }
}
