import Fastify from 'fastify'
import cors from '@fastify/cors'
import { createSupabaseClient } from '@agente/db'
import { createRedisConnection, createMessageQueue } from '@agente/queue'
import { loadEnv } from './env.js'
import { registerWebhookRoute } from './routes/webhook.js'

const env = loadEnv()
const db = createSupabaseClient()
const redis = createRedisConnection(env.REDIS_URL)
const queue = createMessageQueue(redis)

const app = Fastify({ logger: true })
await app.register(cors)

registerWebhookRoute(app, { db, queue })

app.get('/', async (_req, reply) => reply.send({ ok: true }))

await app.listen({ port: env.PORT, host: '0.0.0.0' })
