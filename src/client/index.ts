import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { createDefaultClientBackends } from './backends.ts'
import { StaticDomTranslator } from './dom-translator.ts'
import { en, zh, type UITranslateLocaleKey } from './locales.ts'
import { TranslationSettingsSection } from './SettingsSection.tsx'
import { resolveSettings, type UITranslateSettings } from './settings-model.ts'

const NS = 'ui-translate'
const SETTINGS_NAMESPACE = 'ui-translate'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'ui-translate': UITranslateLocaleKey
  }
}

export const inject = ['slots', 'locale', 'connection', 'settingsScope', 'remote']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-translate: dictionaries')
  const settingsScope = ctx.settingsScope.bind<UITranslateSettings>({ namespace: SETTINGS_NAMESPACE })
  const backends = createDefaultClientBackends()
  const translator = new StaticDomTranslator(document, backends, resolveSettings(undefined))

  const sync = (): void => {
    const snapshot = settingsScope.getSnapshot()
    translator.update(resolveSettings(snapshot.status === 'ready' ? snapshot.value : undefined))
  }
  ctx.effect(() => {
    const unsubscribe = settingsScope.subscribe(sync)
    translator.start()
    sync()
    return () => {
      unsubscribe()
      translator.dispose()
      backends.dispose()
    }
  }, 'ui-translate: DOM observer and settings scope')

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'ui-translate',
    order: 145,
    label: () => ctx.locale.bind(NS)('settings.title'),
    locale: NS,
    inject: () => ({ settingsScope: settingsScope as SettingsScope<UITranslateSettings> }),
  }, TranslationSettingsSection))
}

export { createDefaultClientBackends, StaticDomTranslator, TranslationSettingsSection }
export * from './settings-model.ts'
