import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'
import type { LanguageModel, CoreTool } from 'ai'
import { tool } from 'ai'
import { z } from 'zod'

export function resolveModel(modelId: string): LanguageModel {
  if (modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('o3')) {
    return openai(modelId)
  }
  if (modelId.startsWith('claude-')) {
    return anthropic(modelId)
  }
  throw new Error(`Unsupported model: ${modelId}. Add provider mapping in packages/llm/src/tools.ts`)
}

export const TOOL_REGISTRY: Record<string, CoreTool> = {
  get_current_time: tool({
    description: 'Returns the current date and time in ISO 8601 format.',
    parameters: z.object({}),
    execute: async () => ({ datetime: new Date().toISOString() }),
  }),
}
