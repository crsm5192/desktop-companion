import type { AppConfig, ChatMessage } from '../../shared/types'
import { controlEndpoint, PERFORMANCE_PROMPT, type ModelCapabilities } from '../../shared/control'

export function buildChatSystemPrompt(config: Pick<AppConfig, 'chat' | 'controlApi'>, capabilities: ModelCapabilities | null, target: 'chat' | 'agent' = 'chat'): string {
  const sections = target === 'chat' ? [config.chat.persona, config.chat.voiceRule] : []
  if (target === 'chat' && !config.chat.performanceEnabled) return sections.filter(Boolean).join('\n\n')
  const endpoint = controlEndpoint(config.controlApi)
  const execution = target === 'agent'
    ? '通过你实际拥有的 WebSocket 执行工具或连接器连接目标地址，先 authenticate，再 model.get 查询模型能力，按对话语义调用下方命令增加表情、动作与眼神。每句话最多安排一次表演意图，等待响应确认后再认为执行成功。只有需要桌宠朗读时才调用 speech.play。连接器须预先配置令牌；缺少执行工具、接口已关闭或连接失败时，明确说明无法控制。'
    : `你通过回复末尾的 <performance>JSON</performance> 发出表演指令，桌宠解析并执行 performance.play。你无需自行连接 WebSocket；只描述动作而没有合法标签，不会触发表演。不能声称已连接或调用自己没有执行工具的接口。\n${PERFORMANCE_PROMPT}`
  sections.push(`【桌宠表演规则与控制接口文档】
当前控制接口地址：${endpoint}
外部 WebSocket 接口：${config.controlApi.enabled ? '已启用配置' : '已关闭'}。${target === 'chat' ? '内置聊天的表演指令由桌宠本机执行，不依赖外部接口开关。' : '此地址须从 Agent 所在的机器可达。'}
在回复用户之前理解以下调用规则，聊天过程中根据语义选择恰当的表情、动作与眼神。

【本次对话的执行方式】
${execution}
表达高兴时可用 happy，害羞时 shy，难过时 sad，思考时 thinking；赞同可点头 nod，否定可摇头 shake，招呼可 wave，轻松互动可 blink。使用当前模型支持的动作。正文保持自然，不要显示接口地址、JSON、鉴权信息或调用说明，不要让用户阅读控制指令。
有明确情绪的回复安排一次表演，轮换合适的动作和视线，避免连续使用同一种点头。通常 intensity 选 0.75 到 1；安慰或严肃内容可以降低。情绪本身也会驱动头部、身体与肩膀的联动，不必每次都指定 gesture。表演由播放器按实际语音时长安排。

【外部程序调用协议】
目标地址：${endpoint}。本机或远程 Agent 通过具备 WebSocket 执行能力的连接器发送 JSON 文本，不携带浏览器 Origin。每条请求带唯一字符串 id、type 和对象 data。
连接后 5 秒内先发送 {"id":"auth-1","type":"authenticate","data":{"token":"由 Agent 连接器从其安全配置读取"}}。桌宠设置中复制的令牌须单独配置到 Agent，真实令牌不会发送给语言模型。连接地址可能经由 VPN 或隧道转发；wss:// 的 TLS 由外部代理提供。
认证后可发送 {"id":"model-1","type":"model.get","data":{}} 查询资源。成功响应 {"id":"model-1","ok":true,"data":{...}}；失败响应包含 ok:false 与 error.code/error.message。
命令与参数：
- status.get：data={}，查询模型与端口状态。
- model.get：data={}，查询表情、动作、参数 ID、上下限和当前值。
- expression.set：data={"name":"模型现有表情名","durationMs":3500}。
- motion.play：data={"name":"模型现有动作名","durationMs":3500}。
- gaze.set：data={"x":0,"y":0,"durationMs":2500}，x/y 范围 -1..1，右/上为正。
- parameters.set：data={"values":[{"id":"ParamAngleZ","value":12}],"durationMs":2000}，最多 64 个参数，程序约束至模型上下限。
- performance.play：data={"emotion":"shy","gesture":"nod","gaze":{"x":0,"y":0},"intensity":0.65,"durationMs":3500}。
- speech.play：data={"text":"你好","performance":{"emotion":"happy"}}，使用已配置 TTS，开播时开始表演。
- control.reset：data={}，停止 API 语音和动作，恢复临时表情并释放眼神控制。
durationMs 范围 300..30000，默认 3500；intensity 范围 0..1。内置聊天建议动作持续 300..10000 毫秒。
表情、动作和参数必须来自当前模型；不知道名称时先查询 model.get。收到未知资源错误时，选择模型支持的资源，不虚构已执行成功。
可接收 model.changed、expression.started/finished、motion.started/finished、performance.started/finished、speech.started/finished 事件。参数与眼神结束后平滑恢复，语音口型跟随音频音量。

【当前模型能力】`)
  if (capabilities) {
    sections.push(JSON.stringify({
      modelPath: capabilities.modelPath,
      expressions: capabilities.expressions.map(item => item.name),
      motions: capabilities.motions.map(item => item.name),
      emotions: capabilities.emotions,
      gestures: capabilities.gestures,
      parameters: capabilities.parameters.filter(item => /^(ParamAngle[XYZ]|ParamEyeBall[XY]|ParamMouth(OpenY|Form)|ParamEye[LR]Open)$/.test(item.id)).map(item => ({ id: item.id, minimum: item.minimum, maximum: item.maximum }))
    }))
  } else sections.push('模型尚未加载。不要虚构表情、动作资源或声称表演已成功。')
  return sections.filter(Boolean).join('\n\n')
}
/** Rebuilt immediately before each request so saved address/persona changes cannot remain stale. */
export function prepareChatMessages(messages: ChatMessage[], config: Pick<AppConfig, 'chat' | 'controlApi'>, capabilities: ModelCapabilities | null): ChatMessage[] {
  const prompt = buildChatSystemPrompt(config, capabilities)
  const conversation = messages.filter(message => message.role !== 'system')
  return prompt ? [{ role: 'system', content: prompt }, ...conversation] : conversation
}
