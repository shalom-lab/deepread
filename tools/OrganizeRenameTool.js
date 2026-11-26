/**
 * Tool: organize_rename
 * 确认后写库：官方标题 + 附件角色命名
 * 角色白名单：Manuscript / Preprint / Accepted / Proof / AppendixN
 */
(function () {
	if (typeof DeepRead === "undefined") return;

	DeepRead.OrganizeRenameTool = {
		id: "organize_rename",

		/** 允许的角色（appendix 可 appendix1..appendix9） */
		ROLE_PREFIX: {
			manuscript: "Manuscript",
			preprint: "Preprint",
			accepted: "Accepted",
			proof: "Proof"
		},

		isValidRole(role) {
			const r = String(role || "").toLowerCase();
			if (r === "manuscript" || r === "preprint" || r === "accepted" || r === "proof") return true;
			return /^appendix[1-9]$/.test(r);
		},

		normalizeRole(role) {
			const r = String(role || "").toLowerCase().trim();
			if (r === "manuscript" || r === "main" || r === "vor" || r === "published") return "manuscript";
			if (r === "preprint" || r === "pre-print") return "preprint";
			if (r === "accepted" || r === "aam" || r === "postprint" || r === "post-print") return "accepted";
			if (r === "proof" || r === "galley" || r === "prepress") return "proof";
			const m = r.match(/^appendix\s*_?\s*([1-9])$/) || r.match(/^appendix([1-9])$/);
			if (m) return "appendix" + m[1];
			if (r === "appendix" || r === "suppl" || r === "si" || r === "supplement") return "appendix1";
			return "";
		},

		fsSafe(name) {
			return String(name || "")
				.replace(/[\\/:*?"<>|]/g, "")
				.replace(/[\u0000-\u001f]/g, "")
				.replace(/\s+/g, " ")
				.trim();
		},

		shortenTitle(title, maxLen) {
			const max = maxLen || 48;
			let s = this.fsSafe(title).replace(/_+/g, "_");
			if (!s) s = "Untitled";
			if (s.length > max) s = s.slice(0, max).replace(/[_\s]+$/g, "");
			return s || "Untitled";
		},

		/**
		 * 附件名中段：第一作者[ et al]_年_期刊_title（按总长截断 title）
		 * 例：Judge et al_2026_Lancet Planet Health_Drivers of sylvatic...
		 */
		buildCiteStem(meta, fallbackTitle, maxLen) {
			const max = maxLen || 120;
			const m = meta || {};
			let author = this.fsSafe(m.firstAuthor || "Unknown");
			if (!author) author = "Unknown";
			const multi = (m.authorCount || 0) > 1;
			const authorPart = multi ? `${author} et al` : author;
			const year = String(m.year || "").match(/(19|20)\d{2}/) ? String(m.year).match(/(19|20)\d{2}/)[0] : "0000";
			let journal = this.fsSafe(m.journal || m.containerTitle || "Journal");
			if (journal.length > 40) journal = journal.slice(0, 40).replace(/[_\s]+$/g, "");
			const titleFull = this.fsSafe(m.title || fallbackTitle || "Untitled");

			const head = `${authorPart}_${year}_${journal}_`;
			const room = Math.max(20, max - head.length);
			let titlePart = titleFull;
			if (titlePart.length > room) {
				titlePart = titlePart.slice(0, room).replace(/[_\s]+$/g, "");
			}
			let stem = this.fsSafe(`${head}${titlePart}`);
			if (stem.length > max) stem = stem.slice(0, max).replace(/[_\s]+$/g, "");
			return stem || this.shortenTitle(fallbackTitle, max);
		},

		guessAttachmentRole(att, indexAmongFiles) {
			const title = ((att.getField && att.getField("title")) || "").toLowerCase();
			const path = ((att.attachmentPath) || "").toLowerCase();
			const blob = title + " " + path;
			if (/preprint|biorxiv|medrxiv|arxiv/.test(blob)) return "preprint";
			if (/accepted|aam|postprint|author.?accepted/.test(blob)) return "accepted";
			if (/proof|galley|prepress/.test(blob)) return "proof";
			const ap = blob.match(/appendix\s*_?\s*([1-9])|附录\s*([1-9])|suppl\w*\s*_?\s*([1-9])|s([1-9])\b/);
			if (ap) {
				const n = ap[1] || ap[2] || ap[3] || ap[4] || "1";
				return "appendix" + n;
			}
			if (/appendix|suppl|supporting|supplement|附加|附录/.test(blob)) return "appendix1";
			if (/manuscript|全文|main\s*text|article|published|vor/.test(blob)) return "manuscript";
			if (indexAmongFiles === 0) return "manuscript";
			return "appendix" + Math.min(9, indexAmongFiles);
		},

		rolePrefix(role) {
			const r = this.normalizeRole(role) || String(role || "").toLowerCase();
			if (this.ROLE_PREFIX[r]) return this.ROLE_PREFIX[r];
			if (/^appendix[1-9]$/.test(r)) {
				return "Appendix" + r.replace(/\D/g, "");
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

		_stripXmlToText(xml) {
			return String(xml || "")
				.replace(/<w:tab[^/]*\/>/g, "\t")
				.replace(/<w:br[^/]*\/>/g, "\n")
				.replace(/<\/w:p>/g, "\n")
				.replace(/<[^>]+>/g, "")
				.replace(/&lt;/g, "<")
				.replace(/&gt;/g, ">")
				.replace(/&amp;/g, "&")
				.replace(/&quot;/g, '"')
				.replace(/&#39;/g, "'")
				.replace(/[ \t]+\n/g, "\n")
				.replace(/\n{3,}/g, "\n\n")
				.trim();
		},

		/** DOCX：优先全文缓存，否则解压 word/document.xml；失败返回 ""，不抛错 */
		async _extractDocxPreview(att, maxChars) {
			const limit = maxChars || 8000;
			try {
				try {
					const cached = await att.attachmentText;
					if (cached && String(cached).trim()) {
						return String(cached).trim().slice(0, limit);
					}
				} catch (e) { /* ignore */ }

				const path = await att.getFilePathAsync();
				if (!path || !/\.docx$/i.test(path)) return "";

				const classes = (typeof Cc !== "undefined" && Cc)
					|| (typeof Components !== "undefined" && Components.classes);
				const ifaces = (typeof Ci !== "undefined" && Ci)
					|| (typeof Components !== "undefined" && Components.interfaces);
				if (!classes || !ifaces) return "";

				const zr = classes["@mozilla.org/libjar/zip-reader;1"].createInstance(ifaces.nsIZipReader);
				const file = classes["@mozilla.org/file/local;1"].createInstance(ifaces.nsIFile);
				file.initWithPath(path);
				zr.open(file);
				try {
					if (!zr.hasEntry("word/document.xml")) return "";
					const stream = zr.getInputStream("word/document.xml");
					const sis = classes["@mozilla.org/scriptableinputstream;1"]
						.createInstance(ifaces.nsIScriptableInputStream);
					sis.init(stream);
					let data = "";
					while (sis.available()) {
						data += sis.read(Math.min(8192, sis.available()));
						if (data.length > limit * 4) break;
					}
					try { sis.close(); } catch (e) { /* ignore */ }
					return this._stripXmlToText(data).slice(0, limit);
				} finally {
					try { zr.close(); } catch (e) { /* ignore */ }
				}
			} catch (e) {
				DeepRead.log("_extractDocxPreview: " + (e.message || e));
				return "";
			}
		},

		/** 老 .doc：尽量读全文缓存，否则空串（不报错） */
		async _extractDocPreview(att, maxChars) {
			const limit = maxChars || 8000;
			try {
				const cached = await att.attachmentText;
				if (cached && String(cached).trim()) {
					return String(cached).trim().slice(0, limit);
				}
			} catch (e) { /* ignore */ }
			return "";
		},

		/**
		 * 抽取预览文本：PDF 最多前 maxPages 页（更少则全要，不报错）；
		 * DOCX/DOC 尽量抽文本前段。失败一律返回 ""。
		 */
		async extractPreviewText(att, maxPages) {
			const pages = maxPages || 5;
			try {
				if (!att) return "";

				const path = (att.attachmentPath || "") + " " + ((att.getField && att.getField("title")) || "");
				const isPdf = (att.isPDFAttachment && att.isPDFAttachment())
					|| /\.pdf$/i.test(path)
					|| /pdf/i.test(att.attachmentContentType || "");
				const isDocx = /\.docx$/i.test(path) || /wordprocessingml|docx/i.test(att.attachmentContentType || "");
				const isDoc = /\.doc$/i.test(path) && !/\.docx$/i.test(path);

				if (isPdf) {
					if (typeof Zotero === "undefined" || !Zotero.PDFWorker || !Zotero.PDFWorker.getFullText) {
						return "";
					}
					let result = null;
					try {
						// 有的版本支持第二参 maxPages；页数不足时 worker 会截到实际页数
						result = await Zotero.PDFWorker.getFullText(att.id, pages);
					} catch (e) { return ""; }
					let text = (result && result.text) || "";
					if (!text) return "";
					if (text.indexOf("\f") >= 0) {
						const parts = text.split("\f");
						// 少于 5 页就全用；多于则截前 5 页——不报错
						text = parts.slice(0, Math.min(pages, parts.length)).join("\n\n");
					} else if (text.length > 12000) {
						text = text.slice(0, 12000);
					}
					return String(text).trim().slice(0, 8000);
				}

				if (isDocx) {
					return await this._extractDocxPreview(att, 8000);
				}
				if (isDoc) {
					return await this._extractDocPreview(att, 8000);
				}

				// 其它支持类型：尝试 attachmentText
				try {
					const cached = await att.attachmentText;
					if (cached) return String(cached).trim().slice(0, 8000);
				} catch (e) { /* ignore */ }
				return "";
			} catch (e) {
				DeepRead.log("extractPreviewText: " + (e.message || e));
				return "";
			}
		},

		async buildProposalForItem(topItem, officialMeta, roleOverrides, allowedAttachmentIDs) {
			const zh = DeepRead._locale === "zh";
			const fromTitle = (topItem.getField && topItem.getField("title")) || "";
			const hasOfficial = !!(officialMeta && officialMeta.title && officialMeta.source !== "none");
			const toTitle = hasOfficial ? officialMeta.title : null;
			// 命名中段：第一作者 et al_年_期刊_title（官方 meta + 条目字段补全）
			const citeMeta = hasOfficial
				? (DeepRead.OfficialMeta.enrichFromItem
					? DeepRead.OfficialMeta.enrichFromItem(officialMeta, topItem)
					: officialMeta)
				: DeepRead.OfficialMeta.enrichFromItem
					? DeepRead.OfficialMeta.enrichFromItem({ title: fromTitle }, topItem)
					: { title: fromTitle };
			const shortBase = this.buildCiteStem(citeMeta, toTitle || fromTitle, 120);

			const files = this.collectFileAttachments(topItem).filter(att => !allowedAttachmentIDs || allowedAttachmentIDs.has(att.id));
			const attachments = files.map((att, i) => {
				let role = (roleOverrides && (roleOverrides[String(att.id)] || roleOverrides[att.id]))
					|| this.guessAttachmentRole(att, i);
				role = this.normalizeRole(role) || this.guessAttachmentRole(att, i);
				const prefix = this.rolePrefix(role);
				const ext = this.extOfAttachment(att);
				const fromName = (att.getField && att.getField("title")) || "";
				const toName = this.fsSafe(`${prefix}_${shortBase}${ext}`);
				let conf = 0.68;
				if (role === "manuscript" && i === 0) conf = 0.75;
				if (/preprint|accepted|proof|appendix|suppl/i.test(fromName)) conf = 0.82;
				return {
					attachmentID: att.id,
					key: att.key,
					filename: att.attachmentFilename,
					from: fromName,
					to: toName,
					role,
					confidence: conf,
					selected: true
				};
			});

			return {
				itemID: topItem.id,
				key: topItem.key,
				libraryID: topItem.libraryID,
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
					pmid: officialMeta.pmid || (officialMeta.ids && officialMeta.ids.pmid) || "",
					firstAuthor: citeMeta.firstAuthor || "",
					year: citeMeta.year || "",
					journal: citeMeta.journal || ""
				} : null,
				attachments,
				selected: true
			};
		},

		/** 把条目提案展开为原子步骤（供确认 UI / runPlan） */
		proposalToAtomSteps(proposal) {
			const steps = [];
			if (!proposal) return steps;
			if (proposal.titleSelected && proposal.toTitle) {
				steps.push({
					tool: "set_item_title",
					selected: true,
					risk: "medium",
					label: `title #${proposal.itemID}`,
					args: {
						itemID: proposal.itemID,
						title: proposal.toTitle,
						officialSource: (proposal.official && (proposal.official.sourceLabel || proposal.official.source)) || "",
						requireOfficial: true
					}
				});
			}
			for (const attProp of (proposal.attachments || [])) {
				if (!attProp.selected || !attProp.to) continue;
				steps.push({
					tool: "rename_attachment",
					selected: true,
					risk: "medium",
					label: `rename #${attProp.attachmentID}`,
					args: {
						attachmentID: attProp.attachmentID,
						newName: this.fsSafe(attProp.to)
					}
				});
			}
			return steps;
		},

		async applyItemProposal(proposal, scope) {
			const result = { itemID: proposal.itemID, changed: [], errors: [], atomResults: [] };
			if (!Zotero.Items.get(proposal.itemID)) {
				result.errors.push("item missing");
				return result;
			}
			if (!DeepRead.AtomTools || typeof DeepRead.AtomTools.runPlan !== "function") {
				result.errors.push("AtomTools missing");
				return result;
			}
			if (!scope) {
				result.errors.push("missing scope whitelist");
				return result;
			}
			const steps = this.proposalToAtomSteps(proposal);
			const atomResults = await DeepRead.AtomTools.runPlan(steps, scope);
			result.atomResults = atomResults;
			for (const r of atomResults) {
				if (r.skipped || r.rejected) {
					if (r.rejected) result.errors.push((r.tool || "?") + ": " + (r.error || "out-of-scope"));
					continue;
				}
				if (r.ok) {
					if (r.tool === "set_item_title") result.changed.push("title");
					else if (r.tool === "rename_attachment") result.changed.push("att:" + (r.attachmentID || ""));
					else result.changed.push(r.tool);
				} else {
					result.errors.push((r.tool || "?") + ": " + (r.error || "failed"));
				}
			}
			return result;
		}
	};

	if (!DeepRead.ToolRegistry) DeepRead.ToolRegistry = {};
	Object.assign(DeepRead.OrganizeRenameTool, { name: "organize_rename", source: "deepread", domain: "items" });
	DeepRead.ToolRegistry.organize_rename = DeepRead.OrganizeRenameTool;
})();
