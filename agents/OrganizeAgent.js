/**
 * 条目整理 Agent：官方元数据 + 前5页预览分类 + JSON 校验重试 + 人工确认
 */
(function () {
	if (typeof DeepRead === "undefined") return;

	DeepRead.OrganizeAgent = {
		MAX_PREVIEW_PAGES: 5,
		MAX_MODEL_RETRIES: 2,

		COMMANDS: [
			{
				id: "organize_rename",
				zh: "条目整理",
				en: "Organize"
			}
		],

		ALLOWED_ROLES_HELP: "manuscript | preprint | accepted | proof | appendix1..appendix9",

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

		_buildClassifyPrompt(payload, retryNote, scope) {
			const schema =
				'{"items":[{"itemID":123,"roles":{"456":{"role":"manuscript","confidence":0.9,"reason":"short"}}}]}';
			const scopeInfo = DeepRead.AtomTools && DeepRead.AtomTools.scopeForPrompt
				? DeepRead.AtomTools.scopeForPrompt(scope)
				: {};
			return [
				"You classify academic file attachments for renaming.",
				"Allowed role values ONLY: " + this.ALLOWED_ROLES_HELP + ".",
				"Use manuscript / preprint / accepted / proof for main-text versions; appendixN for appendices/supplements.",
				"Do NOT invent or change article titles. Titles are resolved elsewhere from PubMed/Crossref.",
				"HARD SCOPE: you may ONLY reference these IDs: " + JSON.stringify(scopeInfo),
				"Any ID outside this whitelist is forbidden.",
				"Each attachment includes filename + optional text preview from at most the first 5 pages (fewer pages = whole file).",
				"Return ONE JSON object only, no markdown fences, matching schema:",
				schema,
				"Rules:",
				"- Every attachmentID in the input MUST appear once.",
				"- role must be one of the allowed values.",
				"- confidence is a number from 0 to 1.",
				"- reason <= 40 chars.",
				retryNote ? ("Previous response invalid: " + retryNote + " Fix and return JSON only.") : "",
				"INPUT:",
				JSON.stringify(payload)
			].filter(Boolean).join("\n");
		},

		_parseJsonObject(text) {
			const raw = String(text || "").trim();
			let m = raw.match(/\{[\s\S]*\}/);
			if (!m) throw new Error("no JSON object");
			return JSON.parse(m[0]);
		},

		/**
		 * 校验模型返回是否覆盖全部附件且角色合法。
		 * @returns {{ok:boolean, error?:string, rolesByItem?:Map}}
		 */
		_validateRoleResponse(parsed, expected) {
			if (!parsed || !Array.isArray(parsed.items)) {
				return { ok: false, error: "missing items[]" };
			}
			const rolesByItem = new Map();
			const seenItems = new Set();

			for (const row of parsed.items) {
				const itemID = Number(row.itemID);
				if (!expected.has(itemID)) {
					return { ok: false, error: "unknown itemID " + itemID };
				}
				seenItems.add(itemID);
				const need = expected.get(itemID);
				const roles = row.roles || {};
				const normalized = {};
				for (const attID of need) {
					const cell = roles[String(attID)] || roles[attID];
					if (!cell) return { ok: false, error: "missing attachment " + attID + " on item " + itemID };
					const roleRaw = typeof cell === "string" ? cell : cell.role;
					const role = DeepRead.OrganizeRenameTool.normalizeRole(roleRaw);
					if (!DeepRead.OrganizeRenameTool.isValidRole(role)) {
						return { ok: false, error: "bad role '" + roleRaw + "' for att " + attID };
					}
					let confidence = typeof cell === "object" && cell ? Number(cell.confidence) : 0.8;
					if (!(confidence >= 0 && confidence <= 1)) confidence = 0.75;
					normalized[String(attID)] = {
						role,
						confidence,
						reason: (cell && cell.reason) ? String(cell.reason).slice(0, 80) : ""
					};
				}
				// 多余 key 忽略
				rolesByItem.set(itemID, normalized);
			}

			for (const itemID of expected.keys()) {
				if (!seenItems.has(itemID)) {
					return { ok: false, error: "missing itemID " + itemID };
				}
			}
			return { ok: true, rolesByItem };
		},

		async _collectAttachmentPreviews(proposals) {
			const tool = DeepRead.OrganizeRenameTool;
			const out = [];
			for (const p of proposals) {
				const atts = [];
				for (const a of (p.attachments || [])) {
					const att = Zotero.Items.get(a.attachmentID);
					let preview = "";
					let previewNote = "none";
					if (att) {
						preview = await tool.extractPreviewText(att, this.MAX_PREVIEW_PAGES);
						if (preview) {
							previewNote = "first<=5p";
						} else {
							// Word 等：再试通用全文缓存 / docx 抽取（在 extractPreviewText 内处理）
							previewNote = "filename-only";
						}
					}
					atts.push({
						attachmentID: a.attachmentID,
						from: a.from,
						guessRole: a.role,
						previewNote,
						preview: preview ? preview.slice(0, 3500) : ""
					});
				}
				out.push({
					itemID: p.itemID,
					officialTitle: p.toTitle || null,
					currentTitle: p.fromTitle,
					attachments: atts
				});
			}
			return out;
		},

		/**
		 * 用模型分类附件角色：固定 JSON → 校验 → 失败重试；通过才应用。
		 * 绝不允许模型改条目标题。
		 */
		async refineRolesWithModel(proposals, logs, scope) {
			const log = logs || [];
			try {
				await DeepRead.syncProviderConfig();
				if (!DeepRead.provider || !DeepRead.provider.config.apiKey) {
					log.push({
						level: "warn",
						msg: DeepRead._locale === "zh"
							? "未配置 API Key：附件角色仅用文件名规则。"
							: "No API Key: attachment roles from filename rules only."
					});
					return proposals;
				}

				log.push({
					level: "info",
					msg: DeepRead._locale === "zh"
						? "正在抽取附件预览（PDF/Word 最多前 5 页，页少则全要，不报错）…"
						: "Extracting attachment previews (PDF/Word ≤5 pages; shorter files OK)…"
				});
				if (scope) {
					log.push({
						level: "info",
						msg: (DeepRead._locale === "zh" ? "执行白名单 " : "Scope ") +
							`items=[${(scope.itemIDList || []).join(",")}] atts=[${(scope.attachmentIDList || []).join(",")}]`
					});
				}

				const rawPayload = await this._collectAttachmentPreviews(proposals);
				const payload = [];
				const expected = new Map();
				rawPayload.forEach(row => {
					if (scope && scope.itemIDs && !scope.itemIDs.has(Number(row.itemID))) return;
					const atts = (row.attachments || []).filter(a =>
						!scope || !scope.attachmentIDs || scope.attachmentIDs.has(Number(a.attachmentID))
					);
					if (!atts.length) return;
					const clean = Object.assign({}, row, { attachments: atts });
					payload.push(clean);
					expected.set(row.itemID, atts.map(a => a.attachmentID));
				});
				const totalAtt = [...expected.values()].reduce((s, a) => s + a.length, 0);
				if (totalAtt === 0) return proposals;

				let lastErr = "";
				let rolesByItem = null;
				for (let attempt = 0; attempt <= this.MAX_MODEL_RETRIES; attempt++) {
					const prompt = this._buildClassifyPrompt(payload, attempt ? lastErr : "", scope);
					const result = await DeepRead.provider.chat(
						[{ role: "user", content: prompt }],
						{ temperature: 0.1, maxTokens: 4096 },
						null
					);
					const text = (result && result.content) || "";
					try {
						const parsed = this._parseJsonObject(text);
						const v = this._validateRoleResponse(parsed, expected);
						if (!v.ok) {
							lastErr = v.error || "validation failed";
							log.push({
								level: "warn",
								msg: (DeepRead._locale === "zh" ? "模型返回校验失败，重试：" : "Invalid model JSON, retry: ") + lastErr
							});
							continue;
						}
						rolesByItem = v.rolesByItem;
						log.push({
							level: "ok",
							msg: DeepRead._locale === "zh"
								? `附件角色 JSON 校验通过（第 ${attempt + 1} 次）。`
								: `Attachment role JSON validated (attempt ${attempt + 1}).`
						});
						break;
					} catch (e) {
						lastErr = e.message || String(e);
						log.push({
							level: "warn",
							msg: (DeepRead._locale === "zh" ? "解析失败，重试：" : "Parse failed, retry: ") + lastErr
						});
					}
				}

				if (!rolesByItem) {
					log.push({
						level: "warn",
						msg: DeepRead._locale === "zh"
							? "模型校验未通过，回退文件名规则。"
							: "Model validation failed; fallback to filename rules."
					});
					return proposals;
				}

				const tool = DeepRead.OrganizeRenameTool;
				return proposals.map(p => {
					const roles = rolesByItem.get(p.itemID);
					if (!roles) return p;
					const shortBase = p.shortTitle;
					p.attachments = (p.attachments || []).map(a => {
						const hit = roles[String(a.attachmentID)];
						if (!hit) return a;
						const role = hit.role;
						const prefix = tool.rolePrefix(role);
						const ext = (a.to && a.to.match(/\.[a-z0-9]+$/i)) ? a.to.match(/\.[a-z0-9]+$/i)[0] : "";
						return Object.assign({}, a, {
							role,
							to: tool.fsSafe(`${prefix}_${shortBase}${ext}`),
							confidence: typeof hit.confidence === "number" ? hit.confidence : a.confidence,
							reason: hit.reason || ""
						});
					});
					return p;
				});
			} catch (e) {
				DeepRead.log("OrganizeAgent refineRolesWithModel: " + (e.message || e));
				log.push({
					level: "warn",
					msg: (DeepRead._locale === "zh" ? "模型分类异常，回退规则：" : "Model classify error, fallback: ") + (e.message || e)
				});
				return proposals;
			}
		},

		async buildProposal(options) {
			const opts = options || {};
			const items = opts.items || this.getSelectedTopItems();
			if (!items.length) {
				throw new Error(DeepRead._locale === "zh" ? "请先选择条目" : "Select items first");
			}

			const scope = (DeepRead.AtomTools && DeepRead.AtomTools.buildScopeFromItems)
				? DeepRead.AtomTools.buildScopeFromItems(items)
				: { itemIDs: new Set(items.map(i => i.id)), attachmentIDs: new Set(), itemIDList: items.map(i => i.id), attachmentIDList: [] };

			const proposals = [];
			const logs = [];
			logs.push({
				level: "info",
				msg: (DeepRead._locale === "zh"
					? `安全范围：${scope.itemIDList.length} 条目 / ${scope.attachmentIDList.length} 个 PDF·Word 附件（笔记/HTML 不在范围内）`
					: `Scope: ${scope.itemIDList.length} item(s) / ${scope.attachmentIDList.length} PDF/Word attachment(s) (notes/HTML excluded)`)
			});

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
				refined = await this.refineRolesWithModel(proposals, logs, scope);
				logs.push({
					level: "info",
					msg: DeepRead._locale === "zh"
						? "角色白名单：Manuscript / Preprint / Accepted / Proof / AppendixN。条目标题仅 Crossref/PubMed。"
						: "Roles: Manuscript/Preprint/Accepted/Proof/AppendixN. Titles only from Crossref/PubMed."
				});
			}

			return {
				command: "organize_rename",
				proposals: refined,
				logs,
				validated: true,
				scope: {
					itemIDList: scope.itemIDList.slice(),
					attachmentIDList: scope.attachmentIDList.slice()
				}
			};
		},

		_rehydrateScope(scopeLite) {
			if (!scopeLite) return null;
			if (scopeLite.itemIDs && scopeLite.attachmentIDs) return scopeLite;
			const itemIDs = new Set((scopeLite.itemIDList || []).map(Number));
			const attachmentIDs = new Set((scopeLite.attachmentIDList || []).map(Number));
			return {
				itemIDs,
				attachmentIDs,
				itemIDList: [...itemIDs],
				attachmentIDList: [...attachmentIDs]
			};
		},

		async applyProposals(proposals, scopeLite) {
			const scope = this._rehydrateScope(scopeLite);
			if (!scope) {
				throw new Error(DeepRead._locale === "zh"
					? "缺少执行白名单 scope，已拒绝写库"
					: "Missing execution scope; refuse to write");
			}
			const results = [];
			for (const p of proposals) {
				if (!p.selected) continue;
				if (!scope.itemIDs.has(Number(p.itemID))) {
					results.push({
						itemID: p.itemID,
						changed: [],
						errors: ["out-of-scope itemID"]
					});
					continue;
				}
				const r = await DeepRead.OrganizeRenameTool.applyItemProposal(p, scope);
				results.push(r);
			}
			return results;
		}
	};
})();
