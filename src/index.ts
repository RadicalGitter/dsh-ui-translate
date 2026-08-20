import { randomBytes } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { Config as ConfigSchema, resolveConfig, type Config as UITranslateConfig } from './config.ts'
import { OpenAICompatibleProvider, TranslationProviderRegistry } from './providers.ts'
import { createTranslateHandler, TRANSLATE_ROUTE } from './route.ts'

export const name = 'ui-translate'
export const inject = ['webServer'] as const
export const UI_TRANSLATE_SETTINGS_NAMESPACE = settingsNamespace('ui-translate')

export const Config = ConfigSchema
export type Config = UITranslateConfig
export { resolveConfig, TRANSLATE_ROUTE }
export * from './providers.ts'

export function apply(ctx: Context, config: UITranslateConfig = {}): void {
  let current: () => UITranslateConfig = () => config
  installSettingsSection(ctx, UI_TRANSLATE_SETTINGS_NAMESPACE, ConfigSchema, config, {
    setSource: (source) => { current = source },
    onChange: () => {},
    validate: (value) => { resolveConfig(value) },
  })

  const providers = new TranslationProviderRegistry()
  providers.register(new OpenAICompatibleProvider())
  const requestToken = randomBytes(32).toString('base64url')
  ctx.effect(() => {
    const removeMeta = ctx.webServer.tapIndex((html) => {
      const meta = `<meta name="dsh-ui-translate-token" content="${requestToken}">`
      return html.includes('</head>') ? html.replace('</head>', `${meta}</head>`) : meta + html
    })
    const removeRoute = ctx.webServer.register({
      kind: 'exact',
      path: TRANSLATE_ROUTE,
      handler: createTranslateHandler(current, providers, requestToken),
    })
    return () => {
      removeRoute()
      removeMeta()
    }
  }, 'ui-translate: authenticated loopback translation route')
}
