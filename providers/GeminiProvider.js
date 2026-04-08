/**
 * GeminiProvider - Gemini 2.5 Flash 模型实现
 * 解决原生 PDF (Base64) 多模态投喂和长文本/复杂表格解析问题
 */
var GeminiProvider = class GeminiProvider extends BaseAIProvider {
  constructor(config = {}) {
    super(config);
    this.baseURL = "https://generativelanguage.googleapis.com/v1beta";
    this.rateLimiter = this.createRateLimiter(60, 60000); // 60 RPM
    this.chunkSize = 20 * 1024 * 1024; // 20MB 分块大小，避免 Base64 内存溢出
  }

  /**
   * 将 Base64 字符串分块处理，避免内存溢出
   * @param {string} base64 - Base64 编码的 PDF 数据
   * @param {number} chunkSize - 每块大小（字节）
   * @returns {Array<string>} 分块后的 Base64 数组
   */
  chunkBase64(base64, chunkSize = this.chunkSize) {
    const chunks = [];
    const totalLength = base64.length;
    let offset = 0;

    while (offset < totalLength) {
      const chunk = base64.substring(offset, offset + chunkSize);
      chunks.push(chunk);
      offset += chunkSize;
    }

    return chunks;
  }

  /**
   * 处理连续对话
   * @param {Array} history - 对话历史
   * @param {Object} config - 配置参数
   * @param {Object} pdfData - {base64: string, mimeType: string} (可选)
   * @returns {Promise<Object>}
   */
  async chat(history, config = {}, pdfData = null) {
    this.validateConfig();

    const mergedConfig = { ...this.config, ...config };
    const url = `${this.baseURL}/models/${mergedConfig.model || "gemini-3.1-flash-lite-preview"}:generateContent?key=${mergedConfig.apiKey}`;

    // 找到第一个 user 消息的索引
    const firstUserIndex = history.findIndex(msg => msg.role === "user");

    // 转换历史记录格式
    const contents = history.map((msg, index) => {
      const parts = [];

      // 如果传入了 PDF，将它附加在历史的第一个 User 请求中
      // 这是 Gemini 处理带有文档的连续多轮对话的标准做法
      if (pdfData && index === firstUserIndex) {
        if (pdfData.files && pdfData.files.length > 0) {
          for (const file of pdfData.files) {
            if (file.base64) {
              parts.push({
                inlineData: { mimeType: file.mimeType || "application/pdf", data: file.base64 }
              });
            }
          }
        } else if (pdfData.base64) {
          parts.push({
            inlineData: { mimeType: pdfData.mimeType || "application/pdf", data: pdfData.base64 }
          });
        }
      }

      parts.push({ text: msg.content });

      return {
        role: msg.role === "user" ? "user" : "model",
        parts: parts
      };
    });

    const payload = {
      contents: contents,
      generationConfig: {
        temperature: mergedConfig.temperature,
        maxOutputTokens: mergedConfig.maxTokens,
        topP: mergedConfig.topP || 0.95,
        topK: mergedConfig.topK || 40
      }
    };

    return this.rateLimiter(async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        await this.handleError(response);
      }

      const data = await response.json();

      if (!data.candidates || !data.candidates[0]) {
        throw new Error("No response from Gemini API");
      }

      return {
        content: data.candidates[0].content.parts[0].text,
        usage: {
          promptTokens: data.usageMetadata?.promptTokenCount || 0,
          completionTokens: data.usageMetadata?.completionTokenCount || 0,
          totalTokens: data.usageMetadata?.totalTokenCount || 0
        }
      };
    });
  }

  /**
   * 处理原生 PDF 多模态输入（解决 Base64 崩溃问题）
   * @param {Object} pdfData - {base64: string, mimeType: string}
   * @param {string} prompt - 用户提示词
   * @param {Object} config - 配置参数
   * @returns {Promise<Object>}
   */
  async chatWithPDF(pdfData, prompt, config = {}) {
    this.validateConfig();

    const mergedConfig = { ...this.config, ...config };
    const url = `${this.baseURL}/models/${mergedConfig.model || "gemini-1.5-flash"}:generateContent?key=${mergedConfig.apiKey}`;

    // 检查 Base64 大小，如果过大则分块处理
    const base64Length = (pdfData.files && pdfData.files.length > 0)
      ? pdfData.files.reduce((acc, f) => acc + (f.base64 ? f.base64.length : 0), 0)
      : (pdfData.base64 ? pdfData.base64.length : 0);
    const maxSingleRequestSize = 20 * 1024 * 1024; // 20MB

    if (base64Length > maxSingleRequestSize) {
      // 分块处理大文件
      return this.chatWithLargePDF(pdfData, prompt, mergedConfig);
    }

    // 构建组合 parts
    const promptParts = [];
    if (pdfData.files && pdfData.files.length > 0) {
      for (const file of pdfData.files) {
        if (file.base64) {
          promptParts.push({ inlineData: { mimeType: file.mimeType || "application/pdf", data: file.base64 } });
        }
      }
    } else if (pdfData.base64) {
      promptParts.push({ inlineData: { mimeType: pdfData.mimeType || "application/pdf", data: pdfData.base64 } });
    }
    promptParts.push({ text: prompt });

    const payload = {
      contents: [{
        role: "user",
        parts: promptParts
      }],
      generationConfig: {
        temperature: mergedConfig.temperature,
        maxOutputTokens: mergedConfig.maxTokens,
        topP: mergedConfig.topP || 0.95,
        topK: mergedConfig.topK || 40
      }
    };

    return this.rateLimiter(async () => {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        await this.handleError(response);
      }

      const data = await response.json();

      if (!data.candidates || !data.candidates[0]) {
        throw new Error("No response from Gemini API");
      }

      return {
        content: data.candidates[0].content.parts[0].text,
        usage: {
          promptTokens: data.usageMetadata?.promptTokenCount || 0,
          completionTokens: data.usageMetadata?.completionTokenCount || 0,
          totalTokens: data.usageMetadata?.totalTokenCount || 0
        }
      };
    });
  }

  /**
   * 处理超大 PDF 文件（优化策略）
   * 
   * ⚠️ 重要说明：
   * Gemini API 将 PDF 视为一组图像处理。如果分块发送，模型无法建立跨块的上下文联系。
   * 因此，对于超大文件，我们采用以下策略：
   * 1. 优先处理第一块（通常是 PDF 头部和摘要部分）
   * 2. 提示用户使用轻量模式（文本缓存）进行完整分析
   * 3. 未来计划：集成 Google AI Studio File API（支持 2GB）或 PDF 压缩预处理
   * 
   * @param {Object} pdfData - PDF 数据
   * @param {string} prompt - 提示词
   * @param {Object} config - 配置
   * @returns {Promise<Object>}
   */
  async chatWithLargePDF(pdfData, prompt, config) {
    // 对于超大文件，由于 Gemini API 的限制，我们只能处理第一部分
    // 注意：这不是真正的"分块"，而是只处理文件的开头部分
    const mainBase64 = (pdfData.files && pdfData.files.length > 0) ? pdfData.files[0].base64 : pdfData.base64;
    const mainMimeType = (pdfData.files && pdfData.files.length > 0) ? pdfData.files[0].mimeType : pdfData.mimeType;

    if (!mainBase64) throw new Error("PDF data is empty");

    const chunks = this.chunkBase64(mainBase64);

    // 优先处理第一块（通常是 PDF 头部和摘要部分）
    const firstChunk = chunks[0];

    // 构建提示词，明确告知这是部分内容
    const segmentedPrompt = `${prompt}\n\n⚠️ 注意：由于文件过大，当前仅对主文件分析了前半部分（约 ${Math.round((firstChunk.length / mainBase64.length) * 100)}%）。如需完整分析，请尝试压缩 PDF。`;

    try {
      const result = await this.chatWithPDF(
        { base64: firstChunk, mimeType: mainMimeType },
        segmentedPrompt,
        config
      );

      // 添加提示信息
      if (chunks.length > 1) {
        result.content += `\n\n---\n📌 **提示**：文档较大（${chunks.length} 个部分），当前仅分析了第一部分。\n\n**建议**：\n- 使用轻量模式（文本缓存）进行完整分析\n- 或等待 File API 集成（支持 2GB 文件）`;
      }

      return result;
    } catch (error) {
      // 如果处理失败，回退到文本模式提示
      throw new Error(`PDF 处理失败: ${error.message}\n\n建议：使用轻量模式（文本缓存）进行分析，或压缩 PDF 后重试。`);
    }
  }

  /**
   * 针对医学论文表格的结构化提取
   * @param {Object} pdfData - PDF 数据 {base64: string, text: string}
   * @param {Object} options - 提取选项 {tableType: string, fields: []}
   * @returns {Promise<Object>}
   */
  async extractNumbers(pdfData, options = {}) {
    this.validateConfig();

    const prompt = `请从以下医学论文中提取结构化数据。

${options.tableType ? `重点关注 ${options.tableType} 类型的表格。` : ""}
${options.fields ? `需要提取的字段：${options.fields.join(", ")}` : ""}

请以 JSON 格式返回提取结果，包含：
1. 表格标题
2. 列名
3. 数据行（每行作为对象）
4. 统计信息（如 p 值、置信区间等）

如果文档包含 PDF，请直接分析 PDF 中的表格结构，确保数字准确性。`;

    // 优先使用原生 PDF 模式（多模态）
    if (pdfData.base64) {
      return this.chatWithPDF(pdfData, prompt, {
        temperature: 0.3, // 降低温度以提高准确性
        maxTokens: 8192
      });
    }

    // 回退到文本模式
    return this.chat([{
      role: "user",
      content: `${prompt}\n\n文档内容：\n${pdfData.text || ""}`
    }], {
      temperature: 0.3,
      maxTokens: 8192
    });
  }

  /**
   * 生成文献摘要
   * @param {Object} pdfData - PDF 数据
   * @param {Object} options - 选项 {language: 'zh'|'en', length: 'short'|'medium'|'long'}
   * @returns {Promise<Object>}
   */
  async generateSummary(pdfData, options = {}) {
    const language = options.language || "zh";
    const length = options.length || "medium";

    const lengthMap = {
      short: "200-300 字",
      medium: "500-800 字",
      long: "1000-1500 字"
    };

    const prompt = `请为以下医学论文生成${language === "zh" ? "中文" : "英文"}摘要，长度约 ${lengthMap[length]}。

摘要应包含：
1. 研究背景和目的
2. 研究方法
3. 主要发现
4. 结论和意义

请使用专业的医学学术语言，确保准确性。`;

    if (pdfData.base64) {
      return this.chatWithPDF(pdfData, prompt);
    }

    return this.chat([{
      role: "user",
      content: `${prompt}\n\n文档内容：\n${pdfData.text || ""}`
    }]);
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = GeminiProvider;
}

