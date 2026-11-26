/**
 * 官方元数据查询：仅 Crossref / PubMed（NCBI E-utilities）
 * 禁止用模型编造条目标题。
 */
(function () {
	if (typeof DeepRead === "undefined") return;

	DeepRead.OfficialMeta = {
		_cache: new Map(),

		extractIds(item) {
			const ids = { doi: "", pmid: "", pmcid: "" };
			if (!item) return ids;
			try {
				let doi = "";
				try { doi = item.getField("DOI") || ""; } catch (e) { /* ignore */ }
				doi = String(doi).trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "");
				ids.doi = doi;

				let extra = "";
				try { extra = item.getField("extra") || ""; } catch (e) { /* ignore */ }
				const pmid = String(extra).match(/\bPMID\s*:\s*(\d{4,})\b/i);
				const pmcid = String(extra).match(/\bPMCID\s*:\s*(PMC\d+)\b/i);
				if (pmid) ids.pmid = pmid[1];
				if (pmcid) ids.pmcid = pmcid[1].toUpperCase();
			} catch (e) { /* ignore */ }
			return ids;
		},

		async _httpJson(url, headers) {
			const opts = {
				timeout: 20000,
				headers: Object.assign({
					"Accept": "application/json"
				}, headers || {})
			};
			const res = await Zotero.HTTP.request("GET", url, opts);
			if (res.status >= 400) {
				throw new Error(`HTTP ${res.status} for ${url}`);
			}
			if (typeof res.response === "object" && res.response) return res.response;
			const text = res.responseText || "";
			return text ? JSON.parse(text) : null;
		},

		async lookupCrossref(doi) {
			const clean = String(doi || "").trim();
			if (!clean) return null;
			const key = "crossref:" + clean.toLowerCase();
			if (this._cache.has(key)) return this._cache.get(key);

			const url = "https://api.crossref.org/works/" + encodeURIComponent(clean);
			const data = await this._httpJson(url, {
				"User-Agent": "DeepRead/0.11 (Zotero plugin; mailto:deepread@zotero.org)"
			});
			const msg = data && data.message;
			if (!msg || !msg.title || !msg.title[0]) {
				this._cache.set(key, null);
				return null;
			}
			const authors = Array.isArray(msg.author) ? msg.author : [];
			let firstAuthor = "";
			if (authors[0]) {
				firstAuthor = String(authors[0].family || authors[0].name || "").trim();
				if (!firstAuthor && authors[0].given) firstAuthor = String(authors[0].given).trim();
			}
			const yearParts = msg.issued && msg.issued["date-parts"] && msg.issued["date-parts"][0];
			const year = yearParts && yearParts[0] ? String(yearParts[0]) : "";
			const journalFull = (msg["container-title"] && msg["container-title"][0]) || "";
			const journalShort = (msg["short-container-title"] && msg["short-container-title"][0]) || journalFull;
			const out = {
				title: String(msg.title[0]).trim(),
				source: "crossref",
				sourceLabel: "Crossref",
				doi: msg.DOI || clean,
				confidence: 0.95,
				containerTitle: journalFull,
				journal: journalShort || journalFull,
				firstAuthor,
				authorCount: authors.length,
				year,
				issued: yearParts || null
			};
			this._cache.set(key, out);
			return out;
		},

		async lookupPubMed(pmid) {
			const id = String(pmid || "").trim();
			if (!/^\d+$/.test(id)) return null;
			const key = "pubmed:" + id;
			if (this._cache.has(key)) return this._cache.get(key);

			const url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&retmode=json&id=" + encodeURIComponent(id);
			const data = await this._httpJson(url);
			const rec = data && data.result && data.result[id];
			if (!rec || !rec.title) {
				this._cache.set(key, null);
				return null;
			}
			let title = String(rec.title).trim();
			if (title.endsWith(".")) title = title.slice(0, -1);
			const authors = Array.isArray(rec.authors) ? rec.authors : [];
			let firstAuthor = "";
			if (authors[0] && authors[0].name) {
				// PubMed 常为 "Judge C" → 取姓
				firstAuthor = String(authors[0].name).trim().split(/\s+/)[0] || "";
			}
			const yearMatch = String(rec.pubdate || rec.sortpubdate || "").match(/(19|20)\d{2}/);
			const out = {
				title,
				source: "pubmed",
				sourceLabel: "PubMed",
				pmid: id,
				doi: (rec.elocationid && String(rec.elocationid).match(/10\.\S+/))
					? String(rec.elocationid).match(/10\.\S+/)[0].replace(/\.$/, "")
					: "",
				confidence: 0.96,
				containerTitle: rec.fulljournalname || rec.source || "",
				journal: rec.source || rec.fulljournalname || "",
				firstAuthor,
				authorCount: authors.length,
				year: yearMatch ? yearMatch[0] : "",
				issued: rec.pubdate || null
			};
			this._cache.set(key, out);
			return out;
		},

		/** 官方字段不足时，用 Zotero 条目字段补全作者/年/期刊（仍不编造标题） */
		enrichFromItem(meta, item) {
			const m = Object.assign({}, meta || {});
			if (!item) return m;
			try {
				if (!m.firstAuthor) {
					const creators = item.getCreators ? item.getCreators() : [];
					const first = creators.find(c => (c.creatorType || "") === "author") || creators[0];
					if (first) {
						m.firstAuthor = String(first.lastName || first.name || "").trim();
						m.authorCount = Math.max(m.authorCount || 0, creators.length);
					}
				}
				if (!m.year) {
					const date = item.getField("date") || item.getField("year") || "";
					const ym = String(date).match(/(19|20)\d{2}/);
					if (ym) m.year = ym[0];
				}
				if (!m.journal) {
					m.journal = item.getField("journalAbbreviation")
						|| item.getField("publicationTitle")
						|| m.containerTitle
						|| "";
				}
				if (!m.authorCount) {
					const creators = item.getCreators ? item.getCreators() : [];
					m.authorCount = creators.length;
				}
			} catch (e) { /* ignore */ }
			return m;
		},

		/**
		 * 仅官方渠道。无 DOI/PMID 时返回 null（禁止猜标题）。
		 */
		async lookupOfficial(item) {
			const ids = this.extractIds(item);
			const errors = [];

			if (ids.pmid) {
				try {
					const pm = await this.lookupPubMed(ids.pmid);
					if (pm && pm.title) {
						return this.enrichFromItem(Object.assign({ ok: true, ids }, pm), item);
					}
				} catch (e) {
					errors.push("PubMed: " + (e.message || e));
				}
			}

			if (ids.doi) {
				try {
					const cr = await this.lookupCrossref(ids.doi);
					if (cr && cr.title) {
						return this.enrichFromItem(Object.assign({ ok: true, ids }, cr), item);
					}
				} catch (e) {
					errors.push("Crossref: " + (e.message || e));
				}
			}

			return {
				ok: false,
				ids,
				title: null,
				source: "none",
				sourceLabel: DeepRead._locale === "zh" ? "无官方 ID" : "No official ID",
				confidence: 0,
				error: errors.join("; ") || (DeepRead._locale === "zh"
					? "缺少 DOI/PMID，拒绝改写条目标题"
					: "Missing DOI/PMID; refuse to invent title")
			};
		}
	};
})();
