/**
 * 条目整理 Agent：官方元数据 + 提案 + 人工确认后执行
 * 与阅读对话隔离；仅共用模型配置（附件角色可选用模型辅助）。
 */
(function () {
	if (typeof DeepRead === "undefined") return;

	DeepRead.OrganizeAgent = {
		COMMANDS: [
			{
				id: "organize_rename",
				zh: "规范命名：官方标题 + Manuscript/Appendix 附件",
				en: "Normalize: official title + Manuscript/Appendix files"
			}
		],

		getSelectedTopItems() {
			const pane = Zotero.getActiveZoteroPane && Zotero.getActiveZoteroPane();
			if (!pane) return [];
			const selected = pane.getSelectedItems() || [];
			const map = new Map();
			for (const it of selected) {
				const top = DeepRead._getTopLevelItem(it) || it;
				if (!top || !top.isRegularItem || !top.isRegularItem()) continue;
				map.set(top.id, top);
			}
			return Array.from(map.values());
		},

		/**
		 * 可选：用模型辅助判断附件角色。失败则静默回退规则。
		 * 绝不允许模型产出条目标题。
		 */
		async refineRolesWithModel(proposals) {
			try {
				await DeepRead.syncProviderConfig();
				if (!DeepRead.provider || !DeepRead.provider.config.apiKey) return proposals;

				const payload = proposals.map(p => ({
					itemID: p.itemID,
					officialTitle: p.toTitle || p.fromTitle,
					attachments: (p.attachments || []).map(a => ({
						attachmentID: a.attachmentID,
						from: a.from,
						guessRole: a.role
					}))
				}));

				const prompt =
					"You classify Zotero attachment roles for renaming.\n" +
					"Allowed roles ONLY: manuscript, appendix1, appendix2.\n" +
					"Do NOT invent or change article titles.\n" +
					"Return JSON only: {\"items\":[{\"itemID\":123,\"roles\":{\"456\":\"manuscript\"}}]}\n\n" +
					JSON.stringify(payload);

				const result = await DeepRead.provider.chat(
					[{ role: "user", content: prompt }],
					{ temperature: 0.1, maxTokens: 2048 },
					null
				);
				const text = (result && result.content) || "";
				const m = text.match(/\{[\s\S]*\}/);
				if (!m) return proposals;
				const parsed = JSON.parse(m[0]);
				const byItem = new Map();
				(parsed.items || []).forEach(row => byItem.set(Number(row.itemID), row.roles || {}));

				return proposals.map(p => {
					const roles = byItem.get(p.itemID);
					if (!roles) return p;
					const shortBase = p.shortTitle;
					const tool = DeepRead.OrganizeRenameTool;
					p.attachments = (p.attachments || []).map(a => {
						const role = roles[String(a.attachmentID)] || roles[a.attachmentID] || a.role;
						if (!/^(manuscript|appendix\d+)$/i.test(role)) return a;
						const prefix = tool.rolePrefix(role);
						const ext = (a.to && a.to.match(/\.[a-z0-9]+$/i)) ? a.to.match(/\.[a-z0-9]+$/i)[0] : "";
						return Object.assign({}, a, {
							role,
							to: tool.fsSafe(`${prefix}_${shortBase}${ext}`),
							confidence: Math.min(0.92, (a.confidence || 0.7) + 0.1)
						});
					});
					return p;
				});
			} catch (e) {
				DeepRead.log("OrganizeAgent refineRolesWithModel: " + (e.message || e));
				return proposals;
			}
		},

		async buildProposal(options) {
			const opts = options || {};
			const items = opts.items || this.getSelectedTopItems();
			if (!items.length) {
				throw new Error(DeepRead._locale === "zh" ? "请先选择条目" : "Select items first");
			}

			const proposals = [];
			const logs = [];

			for (const item of items) {
				const official = await DeepRead.OfficialMeta.lookupOfficial(item);
				const hasTitle = !!(official && official.ok && official.title && official.source && official.source !== "none");
				const meta = hasTitle ? official : (official || { source: "none", confidence: 0 });
				if (hasTitle) {
					logs.push({
						level: "ok",
						itemID: item.id,
						msg: `[官方] ${meta.sourceLabel}: 「${meta.title}」 · 把握度 ${Math.round((meta.confidence || 0.95) * 100)}%`
					});
				} else {
					logs.push({
						level: "warn",
						itemID: item.id,
						msg: `[跳过标题] ${item.getField("title") || item.id} — ${meta.error || "无 DOI/PMID"}`
					});
				}
				const prop = await DeepRead.OrganizeRenameTool.buildProposalForItem(
					item,
					hasTitle ? meta : { source: "none", title: null, error: meta.error, confidence: 0, ids: meta.ids }
				);
				proposals.push(prop);
			}

			let refined = proposals;
			if (opts.useModelForRoles !== false) {
				refined = await this.refineRolesWithModel(proposals);
				logs.push({
					level: "info",
					msg: DeepRead._locale === "zh"
						? "附件角色：已尝试用当前模型辅助分类（失败则用规则）；条目标题始终仅来自 Crossref/PubMed。"
						: "Attachment roles: model-assisted when possible; titles always from Crossref/PubMed only."
				});
			}

			return { command: "organize_rename", proposals: refined, logs };
		},

		async applyProposals(proposals) {
			const results = [];
			for (const p of proposals) {
				if (!p.selected) continue;
				const r = await DeepRead.OrganizeRenameTool.applyItemProposal(p);
				results.push(r);
			}
			return results;
		}
	};
})();
