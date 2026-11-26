/**
 * 条目整理对话框：独立 about:blank 窗口（主窗口是 XUL，HTML 浮层经常看不见）
 */
(function () {
	if (typeof DeepRead === "undefined") return;

	const XHTML_NS = "http://www.w3.org/1999/xhtml";

	DeepRead.OrganizeDialog = {
		_dialogWin: null,
		_state: null,

		_t(zh, en) {
			return DeepRead._locale === "zh" ? zh : en;
		},

		_el(doc, tag) {
			return doc.createElementNS(XHTML_NS, tag);
		},

		close() {
			try {
				if (this._dialogWin && !this._dialogWin.closed) {
					this._dialogWin.close();
				}
			} catch (e) { /* ignore */ }
			this._dialogWin = null;
			this._state = null;
			// 兼容旧版主窗口浮层
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
					try {
						this._paintDialog(dialogWin, items);
						painted = true;
					} catch (e) {
						DeepRead.log("OrganizeDialog paint: " + (e.message || e));
						DeepRead.showAlert("DeepRead", this._t("整理窗口渲染失败：", "Organize UI failed: ") + (e.message || e));
					}
				};

				if (dialogWin.document && dialogWin.document.readyState === "complete") {
					paint();
				} else {
					dialogWin.addEventListener("DOMContentLoaded", paint, { once: true });
					dialogWin.addEventListener("load", paint, { once: true });
					// 兜底：about:blank 有时已经 complete 但事件已过
					dialogWin.setTimeout(paint, 50);
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

		_paintDialog(dialogWin, items) {
			const doc = dialogWin.document;
			if (!doc || doc.getElementById("deepread-organize-root")) return;

			try {
				dialogWin.document.title = this._t("DeepRead 条目整理", "DeepRead Organize Items");
			} catch (e) { /* ignore */ }

			if (!doc.head) {
				const head = this._el(doc, "head");
				(doc.documentElement || doc).appendChild(head);
			}
			if (!doc.body) {
				const body = this._el(doc, "body");
				(doc.documentElement || doc).appendChild(body);
			}

			const style = this._el(doc, "style");
			style.textContent = `
				html, body {
					margin: 0; padding: 0; height: 100%;
					font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
					background: #f3f5f7; color: #222;
				}
				#deepread-organize-root {
					box-sizing: border-box; height: 100%;
					padding: 16px 18px 14px; overflow: auto;
					background: #fff;
				}
				button { font-family: inherit; }
			`;
			doc.head.appendChild(style);

			const root = this._el(doc, "div");
			root.id = "deepread-organize-root";
			root.innerHTML = `
				<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;">
					<div>
						<div style="font-size:16px;font-weight:700;">${this._t("条目整理（人工确认）", "Item Organize (human confirm)")}</div>
						<div style="font-size:11px;color:#666;margin-top:2px;">${this._t(
							"执行范围锁定在本次选中条目/附件 ID。标题仅 PubMed/Crossref。删/挪默认不勾选。笔记/HTML 不在白名单。OK 前不改库。",
							"Writes locked to selected item/attachment IDs. Titles: PubMed/Crossref only. Delete/move default unchecked. Notes/HTML out of scope. No writes before OK."
						)}</div>
					</div>
					<button type="button" data-act="close" style="border:none;background:#f1f3f5;border-radius:6px;padding:6px 10px;cursor:pointer;">✕</button>
				</div>
				<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:10px;">
					<label style="font-size:12px;">${this._t("指令", "Command")}</label>
					<select data-role="cmd" style="flex:1;min-width:220px;font-size:12px;padding:4px 6px;">
						<option value="organize_rename">${this._t("规范命名：官方标题 + Manuscript/Preprint/Accepted/Proof/Appendix", "Normalize: official title + Manuscript/Preprint/Accepted/Proof/Appendix")}</option>
					</select>
					<label style="font-size:12px;display:flex;align-items:center;gap:4px;">
						<input type="checkbox" data-role="use-model" checked />
						${this._t("模型读前5页分类角色", "Model reads ≤5 pages for roles")}
					</label>
					<button type="button" data-act="analyze" style="padding:6px 12px;border:none;border-radius:6px;background:#1565c0;color:#fff;cursor:pointer;font-size:12px;">
						${this._t("生成方案 + 把握度日志", "Build plan + confidence log")}
					</button>
				</div>
				<div data-role="status" style="font-size:12px;color:#555;margin-bottom:8px;">
					${this._t(`已选 ${items.length} 个顶层条目。先点「生成方案」。`, `${items.length} top-level item(s) selected. Click Build plan.`)}
				</div>
				<pre data-role="log" style="display:none;white-space:pre-wrap;font-size:11px;line-height:1.45;background:#f6f8fa;border:1px solid #e6ebf0;border-radius:8px;padding:8px 10px;max-height:120px;overflow:auto;margin:0 0 10px;"></pre>
				<div data-role="table-wrap" style="overflow:auto;max-height:52vh;border:1px solid #e6ebf0;border-radius:8px;"></div>
				<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
					<button type="button" data-act="close" style="padding:7px 14px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;">${this._t("取消", "Cancel")}</button>
					<button type="button" data-act="apply" disabled style="padding:7px 14px;border:none;border-radius:6px;background:#9e9e9e;color:#fff;cursor:not-allowed;font-weight:600;">
						${this._t("OK 执行勾选项", "OK · apply checked")}
					</button>
				</div>
			`;
			doc.body.appendChild(root);

			root.querySelectorAll("[data-act='close']").forEach(btn => {
				btn.addEventListener("click", () => this.close());
			});
			root.querySelector("[data-act='analyze']").addEventListener("click", () => this._runAnalyze(root));
			root.querySelector("[data-act='apply']").addEventListener("click", () => this._runApply(root));

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

		_renderTable(panel, proposals) {
			const wrap = panel.querySelector("[data-role='table-wrap']");
			const doc = panel.ownerDocument;
			wrap.innerHTML = "";
			const table = this._el(doc, "table");
			table.style.cssText = "width:100%;border-collapse:collapse;font-size:11px;";
			table.innerHTML = `
				<thead>
					<tr style="background:#f3f6f9;text-align:left;">
						<th style="padding:6px;border-bottom:1px solid #e0e6ed;">${this._t("执行", "Do")}</th>
						<th style="padding:6px;border-bottom:1px solid #e0e6ed;">${this._t("条目/附件", "Item / file")}</th>
						<th style="padding:6px;border-bottom:1px solid #e0e6ed;">from → to</th>
						<th style="padding:6px;border-bottom:1px solid #e0e6ed;">${this._t("来源", "Source")}</th>
						<th style="padding:6px;border-bottom:1px solid #e0e6ed;">${this._t("把握度", "Confidence")}</th>
					</tr>
				</thead>
			`;
			const tbody = this._el(doc, "tbody");

			proposals.forEach((p, pi) => {
				const tr = this._el(doc, "tr");
				const titleDisabled = !p.toTitle;
				const confPct = Math.round((p.titleConfidence || 0) * 100);
				tr.innerHTML = `
					<td style="padding:6px;border-bottom:1px solid #eef2f6;vertical-align:top;">
						<input type="checkbox" data-kind="title" data-pi="${pi}" ${p.titleSelected && p.toTitle ? "checked" : ""} ${titleDisabled ? "disabled" : ""}/>
					</td>
					<td style="padding:6px;border-bottom:1px solid #eef2f6;vertical-align:top;">
						<div style="font-weight:600;">#${p.itemID} ${this._t("标题", "Title")}</div>
					</td>
					<td style="padding:6px;border-bottom:1px solid #eef2f6;vertical-align:top;word-break:break-word;">
						<div style="color:#888;">${DeepRead._escapeHTML(p.fromTitle || "")}</div>
						<div style="color:#1565c0;margin-top:2px;">→ ${DeepRead._escapeHTML(p.toTitle || (p.titleBlockedReason || "—"))}</div>
					</td>
					<td style="padding:6px;border-bottom:1px solid #eef2f6;vertical-align:top;">${DeepRead._escapeHTML(p.titleSource || "")}</td>
					<td style="padding:6px;border-bottom:1px solid #eef2f6;vertical-align:top;font-weight:700;color:${confPct >= 80 ? "#2e7d32" : (confPct >= 60 ? "#ef6c00" : "#c62828")};">
						${titleDisabled ? "—" : confPct + "%"}
					</td>
				`;
				tbody.appendChild(tr);

				(p.attachments || []).forEach((a, ai) => {
					const atr = this._el(doc, "tr");
					const ac = Math.round((a.confidence || 0) * 100);
					atr.innerHTML = `
						<td style="padding:6px;border-bottom:1px solid #eef2f6;">
							<input type="checkbox" data-kind="att" data-pi="${pi}" data-ai="${ai}" ${a.selected ? "checked" : ""}/>
						</td>
						<td style="padding:6px;border-bottom:1px solid #eef2f6;">
							<span style="color:#666;">${DeepRead._escapeHTML(a.role || "")}</span>
						</td>
						<td style="padding:6px;border-bottom:1px solid #eef2f6;word-break:break-word;">
							<div style="color:#888;">${DeepRead._escapeHTML(a.from || "")}</div>
							<div style="color:#1565c0;">→ ${DeepRead._escapeHTML(a.to || "")}</div>
						</td>
						<td style="padding:6px;border-bottom:1px solid #eef2f6;">rule/model</td>
						<td style="padding:6px;border-bottom:1px solid #eef2f6;font-weight:700;color:${ac >= 80 ? "#2e7d32" : (ac >= 60 ? "#ef6c00" : "#c62828")};">${ac}%</td>
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
					const prop = this._state.proposal.proposals[pi];
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
			btn.disabled = true;
			applyBtn.disabled = true;
			applyBtn.style.background = "#9e9e9e";
			applyBtn.style.cursor = "not-allowed";
			this._setStatus(panel, this._t(
				"正在查官方元数据、抽前≤5页预览、校验模型 JSON…通过后才展示方案。",
				"Fetching official meta, ≤5-page previews, validating model JSON… UI after pass."
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
				applyBtn.style.background = "#2e7d32";
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
			applyBtn.disabled = true;
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
			}
		}
	};

	DeepRead.openOrganizeDialog = function () {
		return DeepRead.OrganizeDialog.open();
	};
})();
