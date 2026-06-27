import { env } from './infrastructure/config/env'
import { app } from './presentation/http/app'

app.listen(env.port)

console.info(`🦊 Restaurant order server running at http://localhost:${env.port}/api`)
