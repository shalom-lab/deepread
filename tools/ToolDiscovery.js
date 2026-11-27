(function () {
	const hints = {
		context: /选中|选区|当前|selected|context/i,
		items: /文献|条目|元数据|重复|合并|标题|metadata|record|item|duplicate|merge/i,
		search: /检索|搜索|查找|search|find|look up/i,
		collections: /分类|文件夹|归类|collection|folder/i, tags: /标签|tag/i,
		attachments: /附件|文件名|改名|attach|filename|rename/i, notes: /笔记|note/i,
		pdf: /pdf|文本|截图|图像|目录|页面|page text|outline|image/i,
		reader: /阅读|划选|页码|跳页|打开|reader|page|navigate|open/i,
		annotations: /标注|高亮|批注|annotat|highlight/i,
		citation: /引文|引用|引注|参考文献|cit[a-e]|bibliograph/i,
		import_export: /导入|导出|import|export|ris\b|bibtex|doi/i, sync: /同步|sync/i,
		ui: /界面|定位|标签页|window|tab|locate/i, statistics: /统计|年份分布|statistics|count|distribution/i
	};
	function matches(tool, query) {
		const exact = query.toLowerCase();
		const corpus = [tool.name, tool.mcpName, tool.domain, tool.description, tool.descriptionZh].filter(Boolean).join(" ").toLowerCase();
		let score = query.includes(tool.name) ? 20 : 0;
		if (tool.domain && hints[tool.domain]?.test(query)) score += 4;
		if (/整理|organize/i.test(query) && tool.name === "deepread_plan_organize") score += 12;
		for (const token of new Set(exact.match(/[a-z_0-9]+|[\u3400-\u9fff]{2,}/g) || [])) if (corpus.includes(token)) score += 2;
		return score;
	}
	function rank(tools, text) {
		return tools.map(tool => ({ tool, score: matches(tool, text) }))
			.sort((a, b) => b.score - a.score).map(r => r.tool);
	}
	const find = DeepRead.registerTool({
		name: "deepread_find_tools", source: "deepread", domain: "context", floatingChat: true, annotations: { readOnlyHint: true },
		description: "Find available tools by task, domain, or exact tool name. Matching tools become callable on the next step of this chat turn.",
		descriptionZh: "按任务、领域或名称查找工具，并在本轮对话的下一步提供匹配项。",
		inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 160 } }, required: ["query"], additionalProperties: false },
		run({ query }, _message, available = Object.values(DeepRead.ToolRegistry).filter(t => t.floatingChat && DeepRead.ToolRuntime.enabled(t))) {
			const matched = available.filter(t => t.name !== find.name && matches(t, query) > 0);
			return { tools: rank(matched, query).slice(0, 12).map(t => ({ name: t.name, domain: t.domain || t.server, description: t.description })) };
		}
	});
	DeepRead.ToolDiscovery = {
		select(all, message) {
			if (all.length <= 18 || !all.includes(find)) return all;
			const context = message?.reader?.attachmentID ? " reader" : "";
			return [find, ...rank(all.filter(tool => tool !== find), (message?.content || "") + context).slice(0, 17)];
		}, find
	};
})();
