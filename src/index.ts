import { env } from './infrastructure/config/env'
import { logger } from './infrastructure/logging/logger'
import { broker } from './infrastructure/realtime/realtime-broker'
import { app } from './presentation/http/app'

await broker.start()

app.listen(env.port)

logger.info({ port: env.port }, '🦊 Restaurant order server running')

async function shutdown(): Promise<void> {
  await broker.stop()
  await app.stop()
  process.exit(0)
}

process.on('SIGINT', () => {
  shutdown().catch((err) => {
    logger.error({ err }, 'error during shutdown')
    process.exit(1)
  })
})
process.on('SIGTERM', () => {
  shutdown().catch((err) => {
    logger.error({ err }, 'error during shutdown')
    process.exit(1)
  })
})
