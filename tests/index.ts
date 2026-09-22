import { runAll } from './harness'

import './domain.test'
import './router.test'
import './csv.test'
import './agent.test'
import './autonomy.test'
import './summary.test'
import './store.test'
import './eval.test'
import './learning.test'

const code = await runAll()
process.exit(code)
