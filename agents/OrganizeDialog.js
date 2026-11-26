/**
 * 条目整理对话框（主窗口浮层）：提案 log / 把握度 / OK 后写库
 */
(function () {
	if (typeof DeepRead === "undefined") return;

	DeepRead.OrganizeDialog = {
		_overlay: null,
		_state: null,

		_t(zh, en) {
			return DeepRead._locale === "zh" ? zh : en;
		},

		close() {
			if (this._overlay && this._overlay.parentNode) {
				this._overlay.parentNode.removeChild(this._overlay);
			}
			this._overlay = null;
			this._state = null;
		},

		async open() {
			const win = Zotero.getMainWindow();
			if (!win || !win.document) {
				DeepRead.showAlert("DeepRead", this._t("无法打开主窗口", "Main window unavailable"));
				return;
			}
			const items = DeepRead.OrganizeAgent.getSelectedTopItems();
			if (items.length < 1) {
				DeepRead.showAlert("DeepRead", this._t("请先在文献列表中选择条目", "Select library items first"));
				return;
			}

			this.close();
			const doc = win.document;
			const overlay = doc.createElement("div");
			overlay.id = "deepread-organize-overlay";
			overlay.style.cssText = `
				position: fixed; inset: 0; z-index: 2147483646;
				background: rgba(20,24,30,0.45);
				display: flex; align-items: center; justify-content: center;
				font-family: system-ui, -apple-system, Segoe UI, sans-serif;
			`;

			const panel = doc.createElement("div");
			panel.style.cssText = `
				width: min(920px, 94vw); max-height: 88vh; overflow: auto;
				background: #fff; border-radius: 12px; box-shadow: 0 18px 50px rgba(0,0,0,0.28);
				padding: 16px 18px 14px; box-sizing: border-box; color: #222;
			`;

			panel.innerHTML = `
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
				<div data-role="table-wrap" style="overflow:auto;max-height:46vh;border:1px solid #e6ebf0;border-radius:8px;"></div>
				<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:12px;">
					<button type="button" data-act="close" style="padding:7px 14px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer;">${this._t("取消", "Cancel")}</button>
					<button type="button" data-act="apply" disabled style="padding:7px 14px;border:none;border-radius:6px;background:#9e9e9e;color:#fff;cursor:not-allowed;font-weight:600;">
						${this._t("OK 执行勾选项", "OK · apply checked")}
					</button>
				</div>
			`;

			overlay.appendChild(panel);
			(doc.documentElement || doc.body).appendChild(overlay);
			this._overlay = overlay;
			this._state = { items, proposal: null };

			overlay.addEventListener("click", (e) => {
				if (e.target === overlay) this.close();
			});
			panel.querySelectorAll("[data-act='close']").forEach(btn => {
				btn.addEventListener("click", () => this.close());
			});
			panel.querySelector("[data-act='analyze']").addEventListener("click", () => this._runAnalyze(panel));
			panel.querySelector("[data-act='apply']").addEventListener("click", () => this._runApply(panel));
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
			const table = doc.createElement("table");
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
			const tbody = doc.createElement("tbody");

			proposals.forEach((p, pi) => {
				const tr = doc.createElement("tr");
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
					const atr = doc.createElement("tr");
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
				// 校验通过（或回退规则）后才渲染表格供拍板
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
