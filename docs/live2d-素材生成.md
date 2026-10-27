# 安和昴 Live2D 素材生成方案（B）

> 目标：从安和昴参考图出发，生成能直接喂进 Live2D Cubism 的「正常比例半身」分层立绘，
> 再在 Cubism 里做「呼吸 + 眨眼 + 口型」精简 rig，替换桌宠里的 CSS 占位小人。

角色：安和昴（Awa Subaru），《GIRLS BAND CRY》（哭泣少女乐队 / ガールズバンドクライ），17 岁，乐队鼓手。

---

## 0. 外观设定（⚠️ 待你确认 —— 以你的 chibi 图为准）

| 项 | 默认值（据动画设定，供参考） | 你的 chibi 实际 |
|---|---|---|
| 发色 | 金色短发（下巴长度、微卷 bob） | ？ |
| 瞳色 | 绿色 | ？ |
| 发型特征 | 呆毛 / 刘海样式 | ？ |
| 服装 | 乐队便服 / 校服 | ？ |
| 标志性配件 | 鼓棒 / 耳机 等 | ？ |

> 请把「你的 chibi 实际」这列填给我，或直接把 chibi 图路径发我；我把提示词里的外观段改成准确的。

---

## 1. 生成目标（喂 Cubism 用的分层立绘）

Live2D 需要**分层 PSD + 正面无透视 + 中性表情**，这是硬性要求：

- 正面朝向、对称、站立（双臂自然下垂、略离开身体，方便分件）
- 无透视 / 无透视缩短（正视角，不能是俯视仰视）
- 中性表情：嘴闭合、双眼睁开、平视镜头
- 纯白或纯透明背景
- **正常比例、半身（waist-up，腰以上）** —— Live2D 最经典格式；桌宠窗口小、半身最合适，且能套现成半身 rig 模板省时间
- 半身就够：头 + 胸 + 手臂（不生成腿，减少分件和 rig 工作量）

---

## 2. Qwen-Image-Layered 提示词

> 模型会自动拆层输出带 alpha 的 PSD/分层图。提示词把「角色 + 姿势 + 分层」讲清楚即可。

**正向提示词（英文对模型更稳）：**

```
masterpiece, best quality, 1girl, anime girl, normal proportions, waist-up, upper body,
front view, standing, arms slightly away from body, symmetrical,
neutral expression, closed mouth, open eyes, looking at viewer,
flat color, clean lineart, plain white background,
character reference sheet, layered illustration, separated parts, PSD layers

Subaru Awa (Girls Band Cry), short blonde wavy bob hair, green eyes, ahoge,
simple casual outfit, <按第 0 节确认的外观补充>
```

**负向提示词：**

```
(3d, realistic, photo, blurry, low quality, worst quality),
side view, back view, perspective, foreshortening, tilted head,
complex background, extra fingers, bad anatomy, missing limb,
hair covering face, heavy shading, gradient background
```

---

## 3. ComfyUI 工作流参数

- **模型**：Qwen-Image-Layered（checkpoint，如 `qwen-image-layered-2512`，Civitai / HF 可下）
- **分辨率**：1024×1024（方）或 1024×1536（竖版立绘，上半身够用）
- **采样**：用工作流默认（约 steps 28–40，cfg 4–5；以你下载的工作流为准，先跑默认再微调）
- **参考图接入（强烈建议）**：把你的 chibi 图用 ControlNet（lineart / depth）或 img2img 传入，保证生成结果贴合你的小人，而不是凭空画
- 参考工作流：
  - [Qwen-Image-Layered ComfyUI 工作流指南](https://10b.ai/blog/qwen-image-layered-comfyui-workflow-2026)
  - [Qwen-Image-Layered 做 Live2D 脸部件分离实测](https://lilting.ch/en/articles/qwen-image-layered-live2d-face-parts)

---

## 4. 部件清单（生成后检查 / 手动补）

AI 拆层通常不完美，进 Cubism 前要确认这些**关键层都在、且背面没有空洞**：

- [ ] 头发后层（back hair）
- [ ] 脸 / 头（head base）
- [ ] 刘海 / 头发前层（front hair）
- [ ] 眉毛 × 2
- [ ] 眼白 × 2
- [ ] 虹膜+瞳孔 × 2
- [ ] 眼睛高光 × 2
- [ ] 嘴（闭合）
- [ ] 嘴（张开，做 2~3 档口型）
- [ ] 身体 / 衣服
- [ ] 左臂 / 右臂（分开）

> AI 最常缺的是「眼睛的睁+闭两张」和「张嘴口型」，这两项是眨眼/口型动画的基础，缺了要手动补画或用图层编辑补。

---

## 5. Cubism 精简 rig 检查表（呼吸 + 眨眼 + 口型）

导入 Cubism Editor（自动网格）后，只做这些参数就够桌宠用：

| 参数 ID | 作用 | 绑定 |
|---|---|---|
| `ParamEyeLOpen` | 眨眼（眼睑/眼睛 scaleY） | 眼白、虹膜、高光、上眼睑 |
| `ParamMouthOpenY` | 口型开合（说话时跟 TTS 音量联动） | 嘴张开层 / 下唇 |
| `ParamBreath` | 呼吸（身体整体 scale，幅度小） | 身体、头 |
| `ParamAngleX` / `ParamAngleY` | 头部轻微转动（可选） | 头、发、五官 |
| `ParamBodyAngleX` | 身体轻微摆动（可选） | 身体 |

导出：`.moc3` + 贴图 + `model3.json`，放进 `desktop-companion/resources/models/`，设置里填 `modelPath` 即可替换占位小人。

---

## 6. 大致工作量（回顾）

- 生成 + 抽卡 + 修图（补背面/补睁闭眼口型）：0.5–1 天
- Cubism 精简 rig（上表参数）：0.5–1 天
- 导出 + 接入桌宠：小半天

总计约 **2–3 天**（个人 DIY，不含外包；正常比例可套现成半身 rig 模板，rig 部分还能更快）。

---

## 7. 平图 → 分层 PSD（Qwen-Image-Layered 接法）

> 把你这张「五指张开」的平图当参考，喂给 Qwen-Image-Layered，出带 alpha 的分层 PSD。

### 7.1 需要装的东西

- **模型**：Qwen-Image-Layered（checkpoint 或 GGUF 版，Civitai / HF 可下）
- **自定义节点**（二选一，用于把分层结果存成 PSD/TIFF）：
  - [Qwen_Layers_Diffuser_Pipeline_Comfyui](https://github.com/EricRollei/Qwen_Layers_Diffuser_Pipeline_Comfyui)（含 `.psd` / `.tiff` 保存节点）
  - [Comfyui-HAIGC-PSD](https://github.com/HAIGC/Comfyui-HAIGC-PSD)（保存分层图为 PSD）
- 官方工作流参考：[docs.comfy.org · Qwen-Image-Layered](https://docs.comfy.org/zh/tutorials/image/qwen/qwen-image-layered)

### 7.2 节点链（概览）

```
Load Checkpoint (Qwen-Image-Layered)
  ├─ CLIP Text Encode（正向：本文第 2 节提示词）
  ├─ CLIP Text Encode（负向）
  └─ [参考图] Load Image → ControlNet / IPAdapter / img2img ─┐
KSampler → VAE Decode → Qwen Layers 输出节点 → 保存 .psd
```

### 7.3 参考图三种接法（按你 ComfyUI 里有没有对应节点选一种）

| 方式 | 作用 | 参数 |
|---|---|---|
| **img2img**（最通用） | 平图当初始图，低 denoise 重绘成分层 | denoise 0.6~0.8 |
| **ControlNet lineart / depth** | 锁住姿态与线稿 | 需装 Qwen-Image 对应 ControlNet，strength 0.6~0.9 |
| **IPAdapter** | 锁住长相 / 画风 | 需装 IPAdapter 节点，weight 0.7~0.9 |

> 不确定支不支持 ControlNet / IPAdapter 时，先用 **img2img** 最稳。

### 7.4 关键参数

- 分辨率：**竖版 1024×1536**（全身站姿）；模型不支持该档就选它原生支持的最接近竖版
- 提示词：用本文第 2 节的正 / 负向（外观段填你最终确认的样子）
- 输出：分层 PSD（每层带 alpha）

### 7.5 重要提醒（别期望过高）

Qwen-Image-Layered 的「分层」是**粗分层**（角色主体 / 前景 / 背景等大层），**不是** Live2D 需要的细部件分层（眼、口、眉、发前后层）。所以出 PSD 后仍要在 PS / Cubism 里：

1. 把粗层再**拆成细部件**（尤其眼睛睁+闭、嘴张开、头发前后层）；
2. **补画**被宽袖遮挡的手臂内侧、躯干、被前发遮住的后脑勺；
3. 统一部件分辨率后进 Cubism 自动网格 + 精简 rig（第 5 节）。

---

## 8. See-through / live2d-model-maker 主线（自动拆层 + 补遮挡）

> 比 Qwen-Image-Layered 更对口：一张动漫立绘 → 自动拆 **~23 层**（带深度排序）+ **inpaint 补全遮挡区**，直接面向 Live2D。建议用它当主力，第 7 节当备选。

### 8.1 相关项目

| 项目 | 说明 |
|---|---|
| [See-through（shitagaki-lab）](https://github.com/shitagaki-lab/see-through) | 原版研究系统：单图 → 23 层可动 2.5D 模型 |
| [mrcuddle/live2d-model-maker](https://huggingface.co/mrcuddle/live2d-model-maker) | FLUX 版模型（`LIVE2D-FLUX.safetensors`） |
| [ComfyUI-See-through](https://github.com/jtydhr88/ComfyUI-See-through) | ComfyUI 插件（推荐，直接装） |
| [Bunraku（arXiv 2607.27348）](https://arxiv.org/abs/2607.27348) | 后续系统：单图 → 可编辑 Live2D 角色（关注，可能更完整） |

### 8.2 两条用法

1. **ComfyUI 插件**（推荐）：装 `ComfyUI-See-through` → 工作流喂图 → 出分层；
2. **FLUX 模型直用**：`LIVE2D-FLUX.safetensors` 当 FLUX LoRA 加载。

参考实战（含坑位，先读）：
- [See-through hands-on：setup and where it breaks](https://lilting.ch/en/articles/see-through-anime-layer-decomposition)
- [See-through 徹底解説（日文，原理 + 动かし方）](https://note.com/ai_driven/n/nafe907059646)

### 8.3 推荐流水线（主线 + 兜底）

```
安和昴平图（正面 / A-pose / 白底）
   ↓ See-through / live2d-model-maker
   ↓ 自动拆 23 层 + 补全遮挡
   ↓ 检查拆坏 / 补坏处（披帛、袖内衬、手、后脑勺）
   ↓ Nano Banana Pro / GPT Image 逐块精修
   ↓ PS 抠 alpha + 像素对齐（睁闭眼 / 口型）
   ↓ Cubism 自动网格 + 精简 rig（第 5 节）
```

### 8.4 坑位清单（提前知道，少踩）

1. **FLUX 底模**：要额外下 FLUX 底座（大、吃显存；4080 16GB 能跑，但别和 ComfyUI 出图同时抢 GPU）；
2. **23 层是固定模板**：标准件（发前/发后、眼、口、身体、左右臂等）；你的**汉服大袖 + 披帛/飘带**是非标件，大概率**拆不干净**，需单独拆或兜底；
3. **补全（inpaint）质量不稳**：遮挡越复杂越容易补崩，手、袖内、裙摆交叠是重灾区；
4. **深度排序/层顺序**：AI 给的层序未必对，进 Cubism 前要核对前后关系；
5. **睁闭眼/口型仍要自己补**：模型给的是「睁眼 + 闭嘴」单态，眨眼/说话那几帧还是要 AI 编辑器对齐生成或手绘；
6. **先拿 1 张试跑**：别直接上你的最终图，先随便找张动漫立绘验证环境 + 看拆层质量，再喂安和昴。

### 8.5 逐块重画提示词模板（喂 Nano Banana Pro / GPT Image）

> 按视觉体检结果，See-through 拆出的**大件（身体/衣服/发/脸底）可直接用**，下面这些**五官细节 + 手 + 披帛**要逐块重画。

**通用规则（先看，很重要）：**

1. **每次都从「原图」出发改**，不要拿上次改过的图再改（避免风格漂移累积）；
2. **每次只改一处**，指令里写死「其它部分保持不变」；
3. 改完**只抠出被改的部件**，替换 PSD 里对应层，别整张重贴；
4. 睁眼/闭眼、闭嘴/张嘴这类**变体必须从同一张底图改**，保证像素对齐；
5. 英文指令效果更稳，中文备查。

---

**① 鼻子**

- 中文：把鼻子画清晰——一条自然的鼻梁/鼻尖阴影，动漫风，不要糊成光晕。其它部分保持不变。
- 英文：`Redraw the nose as a clean anime-style nose line with a subtle nostril/nose-tip shadow, not a blurry glow. Keep everything else identical.`

**② 嘴（闭嘴基础版）**

- 中文：把嘴画清晰——一条完整的闭合唇线，有上下唇厚度，动漫风。其它部分保持不变。
- 英文：`Redraw the mouth as a clean closed-mouth line with defined upper and lower lip, anime style. Keep everything else identical.`

**③ 嘴（张嘴口型，做 2~3 档，用于 lip sync）**

- 中文：嘴的位置和大小不变，把它改成【微张 / 半张 / 大张】的样子，露一点牙和舌头。其它部分保持不变。
- 英文：`Keep the mouth position and size exactly the same, but change it to a slightly-open mouth showing a bit of teeth and tongue. Keep everything else identical.`
- （微张/半张/大张三档分别跑一次，得到 3 张口型帧）

**④ 眉毛**

- 中文：把眉毛画清晰——两条完整的弧线眉，颜色和原图一致，不要断裂、不要糊。其它部分保持不变。
- 英文：`Redraw the eyebrows as two clean, complete arcs matching the original color, no breaks or blur. Keep everything else identical.`

**⑤ 眼白**

- 中文：把眼白画自然——贴合上下眼睑弧度的形状，不要纯白椭圆，露出面积正确。其它部分保持不变。
- 英文：`Redraw the eye whites to fit the eyelid curve, not a plain white oval, with natural exposed area. Keep everything else identical.`

**⑥ 睫毛**

- 中文：把睫毛画干净、左右对称、粗细均匀，边缘无杂色。其它部分保持不变。
- 英文：`Clean up the eyelashes — even thickness, symmetrical left/right, no color noise on edges. Keep everything else identical.`

**⑦ 耳朵**

- 中文：把耳朵边缘画干净、平滑，去掉锯齿和模糊。其它部分保持不变。
- 英文：`Clean up the ears — smooth edges, remove jaggies and blur. Keep everything else identical.`

**⑧ 手（五指张开、清晰）**

- 中文：把手重画——五指张开、每根手指分明、关节自然、指甲清晰，动漫风，和袖口衔接自然。其它部分保持不变。
- 英文：`Redraw the hand with five clearly separated fingers, natural joints, clean nails, anime style, connecting naturally to the sleeve. Keep everything else identical.`

**⑨ 披帛 / 飘带（新增层，因为 See-through 把它丢了）**

- 中文：给这个角色加一条绕肩绕臂的绿色飘带披帛（celestial silk sash），动漫风，从肩上自然垂下，配色和原图一致，纯白背景。
- 英文：`Add a flowing green silk ribbon/sash draped over the shoulder and arm, anime style, matching the original color scheme, on a plain white background.`
- 用法：单独生成 → 抠 alpha → 作为新层加进 PSD（注意和袖子/身体的前后遮挡关系）。

---

**改完的收尾**：所有重画部件抠 alpha → 对齐 → 替换进 PSD 对应层 → 进 Cubism 自动网格 + 精简 rig（第 5 节）。

---

## 9. 验证跑通（先把 .moc3 接进桌宠，再慢慢磨画）

> 不追求完美，先让管线全通：See-through PSD → 最小 rig → 导出 .moc3 → 桌宠里动起来。

### 9.1 下载两样东西

1. **Cubism SDK for Web**（拿 `Core/live2dcubismcore.min.js`）→ 复制到游戏 `src/renderer/public/`；
2. **Live2D Cubism Editor**（FREE 版）→ 装好。

### 9.2 最小 rig（只做 3 个参数，够验证）

1. Cubism Editor 打开 See-through 的 `.psd`（导入为纹理）；
2. 自动网格（Editor 4.x 的「自动网格生成器」，或逐件套网格）；
3. 建 3 个参数：
   - `ParamBreath` —— 呼吸（整体轻微 scale）
   - `ParamEyeLOpen` —— 眨眼（睫毛/眼白 scaleY）
   - `ParamMouthOpenY` —— 口型（嘴开合）
4. 导出 → **moc3（运行时）** → 得到 `xxx.moc3` + `xxx.model3.json` + 贴图。

> 五官糙没关系，先验证「模型能加载、能呼吸眨眼」。

### 9.3 放进游戏

1. 把导出的 `.moc3` + `.model3.json` + 贴图，整包放进 `src/renderer/public/models/`；
2. 桌宠 ⚙️ 设置里 `modelPath` 填 **`models/xxx.model3.json`**（相对路径，不带前导 `/`）；
3. `npm run dev` → 应该看到 Live2D 小人站在窗口底边。

### 9.4 注意

- **dev 模式**直接能加载（Vite 从 public/ 提供文件）；**打包版**要自定义协议（file:// 不能直接 fetch），后续再补；
- 游戏侧代码已就绪（`Live2DPet.tsx`：动态加载 Cubism Core + `pixi-live2d-display/cubism4` 渲染，底部居中，模拟站屏幕边）。
