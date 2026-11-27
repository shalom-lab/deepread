# Zotero 工具兼容性验收

## 测试范围

阅读器测试使用单独启动的 Windows Zotero、全新配置和临时文库，通过插件脚本载入仓库中的原生工具。夹具生成一页带文字和书签的 PDF，并在对应版本的真实阅读器中打开。测试不需要模型密钥。

| Zotero | 阅读器宿主与标注 API 源码核对 | Windows 实机证据 |
|---|---|---|
| 7 | 7.0.32。已核对打开、导航、选区弹窗，以及返回标注对象的 `getAnnotations`。[宿主](https://github.com/zotero/zotero/tree/7.0.32/chrome/content/zotero/xpcom) · [阅读器](https://github.com/zotero/reader/tree/7f32b0ef732c61aa47ed670e4bc3513c9b6f9709/src) | 7.0.32 通过 PDF、标注、附件改名及窗口切换 |
| 8 | 8.0.5。已核对相同宿主接口、PDF 视图与选区结构，列举标注返回对象。[宿主](https://github.com/zotero/zotero/tree/8.0.5/chrome/content/zotero/xpcom) · [阅读器](https://github.com/zotero/reader/tree/584c698eadb4df8049047076f5fa51c32b3b06d7/src) | 8.0.4 通过 PDF、标注、附件改名及窗口切换 |
| 9 | 9.0.6。已核对带第二个参数的 `getAnnotations(false, true)` 返回 ID、PDF 视图与坐标选区结构。[宿主](https://github.com/zotero/zotero/tree/9.0.6/chrome/content/zotero/xpcom) · [阅读器](https://github.com/zotero/reader/tree/9643fac7a4e86c8d7ff9548af0191e9df63aa998/src) | 9.0.6 通过 PDF、标注、附件改名及窗口切换 |
| 10 | 10.0.8。还核对了本机安装包中的 PDF.js、双栏选区、标注写入和删除逻辑。[宿主](https://github.com/zotero/zotero/tree/10.0.8/chrome/content/zotero/xpcom) · [阅读器](https://github.com/zotero/reader/tree/c3d467bfcb9e3a8cacfbbe04c5c7fd1369030a36/src) | 10.0.8 通过 PDF、标注、附件改名及窗口切换 |

## 实机结果

四个版本在临时文库中运行相同的 PDF、标注和附件改名用例。自动化夹具从工具入口发起请求，并把已选择的行交给确认后的执行函数。窗口切换的各版本结果单独列于上表。

- 读取当前阅读器的附件 ID 和页码，解析书签到目标页，从第一页提取夹具中的文字。
- 跳页，在 Zotero 中显示真实渲染的 PNG 页图，并以受大小限制的 JPEG 返回该页。
- 通过阅读器的原生选区接口提供文字和坐标，解析发送时的选区并确认创建高亮。列出已存标注，取消一次编辑后验证原值，再执行编辑、跳转及删除。
- 取消附件改名后验证原状态。确认时同时更名磁盘文件与 Zotero 标题，再分别读取文件系统和 SQLite 记录核对。
- 独立的窗口测试列举主窗口标签，取消及确认切换标签，在单独窗口打开选中附件，再次打开时复用同一窗口，最后按实例 ID 切回该阅读器。

另有独立回归覆盖双栏页码、选区与坐标快照、原始 PDF 更换、只读标注、并发修改和保存失败。用鼠标划选跨页文字以及在真实模型中判读图像仍需人工验收。跨版本运行记录只覆盖表中列出的宿主、操作系统和样本文件。

## 复现

使用 Node 运行以下命令。实机脚本输出实际运行的宿主版本和通过的检查项。

```text
node tests/reader-smoke.cjs "<Zotero 可执行文件路径>"
node tests/reader-navigation-smoke.cjs "<Zotero 可执行文件路径>"
node --test tests/reader-tools.test.cjs tests/reader-navigation.test.cjs
```

PDF 工具要求文档在阅读器中载入。文本按页和偏移读取，图像限制长边 1200 像素、JPEG 数据最多 1000 KiB。缺失 PDF.js、页码或带坐标的选区时，工具会报告不可用的操作。

## 文库写入与对外 MCP

在上述四个版本的临时文库中，用两条合成文献验证了创建、标签修改、子笔记创建和编辑。取消合并后两个条目均保留。确认合并后，选定的主条目获得了另一条的标签和子笔记，重复条目进入回收站。随后将父分类及子分类移入回收站，核对成员文献和笔记仍可读取。复现命令为 `node tests/library-smoke.cjs "<Zotero 可执行文件路径>"`。

在 Zotero 10.0.8 和 Zotero MCP 1.7.0 上，从外部客户端通过 HTTP 实测了工具发现、检索和写入。对同一条目的年份提出从 2020 改到 2028，第一次在 Zotero 点取消，读回 2020。第二次勾选执行，客户端取得逐项回执，文库读回 2028。再次提交已经使用的方案会被拒绝。

在同一临时环境中分别导入一条 RIS 和一条 BibTeX 记录，核对预览标题、保存后的标题、年份、作者和标签。CSL 引文和书目生成以及 RIS、BibTeX 导出也已实测。同步测试覆盖关闭状态及模拟失败分支，未向真实账号发起同步。三家模型适配器使用协议响应样例测试，没有调用付费模型。
