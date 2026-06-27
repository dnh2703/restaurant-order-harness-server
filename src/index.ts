import { env } from './infrastructure/config/env'
import { broker } from './infrastructure/realtime/realtime-broker'
import { app } from './presentation/http/app'

await broker.start()

app.listen(env.port)

console.info(`🦊 Restaurant order server running at http://localhost:${env.port}/api`)

async function shutdown(): Promise<void> {
  await broker.stop()
  await app.stop()
  process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
