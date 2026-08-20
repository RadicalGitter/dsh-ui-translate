import { useState, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type { UITranslateLocaleKey } from './locales.ts'
import { BACKENDS, TARGET_LANGUAGES, resolveSettings, type UITranslateSettings } from './settings-model.ts'

export interface TranslationSettingsProps {
  settingsScope: SettingsScope<UITranslateSettings>
  t: (key: UITranslateLocaleKey) => string
}

const styles: Record<string, CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', gap: 18, width: '100%', color: 'var(--dsw-alias-label-primary)' },
  title: { fontSize: 18, fontWeight: 600, margin: 0 },
  row: { display: 'flex', flexDirection: 'column', gap: 6, paddingBottom: 14, borderBottom: '1px solid var(--dsw-alias-border-l2)' },
  horizontal: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  label: { fontSize: 14, fontWeight: 500 },
  hint: { fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' },
  control: { minWidth: 240, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--dsw-alias-border-l2)', background: 'var(--dsw-alias-bg-layer-1)', color: 'inherit', font: 'inherit' },
  callout: { padding: 12, borderRadius: 12, background: 'var(--dsw-alias-bg-module-platform)', fontSize: 12, lineHeight: 1.55 },
}

const LANGUAGE_LABELS: Record<string, string> = {
  en: 'English', sv: 'Svenska', de: 'Deutsch', fr: 'Français', es: 'Español', ja: '日本語', ko: '한국어',
}

export function TranslationSettingsSection({ settingsScope, t }: TranslationSettingsProps): ReactNode {
  const snapshot = useSyncExternalStore(
    settingsScope.subscribe.bind(settingsScope),
    settingsScope.getSnapshot.bind(settingsScope),
    settingsScope.getSnapshot.bind(settingsScope),
  )
  const [saving, setSaving] = useState(false)

  if (snapshot.status === 'loading') return <div translate="no" className="notranslate">{t('settings.loading')}</div>
  if (snapshot.status !== 'ready') return <div translate="no" className="notranslate">{t('settings.unavailable')}</div>
  const settings = resolveSettings(snapshot.value)
  const set = async (field: string, value: unknown): Promise<void> => {
    setSaving(true)
    try { await settingsScope.set(field, value) } finally { setSaving(false) }
  }

  return <section
    data-dsh-plugin="ui-translate"
    data-dsh-part="settings"
    translate="no"
    className="notranslate"
    style={styles.root}
  >
    <h2 style={styles.title}>{t('settings.heading')}</h2>
    <div style={styles.row}>
      <label style={styles.horizontal}>
        <span style={styles.label}>{t('settings.enabled')}</span>
        <input type="checkbox" checked={settings.enabled} disabled={saving} onChange={event => { void set('enabled', event.currentTarget.checked) }} />
      </label>
      <span style={styles.hint}>{t('settings.enabledHint')}</span>
    </div>
    <label style={styles.row}>
      <span style={styles.label}>{t('settings.target')}</span>
      <select style={styles.control} value={settings.targetLanguage} disabled={saving} onChange={event => { void set('targetLanguage', event.currentTarget.value) }}>
        {TARGET_LANGUAGES.map(id => <option key={id} value={id}>{LANGUAGE_LABELS[id]}</option>)}
      </select>
    </label>
    <label style={styles.row}>
      <span style={styles.label}>{t('settings.backend')}</span>
      <select style={styles.control} value={settings.backend} disabled={saving} onChange={event => { void set('backend', event.currentTarget.value) }}>
        {BACKENDS.map(id => <option key={id} value={id}>{t(id === 'offline-glossary' ? 'settings.offline' : 'settings.openai')}</option>)}
      </select>
    </label>
    {settings.backend === 'offline-glossary' ? <div style={styles.callout}>{t('settings.offlineLimit')}</div> : <>
      <label style={styles.row}>
        <span style={styles.label}>{t('settings.endpoint')}</span>
        <input style={styles.control} type="url" value={settings.endpoint} disabled={saving} onChange={event => { void set('endpoint', event.currentTarget.value) }} />
      </label>
      <label style={styles.row}>
        <span style={styles.label}>{t('settings.model')}</span>
        <input style={styles.control} value={settings.model} disabled={saving} onChange={event => { void set('model', event.currentTarget.value) }} />
      </label>
      <label style={{ ...styles.horizontal, paddingBottom: 12 }}>
        <span style={styles.label}>{t('settings.allowRemote')}</span>
        <input type="checkbox" checked={settings.allowRemoteEndpoint} disabled={saving} onChange={event => { void set('allowRemoteEndpoint', event.currentTarget.checked) }} />
      </label>
    </>}
    <div style={styles.callout}>{t('settings.privacy')}</div>
  </section>
}
