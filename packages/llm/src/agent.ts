import { generateText } from 'ai'
import type { RunAgentInput, RunAgentOutput } from './types.js'
import { resolveModel, TOOL_REGISTRY } from './tools.js'

export async function runAgent({ agentConfig, history, userMessage }: RunAgentInput): Promise<RunAgentOutput> {
  const model = resolveModel(agentConfig.model)

  const enabledTools = agentConfig.tools.reduce<Record<string, (typeof TOOL_REGISTRY)[string]>>(
    (acc, name) => {
      const t = TOOL_REGISTRY[name]
      if (t) acc[name] = t
      return acc
    },
    {},
  )

  const messages = [
    ...history,
    { role: 'user' as const, content: userMessage },
  ]

  const { text } = await generateText({
    model,
    system: agentConfig.system_prompt,
    messages,
    temperature: agentConfig.temperature,
    maxSteps: 5,
    ...(Object.keys(enabledTools).length > 0 && { tools: enabledTools }),
  })

  return { text }
}
