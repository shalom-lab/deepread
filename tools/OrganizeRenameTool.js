/**
 * Tool: organize_rename
 * 确认后写库：官方标题 + Manuscript/Appendix 附件命名
 */
(function () {
	if (typeof DeepRead === "undefined") return;

	DeepRead.OrganizeRenameTool = {
		id: "organize_rename",

		fsSafe(name) {
			return String(name || "")
				.replace(/[\\/:*?"<>|]/g, "")
				.replace(/\s+/g, " ")
				.trim();
		},

		/** 文章名缩减：用于附件前缀 */
		shortenTitle(title, maxLen) {
			const max = maxLen || 48;
			let s = String(title || "")
				.replace(/[^\w\u4e00-\u9fff\-]+/g, "_")
				.replace(/_+/g, "_")
				.replace(/^_|_$/g, "");
			if (!s) s = "Untitled";
			if (s.length > max) s = s.slice(0, max).replace(/_+$/g, "");
			return s || "Untitled";
		},

		guessAttachmentRole(att, indexAmongFiles) {
			const title = ((att.getField && att.getField("title")) || "").toLowerCase();
			const path = ((att.attachmentPath) || "").toLowerCase();
			const blob = title + " " + path;
			if (/appendix\s*_?\s*2|suppl.*2|supporting.*2|附加\s*2|附录\s*2|s2\b/.test(blob)) {
				return "appendix2";
			}
			if (/appendix\s*_?\s*1|suppl|supporting|supplement|附加|附录|s1\b|appendix/.test(blob)) {
				return "appendix1";
			}
			if (/manuscript|全文|main\s*text|article|paper/.test(blob)) {
				return "manuscript";
			}
			// 默认：第一个当 Manuscript，其后依次 Appendix
			if (indexAmongFiles === 0) return "manuscript";
			if (indexAmongFiles === 1) return "appendix1";
			return "appendix2";
		},

		rolePrefix(role) {
			if (role === "appendix1") return "Appendix1";
			if (role === "appendix2") return "Appendix2";
			if (role === "appendix" || /^appendix\d+$/i.test(role)) {
				const n = String(role).replace(/\D/g, "") || "1";
				return "Appendix" + n;
			}
			return "Manuscript";
		},

		extOfAttachment(att) {
			try {
				const path = att.attachmentPath || (att.getFilePath && att.getFilePath()) || "";
				const m = String(path).match(/\.([a-z0-9]{1,5})$/i);
				if (m) return "." + m[1].toLowerCase();
			} catch (e) { /* ignore */ }
			try {
				const t = att.attachmentContentType || "";
				if (/pdf/i.test(t)) return ".pdf";
				if (/word|docx/i.test(t)) return ".docx";
				if (/msword/i.test(t)) return ".doc";
			} catch (e) { /* ignore */ }
			return "";
		},

		collectFileAttachments(topItem) {
			const out = [];
			if (!topItem) return out;
			const ids = topItem.getAttachments ? topItem.getAttachments() : [];
			for (const id of ids) {
				const att = Zotero.Items.get(id);
				if (!att || !DeepRead._isSupportedAttachment(att)) continue;
				out.push(att);
			}
			return out;
		},

		/**
		 * 构建提案（不写库）。标题 to 仅来自 officialMeta。
		 */
		async buildProposalForItem(topItem, officialMeta, roleOverrides) {
			const zh = DeepRead._locale === "zh";
			const fromTitle = (topItem.getField && topItem.getField("title")) || "";
			const hasOfficial = !!(officialMeta && officialMeta.title && officialMeta.source !== "none");
			const toTitle = hasOfficial ? officialMeta.title : null;
			const shortBase = this.shortenTitle(toTitle || fromTitle);

			const files = this.collectFileAttachments(topItem);
			const attachments = files.map((att, i) => {
				const role = (roleOverrides && roleOverrides[String(att.id)]) || this.guessAttachmentRole(att, i);
				const prefix = this.rolePrefix(role);
				const ext = this.extOfAttachment(att);
				const fromName = (att.getField && att.getField("title")) || "";
				const toName = this.fsSafe(`${prefix}_${shortBase}${ext}`);
				let conf = 0.7;
				if (role === "manuscript" && i === 0) conf = 0.75;
				if (/appendix|suppl/i.test(fromName)) conf = 0.85;
				return {
					attachmentID: att.id,
					from: fromName,
					to: toName,
					role,
					confidence: conf,
					selected: true
				};
			});

			return {
				itemID: topItem.id,
				fromTitle,
				toTitle,
				titleSelected: !!toTitle,
				titleConfidence: hasOfficial ? (officialMeta.confidence || 0.95) : 0,
				titleSource: hasOfficial ? officialMeta.sourceLabel : (zh ? "无官方来源（跳过改标题）" : "No official source (skip title)"),
				titleBlockedReason: hasOfficial ? "" : (officialMeta && officialMeta.error) || (zh ? "缺少 DOI/PMID" : "Missing DOI/PMID"),
				shortTitle: shortBase,
				official: hasOfficial ? {
					source: officialMeta.source,
					sourceLabel: officialMeta.sourceLabel,
					doi: officialMeta.doi || (officialMeta.ids && officialMeta.ids.doi) || "",
					pmid: officialMeta.pmid || (officialMeta.ids && officialMeta.ids.pmid) || ""
				} : null,
				attachments,
				selected: true
			};
		},

		/** 执行已勾选变更 */
		async applyItemProposal(proposal) {
			const result = { itemID: proposal.itemID, changed: [], errors: [] };
			const item = Zotero.Items.get(proposal.itemID);
			if (!item) {
				result.errors.push("item missing");
				return result;
			}

			try {
				if (proposal.titleSelected && proposal.toTitle) {
					// 二次校验：禁止无来源写标题
					if (!proposal.official || !proposal.official.source) {
						result.errors.push("refuse title without official source");
					} else {
						item.setField("title", proposal.toTitle);
						await item.saveTx();
						result.changed.push("title");
					}
				}
			} catch (e) {
				result.errors.push("title: " + (e.message || e));
			}

			for (const attProp of (proposal.attachments || [])) {
				if (!attProp.selected || !attProp.to) continue;
				try {
					const att = Zotero.Items.get(attProp.attachmentID);
					if (!att) {
						result.errors.push("att missing " + attProp.attachmentID);
						continue;
					}
					const newName = this.fsSafe(attProp.to);
					if (typeof att.renameAttachmentFile === "function") {
						const ok = await att.renameAttachmentFile(newName);
						if (!ok) {
							// 仍尝试改显示名
							att.setField("title", newName);
							await att.saveTx();
							result.changed.push("att-title:" + att.id);
							result.errors.push("renameAttachmentFile failed for " + att.id + "; updated display title only");
							continue;
						}
					}
					att.setField("title", newName);
					await att.saveTx();
					result.changed.push("att:" + att.id);
				} catch (e) {
					result.errors.push("att " + attProp.attachmentID + ": " + (e.message || e));
				}
			}
			return result;
		}
	};

	if (!DeepRead.ToolRegistry) DeepRead.ToolRegistry = {};
	DeepRead.ToolRegistry.organize_rename = DeepRead.OrganizeRenameTool;
})();
