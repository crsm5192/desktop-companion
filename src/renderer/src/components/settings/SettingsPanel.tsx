import { useEffect, useRef, useState } from 'react'
import type { AppConfig, ModelInfo, SiyuanNotebook } from '@shared/types'
import { ANTIALIASING_SAMPLES, type AntialiasingSamples } from '@shared/petRendering'

const SETTINGS_SECTIONS = [
  { id: 'pet', label: '桌宠' },
  { id: 'chat', label: '对话' },
  { id: 'voice', label: '语音' },
  { id: 'sync', label: '同步' },
  { id: 'advanced', label: '高级' }
] as const

type SettingsSection = (typeof SETTINGS_SECTIONS)[number]['id']

export default function SettingsPanel(): JSX.Element {
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [activeSection, setActiveSection] = useState<SettingsSection>('pet')
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => { contentRef.current?.scrollTo({ top: 0 }) }, [activeSection])
  const [siyuanStatus, setSiyuanStatus] = useState('')
  const [ttsStatus, setTtsStatus] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [notebooks, setNotebooks] = useState<SiyuanNotebook[]>([])
  const [folderMsg, setFolderMsg] = useState('')
  const [apiStatus, setApiStatus] = useState('')
  const [saveError, setSaveError] = useState('')
  const [chatPrompt, setChatPrompt] = useState<string | null>(null)
  const [agentPrompt, setAgentPrompt] = useState<string | null>(null)

  useEffect(() => {
    // 配置 + 模型列表一起加载，避免下拉框在列表未到时先渲染、值对不上（导致记不住选中项）
    void Promise.all([window.api.getConfig(), window.api.models.list()]).then(([c, m]) => {
      setCfg(c)
      setModels(m)
      // 笔记本列表用当前配置拉一次（失败静默，可手动刷新）
      void window.api.siyuan.notebooks({ ...c.siyuan }).then(setNotebooks).catch(() => setNotebooks([]))
    })
  }, [])

  if (!cfg) return <div className="panel settings-panel">加载中…</div>

  /** 一键打开数据目录（模型 / 音乐 / 配置） */
  const openFolder = async (kind: 'models' | 'music' | 'data'): Promise<void> => {
    setFolderMsg('打开中…')
    try {
      const fn =
        kind === 'models'
          ? window.api.folders.openModels
          : kind === 'music'
            ? window.api.folders.openMusic
            : window.api.folders.openData
      const r = await fn()
      setFolderMsg(r.ok ? `已打开：${r.path}` : `打开失败：${r.error ?? r.path}`)
    } catch (e) {
      setFolderMsg(`打开失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** 刷新模型列表（刚往目录里放了新模型时用） */
  const reloadModels = (): void => {
    void window.api.models
      .list()
      .then((list) => {
        setModels(list)
        setFolderMsg(`模型已刷新，共 ${list.length} 个`)
      })
      .catch((e) => setFolderMsg(`刷新失败：${e instanceof Error ? e.message : String(e)}`))
  }

  const patch = (p: Partial<AppConfig>, immediate = false): void => {
    setCfg({ ...cfg, ...p })
    setSaved(false)
    if (!immediate) setDirty(true)
  }

  const updatePet = (values: Partial<AppConfig['pet']>): void => {
    patch({ pet: { ...cfg.pet, ...values } }, true)
    void window.api.setConfig({ pet: values }).catch(err => setSaveError(String(err)))
  }

  const save = async (): Promise<void> => {
    setSaveError('')
    setSaving(true)
    try {
      // Preserve toolbar/tray changes and model placement made while this window was open.
      const latest = (await window.api.getConfig()).pet
      const updated = await window.api.setConfig({
        ...cfg,
        pet: { ...cfg.pet, interactionEnabled: latest.interactionEnabled, edgeSnapEnabled: latest.edgeSnapEnabled,
          winX: latest.winX, winY: latest.winY, offsetX: latest.offsetX, offsetY: latest.offsetY, scale: latest.scale }
      })
      // The main process notifies the pet and other windows to apply saved configuration.
      setCfg(updated)
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
      const status = await window.api.control.status()
      setApiStatus(status.error ? `连接接口未开启：${status.error}` : status.listening ? `桌宠监听 ${status.host}:${status.port}；Agent 连接 ${status.endpoint}` : '接口已关闭')
      if (chatPrompt !== null) setChatPrompt(await window.api.chat.prompt())
      if (agentPrompt !== null) setAgentPrompt(await window.api.chat.prompt('agent'))
    } catch (err) { setSaveError(err instanceof Error ? err.message : String(err)) }
    finally { setSaving(false) }
  }

  const testSiyuan = async (): Promise<void> => {
    try {
      const r = await window.api.siyuan.test(cfg.siyuan)
      setSiyuanStatus(r.ok ? `连接成功，版本 ${r.version ?? ''}` : '连接失败')
    } catch (e) {
      setSiyuanStatus(e instanceof Error ? e.message : String(e))
    }
  }

  const reloadNotebooks = (): void => {
    // 用当前输入框里的地址/token 拉笔记本列表（不必先保存）
    void window.api.siyuan.notebooks({ ...cfg.siyuan }).then((list) => {
      setNotebooks(list)
      setSiyuanStatus(list.length ? `已取到 ${list.length} 个笔记本` : '没有可用笔记本')
    }).catch((e) => {
      setNotebooks([])
      setSiyuanStatus(`获取笔记本失败：${e instanceof Error ? e.message : String(e)}`)
    })
  }

  /** 测试连接：先 /health，再实际合成一句（用当前面板里的配置，不必先保存） */
  const probeTtsServer = async (): Promise<void> => {
    setTtsStatus('检测服务…')
    try {
      const h = await window.api.tts.probe(cfg.tts)
      if (!h.ok) {
        setTtsStatus(`连接失败：${h.error ?? '未知错误'}`)
        return
      }
      const styles = h.styles?.length ? `，风格 ${h.styles.length} 种` : ''
      setTtsStatus(`服务在线（${h.device ?? '?'}${styles}），正在合成测试…`)
      const r = await window.api.tts.speak(`テスト、聞こえる`)
      const audio = new Audio(`data:${r.mime};base64,${r.base64}`)
      await audio.play()
      setTtsStatus(`✅ 服务在线（${h.device ?? '?'}）且合成成功，已播放`)
    } catch (e) {
      setTtsStatus(`失败：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const testTts = async (): Promise<void> => {
    setTtsStatus('合成中（首次约 10~30 秒，请稍候）…')
    try {
      // 用日语测试句：很多 CosyVoice 服务只支持日语，发中文会被服务端拒绝
      const r = await window.api.tts.speak('テストです。こんにちは、聞こえますか？')
      const audio = new Audio(`data:${r.mime};base64,${r.base64}`)
      await audio.play()
      setTtsStatus('成功，已播放')
    } catch (e) {
      setTtsStatus(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="panel settings-panel">
      <div className="settings-tabs" role="tablist" aria-label="设置分类">
        {SETTINGS_SECTIONS.map(section => <button
          key={section.id} id={`settings-tab-${section.id}`} role="tab"
          aria-selected={activeSection === section.id} aria-controls={`settings-section-${section.id}`}
          tabIndex={activeSection === section.id ? 0 : -1}
          onClick={() => setActiveSection(section.id)}
          onKeyDown={event => {
            const index = SETTINGS_SECTIONS.findIndex(item => item.id === activeSection)
            const next = event.key === 'ArrowRight' ? (index + 1) % SETTINGS_SECTIONS.length
              : event.key === 'ArrowLeft' ? (index + SETTINGS_SECTIONS.length - 1) % SETTINGS_SECTIONS.length
              : event.key === 'Home' ? 0 : event.key === 'End' ? SETTINGS_SECTIONS.length - 1 : -1
            if (next < 0) return
            event.preventDefault()
            const target = SETTINGS_SECTIONS[next].id
            setActiveSection(target)
            document.getElementById(`settings-tab-${target}`)?.focus()
          }}
        >{section.label}</button>)}
      </div>
      <div className="settings-content" ref={contentRef}>
        <section id="settings-section-pet" role="tabpanel" aria-labelledby="settings-tab-pet" hidden={activeSection !== 'pet'}>
          <div className="settings-section-heading"><h2>桌宠与窗口</h2><p>调整模型、画质与桌面操作，修改后自动保存。</p></div>
          <fieldset className="settings-card">
            <legend>模型与资源</legend>
            <label>
              选择模型
              <select
                value={cfg.pet.modelPath}
                onChange={(e) => {
                  const v = e.target.value
                  updatePet({ modelPath: v })
                }}
              >
                <option value="">占位动画（CSS）</option>
                {models.map((m) => (
                  <option key={m.model3Path} value={m.model3Path}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
            <details className="settings-details">
              <summary>模型与数据目录</summary>
              <div className="settings-details-body">
                <div className="settings-row">
                  <button onClick={() => void openFolder('models')}>📁 模型目录</button>
                  <button onClick={() => void openFolder('music')}>🎵 音乐目录</button>
                  <button onClick={() => void openFolder('data')}>⚙️ 数据目录</button>
                  <button onClick={reloadModels}>↻ 刷新模型列表</button>
                </div>
                {folderMsg && <div className="siyuan-status">{folderMsg}</div>}
              </div>
            </details>
          </fieldset>
          <fieldset className="settings-card">
            <legend>画质与透明度</legend>
            <label className="settings-aa-toggle">
              <input
                type="checkbox"
                aria-label="模型抗锯齿"
                checked={cfg.pet.antialiasing}
                onChange={(e) => {
                  const antialiasing = e.target.checked
                  updatePet({ antialiasing })
                }}
              />
              增强模型抗锯齿
            </label>
            <label className="settings-aa-level">
              <span>抗锯齿倍率</span>
              <select
                aria-label="抗锯齿倍率"
                disabled={!cfg.pet.antialiasing}
                value={cfg.pet.antialiasingSamples}
                onChange={(e) => {
                  const antialiasingSamples = Number(e.target.value) as AntialiasingSamples
                  updatePet({ antialiasingSamples })
                }}
              >
                {ANTIALIASING_SAMPLES.map(samples => <option key={samples} value={samples}>{samples}×</option>)}
              </select>
            </label>
            <p className="settings-aa-hint">基础抗锯齿默认开启，勾选后可进一步增强。倍率越高，显卡开销越大；切换后立即生效并自动保存。</p>
            <label className="row">
              <span>桌宠不透明度</span>
              <input
                type="range"
                aria-label="桌宠不透明度"
                min={0.2}
                max={1}
                step={0.05}
                value={cfg.pet.opacity}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  updatePet({ opacity: v })
                }}
              />
              <span>{Math.round(cfg.pet.opacity * 100)}%</span>
            </label>
            <label className="row">
              <span>弹窗不透明度</span>
              <input
                type="range"
                aria-label="弹窗不透明度"
                min={0.2}
                max={1}
                step={0.05}
                value={cfg.pet.panelOpacity}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  updatePet({ panelOpacity: v })
                }}
              />
              <span>{Math.round(cfg.pet.panelOpacity * 100)}%</span>
            </label>
          </fieldset>
          <fieldset className="settings-card">
            <legend>窗口与互动</legend>
            <label className="row">
              <span>整体缩放（框架）</span>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={cfg.pet.frameScale}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  updatePet({ frameScale: v })
                }}
              />
              <span>{cfg.pet.frameScale.toFixed(2)}×</span>
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={cfg.pet.locked}
                onChange={(e) => updatePet({ locked: e.target.checked })}
              />
              调整模式
            </label>
            <p className="settings-note">开启调整模式后，左键拖动窗口，右键平移模型。</p>
            <label className="row">
              <input
                type="checkbox"
                checked={cfg.pet.eyeTracking}
                onChange={(e) => updatePet({ eyeTracking: e.target.checked })}
              />
              眼球追踪鼠标
            </label>
            <label className="row">
              <span>追踪幅度</span>
              <input
                type="range"
                min={0.2}
                max={2}
                step={0.05}
                value={cfg.pet.eyeTrackingStrength}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  updatePet({ eyeTrackingStrength: v })
                }}
              />
              <span>{cfg.pet.eyeTrackingStrength.toFixed(2)}×</span>
            </label>
          </fieldset>
        </section>
        <section id="settings-section-chat" role="tabpanel" aria-labelledby="settings-tab-chat" hidden={activeSection !== 'chat'}>
          <div className="settings-section-heading"><h2>对话与角色</h2><p>设置角色称呼、对话服务和交流方式。</p></div>
          <fieldset className="settings-card">
            <legend>角色称呼</legend>
            <div className="settings-grid">
              <label>
                角色名称
                <input
                  value={cfg.character.name}
                  onChange={(e) => patch({ character: { ...cfg.character, name: e.target.value } })}
                  placeholder="例如：小助手 / 初音未来 / 你的角色名"
                />
              </label>
              <label>
                角色自称
                <input
                  value={cfg.character.shortName}
                  onChange={(e) => patch({ character: { ...cfg.character, shortName: e.target.value } })}
                  placeholder="例如：小助 / 未来"
                />
              </label>
              <label>
                对你的称呼
                <input
                  value={cfg.character.userName}
                  onChange={(e) => patch({ character: { ...cfg.character, userName: e.target.value } })}
                  placeholder="例如：你 / 主人 / 老板"
                />
              </label>
            </div>
          </fieldset>
          <fieldset className="settings-card">
            <legend>对话服务</legend>
            <label>
              服务地址（Base URL）
              <input
                value={cfg.llm.baseUrl}
                onChange={(e) => patch({ llm: { ...cfg.llm, baseUrl: e.target.value } })}
              />
            </label>
            <div className="settings-grid">
              <label>
              模型名称
                <input
                  value={cfg.llm.model}
                  onChange={(e) => patch({ llm: { ...cfg.llm, model: e.target.value } })}
                />
              </label>
              <label>
                API Key
                <input
                  type="password"
                  value={cfg.llm.apiKey}
                  onChange={(e) => patch({ llm: { ...cfg.llm, apiKey: e.target.value } })}
                />
              </label>
            </div>
          </fieldset>
          <fieldset className="settings-card">
            <legend>角色与表演</legend>
            <label className="row"><input type="checkbox" checked={cfg.chat.performanceEnabled} onChange={e => patch({ chat: { ...cfg.chat, performanceEnabled: e.target.checked } })} />聊天时配合表情和动作</label>
            <details className="settings-details">
              <summary>编辑对话规则</summary>
              <div className="settings-details-body">
                <label>
                  对话规则（人设 / 系统提示词）
                  <textarea
                    rows={7}
                    value={cfg.chat.persona}
                    onChange={(e) => patch({ chat: { ...cfg.chat, persona: e.target.value } })}
                  />
                </label>
              </div>
            </details>
          </fieldset>
        </section>
        <section id="settings-section-voice" role="tabpanel" aria-labelledby="settings-tab-voice" hidden={activeSection !== 'voice'}>
          <div className="settings-section-heading"><h2>语音与音色</h2><p>连接语音服务，选择音色并试听。</p></div>
          <fieldset className="settings-card">
            <legend>语音服务</legend>
            <label>
              模式
              <select
                value={cfg.tts.mode}
                onChange={(e) =>
                  patch({ tts: { ...cfg.tts, mode: e.target.value as AppConfig['tts']['mode'] } })
                }
              >
                <option value="server">语音服务（推荐）</option>
                <option value="command">本地脚本</option>
              </select>
            </label>
            {cfg.tts.mode === 'server' && (
              <>
                <label>
                  服务地址
                  <input
                    value={cfg.tts.server.baseUrl}
                    placeholder="http://127.0.0.1:8001"
                    onChange={(e) =>
                      patch({
                        tts: { ...cfg.tts, server: { ...cfg.tts.server, baseUrl: e.target.value } }
                      })
                    }
                  />
                </label>
                <div className="settings-grid">
                  <label>
                    接口风格
                    <select
                      value={cfg.tts.server.apiStyle}
                      onChange={(e) =>
                        patch({
                          tts: {
                            ...cfg.tts,
                            server: {
                              ...cfg.tts.server,
                              apiStyle: e.target.value as AppConfig['tts']['server']['apiStyle']
                            }
                          }
                        })
                      }
                    >
                      <option value="openai">OpenAI 兼容</option>
                      <option value="legacy">传统接口（/tts）</option>
                    </select>
                  </label>
                  <label>
                    音色（Voice）
                    <input
                      value={cfg.tts.server.voice}
                      placeholder="jp"
                      onChange={(e) =>
                        patch({
                          tts: { ...cfg.tts, server: { ...cfg.tts.server, voice: e.target.value } }
                        })
                      }
                    />
                  </label>
                </div>
                <details className="settings-details">
                  <summary>语言与高级选项</summary>
                  <div className="settings-details-body">
                    <label>
                      情绪风格（可选）
                      <input
                        value={cfg.tts.server.style}
                        placeholder="留空=不指定；如 amai / excited / sasayaku"
                        onChange={(e) =>
                          patch({
                            tts: { ...cfg.tts, server: { ...cfg.tts.server, style: e.target.value } }
                          })
                        }
                      />
                    </label>
                    <label>
                      Token（可选，留空不鉴权）
                      <input
                        type="password"
                        value={cfg.tts.server.token}
                        onChange={(e) =>
                          patch({
                            tts: { ...cfg.tts, server: { ...cfg.tts.server, token: e.target.value } }
                          })
                        }
                      />
                    </label>
                    <label>
                      服务端语言（留空=不限制）
                      <input
                        value={cfg.tts.server.lang}
                        placeholder="如 jp / zh / en；留空则不干预"
                        onChange={(e) =>
                          patch({
                            tts: { ...cfg.tts, server: { ...cfg.tts.server, lang: e.target.value } }
                          })
                        }
                      />
                    </label>
                    <label>
                      语言适配策略
                      <select
                        value={cfg.tts.server.langAdapt}
                        onChange={(e) =>
                          patch({
                            tts: {
                              ...cfg.tts,
                              server: {
                                ...cfg.tts.server,
                                langAdapt: e.target.value as AppConfig['tts']['server']['langAdapt']
                              }
                            }
                          })
                        }
                      >
                        <option value="simplify">simplify（只换字形，不改语义）</option>
                        <option value="kana">kana（转假名读音，仅日语）</option>
                        <option value="off">off（原样发送）</option>
                      </select>
                    </label>
                    <label className="row">
                      <input
                        type="checkbox"
                        checked={cfg.tts.server.autoRetryOnLangError}
                        onChange={(e) =>
                          patch({
                            tts: {
                              ...cfg.tts,
                              server: { ...cfg.tts.server, autoRetryOnLangError: e.target.checked }
                            }
                          })
                        }
                      />
                      服务端报「语言不支持」时自动适配并重试一次
                    </label>
                  </div>
                </details>
                <div className="settings-row">
                  <button onClick={() => void probeTtsServer()}>测试连接</button>
                  <span className="settings-hint">检查服务并合成测试语音</span>
                </div>
              </>
            )}
            {cfg.tts.mode === 'command' && (
              <>
                <label>
                  Python
                  <input
                    value={cfg.tts.python}
                    onChange={(e) => patch({ tts: { ...cfg.tts, python: e.target.value } })}
                  />
                </label>
                <label>
                  脚本（语音合成脚本路径）
                  <input
                    value={cfg.tts.script}
                    onChange={(e) => patch({ tts: { ...cfg.tts, script: e.target.value } })}
                  />
                </label>
                <label>
                  语言
                  <select
                    value={cfg.tts.lang}
                    onChange={(e) =>
                      patch({ tts: { ...cfg.tts, lang: e.target.value as AppConfig['tts']['lang'] } })
                    }
                  >
                    <option value="auto">auto（按假名自动）</option>
                    <option value="zh">zh</option>
                    <option value="jp">jp</option>
                  </select>
                </label>
              </>
            )}
          </fieldset>
          <fieldset className="settings-card">
            <legend>语速与试听</legend>
            <label className="row">
              <span>语速</span>
              <input
                type="range"
                min={0.5}
                max={2}
                step={0.05}
                value={cfg.tts.speed}
                onChange={(e) => patch({ tts: { ...cfg.tts, speed: Number(e.target.value) } })}
              />
              <span>{cfg.tts.speed.toFixed(2)}×</span>
            </label>
            <div className="settings-actions">
              <button onClick={() => void testTts()}>试听一句</button>
            </div>
            <p className="settings-note">试听使用已保存的语音设置。</p>
            {ttsStatus && <div className="siyuan-status">{ttsStatus}</div>}
          </fieldset>
          <details className="settings-details">
            <summary>语音输出规则</summary>
            <div className="settings-details-body">
              <label>
                语音规则（如何输出「日语：」行）
                <textarea
                  rows={3}
                  value={cfg.chat.voiceRule}
                  onChange={(e) => patch({ chat: { ...cfg.chat, voiceRule: e.target.value } })}
                />
              </label>
            </div>
          </details>
        </section>
        <section id="settings-section-sync" role="tabpanel" aria-labelledby="settings-tab-sync" hidden={activeSection !== 'sync'}>
          <div className="settings-section-heading"><h2>笔记同步</h2><p>将日记与待办同步到思源笔记。</p></div>
          <fieldset className="settings-card">
            <legend>思源连接</legend>
            <label>
              服务地址（Base URL）
              <input
                value={cfg.siyuan.baseUrl}
                onChange={(e) => patch({ siyuan: { ...cfg.siyuan, baseUrl: e.target.value } })}
              />
            </label>
            <label>
              Token
              <input
                type="password"
                value={cfg.siyuan.token}
                onChange={(e) => patch({ siyuan: { ...cfg.siyuan, token: e.target.value } })}
              />
            </label>
            <div className="settings-actions">
              <button onClick={() => void testSiyuan()}>测试连接</button>
            </div>
            {siyuanStatus && <div className="siyuan-status">{siyuanStatus}</div>}
          </fieldset>
          <fieldset className="settings-card">
            <legend>同步内容</legend>
            <label className="row">
              <input
                type="checkbox"
                checked={cfg.siyuan.syncDiary}
                onChange={(e) => patch({ siyuan: { ...cfg.siyuan, syncDiary: e.target.checked } })}
              />
              保存日记时同步到思源
            </label>
            <label>
              日记目标笔记本
              <select
                value={cfg.siyuan.diaryNotebook}
                onChange={(e) => patch({ siyuan: { ...cfg.siyuan, diaryNotebook: e.target.value } })}
              >
                <option value="">（未选择）</option>
                {notebooks.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={cfg.siyuan.syncTodo}
                onChange={(e) => patch({ siyuan: { ...cfg.siyuan, syncTodo: e.target.checked } })}
              />
              待办变更时同步到思源
            </label>
            <label>
              待办目标笔记本
              <select
                value={cfg.siyuan.todoNotebook}
                onChange={(e) => patch({ siyuan: { ...cfg.siyuan, todoNotebook: e.target.value } })}
              >
                <option value="">（未选择）</option>
                {notebooks.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="settings-actions">
              <button onClick={reloadNotebooks}>刷新笔记本列表</button>
            </div>
          </fieldset>
        </section>
        <section id="settings-section-advanced" role="tabpanel" aria-labelledby="settings-tab-advanced" hidden={activeSection !== 'advanced'}>
          <div className="settings-section-heading"><h2>高级控制</h2><p>连接外部程序或 Agent，查看控制说明。</p></div>
          <fieldset className="settings-card">
            <legend>外部连接</legend>
            <label className="row"><input type="checkbox" checked={cfg.controlApi.enabled} onChange={e => patch({ controlApi: { ...cfg.controlApi, enabled: e.target.checked } })} />启用外部程序与 Agent 控制</label>
            <label className="row"><span>连接范围</span><select aria-label="连接范围" value={cfg.controlApi.listenHost ?? '127.0.0.1'} onChange={e => patch({ controlApi: { ...cfg.controlApi, listenHost: e.target.value } })}>
              <option value="127.0.0.1">仅本机</option>
              <option value="0.0.0.0">允许其他电脑连接</option>
              <option value="::1">仅本机（IPv6）</option>
              <option value="::">允许其他电脑连接（IPv6）</option>
              {cfg.controlApi.listenHost === 'localhost' && <option value="localhost">仅本机（localhost）</option>}
            </select></label>
            <label className="row"><span>桌宠监听端口</span><input type="number" aria-label="桌宠监听端口" min={1024} max={65535} value={cfg.controlApi.port} onChange={e => {
              const port = Number(e.target.value)
              let endpoint = cfg.controlApi.endpoint ?? `ws://127.0.0.1:${cfg.controlApi.port}`
              try {
                const address = new URL(endpoint)
                if (['127.0.0.1', 'localhost', '[::1]'].includes(address.hostname) && Number(address.port || (address.protocol === 'wss:' ? 443 : 80)) === cfg.controlApi.port && Number.isInteger(port) && port >= 1024 && port <= 65535) {
                  address.port = String(port)
                  endpoint = address.toString()
                }
              } catch { /* The address is validated when saving. */ }
              patch({ controlApi: { ...cfg.controlApi, port, endpoint } })
            }} /></label>
            <label className="row"><span>Agent 连接地址</span><input type="text" aria-label="Agent 连接地址" placeholder="ws://电脑IP:18790 或 wss://域名/路径" value={cfg.controlApi.endpoint ?? `ws://127.0.0.1:${cfg.controlApi.port}`} onChange={e => patch({ controlApi: { ...cfg.controlApi, endpoint: e.target.value } })} /></label>
            <p>远程 Agent 请填写它能访问的电脑 IP 或域名，地址会自动写入 AI 提示词。VPN 或隧道可转发到桌宠监听端口；wss 加密由隧道或代理提供。</p>
          </fieldset>
          <details className="settings-details">
            <summary>连接令牌与状态</summary>
            <div className="settings-details-body">
              <label className="row"><span>连接令牌</span><input type="password" value={cfg.controlApi.token} onChange={e => patch({ controlApi: { ...cfg.controlApi, token: e.target.value } })} /></label>
              <div className="settings-actions">
                <button onClick={() => void navigator.clipboard.writeText(cfg.controlApi.token)}>复制连接令牌</button>
                <button onClick={() => void window.api.control.status().then(status => setApiStatus(status.error ? `接口未开启：${status.error}` : status.listening ? `桌宠监听 ${status.host}:${status.port}；Agent 连接 ${status.endpoint}` : '接口已关闭'))}>查看连接状态</button>
              </div>
              {apiStatus && <div className="siyuan-status">{apiStatus}</div>}
            </div>
          </details>
          <fieldset className="settings-card">
            <legend>提示词与工具说明</legend>
            <button onClick={() => {
              if (chatPrompt !== null) setChatPrompt(null)
              else void window.api.chat.prompt().then(setChatPrompt)
            }}>{chatPrompt !== null ? '收起提示词' : '预览已保存的 AI 提示词'}</button>
            {chatPrompt !== null && <label className="col"><span>每次对话前自动发送，地址随保存的配置更新</span><textarea readOnly rows={12} aria-label="发给 AI 的系统提示词" value={chatPrompt} /></label>}
            <button onClick={() => {
              if (agentPrompt !== null) setAgentPrompt(null)
              else void window.api.chat.prompt('agent').then(setAgentPrompt)
            }}>{agentPrompt !== null ? '收起 Agent 提示词' : '预览已保存的远程 Agent 提示词'}</button>
            {agentPrompt !== null && <>
              <label className="col"><span>将这份说明提前放入远程 Agent 的系统提示词或工具说明；连接令牌单独配置</span><textarea readOnly rows={12} aria-label="远程 Agent 控制提示词" value={agentPrompt} /></label>
              <button onClick={() => void navigator.clipboard.writeText(agentPrompt)}>复制 Agent 提示词</button>
            </>}
          </fieldset>
        </section>
      </div>
      <div className="settings-footer">
        <div className="settings-save-status" role="status">
          {saveError ? <span className="error">{saveError}</span>
            : saved ? <span className="settings-saved">已保存</span>
            : dirty ? <span className="settings-unsaved">有未保存的修改</span>
            : <span>{activeSection === 'pet' ? '桌宠设置自动保存' : '修改后点击保存设置'}</span>}
        </div>
        <button className="save-btn" disabled={saving} onClick={() => void save()}>
          {saving ? '保存中…' : saved ? '已保存 ✓' : '保存设置'}
        </button>
      </div>
    </div>
  )
}
