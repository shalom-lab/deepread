/**
 * BaseAIProvider - 通用大模型适配器基类
 * 采用 Provider Pattern 设计，便于未来扩展 DeepSeek、Claude 等模型
 */
var BaseAIProvider = class BaseAIProvider {
  constructor(config = {}) {
    this.config = {
      apiKey: config.apiKey || "",
      model: config.model || "",
      temperature: config.temperature || 0.7,
      maxTokens: config.maxTokens || 4096,
      ...config
    };
  }

  /**
   * 处理连续对话
   * @param {Array} history - 对话历史 [{role: 'user', content: '...'}, ...]
   * @param {Object} config - 额外配置参数
   * @param {Object} pdfData - {base64: string, mimeType: string} (可选)
   * @returns {Promise<Object>} {content: string, usage: {...}}
   */
  async chat(history, config = {}, pdfData = null) {
    throw new Error("chat() method must be implemented by subclass");
  }

  /**
   * 针对医学论文表格的结构化提取
   * @param {Object} pdfData - PDF 数据对象 {base64: string, text: string}
   * @param {Object} options - 提取选项
   * @returns {Promise<Object>} 结构化数据
   */
  async extractNumbers(pdfData, options = {}) {
    throw new Error("extractNumbers() method must be implemented by subclass");
  }

  /**
   * 验证配置是否完整
   * @returns {boolean}
   */
  validateConfig() {
    if (!this.config.apiKey) {
      throw new Error("API Key is required");
    }
    return true;
  }

  /**
   * 处理错误响应
   * @param {Response} response - Fetch 响应对象
   * @returns {Promise<Object>}
   */
  async handleError(response) {
    const errorText = await response.text();
    let errorData;
    try {
      errorData = JSON.parse(errorText);
    } catch (e) {
      errorData = { message: errorText };
    }
    throw new Error(`API Error (${response.status}): ${errorData.message || errorText}`);
  }

  /**
   * 限流保护 - RPM (每分钟请求数) 控制
   * @param {Function} fn - 要执行的函数
   * @param {number} maxRequests - 最大请求数
   * @param {number} windowMs - 时间窗口（毫秒）
   */
  createRateLimiter(maxRequests = 60, windowMs = 60000) {
    const requests = [];
    return async (fn) => {
      const now = Date.now();
      // 清理过期请求记录
      while (requests.length > 0 && requests[0] < now - windowMs) {
        requests.shift();
      }
      // 检查是否超过限制
      if (requests.length >= maxRequests) {
        const waitTime = requests[0] + windowMs - now;
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      requests.push(Date.now());
      return fn();
    };
  }
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = BaseAIProvider;
}

