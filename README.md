# 桌面伴侣 · Desktop Companion

通用的 Windows 桌面陪伴助手：任意 Live2D 模型 + AI 对话 + 语音 + 音乐 + 番茄钟/待办/日记。
换上你自己的模型和角色设定，它就能变成任何你想要的角色。

> **本项目从设计、编码、调试到文档，全程由 AI（[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)）编写完成。**
> 包括 Live2D 渲染适配、模型按键自动探测、水印处理、思源笔记同步、打包发布在内的所有代码，均由 AI 生成并实测验证。

## 功能

- 🐱 **Live2D 桌宠**：透明置顶窗 + 点击穿透 + 锁定模式，支持拖拽移动 / 右键平移 / 框架整体缩放 / 不透明度调节、眼球追踪、随机气泡、口型联动、**一键复位**。
- 🎭 **模型按键自动化**：自动扫描模型目录，把没在 `model3.json` 里声明的表情/动作补全成底部小按钮——不同模型（VTS 导出、Cubism 原生）通吃，换模型不用改配置。
- 🧹 **水印清理**：内置常见免费模型的水印/广告参数压制（如 `Paramheadxy*`），部分模型可写进 `.moc3` 默认值，换机也不丢。
- 💬 **对话（通用 OpenAI 兼容）**：任何实现标准 `/v1/chat/completions` 接口的服务都能直接用 —— OpenAI、DeepSeek、智谱、Moonshot、本地 vLLM / LM Studio / Ollama 等；支持流式 SSE 输出。已用真实服务端实测通过（见下文「对话接口兼容性」）。
- 🎙️ **语音**：TTS（常驻 HTTP 服务 / 外部脚本 两种模式，任何音色都可）。配套语音后端见
  **[companion-voice-server](https://github.com/crsm5192/companion-voice-server)**。
- 🎵 **音乐播放器**：顺序/乱序、进度条、读取音频元数据（标题/艺术家）、列表滚动、关面板继续播、记住上次播放。
- 🍅 **番茄钟 / 待办 / 日记**：本地持久化。
- 📖 **思源笔记**：日记 / 待办自动同步（各可选目标笔记本），连接测试。
- 💾 **存储**：SQLite（sql.js WASM，聊天/待办/日记）。
- 📦 **双版本打包**：便携版（免安装）+ NSIS 安装版（启动快）；模型 / 音乐 / 配置 / 数据都在 exe 外部。
- 🩺 **诊断日志**：启动时在数据目录写 `diagnostic.log`，排查模型/音乐路径、WebGL 等问题。

## 对话接口兼容性

对话模块不绑定任何厂商，只依赖 OpenAI 标准协议。配置方式（⚙️ → 对话模型）：

| 字段 | 说明 |
|---|---|
| Base URL | 服务地址。填 `https://api.deepseek.com` 或 `http://127.0.0.1:8000`（自动补 `/v1/chat/completions`）；若已含 `/v1` 也能正确拼接 |
| API Key | 为空则不发送 `Authorization` 头（适用于内网免鉴权服务） |
| Model | 模型名，需与服务端可用列表一致 |

**实测记录**（非模拟，真实服务端返回）：

```
endpoint = http://<server>/v1/chat/completions
HTTP 200 OK   流式分片 = 11   耗时 = 2105 ms
回复 = "我是可协助问答、写作与分析的 AI 助手。"
```

也验证过错误分支：模型停用时返回 `MODEL_DISABLED`、余额不足时返回 402 `INSUFFICIENT_BALANCE` —— 说明鉴权与请求格式均正确，服务端能正常处理请求。

## 技术栈

| 层 | 选型 |
|---|---|
| 桌面外壳 | Electron 33 + electron-vite 2 |
| 渲染 | React 18 + TypeScript + Pixi.js 8 + easy-live2d |
| 状态 | zustand |
| 对话 | OpenAI 兼容 API（流式 SSE） |
| 语音 | TTS（HTTP 服务 / 外部脚本） |
| 存储 | sql.js（WASM SQLite） |
| 元数据 | music-metadata |

## 快速开始

```bash
npm install
npm run dev
```

> Electron 二进制下载慢（国内）：
> ```bash
> set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ && npm install
> ```

## 换成你自己的角色（三步）

1. **放模型**：把 Live2D 模型文件夹（含 `.moc3` / `.model3.json` / 贴图）拷进 `models/` 目录；
2. **选模型**：⚙️ → 小人 → 选择模型；
3. **改设定**：⚙️ → 角色设定，填角色名、自称、对你的称呼；再按需改「对话 / 语音规则」里的人设。

改完点保存即时生效，无需重启。模型自带的**表情/动作**会自动出现在底部一排小按钮上（详见下节）。

> 模型无需事先在 `model3.json` 里声明 Expressions/Motions —— 程序会扫描目录自动补全。

## 配置

首次运行后生成 `config.json`（位置见下文「数据存放位置」），也可在设置面板（⚙️）里改。关键项：

- `character`：角色设定 —— `name`（角色名，显示在聊天标题/托盘）、`shortName`（聊天气泡落款）、`userName`（对你的称呼）。**换角色就改这里**。
- `llm`：`baseUrl` / `apiKey` / `model`（任意 OpenAI 兼容对话接口；旧版配置里的 `hermes` 段会自动迁移过来）。
- `tts`：`mode`（`server` 常驻服务 / `command` CLI）、`server.baseUrl`、`speed`。
- `siyuan`：`baseUrl` / `token`（思源「设置 → 关于 → API token」）；`syncDiary` / `diaryNotebook`（日记同步开关与目标笔记本）、`syncTodo` / `todoNotebook`（待办同步）。日记同步为同路径幂等更新（`/日记/日期`），待办整表覆盖为一篇 Markdown 任务清单。
- `pet`：`modelPath`、`scale`、`opacity`、`frameScale`、`eyeTracking`、锁定等。
- `chat.persona`：对话规则（人设 / 系统提示词）。
- `chat.voiceRule`：语音规则（如何输出「日语：」行）。

## 模型按键（表情 / 动作）

不同来源的 Live2D 模型差异很大，程序统一处理：

| 情况 | 处理方式 |
|---|---|
| `model3.json` 已声明 Expressions / Motions | 直接读取 |
| 目录里有 `exp3.json` / `motion3.json` 但**没声明**（VTS 导出常见） | 自动扫描补全声明（只改内存，不动模型文件） |
| 模型完全没有表情/动作 | 不显示按钮条 |

- 表情显示为一排圆角小按钮；动作收进 `▾` 下拉，避免堆满屏幕；
- 按钮数量随模型自动变化，切换模型即刻刷新。

## 水印 / 广告清理

部分免费模型自带水印开关参数（VTS 里可用热键关掉）。程序已内置压制：

- `Paramheadxy*` 系列（常见免费模型水印）：每帧强制隐藏；
- 支持把开关**直接写进 `.moc3` 默认值**（如初音模型的 `Param137`），这样复制模型到任何电脑都不会再出现水印，不依赖程序设置。

## 数据存放位置

| 版本 | 位置 |
|---|---|
| **开发** | 模型/音乐在 `src/renderer/public/{models,music}/`；配置/数据在 `%APPDATA%\DesktopCompanion\` |
| **便携版 exe** | 全部在 **exe 旁边**（`models\` `music\` `config.json` `data.db`），随 exe 携带 |
| **安装版（NSIS）** | 全部在 `%APPDATA%\DesktopCompanion\`（`config.json` `data.db` `models\` `music\`），**覆盖安装/卸载不会被清空** |

> 从旧版（`awa-subaru-companion`）升级时，首次启动会自动把旧的配置/数据/模型/音乐迁移过来。

> 记不清路径时，看数据目录里的 `diagnostic.log`，会写明 `modelsDir` / `musicDir` 的实际位置。

## 模型 / 音乐（外部，不进仓库）

模型放在 `src/renderer/public/models/`（开发）或上面的数据目录（打包），
音乐放在 `src/renderer/public/music/`（开发）或数据目录（打包）。
两者因体积和版权原因均不提交，需自行准备。

> 提示：若某个模型切不过去、报 404，多半是它的 `model3.json` 里相对路径写错（例如表达式写成了 `../xxx.exp3.json` 而实际在 `expressions/` 子目录）。

## 打包（Windows）

```bash
npm run build:win:portable   # 便携版（免安装）
npm run build:win:nsis       # NSIS 安装版（启动快）
npm run build:win            # 两者都出
```

产物在 `release/`：`DesktopCompanion 0.2.0.exe`（便携）+ `DesktopCompanion Setup 0.2.0.exe`（安装）+ `models\` + `music\`。

打包注意事项：
- 若 electron 下载超时，用 `ELECTRON_MIRROR` 镜像（见「快速开始」）；
- 若 `winCodeSign` 解压报「符号链接」错误，先开启 Windows「开发人员模式」（设置 → 隐私和安全性 → 开发者选项 → 开发人员模式）。

## 排查

- **模型列表为空**：看 `diagnostic.log` 的 `modelsDir 存在: ...`，确认模型放对了位置。
- **模型加载但画面不显示**：多半是显卡驱动/WebGL 问题（Live2D 靠 WebGL 渲染）。打开控制台（`Ctrl+Shift+I`）看 `[webgl] renderer/vendor/version`，更新显卡驱动或换真机。
- **换电脑切不了模型**：确认把 `models\`（和 `music\`）拷到了正确的数据目录。

## 相关项目

- 🔊 **[桌面伴侣 · 语音服务](https://github.com/crsm5192/companion-voice-server)** —— **本项目的配套语音后端**。
  这是一个常驻 TTS 服务（CosyVoice3），专门为桌宠适配：模型只加载一次常驻内存，提供 OpenAI 兼容的
  `/v1/audio/speech` 接口，桌宠说一句话就是一次 HTTP 请求，无需每次等模型加载。

  两者通过 HTTP 解耦，可以：

  - 跑在同一台机器（桌宠填 `http://127.0.0.1:8001`）
  - 跑在局域网另一台有显卡的机器上（桌宠填该机器 IP）
  - 完全不部署语音服务（桌宠里把 TTS 关掉，纯文字聊天）

## 下载

| 版本 | 说明 |
|---|---|
| **[便携版](https://github.com/crsm5192/desktop-companion/releases/latest/download/DesktopCompanion.0.2.0.exe)** | 免安装，解压即用；模型/音乐/配置/数据都在 exe 旁边，可整个文件夹带走 |
| **[安装版](https://github.com/crsm5192/desktop-companion/releases/latest/download/DesktopCompanion.Setup.0.2.0.exe)** | NSIS 安装包，启动更快；数据存在 `%APPDATA%\DesktopCompanion\`，覆盖安装不清空 |

> 全部版本见 **[Releases](https://github.com/crsm5192/desktop-companion/releases)**。
> 模型与音乐因版权不随包分发，需自行放入数据目录（见上文「数据存放位置」）。

### 配套语音服务（可选）

桌宠可以不装语音服务（纯文字聊天）；想让角色开口说话，部署配套项目即可：

- 🔊 **[companion-voice-server](https://github.com/crsm5192/companion-voice-server)** ｜ **[其 Releases](https://github.com/crsm5192/companion-voice-server/releases)**

## 许可

MIT
