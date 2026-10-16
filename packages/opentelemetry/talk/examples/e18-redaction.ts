import { action } from '@reatom/core'
import { checkSensitiveNames, reatomOpentelemetry } from '@reatom/opentelemetry'

export const otel = reatomOpentelemetry({
  name: 'bank',
  endpoint: 'https://bank.example/otel',
  serviceName: 'bank-web',
})

checkSensitiveNames(otel)

type Login = { email: string; password: string }
type CardInput = { holder: string; cardNumber: string }

export const login = action(
  (credentials: Login) => credentials.email,
  'auth.login',
)

export const saveCard = action(
  (input: CardInput) => input.cardNumber.slice(-4),
  'billing.saveCard',
)
