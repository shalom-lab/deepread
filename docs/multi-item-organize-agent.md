# 条目整理 Agent（人工拍板 · 首个 Tool）

## 1. 目标任务

做一套**主打条目整理**的 Agent 能力：和现有「单篇 AI 阅读对话」**产品上拆开**——阅读归阅读，整理归整理。  
AI 只提案；**改库的 Tools 必须由人点 OK**。本文件描述的 **`organize_rename` 是第一个落地 Tool**；以后可加合并重复、补元数据等，但都挂在「整理」这条线，不塞进阅读聊天。

### 产品定位

| | AI 阅读（现有） | 条目整理（本能力） |
|--|----------------|-------------------|
| 主场景 | 单篇精读、追问、存笔记 | 多选批处理、规范命名、理附件 |
| 交互 | 自由对话 + 用户预设 | **写死指令** + 提案确认 |
| 是否改库 | 基本不改条目本体 | **会改**标题/附件名等（确认后） |
| 关系 | 互不混用历史与入口 | 仅共用模型账号配置 |

### 首期完工标准

- 多选时可打开「条目整理」面板（不占用/不伪装成阅读侧栏）。
- 快捷指令写死；首期只启用 **规范条目名 + Manuscript/Appendix 附件命名**。
- 执行前强制 **log + 把握度**；OK 前零写库。
- 共用现有 Provider / API Key / 模型选择（配置层共用，产品层分立）。

### 非目标（首期不做）

- 不和阅读聊天共用会话、不共享「深度阅读」预设。
- 不自动静默改名、不无人值守。
- 不一次上齐多个 Tool（只把扩展点留好）。

---

## 2. 背景信息

### 场景

用户多选一批「关系乱 / 附件名乱」的条目，希望：

1. **条目标题** → 官方标准名（优先 PubMed / 已有 DOI·PMID 元数据）。
2. **附件文件名** → 统一前缀规则（相对「文章名缩减」）：
   - `Manuscript_<短标题>`
   - `Appendix1_<短标题>`
   - `Appendix2_<短标题>`
   - （可扩展 `AppendixN_`）
3. 处理前看 **log + 把握度**，人点 OK 再改。

### 与现有 DeepRead 的关系（刻意不搭车阅读）

| 能力 | AI 阅读侧栏 | 条目整理 Agent |
|------|-------------|---------------|
| 产品叙事 | 读文献 | **整理文库** |
| 模型配置 | 共用账号/Key | 共用账号/Key |
| UI / 入口 | 单篇 Item Pane | **多选整理入口**（独立） |
| 历史 | `deepread_history` 按 item | 整理 session，与阅读隔离 |
| Tools | 无 | `organize_rename` 为首个；可增 |
| 快捷指令 | 用户可编预设 | **写死白名单** |

### 建议目录 / 模块（实现时）

```
deepread.js
agents/
  OrganizeAgent.js
  OrganizeDialog.js
tools/
  OfficialMetaLookup.js
  ZoteroAtomTools.js      # 原子层：set_item_title / rename_attachment /
                          # delete_attachment / move_attachment / set_item_field
  OrganizeRenameTool.js   # 组合层：organize_rename → 展开为原子步骤
docs/
  multi-item-organize-agent.md
```

### 原子 Tool 层（已定）

| id | 风险 | 说明 |
|----|------|------|
| `set_item_title` | 中 | 改标题；默认要求 officialSource |
| `rename_attachment` | 中 | 改附件文件名/显示名 |
| `delete_attachment` | 高 | 删除/进回收站 |
| `move_attachment` | 高 | 附件换父条目 |
| `set_item_field` | 中 | 白名单字段写入 |

组合 Tool（如 `organize_rename`）只负责提案，执行时拆成原子步骤经 `AtomTools.runPlan` 跑。未来「A 改名 + B 删除」= 同表勾选不同原子步骤。

### 首期写死快捷指令（示例文案）

1. `规范命名：条目标题 + Manuscript/Appendix 附件`
2. （预留槽位，暂不启用）`仅规范附件名`
3. （预留槽位，暂不启用）`仅拉取官方标题建议`

### Tool 契约（草案）`organize_rename`

**输入（模型提案 JSON）**

```json
{
  "tool": "organize_rename",
  "summary": "将 3 条文献标题与附件按 PubMed/DOI 元数据规范命名",
  "items": [
    {
      "itemID": 123,
      "confidence": 0.86,
      "confidenceNote": "DOI 命中且标题与现附件高度一致",
      "title": {
        "from": "旧标题...",
        "to": "官方标准标题...",
        "source": "pubmed|doi|crossref|existing-meta|model-guess"
      },
      "shortTitle": "YellowFever_SE_Brazil",
      "attachments": [
        {
          "attachmentID": 456,
          "from": "全文.pdf",
          "to": "Manuscript_YellowFever_SE_Brazil.pdf",
          "role": "manuscript|appendix1|appendix2|other",
          "confidence": 0.9
        }
      ]
    }
  ]
}
```

**输出（执行结果）**

```json
{
  "ok": true,
  "applied": [{ "itemID": 123, "changed": ["title", "att:456"] }],
  "skipped": [],
  "errors": []
}
```

### 把握度日志（确认前 UI 必显）

对每个 item / 每个附件展示：

- `confidence`（0–1 或 高/中/低）
- `source`（官方来源 vs 模型猜测）
- `from → to`
- 低把握（如 &lt; 0.6）默认勾选「跳过」，用户可手动勾回

---

## 3. 工作要求

### 范围

- 仅 **顶层常规条目**（及各自子附件）；附件单独多选时可归一到父条目再整理。
- 命名字符集：文件系统安全（去 `\ / : * ? " < > |`），空格可改 `_`，短标题长度上限建议 40–60。
- 附件扩展名保留原后缀（`.pdf` / `.docx` 等）。

### 禁止项

- 禁止在用户点 OK 前调用任何写操作（`setField` / 重命名文件 / `saveTx`）。
- 禁止模型直接「执行」；模型只能产出提案 JSON。
- 禁止首期开放自由 Tools 调用（防乱改库）；仅白名单 Tool。
- 禁止用整理会话污染单篇阅读历史（除非用户显式选择合并）。

### 质量约定

- 官方来源优先：已有 DOI/PMID/PMC → 本地字段或 API 核对 → 再模型补全。
- `source: model-guess` 的项必须在 log 里标黄/低把握。
- 执行失败单项报错，不中断整批（汇总到结果面板）。
- 与现有 UI 语言一致（中英跟随 `_locale`）。

### 人机分工（Agent + Tools）

```
用户选指令 → Agent 调模型分析 → 生成 Tool 提案 + 把握度 log
     → 人审阅 / 勾选 → 点 OK → ToolRegistry 执行 → 回写结果到对话
```

「拍板」永远在人；未来加 Tools 只加工具定义 + 确认卡片，不改这条主链。

---

## 4. 工作流程

### Step 1 — 多选入口

- 选中 ≥2 条时，Item Pane 展示整理入口（或独立按钮/section：「多选整理」）。
- 单选仍走原 DeepRead 阅读侧栏，互不抢。

### Step 2 — 固定快捷指令

- 下拉/按钮仅白名单指令；首期默认选中「规范命名」。
- 输入框可补一句用户说明（可选），但不能换成任意 Tool。

### Step 3 — Agent 收集上下文

- 打包选中条目：标题、DOI、ISBN、附加 PDF/Word 文件名、部分元数据。
- **不默认上传全文 PDF**（整理命名够用元数据+文件名；省 token）。若指令需要可勾「附带文件名列表 only」。

### Step 4 — 模型产出提案

- 要求严格 JSON（或 fenced JSON）。
- 校验 schema；失败则要求重试或展示原始 log 让用户改指令。

### Step 5 — 确认面板（Log + 把握度）

- 表格/列表：`条目 | 字段 | from → to | 来源 | 把握度 | 执行？`
- 总览：「将修改 N 个标题、M 个附件」；低把握默认不勾选。
- 主按钮：`OK 执行` / `取消` / `只复制方案`。

### Step 6 — 执行 Tool

- 仅执行勾选行。
- `OrganizeRenameTool`：改 `title`（及必要时 `shortTitle`），按规则重命名附件显示名/文件名（Zotero API 允许范围内）。
- 对话区追加一条「已执行 / 部分失败」系统结果。

### Step 7 — 扩展未来 Tools（预留）

注册表示例：

| tool id | 说明 | 首期 |
|---------|------|------|
| `organize_rename` | 标准题名 + Manuscript/Appendix 命名 | ✅ |
| `merge_duplicates` | 合并疑似重复条目 | ❌ 预留 |
| `attach_classify` | 只分类附件角色不改题名 | ❌ 预留 |
| `fetch_pubmed_meta` | 只拉官方元数据建议 | ❌ 预留 |

新 Tool = 新文件 + 注册 + 确认卡片字段；Agent 主循环不变。

---

## 可行性结论（给产品拍板）

| 问题 | 结论 |
|------|------|
| 和阅读对话硬揉一起？ | **不建议**。场景、风险（改库）、交互都不同；应主打「条目整理」。 |
| 能不能做？ | **能**。独立入口 + 确认后写库即可。 |
| Agent+人工 Tools？ | **适合**。提案 JSON + 确认面板；未来加 Tool 只扩展注册表。 |
| 共用模型配置？ | **配置共用、产品分立**（Key/模型共用，会话/指令/历史分开）。 |
| 官方来源？ | DOI/PMID 已有字段可先用；无官方 ID 则低把握 + 人盯。 |
| 第一个 Tool？ | 就是 `organize_rename`；后面再挂合并重复、只分类附件等。 |

**建议**：按「条目整理」独立做最小闭环——多选入口 + 写死指令 + 首个 `organize_rename` + 把握度确认；跑通后再加第 2 个 Tool，而不是先做通用 Agent 空壳。

---

## 实现状态（v0.11.5）

已落地：

- `tools/ZoteroAtomTools.js` — 原子 Tool + **选中 ID scope 硬门槛** + `runPlan(steps, scope)`
- 越权 itemID/attachmentID 直接拒绝；删/挪默认不勾选
- Prompt 写入 `allowedItemIDs` / `allowedAttachmentIDs`
- 组合改名仍走原子层；笔记/HTML 不进 attachment 白名单
- **多选时 Zotero 会隐藏自定义 ItemPane**；右侧「已选择 N 个条目」区域注入 DeepRead 整理入口（另有右键/工具菜单）

未接 UI：跨条目混合方案表里勾选 `delete_attachment` / `move_attachment`（原子与 scope 已就绪）。
