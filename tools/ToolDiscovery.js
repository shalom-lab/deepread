(function () {
	const record = /文献|论文|条目|题名|附件|文件名|\b(papers?|articles?|records?|items?|attachments?|filenames?)\b/i;
	const selected = /选中|所选|选区|勾选|当前文献库|当前条目|\b(select(ed|ion)?|current library|active library)\b/i;
	const organize = /整理|规范命名|统一命名|\b(organi[sz]e|tidy|standardiz\w*|standardis\w*)\b/i;
	const attachment = /附件|文件名|\b(attachments?|filenames?|file names?)\b/i;
	const title = /标题|题名|\btitles?\b/i;
	const fileName = /文件名|附件名|\b(file ?names?|attachment names?)\b/i;
	const readerText = /划选|选中.{0,4}(文字|原文|文本|段落)|当前页|阅读器|\b(selected (text|passage)|reader|current page)\b/i;
	const write = /添加|新增|新建|创建|写入|保存|修改|更改|更换|更新|追加|替换|移[动除入]|删除|清除|打上|加上|贴上|重命名|改名|改为|改成|改一下|\b(add|assign|apply|create|save|edit|change|update|append|replace|move|remove|delete|rename|trash)\b/i;
	const textTask = /翻译|润色|改写|纠错|校对|概括|总结|解释|介绍|写.{0,3}(诗|邮件|故事|句子)|\b(translate|polish|rewrite|proofread|paraphrase|summari[sz]e|explain|compose|write)\b/i;
	const creative = /写(?:一[首封篇段个])?[^。！？，,\n]{0,30}(诗|邮件|故事|句子)|\b(write|compose) (?:me )?(?:an? |a short )?(?:poem|story|email|sentence)\b/i;
	const sourceRef = /[“「"‘]|(?:^|\s)'(?=\S)|[:：]\s*\S|\n\s*\S/;
	const resource = /附件|条目|论文|文献|阅读器|笔记|选中|分类|标签|标注|同步|zotero|\b(pdf|attachments?|paper|article|selected|library|notes?|tags?|collections?|mcp)\b/i;
	const fileAction = /重命名|改[个名]|移[动入除]|转移|删除|回收|下载|导入|定位|显示.{0,4}文件夹|\b(rename|move|remove|trash|delete|download|import|reveal)\b/i;
	const followup = /^(?:(?:好[的啊吧]?|请|那就|那|就|再|帮我|好的[,， ]*)\s*)*(?:继续|接着|执行|确认|重试|再来一次|再试一次|下一[步页个批]|按刚才的|照上次的|还是刚才的|也处理|只处理|只看|只要|还有呢|这些呢|这个呢)|^(?:(?:yes|ok(?:ay)?|please)[,\s]+)*(?:continue|go ahead|do it|try again|retry|same again|next(?: one| page| batch| step)?|what about (?:this|these)|only (?:the|those))\b|^(好[的吧]?|可以|确认|行|ok(?:ay)?|yes)[。！!?？ ]*$/i;
	const sourceText = message => String(message?.content || "").trim();

	// Only prior chat turns can supply an omitted object ("continue", "next page").
	function previousTurn(message, history) {
		if (!followup.test(sourceText(message))) return null;
		const index = history.lastIndexOf(message);
		const end = index < 0 ? history.length : index;
		const calls = [];
		for (let i = end - 1; i >= 0; i--) {
			const m = history[i];
			if (m.role === "tool" && !m.skipped && (!m.status || /^(ok|reviewed)$/.test(m.status)) &&
				!calls.some(c => c.name === m.name && c.server === m.server)) calls.push(m);
			if (m.role === "user" && !followup.test(sourceText(m))) {
				if (/^\/tools\b|你.*能做什么|有哪些工具|list (?:your )?tools/i.test(sourceText(m))) return null;
				return { message: m, calls };
			}
		}
		return null;
	}
	function plain(text) {
		if (/^(?:(?:你好|您好|嗨|早上好|谢谢(?:你)?|多谢|再见|hello|hi|hey|thanks(?: you)?|thank you|good morning)[！!，,。.？?\s]*)+$/i.test(text)) return true;
		if (!textTask.test(text) && !creative.test(text)) return false;
		const split = text.search(sourceRef);
		const instruction = split >= 0 ? text.slice(0, split) : text;
		// A quoted source can mention tools. Look for follow-on instructions
		// outside that source, e.g. "Translate this: Bonjour. Save it as a note."
		const unquoted = text.replace(/“[^”]*”|「[^」]*」|‘[^’]*’|"[^"]*"|(?:^|\s)'[^'\n]+'/g, ".");
		const clauses = unquoted.split(/然后|接着|翻译后|润色后|之后|并将|再将|再把|\bthen\b|\band also\b|[。.!?！？;；\n]/i).slice(1);
		const hasWrite = s => write.test(s) && resource.test(s);
		if (resource.test(instruction) || clauses.some(hasWrite) ||
			/(?:调用|运行|使用|\b(?:call|run|use)\b)\s*[a-z0-9.-]*\s*[a-z][a-z0-9]*_[a-z0-9_]+/i.test(unquoted)) return false;
		if (split >= 0 && text.slice(split + 1).trim()) return true;
		return creative.test(text) || /^(?:请|帮我)?(?:解释|介绍)(?!一下这个|一下这篇)|^explain\s+(?!this\b|that\b)/i.test(text);
	}
	function isTextOnly(message, history = []) {
		const text = sourceText(message);
		if (plain(text)) return true;
		const previous = previousTurn(message, history);
		return !!previous && !previous.calls.length && !resource.test(text) && plain(sourceText(previous.message));
	}
	const nativePrefix = "deepread_";
	function named(text, name) {
		if (!name) return false;
		const word = /[a-z0-9_]/;
		const term = name.toLowerCase();
		for (let i = text.indexOf(term); i >= 0; i = text.indexOf(term, i + term.length)) {
			if (!(i > 0 && word.test(text[i - 1])) && !word.test(text[i + term.length] || "")) return true;
		}
		return false;
	}
	function refersToTool(text, name) {
		if (!named(text, name)) return false;
		if (text.trim() === name.toLowerCase() || /[^a-z]/i.test(name)) return true;
		// A remote may literally be named "search", also a common task verb.
		return text.split(/(?:调用|使用|运行|\b(?:use|call|run)\s+(?:tool\s+)?)/i).slice(1)
			.some(part => named(part.trimStart().slice(0, name.length + 1), name));
	}
	const tag = /标签(?!页)|\btags?\b/i, note = /笔记|\bnotes?\b/i;
	const collection = /分类|归类|合集|收藏夹|\bcollections?\b/i;
	const annotation = /标注|注释|高亮|下划线|\b(annotations?|highlights?|underline)\b/i;
	const readPDF = /正文|全文内容|读.{0,6}(PDF|论文|文献)|页图|截图|图像|目录|第\s*\d+\s*页|\b(figure|outline|page (?:text|image)|read (?:this |the )?pdf)\b/i;
	const navigate = /跳转|跳到|跳页|切换|单独打开|打开.{0,8}(pdf|阅读器|文献|论文|标签页)|\b(navigate|jump|switch|open (?:this |the )?(?:pdf|reader|paper|document|tab))\b/i;
	const search = /检索|搜索|搜[一寻下]|查找|找出|帮我找|\b(search|find|look up)\b/i;
	const stats = /统计|分布|有多少|总数|\b(statistics?|count|distribution|how many)\b/i;
	const duplicate = /查重|去重|重复|合并.{0,6}(条目|文献|论文)|\b(duplicates?|deduplicat\w*|merge)\b/i;
	const cite = /引文|引用|引注|参考文献|\b(citations?|cite|bibliograph\w*|csl)\b/i;
	function nativeNames(text, reader) {
		const names = new Set();
		const add = (...keys) => keys.forEach(k => names.add(nativePrefix + k));
		const narrowerTask = tag.test(text) || note.test(text) || collection.test(text) || annotation.test(text);
		const organizing = (organize.test(text) && !narrowerTask && (record.test(text) || selected.test(text) || /^(?:请)?整理$|^organi[sz]e$/i.test(text))) ||
			(title.test(text) && /官方|核对|official metadata/i.test(text)) ||
			(fileName.test(text) && /建议|按.{0,4}角色|suggest|role.based/i.test(text));
		if (selected.test(text)) add("get_context");
		if (organizing) add("get_context", "list_attachments", "plan_organize");
		if (attachment.test(text) && !organizing) {
			add("list_attachments");
			if (fileAction.test(text)) add("manage_attachment");
		}
		if (tag.test(text)) {
			add("list_tags");
			if (write.test(text) || organize.test(text) || /打标签|加标签|tag (?:the|this|selected|all)/i.test(text)) add("manage_tags");
		}
		if (collection.test(text)) {
			add("collections");
			if (write.test(text) || organize.test(text) || /归类|归入|放入|移到|file into/i.test(text)) add("manage_collection");
		}
		if (note.test(text)) {
			add("read_notes");
			if (write.test(text) || /写.{0,4}笔记|记.{0,3}笔记|\bwrite\b/i.test(text)) add("edit_note");
		}
		if (annotation.test(text)) {
			add("read_annotations");
			if (write.test(text) || /高亮|划线|\b(highlight|underline)\b/i.test(text)) add("edit_annotations");
		}
		if (duplicate.test(text)) {
			add("find_duplicates");
			if (/合并|去重|\bmerge\b/i.test(text)) add("manage_items");
		}
		if (readerText.test(text) || navigate.test(text)) add("reader_context");
		if (navigate.test(text)) add("reader_navigate");
		const paperText = /总结|解读|全文|summari[sz]e|full text/i.test(text) && /论文|文献|\b(paper|article|document)\b/i.test(text) &&
			!search.test(text) && !note.test(text) && !annotation.test(text);
		if (readPDF.test(text) || paperText || ((reader || /\bpdf\b/i.test(text)) &&
			/总结|解读|阅读|翻译|summari[sz]e|\bread\b|translate/i.test(text))) add("reader_context", "read_pdf");
		if (/定位.{0,5}(条目|文献|论文)|\b(locate|reveal) (?:this |the )?(?:item|record|paper)\b/i.test(text)) add("locate_item");
		if (stats.test(text) && !tag.test(text) && !attachment.test(text)) add("library_statistics");
		if (cite.test(text) && !/(导入|导出|import|export|ris\b|bibtex)/i.test(text)) add("citation");
		if (/(导出|export)/i.test(text) && !note.test(text)) add("export_references");
		if (/(导入|import)/i.test(text)) {
			if (/doi|10\.\d{4,9}\//i.test(text)) add("import_doi");
			if (/ris\b|bibtex|参考文献|\breferences?\b/i.test(text) && !/doi/i.test(text)) add("import_references");
		}
		if (/同步|\bsync\b/i.test(text)) {
			add("sync_status");
			if (!/状态|进度|status|检查|check/i.test(text) && !attachment.test(text)) add("sync_library");
		}
		if (!organizing && !duplicate.test(text)) {
			if (search.test(text) && !/(找|find|search).{0,6}(工具|tools?)/i.test(text) &&
				(record.test(text) || (!annotation.test(text) && !tag.test(text) && !note.test(text)))) add("search_library");
			if (record.test(text) && /新增|新建|创建|丢弃|回收站|删除|\b(create|trash|delete)\b/i.test(text) &&
				!attachment.test(text) && !tag.test(text) && !note.test(text) && !collection.test(text) && !annotation.test(text)) add("manage_items");
			if (/(元数据|字段|出版年|期刊|作者|metadata|field|journal|author|doi)/i.test(text) && !/(导入|import)/i.test(text)) {
				add("read_items");
				if (write.test(text)) add("edit_item_field");
			}
			if (title.test(text) && (write.test(text) || /核对|correct/i.test(text))) add("get_context", "plan_organize");
			if (!names.size || (names.size === 1 && names.has(nativePrefix + "get_context"))) {
				if (record.test(text) && /查看|读取|信息|详情|\b(read|show|details|metadata)\b/i.test(text)) add("read_items");
			}
		}
		return names;
	}
	const stop = new Set("a an and are at by can could do for from get help how i in is it me my of on or our please show tell that the these this to tool tools use using what with would you your available current selected mcp".split(" "));
	function tokens(text) {
		const words = text.toLowerCase().match(/[a-z][a-z0-9]*|[\u3400-\u9fff]{2,}/g) || [];
		return [...new Set(words.filter(w => w.length > 1 && !stop.has(w)))];
	}
	function relevance(tool, words) {
		const name = (tool.mcpName || tool.name).toLowerCase().replace(/[_-]/g, " ");
		const description = ((tool.description || "") + " " + (tool.descriptionZh || "")).toLowerCase();
		let score = 0;
		for (const w of words) {
			if (named(name, w)) score += 3;
			else if (named(description, w)) score++;
		}
		return score;
	}
	function matchTools(all, text, reader, discovery) {
		const lower = text.toLowerCase(), words = tokens(text);
		const native = nativeNames(text, reader);
		const remote = all.filter(t => t.server);
		const servers = new Set(remote.map(t => t.server).filter(s => named(lower, s) && (s !== "zotero" || /mcp/i.test(text))));
		const externals = servers.size > 0 || /\bmcp\b|外部工具|外接工具/i.test(text);
		const namedTools = all.filter(t => refersToTool(lower, t.name) || (t.server && refersToTool(lower, t.mcpName)));
		const exactQuery = discovery && namedTools.some(t => [t.name, t.mcpName].some(n => n?.toLowerCase() === lower.trim()));
		const ranked = [];
		for (const tool of all) {
			if (tool === find) continue;
			if (servers.size && !servers.has(tool.server)) continue;
			let score = 0;
			if (namedTools.includes(tool)) score = 100;
			else if (namedTools.length && (!discovery || exactQuery)) continue;
			else if (!tool.server && !externals && native.has(tool.name)) score = 20;
			else if (discovery && !tool.server && !externals && named(lower, tool.domain)) score = 15;
			else if (tool.server ? (externals || discovery || !native.size) : discovery) {
				score = relevance(tool, words);
				// An explicit server can itself be the discovery query.
				if (!score && servers.has(tool.server) && (discovery || text.trim().toLowerCase() === tool.server.toLowerCase())) score = 1;
			}
			if (score) ranked.push({ tool, score });
		}
		return ranked.sort((a, b) => b.score - a.score).map(r => r.tool);
	}
	const find = DeepRead.registerTool({
		name: "deepread_find_tools", source: "deepread", domain: "context", floatingChat: true, annotations: { readOnlyHint: true },
		description: "Find available tools by task, domain, or exact tool name. Matching tools become callable on the next step of this chat turn.",
		descriptionZh: "按任务、领域或名称查找工具，并在本轮对话的下一步提供匹配项。",
		inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 160 } }, required: ["query"], additionalProperties: false },
		run({ query }, _message, available = Object.values(DeepRead.ToolRegistry).filter(t => t.floatingChat && DeepRead.ToolRuntime.enabled(t))) {
			return { tools: matchTools(available, query, false, true).slice(0, 6).map(t => ({
				name: t.name, domain: t.domain || t.server, description: String(t.description || "").slice(0, 180)
			})) };
		}
	});
	DeepRead.ToolDiscovery = {
		select(all, message, history = []) {
			if (isTextOnly(message, history)) return [];
			const previous = previousTurn(message, history);
			const text = sourceText(message) + (previous ? "\n" + sourceText(previous.message) : "");
			const past = new Map((previous?.calls || []).map(c => [c.name, c]));
			const compatible = all.filter(t => {
				const call = past.get(t.name);
				return !call || (t.server === call.server && (!t.server || t.mcpName === call.mcpName));
			});
			const matches = matchTools(compatible, text, !!message?.reader?.attachmentID, false);
			const prior = compatible.filter(t => past.has(t.name));
			return [...new Set([...(all.includes(find) ? [find] : []), ...prior, ...matches])].slice(0, 18);
		}, find, isTextOnly
	};
})();
