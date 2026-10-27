import { useEffect, useState } from 'react'
import type { AppConfig, ModelInfo, SiyuanNotebook } from '@shared/types'
import { usePetStore } from '../../store/pet'
import { refreshCharacter } from '../../hooks/useCharacter'

export default function SettingsPanel(): JSX.Element {
  const [cfg, setCfg] = useState<AppConfig | null>(null)
  const [saved, setSaved] = useState(false)
  const [siyuanStatus, setSiyuanStatus] = useState('')
  const [ttsStatus, setTtsStatus] = useState('')
  const [models, setModels] = useState<ModelInfo[]>([])
  const [notebooks, setNotebooks] = useState<SiyuanNotebook[]>([])

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

  const patch = (p: Partial<AppConfig>): void => setCfg({ ...cfg, ...p })

  const save = async (): Promise<void> => {
    await window.api.setConfig(cfg)
    // 即时生效：写共享 store，PetStage/App 订阅后立即重载/刷新
    usePetStore.getState().setModel(cfg.pet.modelPath, cfg.pet.scale)
    usePetStore.getState().setLocked(cfg.pet.locked)
    usePetStore.getState().setEyeTracking(cfg.pet.eyeTracking)
    usePetStore.getState().setOpacity(cfg.pet.opacity)
    // 角色名即时刷新（聊天标题/气泡落款/占位文字）
    refreshCharacter()
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
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

  const testTts = async (): Promise<void> => {
    setTtsStatus('合成中（首次约 10~30 秒，请稍候）…')
    try {
      const r = await window.api.tts.speak(`测试语音，你好，我是${cfg.character.shortName}。`)
      const audio = new Audio(`data:${r.mime};base64,${r.base64}`)
      await audio.play()
      setTtsStatus('成功，已播放')
    } catch (e) {
      setTtsStatus(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="panel settings-panel">
      <div className="panel-header">
        <span>设置</span>
      </div>

      <fieldset>
        <legend>角色设定</legend>
        <label>
          角色名（显示在聊天标题 / 托盘）
          <input
            value={cfg.character.name}
            onChange={(e) => patch({ character: { ...cfg.character, name: e.target.value } })}
            placeholder="例如：小助手 / 初音未来 / 你的角色名"
          />
        </label>
        <label>
          自称（聊天气泡落款）
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
      </fieldset>

      <fieldset>
        <legend>对话模型（任意 OpenAI 兼容 API）</legend>
        <label>
          Base URL
          <input
            value={cfg.llm.baseUrl}
            onChange={(e) => patch({ llm: { ...cfg.llm, baseUrl: e.target.value } })}
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
        <label>
          Model
          <input
            value={cfg.llm.model}
            onChange={(e) => patch({ llm: { ...cfg.llm, model: e.target.value } })}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>TTS（CosyVoice）</legend>
        <label>
          模式
          <select
            value={cfg.tts.mode}
            onChange={(e) =>
              patch({ tts: { ...cfg.tts, mode: e.target.value as AppConfig['tts']['mode'] } })
            }
          >
            <option value="server">server（常驻服务）</option>
            <option value="command">command（每句 CLI，备用）</option>
          </select>
        </label>
        {cfg.tts.mode === 'server' && (
          <label>
            服务地址
            <input
              value={cfg.tts.server.baseUrl}
              onChange={(e) =>
                patch({
                  tts: { ...cfg.tts, server: { ...cfg.tts.server, baseUrl: e.target.value } }
                })
              }
            />
          </label>
        )}
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
        <button onClick={() => void testTts()}>测试语音</button>
        {ttsStatus && <div className="siyuan-status">{ttsStatus}</div>}
      </fieldset>

      <fieldset>
        <legend>思源笔记</legend>
        <label>
          Base URL
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
        <button onClick={reloadNotebooks}>刷新笔记本列表</button>
        <button onClick={() => void testSiyuan()}>测试连接</button>
        {siyuanStatus && <div className="siyuan-status">{siyuanStatus}</div>}
      </fieldset>

      <fieldset>
        <legend>对话 / 语音规则</legend>
        <label>
          对话规则（人设 / 系统提示词）
          <textarea
            rows={7}
            value={cfg.chat.persona}
            onChange={(e) => patch({ chat: { ...cfg.chat, persona: e.target.value } })}
          />
        </label>
        <label>
          语音规则（如何输出「日语：」行）
          <textarea
            rows={3}
            value={cfg.chat.voiceRule}
            onChange={(e) => patch({ chat: { ...cfg.chat, voiceRule: e.target.value } })}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>小人</legend>
        <label>
          选择模型
          <select
            value={cfg.pet.modelPath}
            onChange={(e) => {
              const v = e.target.value
              patch({ pet: { ...cfg.pet, modelPath: v } })
              // 立即切换 + 立即持久化（不依赖「保存」按钮）
              usePetStore.getState().setModel(v, cfg.pet.scale)
              void window.api.setConfig({ pet: { modelPath: v } })
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
        <label className="row">
          <input
            type="checkbox"
            checked={cfg.pet.locked}
            onChange={(e) => patch({ pet: { ...cfg.pet, locked: e.target.checked } })}
          />
          锁定（调整模式：左键拖=移动 · 右键拖=平移 · 滑条=缩放）
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={cfg.pet.eyeTracking}
            onChange={(e) => patch({ pet: { ...cfg.pet, eyeTracking: e.target.checked } })}
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
              patch({ pet: { ...cfg.pet, eyeTrackingStrength: v } })
              usePetStore.getState().setEyeTrackingStrength(v)
              void window.api.setConfig({ pet: { eyeTrackingStrength: v } })
            }}
          />
          <span>{cfg.pet.eyeTrackingStrength.toFixed(2)}×</span>
        </label>
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
              patch({ pet: { ...cfg.pet, frameScale: v } })
              // 立即持久化；主进程 ConfigSet 检测到 frameScale 会实时缩放窗口框架
              void window.api.setConfig({ pet: { frameScale: v } })
            }}
          />
          <span>{cfg.pet.frameScale.toFixed(2)}×</span>
        </label>
        <label className="row">
          <span>不透明度</span>
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={cfg.pet.opacity}
            onChange={(e) => {
              const v = Number(e.target.value)
              patch({ pet: { ...cfg.pet, opacity: v } })
              usePetStore.getState().setOpacity(v)
              void window.api.setConfig({ pet: { opacity: v } })
            }}
          />
          <span>{Math.round(cfg.pet.opacity * 100)}%</span>
        </label>
      </fieldset>

      <button className="save-btn" onClick={() => void save()}>
        {saved ? '已保存 ✓' : '保存'}
      </button>
    </div>
  )
}
