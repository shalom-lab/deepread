// headless.js
// 为 DeepRead 提供的独立无头(Headless) API 拓展
// 设计初衷：供第三方插件 (如 Action Tags) 或 Zotero 原生 Run JavaScript 运行批量静默任务

if (typeof DeepRead !== 'undefined') {
    /**
     * 外部调用的 Headless API
     * @param {Zotero.Item} item - 目标 Zotero 顶层文献条目对象 (必填)
     * @param {string} prompt - 纯文本的指令 (必填)
     * @param {boolean} [saveToHistory=true] - 是否将该次问答结果持久化展示在右侧对话记录中 (默认: true)
     * @param {boolean} [sendHistory=false] - 提问时是否携带过往的对话记录给大模型 (默认: false, 即单次纯净提问)
     * @param {Array<number>} [specificAttachmentIDs=[]] - 若只需针对某几个特定附件进行提取，传入它们的 ID，空缺代表全选 (默认: [])
     * @returns {Promise<string>} - 大模型返回的最终纯文本结果
     */
    DeepRead.runHeadless = async function(item, prompt, saveToHistory = true, sendHistory = false, specificAttachmentIDs = []) {
        if (!item) {
            throw new Error("DeepRead Headless: 缺少目标条目 (item)");
        }
        if (!prompt) {
            throw new Error("DeepRead Headless: 缺少提示词 (prompt)");
        }

        const topItem = this._getTopLevelItem(item);

        // 1. 同步并检查最新的 AI 服务提供商配置
        await this.syncProviderConfig();
        if (!this.provider || !this.provider.config.apiKey) {
            throw new Error("DeepRead Headless: 请先在 Zotero 设置面板中配置 API Key。");
        }

        // 2. 无缝提取文档内容
        const pdfData = await this._getPdfData(topItem, specificAttachmentIDs);

        // 3. 构建发给大模型的一次性纯净对话
        const userMsg = { role: "user", content: prompt };
        
        let localDiskHistory = [];
        let key = null;

        // 如果要求存入本地历史，或者要求带历史发给AI，都需要拉取旧历史
        if (saveToHistory || sendHistory) {
            const histData = this._getOrCreateHistory(topItem);
            key = histData.key;
            localDiskHistory = histData.history;
        }

        // 区分“发给AI的数组”和“存入硬盘的数组”
        let apiChatHistory = [];
        if (sendHistory) {
            // 携带历史：复制过往聊天并加上新问题
            apiChatHistory = [...localDiskHistory, userMsg];
        } else {
            // 不带历史：只有这一句话
            apiChatHistory = [userMsg];
        }
        
        if (saveToHistory) {
            // 压入长期记录并断点保存
            localDiskHistory.push(userMsg); 
            this.chatHistory.set(key, localDiskHistory);
            this.saveChatHistory();
        }

        await this.syncProviderConfig();
        const activeModel = this.provider.config.model;

        // 4. 调用大模型发起网络请求 !
        let result;
        try {
            // 投喂给大模型的数组受 sendHistory 开关控制
            result = await this.provider.chat(apiChatHistory, { model: activeModel }, pdfData);
        } catch (error) {
            throw new Error(`DeepRead Headless Network Error: ${error.message}`);
        }

        // 5. 拿到回答，写入长期磁盘历史（若开启记录）
        const assistantMsg = { role: "assistant", content: result.content, model: activeModel };
        
        if (saveToHistory) {
            localDiskHistory.push(assistantMsg);
            this.chatHistory.set(key, localDiskHistory);
            this.saveChatHistory();
        }

        // 6. 返回纯粹的文字结果给调用的第三方 JS！
        return result.content;
    };
}
