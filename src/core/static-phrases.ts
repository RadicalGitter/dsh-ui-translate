export const ENGLISH_GLOSSARY: Readonly<Record<string, string>> = Object.freeze({
  '设置': 'Settings',
  '通用设置': 'General',
  '模型': 'Models',
  '插件': 'Plugins',
  '插件配置': 'Plugin configuration',
  '关闭': 'Close',
  '保存': 'Save',
  '取消': 'Cancel',
  '确认': 'Confirm',
  '确定': 'OK',
  '删除': 'Delete',
  '编辑': 'Edit',
  '新建': 'New',
  '搜索': 'Search',
  '重试': 'Retry',
  '刷新': 'Refresh',
  '复制': 'Copy',
  '已复制': 'Copied',
  '启用': 'Enabled',
  '禁用': 'Disabled',
  '语言': 'Language',
  '外观': 'Appearance',
  '浅色': 'Light',
  '深色': 'Dark',
  '跟随系统': 'System',
  '工作区': 'Workspace',
  '会话': 'Sessions',
  '新会话': 'New session',
  '历史记录': 'History',
  '加载中': 'Loading',
  '暂无数据': 'No data',
  '任务看板': 'Task board',
  '技能中心': 'Skills Center',
  '更多': 'More',
  '帮助': 'Help',
  '关于': 'About',
  '连接': 'Connect',
  '断开连接': 'Disconnect',
  '成功': 'Success',
  '失败': 'Failed',
  '警告': 'Warning',
  '宠物': 'Pet',
  '喂食': 'Feed',
  '改名': 'Rename',
  '隐藏': 'Hide',
  '宠物正在赶来…': 'The pet is on its way…',
  '宠物迷路了（连接失败）': 'The pet is lost (connection failed)',
  '亲密度 幼鲸': 'Affinity Calf',
  '亲密度 伙伴': 'Affinity Companion',
  '亲密度 挚友': 'Affinity Best friend',
  '亲密度 深海羁绊': 'Affinity Deep-sea bond',
  '亲密度 心有灵犀': 'Affinity Kindred minds',
  '亲密度 传说羁绊': 'Affinity Legendary bond',
  '亲密度 神话羁绊': 'Affinity Mythic bond',
  '亲密度 永恒之契': 'Affinity Eternal pact',
  '亲密度 鲸生共渡': 'Affinity Lifelong voyage',
})

const PET_TREATS = /^小鱼干\s*[×x]\s*(\d{1,9})$/u
const PET_POINTS = /^(\d{1,9})\s*点$/u

/**
 * Return an offline English translation only for compile-time-approved static
 * UI copy or a narrowly bounded numeric pet template. The same function is
 * used by the browser and Host trust boundary so network providers cannot be
 * reached with arbitrary page or user text.
 */
export function translateKnownStaticPhraseToEnglish(text: string): string | undefined {
  const exact = ENGLISH_GLOSSARY[text]
  if (exact !== undefined) return exact
  const treats = PET_TREATS.exec(text)
  if (treats !== null) return `Treats ×${treats[1]}`
  const points = PET_POINTS.exec(text)
  if (points !== null) return `${points[1]} pts`
  return undefined
}

export function isKnownStaticPhrase(text: string): boolean {
  return translateKnownStaticPhraseToEnglish(text) !== undefined
}
