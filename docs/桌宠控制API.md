# 桌宠控制 API（第一版）

桌宠运行并加载模型后，本机程序或远程 Agent 可通过 WebSocket 控制表情、动作、视线和参数。接口默认开启，仅监听本机 `127.0.0.1:18790`。设置 → AI 表演与外部控制中可选择“允许其他电脑连接”，填写“桌宠监听端口”和“Agent 连接地址”。保存后接口与下一次对话的提示词更新。连接令牌首次运行自动生成，可在设置中复制。监听端口被占用时桌宠继续运行，设置中可以查看失败原因。

`controlApi.listenHost` 和 `controlApi.port` 决定这台电脑的实际监听地址；`controlApi.endpoint` 是发给 AI/Agent 的连接地址，两者独立。旧配置没有 `listenHost` 时自动迁移，保留原先的本机地址和端口。仅修改 `port` 时，仍会同步原先与监听端口一致的本机连接地址；远程域名的地址保持独立。

此协议为 Desktop Companion 自有协议；VTube Studio 插件需要增加适配才能连接。接口接受不携带浏览器 Origin 的本机或远程客户端，例如 Node.js/Python Agent。远程连接仍须先通过令牌认证。

## 远程 Agent 配置

| 配置 | 用途 | 示例 |
| --- | --- | --- |
| `enabled` | 开启控制接口 | `true` |
| `listenHost` | 桌宠监听范围 | `127.0.0.1` 仅本机；`0.0.0.0` 所有 IPv4 网络接口；`::1` / `::` 对应 IPv6 |
| `port` | 桌宠电脑上的监听端口 | `18790`，范围 1024..65535 |
| `endpoint` | Agent 实际连接的完整地址，自动引用到提示词 | `ws://192.168.1.20:18790` 或 `wss://pet.example.com/agent` |
| `token` | 连接认证令牌，单独保存到 Agent 的配置或环境变量 | 设置中复制，不能放入提示词 |

在同一局域网或 VPN 内：选择“允许其他电脑连接”，将 Agent 连接地址设为 `ws://桌宠电脑的可达IP:18790`，并确保该网络可访问此端口。`0.0.0.0` 表示监听范围，不能填写为 Agent 的目标地址。

Agent 在公网时：使用 VPN 或支持 WebSocket 的隧道/反向代理，把对外地址转发至这台电脑的监听端口。例如隧道转发 `wss://pet.example.com/agent` 到 `ws://127.0.0.1:18790`，桌宠仍可选择“仅本机”，Agent 连接地址填写隧道提供的完整 URL。桌宠自身提供 `ws` 服务，`wss` 的证书与 TLS 由外部隧道/代理处理。域名、对外端口和路径可以与本地监听设置不同；接口地址不接受 URL 中的账号密码、查询参数或片段。

远程 Agent 需要可执行 WebSocket 请求的工具或连接器。仅给语言模型一段提示词不会赋予联网能力。设置中点击“预览已保存的远程 Agent 提示词”，再“复制 Agent 提示词”，将生成的调用规则提前作为系统提示词/工具说明交给 Agent。该提示词引用已保存的 `endpoint` 和当前模型资源，指导 Agent 先 `authenticate`，再 `model.get`，最后按对话语义发送表情、动作或视线命令；连接器从其安全配置读取令牌。它与内置聊天的隐藏标签提示词分别生成，关闭内置聊天表演不会关闭 Agent 说明。

远程电脑上可用项目自带客户端验证（须已安装项目依赖）：

```powershell
$env:DESKTOP_COMPANION_CONTROL_TOKEN = '在桌宠设置中复制的令牌'
node scripts/control-demo.cjs --address 'wss://pet.example.com/agent'
```

监听状态展示的是本机服务是否开启；对外域名、VPN/隧道和防火墙的实际可达性须由远程客户端连接确认。

## 消息格式

发送 JSON 文本，每条消息包含唯一的字符串 `id`、命令 `type` 和对象 `data`。连接后 5 秒内先认证：

```json
{"id":"1","type":"authenticate","data":{"token":"设置中复制的连接令牌"}}
```

成功响应：

```json
{"id":"1","ok":true,"data":{"protocol":"desktop-companion","version":1}}
```

错误响应：

```json
{"id":"2","ok":false,"error":{"code":"MODEL_NOT_READY","message":"请先加载 Live2D 模型"}}
```

## 命令

| type | data | 用途 |
|---|---|---|
| `status.get` | `{}` | 查询端口与模型是否就绪，不返回令牌 |
| `model.get` | `{}` | 获取当前模型、表情、动作、参数 ID/上下限/默认值/当前值 |
| `expression.set` | `{"name":"脸红","durationMs":3500}` | 临时应用表情，结束后恢复之前的手动表情 |
| `motion.play` | `{"name":"默认手切举手","durationMs":3500}` | 播放动作；循环动作也会在期限内停止并恢复基础参数 |
| `gaze.set` | `{"x":-0.8,"y":0.4,"durationMs":2500}` | 接管眼神与轻微头部转向，右/上为正 |
| `parameters.set` | `{"values":[{"id":"ParamAngleZ","value":12}],"durationMs":2000}` | 控制最多 64 个参数，按模型上下限约束数值 |
| `performance.play` | 见下例 | 同时安排情绪、视线和简短动作 |
| `speech.play` | `{"text":"你好！","performance":{"emotion":"happy"}}` | 使用已配置的 TTS 播放语音；表演在音频实际开播时开始 |
| `control.reset` | `{}` | 停止 API 语音/动作，释放参数与眼神控制，恢复临时表情 |

`durationMs` 范围 300–30000 毫秒，默认 3500。眼神 x/y 范围 -1–1。参数逐渐进入目标值，并在结束后约 350 毫秒内释放；光标追踪恢复生效。语音播放时嘴巴开合由音频控制，优先于 API 对 `ParamMouthOpenY` 的写入。

表情和动作名称请先查询 `model.get`，不要假定所有模型具有相同资源。emotion 会优先寻找语义对应的模型表情，同时使用模型支持的微笑参数；它不是自动生成新表情。intensity 控制程序生成的连续动作强度，模型自带的开关表情仍使用模型原始定义。

```json
{
  "id":"3",
  "type":"performance.play",
  "data":{
    "emotion":"shy",
    "gesture":"nod",
    "gaze":{"x":0,"y":0},
    "intensity":0.65,
    "durationMs":3500
  }
}
```

情绪：`neutral/happy/sad/shy/surprised/thinking/angry`。动作：`nod/shake/wave/blink`。情绪和动作使用多套头部、身体、肩膀与手臂曲线轮换，按模型实际参数范围限制。举手优先使用可识别的手臂参数，也可使用模型自带动作；支持能力见 `model.get`。参数未知、表情不存在和不支持的命令均返回明确错误；整批参数会先验证再应用。

认证成功后自动接收 `model.changed`、`expression.started/finished`、`motion.started/finished`、`performance.started/finished`、`speech.started/finished` 事件，例如：

```json
{"event":"performance.finished","data":{"reason":"completed"}}
```

同一连接最多 8 个未完成请求，所有连接合计最多 32 个；每条消息最大 64 KiB。建议 AI 每句话发送一次表演意图，本地渲染器处理连续动画。

## 内置聊天

“聊天时配合表情和动作”默认开启。每次发送对话请求之前，主进程都会读取当前配置和已加载模型，生成放在消息最前面的系统提示词。提示词包含角色设定、语音规则、当前 `controlApi.endpoint` 地址、API 调用文档、当前模型的表情动作名称和以下表演格式：

```text
你好，很高兴见到你！
日语：こんにちは！
<performance>{"emotion":"shy","gesture":"nod","durationMs":3500}</performance>
```

控制标签不会显示或被朗读，格式错误会被忽略。启用语音时，表演跟随实际开播；关闭语音时，回复完成后开始表演。LLM 仍使用原有流式聊天接口，不要求支持工具调用；由桌宠执行 AI 输出的标签，普通聊天模型本身不会直接建立 WebSocket 连接。远程 Agent 可通过其 WebSocket 工具使用配置的对外地址；真实连接令牌不会发给 AI。

设置中的“预览已保存的 AI 提示词”展示与下一次对话相同的生成规则。修改接口地址后先保存，预览和新请求即采用新地址，不需要重启或清空聊天历史。关闭外部 API 时提示词说明其已关闭，内置表演仍可使用；关闭“聊天时配合表情和动作”时不再附加控制规则。

口型通过 Web Audio 实时分析播放音频的音量，静音段收嘴。独立聊天窗口将音量同步到桌宠窗口。当前实现为音量口型，不包含音素或逐字时间戳。

## 快速演示

Windows 可双击项目根目录的 `启动API测试版.cmd`，直接读取已安装桌宠的 DeepSeek 模型，使用项目内 `.control-demo-data/` 独立配置。首次运行复制已安装桌宠的设置，之后修改保存在独立目录。连接令牌重新生成，原有配置和模型保持不变。

启动该版本后运行 `node scripts/control-demo.cjs --config .control-demo-data/config.json` 可观看控制演示。

桌宠启动、选中模型后，在项目目录运行：

```powershell
node scripts/control-demo.cjs --config "$env:APPDATA\desktop-companion\config.json"
```

使用独立测试配置时，把 `--config` 换成该配置文件路径。示例客户端会读取配置中的完整地址；也可设置 `DESKTOP_COMPANION_CONTROL_TOKEN` 并通过 `--address` 指定完整地址，或通过 `--port` 指定本机端口。演示会点头、表现害羞、侧目，然后复位。

## 验证

```powershell
npm run typecheck
npm run test:interaction
npm run test:control
npm run test:chat
npm run test:chat-window
npm run build
node scripts/test-control-live.cjs --models-dir "$env:APPDATA\desktop-companion\models"
```

最后一项默认使用 `models/DeepSeek/大肥鱼.model3.json`，可用 `--model` 更换相对路径。测试启动真实 Electron 窗口，使用独立配置与本机 LLM/TTS 测试服务，音频静音播放；原有配置不被更改。新增检查会监听 `0.0.0.0`，从非回环 IPv4 网络接口连接并认证，控制真实模型的视线，验证对外 `wss` 地址独立写入下一次 AI 请求。没有非回环接口时退回本机测试，报告标注实际接口；此测试不代表已验证公网隧道或另一台电脑。截图与结果保存在忽略提交的 `test-artifacts/`。

开发时可设置 `DESKTOP_COMPANION_DATA_DIR` 使用独立数据目录，设置 `DESKTOP_COMPANION_MODELS_DIR` 直接读取现有模型目录，无需复制模型文件。

窗口检查覆盖首次绘制延迟、首次显示请求未生效、关闭后再次打开和托盘恢复。真实窗口测试直接点击对话按钮并检查原生窗口可见状态；追加 `--chat-window-only` 可仅运行首次打开与关闭后再次打开检查。

聊天支持选择、粘贴或拖入最多 4 张图片，图片随历史记录保存，并按多模态消息格式交给模型；模型须支持图片输入。开启语音时，回复暂存至音频实际开播，然后一起显示对话栏文字和桌宠气泡，并开始表演。气泡长文本按音频进度分段显示，关闭语音时按阅读时间换段；语音失败时照常显示文字。表演时长跟随音频，超过 10 秒时分段轮换动作。新增 `test:chat` 检查图片消息格式、旧数据库迁移、等待与取消行为、动作幅度和参数恢复；真实窗口测试还覆盖图片操作、延迟语音同步与失败回退。
