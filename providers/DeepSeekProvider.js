/**
 * DeepSeekProvider - DeepSeek Chat Completions + Files API（PDF/Word 等）
 * 文档：先 POST /files 解析，再在对话里引用 file_id（需 deepseek-flash）
 */
var DeepSeekProvider = class DeepSeekProvider extends BaseAIProvider {
  constructor(config = {}) {
    super(config);
    this.baseURL = (config.baseUrl || "https://api.deepseek.com").replace(/\/$/, "");
    this.rateLimiter = this.createRateLimiter(60, 60000);
    /** @type {Map<string, string>} */
    this._fileIdCache = new Map();
  }

  _headers(json = true) {
    const h = { "Authorization": `Bearer ${this.config.apiKey}` };
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  _cacheKey(file) {
    const b64 = file.base64 || "";
    return [
      file.mimeType || "",
      b64.length,
      b64.slice(0, 48),
      b64.slice(-24),
      this.config.parsePurpose || "rich_layout_recognition"
    ].join("|");
  }

  _extFromMime(mime) {
    const m = String(mime || "").toLowerCase();
    if (m.includes("pdf")) return "pdf";
    if (m.includes("wordprocessingml") || m.includes("msword")) return "docx";
    if (m.includes("presentationml") || m.includes("powerpoint")) return "pptx";
    return "bin";
  }

  _base64ToBlob(base64, mimeType) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: mimeType || "application/octet-stream" });
  }

  async _uploadDocument(file) {
    const key = this._cacheKey(file);
    if (this._fileIdCache.has(key)) {
      return this._fileIdCache.get(key);
    }

    const purpose = this.config.parsePurpose || "rich_layout_recognition";
    const mime = file.mimeType || "application/pdf";
    const filename = file.filename || `document.${this._extFromMime(mime)}`;
    const blob = this._base64ToBlob(file.base64, mime);

    const form = new FormData();
    // DeepSeek 要求 purpose 字段在 file 之前
    form.append("purpose", purpose);
    form.append("file", blob, filename);

    const response = await fetch(`${this.baseURL}/files`, {
      method: "POST",
      headers: this._headers(false),
      body: form
    });

    if (!response.ok) {
      await this.handleError(response);
    }

    const data = await response.json();
    const fileId = data.id;
    if (!fileId) {
      throw new Error("DeepSeek Files API did not return file id");
    }
    this._fileIdCache.set(key, fileId);
    return fileId;
  }

  async _ensureFileIds(pdfData) {
    if (!pdfData) return [];
    const files = (pdfData.files && pdfData.files.length)
      ? pdfData.files
      : (pdfData.base64 ? [{ base64: pdfData.base64, mimeType: pdfData.mimeType || "application/pdf" }] : []);

    const ids = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f || !f.base64) continue;
      const fileId = await this._uploadDocument({
        ...f,
        filename: f.filename || `document-${i + 1}.${this._extFromMime(f.mimeType)}`
      });
      ids.push(fileId);
    }
    return ids.slice(0, 20); // DeepSeek 单次最多 20 个文档
  }

  async _toMessages(history, pdfData) {
    const firstUserIndex = history.findIndex(msg => msg.role === "user");
    const fileIds = await this._ensureFileIds(pdfData);

    return history.map((msg, index) => {
      const role = msg.role === "assistant" ? "assistant" : (msg.role === "system" ? "system" : "user");
      if (role === "user" && index === firstUserIndex && fileIds.length > 0) {
        return {
          role,
          content: [
            ...fileIds.map(id => ({ type: "file", file_id: id })),
            { type: "text", text: msg.content || "" }
          ]
        };
      }
      return { role, content: msg.content || "" };
    });
  }

  async chat(history, config = {}, pdfData = null) {
    this.validateConfig();
    const mergedConfig = { ...this.config, ...config };
    // 文件输入需 deepseek-flash；无文件时也允许其他模型
    const hasFiles = !!(pdfData && (pdfData.base64 || (pdfData.files && pdfData.files.length)));
    const model = mergedConfig.model || (hasFiles ? "deepseek-flash" : "deepseek-chat");
    if (hasFiles && model !== "deepseek-flash") {
      // 官方文档：文档引用配合 deepseek-flash
      mergedConfig.model = "deepseek-flash";
    }

    const messages = await this._toMessages(history, pdfData);
    const url = `${this.baseURL}/chat/completions`;
    const payload = {
      model: hasFiles ? "deepseek-flash" : (mergedConfig.model || "deepseek-chat"),
      messages,
      temperature: mergedConfig.temperature,
      max_tokens: mergedConfig.maxTokens
    };

    return this.rateLimiter(async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: this._headers(true),
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        await this.handleError(response);
      }

      const data = await response.json();
      const content = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : "";

      if (!content) {
        throw new Error("No response from DeepSeek API");
      }

      return {
        content: typeof content === "string" ? content : JSON.stringify(content),
        usage: {
          promptTokens: data.usage?.prompt_tokens || 0,
          completionTokens: data.usage?.completion_tokens || 0,
          totalTokens: data.usage?.total_tokens || 0
        }
      };
    });
  }

  async chatWithPDF(pdfData, prompt, config = {}) {
    return this.chat([{ role: "user", content: prompt }], config, pdfData);
  }

  async extractNumbers(pdfData, options = {}) {
    const prompt = `请从以下医学论文中提取结构化数据。

${options.tableType ? `重点关注 ${options.tableType} 类型的表格。` : ""}
${options.fields ? `需要提取的字段：${options.fields.join(", ")}` : ""}

请以 JSON 格式返回提取结果。`;

    if (pdfData && (pdfData.base64 || (pdfData.files && pdfData.files.length))) {
      return this.chatWithPDF(pdfData, prompt, { temperature: 0.3, maxTokens: 8192 });
    }
    return this.chat([{
      role: "user",
      content: `${prompt}\n\n文档内容：\n${pdfData && pdfData.text ? pdfData.text : ""}`
    }], { temperature: 0.3, maxTokens: 8192 });
  }

  async generateSummary(pdfData, options = {}) {
    const language = options.language || "zh";
    const length = options.length || "medium";
    const lengthMap = { short: "200-300 字", medium: "500-800 字", long: "1000-1500 字" };
    const prompt = `请为以下医学论文生成${language === "zh" ? "中文" : "英文"}摘要，长度约 ${lengthMap[length]}。

摘要应包含：研究背景和目的、研究方法、主要发现、结论和意义。`;

    if (pdfData && (pdfData.base64 || (pdfData.files && pdfData.files.length))) {
      return this.chatWithPDF(pdfData, prompt);
    }
    return this.chat([{
      role: "user",
      content: `${prompt}\n\n文档内容：\n${pdfData && pdfData.text ? pdfData.text : ""}`
    }]);
  }
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = DeepSeekProvider;
}
