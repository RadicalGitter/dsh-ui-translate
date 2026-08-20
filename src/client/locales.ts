export const zh = {
  'settings.title': '界面翻译',
  'settings.heading': '静态界面翻译',
  'settings.enabled': '启用安全翻译',
  'settings.enabledHint': '仅处理内置白名单中的中文界面叶文本；不会改写输入框、编辑器、代码或用户内容。',
  'settings.target': '目标语言',
  'settings.backend': '翻译后端',
  'settings.offline': '离线词汇表（默认，不联网）',
  'settings.openai': 'OpenAI 兼容端点（显式配置）',
  'settings.endpoint': '端点基础 URL',
  'settings.model': '模型',
  'settings.allowRemote': '允许公网端点',
  'settings.privacy': '隐私默认值：插件初始关闭，后端默认为离线词汇表。只有选择并配置 OpenAI 兼容后端后，筛选出的短文本才会发送到端点。API 密钥仅从宿主环境变量读取。',
  'settings.offlineLimit': '离线词汇表目前只提供常见中文到英文的精确匹配；未命中的文本保持不变。',
  'settings.loading': '正在加载设置…',
  'settings.unavailable': '此浏览器无法访问持久设置。翻译保持关闭。',
} as const

export const en: Record<keyof typeof zh, string> = {
  'settings.title': 'UI translation',
  'settings.heading': 'Static UI translation',
  'settings.enabled': 'Enable safe translation',
  'settings.enabledHint': 'Only built-in allowlisted Chinese UI leaf text is considered. Inputs, editors, code, and user content are not modified.',
  'settings.target': 'Target language',
  'settings.backend': 'Translation backend',
  'settings.offline': 'Offline glossary (default, no network)',
  'settings.openai': 'OpenAI-compatible endpoint (explicit opt-in)',
  'settings.endpoint': 'Endpoint base URL',
  'settings.model': 'Model',
  'settings.allowRemote': 'Allow a public endpoint',
  'settings.privacy': 'Private by default: the plugin starts disabled and uses the offline glossary. Short filtered labels are sent only after you select and configure the OpenAI-compatible backend. API keys are read only from a Host environment variable.',
  'settings.offlineLimit': 'The offline glossary currently exact-matches common Chinese labels to English. Unknown labels stay unchanged.',
  'settings.loading': 'Loading settings…',
  'settings.unavailable': 'Persistent settings are unavailable in this browser. Translation remains off.',
}

export type UITranslateLocaleKey = keyof typeof zh
