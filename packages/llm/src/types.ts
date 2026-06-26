import type { CoreMessage } from 'ai'
import type { Agent } from '@agente/db'

export type { CoreMessage }

export interface RunAgentInput {
  agentConfig: Agent
  history: CoreMessage[]
  userMessage: string
}

export interface RunAgentOutput {
  text: string
}
