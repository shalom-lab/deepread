/**
 * 条目整理对话框：独立 about:blank 窗口
 * 用 document.write 整页写入 HTML（createElementNS+innerHTML 在该窗口下控件常丢失）
 */
(function () {
	if (typeof DeepRead === "undefined") return;

	DeepRead.OrganizeDialog = {
		_dialogWin: null,
		_state: null,

		_t(zh, en) {
			return DeepRead._locale === "zh" ? zh : en;
		},

		_esc(s) {
			return DeepRead._escapeHTML ? DeepRead._escapeHTML(String(s == null ? "" : s)) : String(s == null ? "" : s)
				.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
		},

		close() {
			try {
				if (this._dialogWin && !this._dialogWin.closed) {
					this._dialogWin.close();
				}
			} catch (e) { /* ignore */ }
			this._dialogWin = null;
			this._state = null;
			try {
				const main = Zotero.getMainWindow && Zotero.getMainWindow();
				const old = main && main.document && main.document.getElementById("deepread-organize-overlay");
				if (old && old.parentNode) old.parentNode.removeChild(old);
			} catch (e) { /* ignore */ }
		},

		async open() {
			try {
				if (!DeepRead.OrganizeAgent || typeof DeepRead.OrganizeAgent.getSelectedTopItems !== "function") {
					DeepRead.showAlert("DeepRead", this._t(
						"整理模块未加载，请禁用后重新启用插件，或重启 Zotero。",
						"Organize module not loaded. Disable/re-enable the plugin or restart Zotero."
					));
					return;
				}

				const mainWin = Zotero.getMainWindow();
				if (!mainWin || typeof mainWin.openDialog !== "function") {
					DeepRead.showAlert("DeepRead", this._t("无法打开主窗口", "Main window unavailable"));
					return;
				}

				const items = DeepRead.OrganizeAgent.getSelectedTopItems();
				if (items.length < 1) {
					DeepRead.showAlert("DeepRead", this._t(
						"请先在文献列表中选择至少 1 个顶层条目（论文/图书等）。",
						"Select at least one top-level library item first."
					));
					return;
				}

				this.close();

				const features = [
					"chrome",
					"dialog",
					"centerscreen",
					"resizable",
					"width=920",
					"height=720"
				].join(",");

				const dialogWin = mainWin.openDialog(
					"about:blank",
					"deepread-organize-" + Date.now(),
					features
				);
				if (!dialogWin) {
					DeepRead.showAlert("DeepRead", this._t(
						"弹窗被拦截。请允许 Zotero 打开对话框后重试。",
						"Popup blocked. Allow Zotero dialogs and retry."
					));
					return;
				}

				this._dialogWin = dialogWin;
				this._state = { items, proposal: null };

				let painted = false;
				const paint = () => {
					if (painted) return;
					if (this._dialogWin !== dialogWin) return;
					try {
						this._paintDialog(dialogWin, items);
						painted = true;
					} catch (e) {
						DeepRead.log("OrganizeDialog paint: " + (e.message || e) + "\n" + (e.stack || ""));
						try {
							const bad = dialogWin.document && dialogWin.document.getElementById("deepread-organize-root");
							if (bad && bad.parentNode) bad.parentNode.removeChild(bad);
						} catch (e2) { /* ignore */ }
						DeepRead.showAlert("DeepRead", this._t("整理窗口渲染失败：", "Organize UI failed: ") + (e.message || e));
					}
				};

				// about:blank：尽快 write；再兜底一次
				try {
					paint();
				} catch (e) { /* paint 内部已处理 */ }
				if (!painted) {
					dialogWin.setTimeout(paint, 0);
					dialogWin.setTimeout(paint, 100);
				}

				dialogWin.addEventListener("unload", () => {
					if (this._dialogWin === dialogWin) {
						this._dialogWin = null;
						this._state = null;
					}
				});
			} catch (e) {
				DeepRead.log("OrganizeDialog.open: " + (e.message || e) + "\n" + (e.stack || ""));
				DeepRead.showAlert("DeepRead", this._t("打开整理窗口失败：", "Failed to open organize dialog: ") + (e.message || e));
			}
		},

		_brainSvg() {
			return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 640" width="28" height="28" aria-hidden="true">
  <defs>
    <linearGradient id="drg" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="rgb(87,68,230)"/>
      <stop offset="100%" stop-color="rgb(125,107,255)"/>
    </linearGradient>
  </defs>
  <path fill="url(#drg)" d="M184 120C184 89.1 209.1 64 240 64L264 64C281.7 64 296 78.3 296 96L296 544C296 561.7 281.7 576 264 576L232 576C202.2 576 177.1 555.6 170 528C169.3 528 168.7 528 168 528C123.8 528 88 492.2 88 448C88 430 94 413.4 104 400C84.6 385.4 72 362.2 72 336C72 305.1 89.6 278.2 115.2 264.9C108.1 252.9 104 238.9 104 224C104 179.8 139.8 144 184 144L184 120zM456 120L456 144C500.2 144 536 179.8 536 224C536 239 531.9 253 524.8 264.9C550.5 278.2 568 305 568 336C568 362.2 555.4 385.4 536 400C546 413.4 552 430 552 448C552 492.2 516.2 528 472 528C471.3 528 470.7 528 470 528C462.9 555.6 437.8 576 408 576L376 576C358.3 576 344 561.7 344 544L344 96C344 78.3 358.3 64 376 64L400 64C430.9 64 456 89.1 456 120z"/>
</svg>`;
		},

		_buildPageHtml(items) {
			const winTitle = this._esc("DeepRead");
			const subtitle = this._esc(this._t("条目整理 · 人工确认后写库", "Organize · write only after confirm"));
			const hint = this._esc(this._t(
				"仅本次选中条目；标题来自 PubMed/Crossref；删/挪默认不执行。",
				"Selected items only; titles from PubMed/Crossref; delete/move off by default."
			));
			const cmdOpt = this._esc(this._t("条目整理", "Organize"));
			const modelLabel = this._esc(this._t("模型读前 5 页判角色", "Model: first 5 pages → roles"));
			const analyze = this._esc(this._t("生成方案", "Build plan"));
			const status = this._esc(this._t(
				`已选 ${items.length} 个顶层条目`,
				`${items.length} top-level item(s)`
			));
			const cancel = this._esc(this._t("取消", "Cancel"));
			const apply = this._esc(this._t("确认执行", "Apply checked"));
			let modelHint = "";
			try {
				const cfg = DeepRead.provider && DeepRead.provider.config;
				if (cfg && (cfg.model || cfg.provider)) {
					modelHint = this._esc(this._t(
						`当前模型：${cfg.provider || "?"} / ${cfg.model || "?"}`,
						`Model: ${cfg.provider || "?"} / ${cfg.model || "?"}`
					));
				} else {
					modelHint = this._esc(this._t(
						"当前模型：未配置（与阅读共用设置）",
						"Model: not configured (shared with reading)"
					));
				}
			} catch (e) {
				modelHint = "";
			}

			return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>${winTitle}</title>
<style>
:root {
  --ink: #1c1f26;
  --muted: #6b7280;
  --line: #e8ebf0;
  --bg: #f7f8fb;
  --card: #ffffff;
  --brand: #5744e6;
  --brand-2: #7d6bff;
  --ok: #1b7f4a;
  --warn: #b45309;
  --bad: #b42318;
}
* { box-sizing: border-box; }
html, body {
  margin: 0; padding: 0; height: 100%;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
  color: var(--ink); background: var(--bg);
}
#deepread-organize-root {
  min-height: 100%;
  padding: 18px 20px 16px;
  display: flex; flex-direction: column; gap: 14px;
}
.brand {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.brand-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.brand-left svg { flex: 0 0 auto; }
.brand-text { min-width: 0; }
.brand-name {
  font-size: 18px; font-weight: 700; letter-spacing: -0.02em;
  background: linear-gradient(90deg, var(--brand), var(--brand-2));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.brand-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
.hint { font-size: 11px; color: var(--muted); margin-top: 4px; line-height: 1.4; }
.toolbar {
  display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
  padding: 10px 12px; background: var(--card); border: 1px solid var(--line); border-radius: 10px;
}
.toolbar select {
  flex: 1; min-width: 200px; font-size: 12px; padding: 7px 10px;
  border: 1px solid var(--line); border-radius: 8px; background: #fff; color: var(--ink);
}
.chk {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; color: var(--muted); user-select: none;
}
.btn {
  border: none; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 600;
  padding: 8px 14px; transition: opacity .15s ease;
}
.btn:hover { opacity: .92; }
.btn-primary {
  background: linear-gradient(90deg, var(--brand), var(--brand-2)); color: #fff;
}
.btn-x, .btn-ghost {
  background: #fff; color: var(--ink); border: 1px solid var(--line);
  padding: 7px 12px; font-weight: 500;
}
.btn-ok {
  background: #c5c9d2; color: #fff; cursor: not-allowed; min-width: 108px;
}
.btn-ok.is-ready { background: var(--ok); cursor: pointer; }
.status {
  font-size: 12px; color: var(--muted); padding: 0 2px;
}
.log {
  display: none; margin: 0; white-space: pre-wrap;
  font-size: 11px; line-height: 1.5; color: #374151;
  background: var(--card); border: 1px solid var(--line); border-radius: 10px;
  padding: 10px 12px; max-height: 110px; overflow: auto;
}
.table-wrap {
  flex: 1; overflow: auto; min-height: 160px;
  background: var(--card); border: 1px solid var(--line); border-radius: 10px;
}
.table-wrap table { width: 100%; border-collapse: collapse; font-size: 12px; }
.table-wrap th {
  position: sticky; top: 0; z-index: 1;
  text-align: left; font-weight: 600; font-size: 11px; color: var(--muted);
  background: #f3f4f8; padding: 9px 10px; border-bottom: 1px solid var(--line);
}
.table-wrap td {
  padding: 10px; vertical-align: top; border-bottom: 1px solid #f0f2f6;
  word-break: break-word;
}
.table-wrap tr:last-child td { border-bottom: none; }
.from { color: var(--muted); font-size: 11px; }
.to { color: var(--brand); margin-top: 3px; font-weight: 500; }
.pill {
  display: inline-block; font-size: 10px; font-weight: 600;
  padding: 2px 7px; border-radius: 999px; background: #eef0ff; color: var(--brand);
}
.conf-hi { color: var(--ok); font-weight: 700; }
.conf-mid { color: var(--warn); font-weight: 700; }
.conf-lo { color: var(--bad); font-weight: 700; }
.footer {
  display: flex; justify-content: flex-end; gap: 8px; padding-top: 2px;
}
</style>
</head>
<body>
<div id="deepread-organize-root">
	<header class="brand">
		<div class="brand-left">
			${this._brainSvg()}
			<div class="brand-text">
				<div class="brand-name">DeepRead</div>
				<div class="brand-sub">${subtitle}</div>
				<div class="hint">${hint}</div>
			</div>
		</div>
		<button type="button" class="btn btn-x" data-act="close" title="Close">✕</button>
	</header>
	<div class="toolbar">
		<select data-role="cmd" title="${this._esc(this._t("指令", "Command"))}">
			<option value="organize_rename">${cmdOpt}</option>
		</select>
		<label class="chk">
			<input type="checkbox" data-role="use-model" checked />
			${modelLabel}
		</label>
		<button type="button" class="btn btn-primary" data-act="analyze">${analyze}</button>
	</div>
	<div class="status" data-role="status">${status}${modelHint ? " · " + modelHint : ""}</div>
	<pre class="log" data-role="log"></pre>
	<div class="table-wrap" data-role="table-wrap"></div>
	<div class="footer">
		<button type="button" class="btn btn-ghost" data-act="close">${cancel}</button>
		<button type="button" class="btn btn-ok" data-act="apply" disabled>${apply}</button>
	</div>
</div>
</body>
</html>`;
		},

		_paintDialog(dialogWin, items) {
			const html = this._buildPageHtml(items);
			const doc = dialogWin.document;
			doc.open();
			doc.write(html);
			doc.close();

			const root = doc.getElementById("deepread-organize-root");
			if (!root) {
				throw new Error("root missing after document.write");
			}

			const bind = (sel, handler) => {
				const nodes = root.querySelectorAll(sel);
				if (!nodes || !nodes.length) {
					throw new Error("missing nodes: " + sel);
				}
				nodes.forEach(node => node.addEventListener("click", handler));
			};

			bind("[data-act='close']", () => this.close());
			bind("[data-act='analyze']", () => this._runAnalyze(root));
			bind("[data-act='apply']", () => this._runApply(root));

			try { dialogWin.focus(); } catch (e) { /* ignore */ }
		},

		_setStatus(panel, text) {
			const el = panel.querySelector("[data-role='status']");
			if (el) el.textContent = text;
		},

		_renderLog(panel, logs) {
			const el = panel.querySelector("[data-role='log']");
			if (!el) return;
			el.style.display = "block";
			el.textContent = (logs || []).map(l => {
				const tag = l.level === "ok" ? "✓" : (l.level === "warn" ? "!" : "·");
				return `${tag} ${l.msg}`;
			}).join("\n");
		},

		_confClass(pct) {
			if (pct >= 80) return "conf-hi";
			if (pct >= 60) return "conf-mid";
			return "conf-lo";
		},

		_renderTable(panel, proposals) {
			const wrap = panel.querySelector("[data-role='table-wrap']");
			if (!wrap) return;
			const doc = panel.ownerDocument;
			wrap.innerHTML = "";
			const table = doc.createElement("table");
			table.innerHTML = `
				<thead>
					<tr>
						<th style="width:44px;">${this._esc(this._t("执行", "Do"))}</th>
						<th style="width:110px;">${this._esc(this._t("对象", "Target"))}</th>
						<th>${this._esc(this._t("变更", "Change"))}</th>
						<th style="width:88px;">${this._esc(this._t("来源", "Source"))}</th>
						<th style="width:64px;">${this._esc(this._t("把握", "Conf."))}</th>
					</tr>
				</thead>
			`;
			const tbody = doc.createElement("tbody");

			proposals.forEach((p, pi) => {
				const tr = doc.createElement("tr");
				const titleDisabled = !p.toTitle;
				const confPct = Math.round((p.titleConfidence || 0) * 100);
				tr.innerHTML = `
					<td>
						<input type="checkbox" data-kind="title" data-pi="${pi}" ${p.titleSelected && p.toTitle ? "checked" : ""} ${titleDisabled ? "disabled" : ""}/>
					</td>
					<td><span class="pill">${this._esc(this._t("标题", "Title"))}</span></td>
					<td>
						<div class="from">${this._esc(p.fromTitle || "")}</div>
						<div class="to">→ ${this._esc(p.toTitle || (p.titleBlockedReason || "—"))}</div>
					</td>
					<td>${this._esc(p.titleSource || "")}</td>
					<td class="${titleDisabled ? "" : this._confClass(confPct)}">${titleDisabled ? "—" : confPct + "%"}</td>
				`;
				tbody.appendChild(tr);

				(p.attachments || []).forEach((a, ai) => {
					const atr = doc.createElement("tr");
					const ac = Math.round((a.confidence || 0) * 100);
					atr.innerHTML = `
						<td>
							<input type="checkbox" data-kind="att" data-pi="${pi}" data-ai="${ai}" ${a.selected ? "checked" : ""}/>
						</td>
						<td><span class="pill">${this._esc(a.role || "file")}</span></td>
						<td>
							<div class="from">${this._esc(a.from || "")}</div>
							<div class="to">→ ${this._esc(a.to || "")}</div>
						</td>
						<td>rule/model</td>
						<td class="${this._confClass(ac)}">${ac}%</td>
					`;
					tbody.appendChild(atr);
				});
			});

			table.appendChild(tbody);
			wrap.appendChild(table);

			wrap.querySelectorAll("input[type=checkbox]").forEach(cb => {
				cb.addEventListener("change", () => {
					const pi = parseInt(cb.getAttribute("data-pi"), 10);
					const kind = cb.getAttribute("data-kind");
					const prop = this._state && this._state.proposal && this._state.proposal.proposals[pi];
					if (!prop) return;
					if (kind === "title") prop.titleSelected = cb.checked;
					if (kind === "att") {
						const ai = parseInt(cb.getAttribute("data-ai"), 10);
						if (prop.attachments[ai]) prop.attachments[ai].selected = cb.checked;
					}
				});
			});
		},

		async _runAnalyze(panel) {
			const btn = panel.querySelector("[data-act='analyze']");
			const applyBtn = panel.querySelector("[data-act='apply']");
			if (!btn || !applyBtn) return;
			btn.disabled = true;
			applyBtn.disabled = true;
			applyBtn.classList.remove("is-ready");
			applyBtn.style.cursor = "not-allowed";
			this._setStatus(panel, this._t(
				"正在生成方案…",
				"Building plan…"
			));
			try {
				const useModel = !!(panel.querySelector("[data-role='use-model']") || {}).checked;
				const built = await DeepRead.OrganizeAgent.buildProposal({
					items: this._state.items,
					useModelForRoles: useModel
				});
				this._state.proposal = built;
				this._renderLog(panel, built.logs);
				this._renderTable(panel, built.proposals);
				const nTitle = built.proposals.filter(p => p.toTitle).length;
				const nAtt = built.proposals.reduce((s, p) => s + (p.attachments || []).length, 0);
				this._setStatus(panel, this._t(
					`方案就绪：${nTitle} 条可改官方标题，${nAtt} 个附件建议重命名。请核对把握度后点 OK。`,
					`Plan ready: ${nTitle} official title(s), ${nAtt} attachment rename(s). Review confidence, then OK.`
				));
				applyBtn.disabled = false;
				applyBtn.classList.add("is-ready");
				applyBtn.style.cursor = "pointer";
			} catch (e) {
				this._setStatus(panel, this._t("生成失败：", "Failed: ") + (e.message || e));
				DeepRead.showAlert("DeepRead", e.message || String(e));
			} finally {
				btn.disabled = false;
			}
		},

		async _runApply(panel) {
			if (!this._state || !this._state.proposal) return;
			const applyBtn = panel.querySelector("[data-act='apply']");
			if (!applyBtn) return;
			applyBtn.disabled = true;
			applyBtn.classList.remove("is-ready");
			this._setStatus(panel, this._t("正在按勾选项写库…", "Applying checked changes…"));
			try {
				const results = await DeepRead.OrganizeAgent.applyProposals(
					this._state.proposal.proposals,
					this._state.proposal.scope
				);
				const ok = results.filter(r => r.changed && r.changed.length).length;
				const errN = results.reduce((s, r) => s + ((r.errors && r.errors.length) || 0), 0);
				const detail = results.map(r => {
					const ch = (r.changed || []).join(",") || "—";
					const er = (r.errors || []).join("; ");
					return `#${r.itemID}: ${ch}${er ? " | err: " + er : ""}`;
				}).join("\n");
				this._renderLog(panel, [
					{ level: "ok", msg: this._t(`完成：${ok} 条有变更`, `Done: ${ok} item(s) changed`) },
					{ level: errN ? "warn" : "info", msg: detail || "—" }
				]);
				this._setStatus(panel, this._t(
					`执行结束（错误 ${errN}）。可关闭窗口。`,
					`Finished (${errN} error(s)). You can close.`
				));
				DeepRead.showAlert("DeepRead", this._t(
					`整理完成：${ok} 条有变更，错误 ${errN}。`,
					`Organize done: ${ok} changed, ${errN} error(s).`
				));
			} catch (e) {
				this._setStatus(panel, this._t("执行失败：", "Apply failed: ") + (e.message || e));
				applyBtn.disabled = false;
				applyBtn.classList.add("is-ready");
			}
		}
	};

	DeepRead.openOrganizeDialog = function () {
		return DeepRead.OrganizeDialog.open();
	};
})();
