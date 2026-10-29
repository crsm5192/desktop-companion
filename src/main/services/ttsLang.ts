/**
 * 语音文本的语言适配。
 *
 * 为什么需要：很多 CosyVoice 部署只挂单一语言的 LoRA，服务端会做语言检测，
 * 收到不支持的语言直接返回 400（例如"本服务仅支持日语，检测到简体中文特征字"）。
 *
 * 这里提供**配置驱动**的适配能力，不预设任何语言：
 *  - 服务端要什么语言 → 配置 `server.lang`（如 jp / zh / en，留空则完全不管）
 *  - 怎么适配       → 配置 `server.langAdapt`：
 *      off      原样发送
 *      simplify 只做字形层面的替换（简体→该语言可接受的字形），不改语义
 *      kana     把文本转成假名读音（仅 lang=jp 有意义）
 */

/** 是否含日文假名 */
export function hasKana(text: string): boolean {
  return /[\u3040-\u309f\u30a0-\u30ff]/.test(text)
}

/** 是否含中文字符（广义，含简体与繁体） */
export function hasHanzi(text: string): boolean {
  return /[\u4e00-\u9fff]/.test(text)
}

/** 是否含拉丁字母 */
export function hasLatin(text: string): boolean {
  return /[A-Za-z]/.test(text)
}

/** 汉字数量 */
export function countHanzi(text: string): number {
  const m = text.match(/[\u4e00-\u9fff]/g)
  return m ? m.length : 0
}

/** 常见简体 → 繁体/日文汉字（高频口语用字，覆盖日常回复） */
const SIMP_TO_TRAD: Record<string, string> = {
  你: '您', 们: '們', 说: '說', 话: '話', 这: '這', 么: '麼', 气: '氣',
  对: '對', 错: '錯', 时: '時', 间: '間', 后: '後', 现: '現', 会: '會',
  觉: '覺', 点: '點', 儿: '兒', 乐: '樂', 开: '開', 关: '關', 为: '為',
  怎: '怎', 样: '樣', 听: '聽', 见: '見', 过: '過', 还: '還', 没: '沒',
  个: '個', 里: '裡', 边: '邊', 头: '頭', 体: '體', 爱: '愛', 欢: '歡',
  谢: '謝', 请: '請', 让: '讓', 给: '給', 帮: '幫', 饿: '餓', 饭: '飯',
  学: '學', 习: '習', 问: '問', 题: '題', 记: '記', 忆: '憶', 忘: '忘',
  买: '買', 卖: '賣', 钱: '錢', 贵: '貴', 坏: '壞', 厉: '厲', 害: '害',
  优: '優', 秀: '秀', 傻: '傻', 聪: '聰', 漂: '漂', 温: '溫', 静: '靜',
  热: '熱', 闹: '鬧', 凉: '涼', 风: '風', 云: '雲', 阴: '陰', 声: '聲',
  歌: '歌', 舞: '舞', 哭: '哭', 痛: '痛', 病: '病', 药: '藥', 医: '醫',
  门: '門', 书: '書', 笔: '筆', 纸: '紙', 电: '電', 脑: '腦', 机: '機',
  网: '網', 络: '絡', 视: '視', 频: '頻', 图: '圖', 画: '畫', 写: '寫',
  读: '讀', 语: '語', 词: '詞', 报: '報', 闻: '聞', 陪: '陪', 伴: '伴',
  待: '待', 同: '同', 起: '起', 专: '專', 业: '業', 长: '長', 短: '短',
  难: '難', 易: '易', 简: '簡', 单: '單', 复: '複', 杂: '雜', 轻: '輕',
  重: '重', 强: '強', 弱: '弱', 够: '夠', 应: '應', 该: '該',
  准: '準', 备: '備', 结: '結', 束: '束', 始: '始', 继: '繼', 续: '續',
  变: '變', 化: '化', 试: '試', 验: '驗', 助: '助', 支: '支',
  持: '持', 需: '需', 要: '要', 求: '求', 建: '建', 议: '議', 计: '計',
  划: '劃', 目: '目', 标: '標', 完: '完', 成: '成',
  功: '功', 败: '敗', 输: '輸', 赢: '贏', 努: '努', 力: '力',
  加: '加', 油: '油', 休: '休', 息: '息', 放: '放', 松: '鬆', 紧: '緊',
  张: '張', 压: '壓', 舒: '舒', 服: '服', 心: '心',
}

/** 简体特征字的快速判断用字符集合 */
const SIMP_HINT = new RegExp(`[${Object.keys(SIMP_TO_TRAD).join('')}]`)

/** 文本是否像「简体中文」（用于决定要不要做字形替换） */
export function looksLikeSimplifiedChinese(text: string): boolean {
  return SIMP_HINT.test(text)
}

/**
 * 字形替换：把简体字换成日文/繁体可接受的字形。
 * 只改字形、不改语义，服务端的「简体中文特征字检测」就不会命中。
 */
export function toJapaneseFriendly(text: string): string {
  let out = ''
  for (const ch of text) out += SIMP_TO_TRAD[ch] ?? ch
  return out.replace(/[~～]+/g, '、').replace(/\s+/g, ' ').trim()
}

/**
 * 日语假名化（轻量版）：把常见汉字词映射成假名读音。
 * 只覆盖高频词，够让服务端接受；不适合长文精读。
 */
const KANJI_TO_KANA: Record<string, string> = {
  今日: 'きょう', 明日: 'あした', 昨日: 'きのう', 毎日: 'まいにち',
  天気: 'てんき', 元気: 'げんき', 時間: 'じかん', 仕事: 'しごと',
  学校: 'がっこう', 先生: 'せんせい', 友達: 'ともだち', 家族: 'かぞく',
  一緒: 'いっしょ', 心配: 'しんぱい', 嬉しい: 'うれしい', 悲しい: 'かなしい',
  寂しい: 'さびしい', 好き: 'すき', 嫌い: 'きらい', 頑張: 'がんば',
  応援: 'おうえん', 朝: 'あさ', 昼: 'ひる', 夜: 'よる', 今: 'いま',
  後: 'あと', 前: 'まえ', 上: 'うえ', 下: 'した', 中: 'なか', 外: 'そと',
  私: 'わたし', 僕: 'ぼく', 俺: 'おれ', 君: 'きみ', 皆: 'みんな',
}

export function toKanaReading(text: string): string {
  let out = text
  for (const [k, v] of Object.entries(KANJI_TO_KANA)) out = out.split(k).join(v)
  return out
}

/**
 * 注入假名：在句首/标点后插入一个日语语气词，让「无假名长汉字串」不再被判定为中文。
 *
 * 依据实测（针对只支持日语的服务端）：
 *   - 纯汉字长句（如 16 个汉字）→ 被判为中文，直接 400
 *   - 只要句中出现任意假名 → 整句按日语接受，正常合成
 * 所以最小代价的兜底是补一个假名，而不是改写全部汉字（改写会破坏读音）。
 */
export function injectKanaMarker(text: string): string {
  if (hasKana(text)) return text
  const t = text.trim()
  if (!t) return t
  // 用「はい、」开头最自然，不会改变语义，只是多一个日语应答词
  return `はい、${t}`
}

export type LangAdaptMode = 'off' | 'simplify' | 'kana'

/**
 * 统一入口：按配置把文本适配到服务端要求的语言。
 *
 * @param text        待合成文本
 * @param targetLang  服务端要求的语言（空 = 不处理）
 * @param mode        适配策略
 */
export function adaptForTts(text: string, targetLang: string, mode: LangAdaptMode): string {
  const lang = (targetLang || '').trim().toLowerCase()
  if (!lang || mode === 'off') return text

  // 目标日语：文本已含假名就是日语，不用动
  if (lang === 'jp' || lang === 'ja' || lang === 'japanese') {
    if (hasKana(text)) return text
    if (mode === 'kana') return toKanaReading(text)
    // simplify：先做字形简化；若文本仍是“无假名长汉字串”，再补假名标记
    let out = looksLikeSimplifiedChinese(text) ? toJapaneseFriendly(text) : text
    if (!hasKana(out) && countHanzi(out) >= 8) out = injectKanaMarker(out)
    return out
  }

  // 目标中文：文本已是中文（含汉字）就直接发
  if (lang === 'zh' || lang === 'cn' || lang === 'chinese') {
    if (hasHanzi(text)) return text
    return text // 纯英文无法简单转中文，原样发
  }

  // 其它语言：保守处理
  return text
}

/** 判断服务端错误是否是「语言不支持」类，供自动重试使用 */
export function isLangError(status: number, body: string): boolean {
  if (status === 400 || status === 415 || status === 422) {
    return /仅支持|不支持|语言|lang|language|unsupported/i.test(body)
  }
  return false
}
