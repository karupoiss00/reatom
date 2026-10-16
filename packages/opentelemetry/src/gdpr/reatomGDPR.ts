import {
  atom,
  reatomForm,
  withInit,
  withLocalStorage,
  type Atom,
  type FormAtom,
} from '@reatom/core'

import type { ReatomOpentelemetry } from '../reatomOpentelemetry.ts'

export const DEFAULT_GDPR_CATEGORIES = {
  diagnostics: false,
  analytics: false,
  marketing: false,
} as const

export type GdprCategories = {
  diagnostics: boolean
  analytics: boolean
  marketing: boolean
}

export type GdprFormState<
  Categories extends Record<string, boolean> = GdprCategories,
> = {
  [Key in keyof GdprCategories | keyof Categories]: boolean
}

export type GdprConsentSnapshot<
  Categories extends Record<string, boolean> = GdprCategories,
> = {
  submitted: true
  categories: GdprFormState<Categories>
}

const isInstanceList = (
  value: ReatomOpentelemetry | readonly ReatomOpentelemetry[],
): value is readonly ReatomOpentelemetry[] => Array.isArray(value)

const asList = (
  value: ReatomOpentelemetry | readonly ReatomOpentelemetry[] | undefined,
): ReatomOpentelemetry[] => {
  if (value == null) return []
  return isInstanceList(value) ? [...value] : [value]
}

const persistKeyOf = (name: string, persist: boolean | string): string =>
  typeof persist === 'string' ? persist : `reatom.gdpr.${name}`

const booleanRecord = (value: unknown): Record<string, boolean> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const categories: Record<string, boolean> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'boolean') return
    categories[key] = entry
  }
  return categories
}

const readStoredConsent = (
  key: string,
): { submitted: true; categories: Record<string, boolean> } | undefined => {
  try {
    const record = withLocalStorage.storageAtom().get({ key })
    if (!record || record instanceof Promise) return
    const data = record.data
    if (!data || typeof data !== 'object' || Array.isArray(data)) return
    if (!('submitted' in data) || data.submitted !== true) return
    const categories = booleanRecord(
      'categories' in data ? data.categories : undefined,
    )
    if (!categories) return
    return { submitted: true, categories }
  } catch {
    return
  }
}

const projectConsent = (
  categories: Record<string, boolean>,
  diagnosticsOffered: boolean,
): Record<string, boolean> => {
  const consent = { ...categories }
  if (!diagnosticsOffered) delete consent.diagnostics
  return consent
}

const writeConsent = (
  instance: ReatomOpentelemetry,
  categories: Record<string, boolean>,
  diagnosticsOffered: boolean,
) => {
  const consent = projectConsent(categories, diagnosticsOffered)
  instance.options.set((current) => ({
    ...current,
    consent,
  }))
}

export interface ReatomGDPROptions<
  Categories extends Record<string, boolean> = GdprCategories,
> {
  name?: string
  categories?: Categories
  instances?: ReatomOpentelemetry | readonly ReatomOpentelemetry[]
  otel?: ReatomOpentelemetry | readonly ReatomOpentelemetry[]
  persist?: boolean | string
}

export type ReatomGDPR<
  Categories extends Record<string, boolean> = GdprCategories,
> = FormAtom<GdprFormState<Categories>, undefined, void, []> & {
  /**
   * Last submitted categories. Live `fields.*` are a draft until `submit`.
   * After submit, `snapshot().categories` has a boolean for every category.
   * Analytics must read this atom, not the checkboxes. Persist restores it.
   */
  snapshot: Atom<GdprConsentSnapshot<Categories> | null>
}

/**
 * Consent form of category booleans. Submit writes `consent` and updates
 * {@link ReatomGDPR.snapshot}. It does not rewrite `signals`. Explicit
 * `diagnostics: false` holds the tracer. A form that does not offer diagnostics
 * leaves trace export as it was. Attaching an instance leaves signals
 * unchanged, so the tracer keeps exporting until an explicit denial. Persist
 * uses `withLocalStorage` (memory fallback where Web Storage is missing). This
 * is not legal advice.
 */
export const reatomGDPR = <
  Categories extends Record<string, boolean> = GdprCategories,
>(
  options: ReatomGDPROptions<Categories> = {},
): ReatomGDPR<Categories> => {
  const name = options.name ?? 'consent'
  const persist = options.persist ?? true
  const instances = [...asList(options.instances), ...asList(options.otel)]
  const persistKey = persist === false ? undefined : persistKeyOf(name, persist)
  const stored = persistKey ? readStoredConsent(persistKey) : undefined
  const schema: Record<string, boolean> = {
    ...(options.categories ?? DEFAULT_GDPR_CATEGORIES),
  }
  const diagnosticsOffered = Object.hasOwn(schema, 'diagnostics')
  const stateFrom = (
    restored: Record<string, boolean> | undefined,
  ): GdprFormState<Categories> => {
    const state: Record<string, boolean> = { ...schema }
    if (restored) {
      for (const key of Object.keys(state)) {
        const value = restored[key]
        if (typeof value === 'boolean') state[key] = value
      }
    }
    return state as GdprFormState<Categories>
  }
  const initial = stateFrom(stored?.categories)

  const apply = (categories: Record<string, boolean>) => {
    for (const instance of instances)
      writeConsent(instance, categories, diagnosticsOffered)
  }

  const consentRecord = (value: unknown): value is Record<string, boolean> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return false
    return Object.values(value).every((entry) => typeof entry === 'boolean')
  }

  const snapshot = atom<GdprConsentSnapshot<Categories> | null>(
    stored ? { submitted: true, categories: initial } : null,
    `${name}.snapshot`,
  )
  if (persistKey) snapshot.extend(withLocalStorage(persistKey))

  const applySubmitted = (value: GdprConsentSnapshot<Categories> | null) => {
    if (!value?.submitted) return
    apply(value.categories)
  }

  const form = reatomForm(initial, {
    name,
    onSubmit: (categories) => {
      const submitted = categories as GdprFormState<Categories>
      snapshot.set({ submitted: true, categories: submitted })
      apply(submitted)
    },
  })

  snapshot.subscribe(applySubmitted)

  for (const instance of instances) {
    instance.options.extend(
      withInit((state) => {
        if (consentRecord(state.consent)) return state
        const saved = persistKey ? readStoredConsent(persistKey) : undefined
        if (!saved) return state
        return {
          ...state,
          consent: projectConsent(saved.categories, diagnosticsOffered),
        }
      }),
    )
  }

  const consentForm: ReatomGDPR<Categories> = Object.assign(form, { snapshot })
  return consentForm
}
