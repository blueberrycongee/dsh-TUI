import type { Context } from '@deepseek-ai/cordis'
import type Schema from '@deepseek-ai/schemastery'

/** New Cordis configs wrap editable fields; old hosts pass plain values. */
export type RuntimeConfig<T> = { [K in keyof T]: T[K] | { get(): T[K] } }

/** Declare only UI preferences as live fields, never the agent/session route. */
export function editableConfig<T>(schema: Schema<T>, keys: readonly (keyof T)[]): Schema<T, RuntimeConfig<T>> {
  for (const key of keys) {
    const field = schema.dict?.[String(key)] as (Schema<unknown> & { volatile?: () => Schema<unknown> }) | undefined
    if (field !== undefined && typeof field.volatile === 'function') schema.dict![String(key)] = field.volatile()
  }
  return schema as Schema<T, RuntimeConfig<T>>
}

/** Snapshot at an operation boundary; retain the host refs for later updates. */
export function configValues<T extends object>(config: RuntimeConfig<T>): T {
  return Object.fromEntries(Object.entries(config).map(([key, value]: [string, unknown]) => [
    key,
    value !== null && typeof value === 'object' && 'get' in value && typeof value.get === 'function'
      ? value.get()
      : value,
  ])) as T
}

interface SettingsScope<T> {
  get(): T
  watch(callback: (next: T) => void): () => void
}

/**
 * 0.1.7 owns settings in Config; older hosts still own registered scopes.
 * Pass the Config owner's context, and dispose watch with the consumer's lifecycle.
 */
export function createSettingsScope<T>(
  ctx: Context,
  service: unknown,
  ns: string,
  schema: Schema<T>,
  current: () => T,
): SettingsScope<T> & { legacy: boolean } {
  const settings = service as { register?: (ns: string, schema: Schema<T>) => SettingsScope<T> }
  if (typeof settings.register === 'function') {
    const scope = settings.register(ns, schema)
    return { legacy: true, get: () => scope.get(), watch: callback => scope.watch(callback) }
  }
  return {
    legacy: false,
    get: current,
    watch(callback) {
      // The event is absent from the old framework's type map. Cordis owns
      // listener disposal and emits it only to the updated plugin fiber.
      const events = ctx as unknown as { on(event: 'loader/volatile-update', listener: () => void): () => void }
      return events.on('loader/volatile-update', () => callback(current()))
    },
  }
}

/** New settings forms expose values through describe(), not get(). */
export function settingsValue(settings: {
  get?(ns: string): unknown
  describe(): readonly { ns: string; value?: unknown }[]
}, ns: string): unknown {
  return typeof settings.get === 'function' ? settings.get(ns) : settings.describe().find(row => row.ns === ns)?.value
}
