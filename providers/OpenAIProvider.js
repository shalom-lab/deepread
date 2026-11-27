/**
 * OpenAIProvider - OpenAI Chat Completions（含 PDF file 输入）
 */
var OpenAIProvider = class OpenAIProvider extends BaseAIProvider {
  constructor(config = {}) {
    super(config);
    this.supportsToolImages = true;
    this.baseURL = (config.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "");
    this.rateLimiter = this.createRateLimiter(60, 60000);
  }

  _headers() {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.config.apiKey}`
    };
  }

  _filePartsFromPdfData(pdfData) {
    const parts = [];
    if (!pdfData) return parts;
    const files = (pdfData.files && pdfData.files.length)
      ? pdfData.files
      : (pdfData.base64 ? [{ base64: pdfData.base64, mimeType: pdfData.mimeType || "application/pdf" }] : []);

    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (!f || !f.base64) continue;
      const mime = f.mimeType || "application/pdf";
      // Chat Completions 官方文件输入目前以 PDF 为主
      if (mime !== "application/pdf" && !String(mime).includes("pdf")) {
        continue;
      }
      const filename = f.filename || `document-${i + 1}.pdf`;
      parts.push({
        type: "file",
        file: {
          filename,
          file_data: `data:application/pdf;base64,${f.base64}`
        }
      });
    }
    return parts;
  }

  _parseToolArgs(raw) {
    if (raw && typeof raw === "object") return raw;
    try { return JSON.parse(raw || "{}"); } catch (e) { return {}; }
  }

  _toMessages(history, pdfData) {
    const firstUserIndex = history.findIndex(msg => msg.role === "user");
    const fileParts = this._filePartsFromPdfData(pdfData);

    return history.map((msg, index) => {
      if (msg.role === "tool") {
        return {
          role: "tool",
          tool_call_id: msg.toolCallId || "call",
          content: msg.content || ""
        };
      }
      if (msg.role === "assistant" && msg.toolCalls && msg.toolCalls.length) {
        return {
          role: "assistant",
          content: msg.content || null,
          tool_calls: msg.toolCalls.map(c => ({
            id: c.id,
            type: "function",
            function: {
              name: c.name,
              arguments: typeof c.arguments === "string" ? c.arguments : JSON.stringify(c.arguments || {})
            }
          }))
        };
      }
      const role = msg.role === "assistant" ? "assistant" : (msg.role === "system" ? "system" : "user");
      const media = role === "user" && index === firstUserIndex ? [...fileParts] : [];
      for (const image of this._toolImages(msg)) {
        media.push({ type: "image_url", image_url: { url: "data:" + image.mimeType + ";base64," + image.data } });
      }
      if (media.length) {
        return {
          role,
          content: [
            ...media,
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
    const model = mergedConfig.model || "gpt-6.1-sol";
    const url = `${this.baseURL}/chat/completions`;

    // 新模型（如 GPT-6.x）用 max_completion_tokens；温度不在设置里暴露，避免部分模型 400
    const payload = {
      model,
      messages: this._toMessages(history, pdfData),
      max_completion_tokens: mergedConfig.maxTokens || 4096
    };
    if (mergedConfig.tools && mergedConfig.tools.length) {
      payload.tools = mergedConfig.tools.map(t => ({
        type: "function",
        function: {
          name: t.name,
          description: String(t.description || "").slice(0, 1024),
          parameters: t.inputSchema || { type: "object", properties: {} }
        }
      }));
      // gpt-6.1 在 chat/completions 里带工具时，默认 reasoning 会被拒。显式关掉。
      payload.reasoning_effort = "none";
    }

    return this.rateLimiter(async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        await this.handleError(response);
      }

      const data = await response.json();
      const message = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message
        : {};
      const content = message.content || "";
      const toolCalls = (message.tool_calls || []).map(c => ({
        id: c.id || ("call_" + Date.now()),
        name: c.function && c.function.name,
        arguments: this._parseToolArgs(c.function && c.function.arguments)
      })).filter(c => c.name);

      if (!content && !toolCalls.length) {
        throw new Error("No response from OpenAI API");
      }

      return {
        content: typeof content === "string" ? content : JSON.stringify(content),
        toolCalls,
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
  module.exports = OpenAIProvider;
}
