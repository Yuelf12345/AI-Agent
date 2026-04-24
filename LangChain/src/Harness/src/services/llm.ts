// import { ChatOllama } from '@langchain/ollama';
import { ChatOpenAI } from "@langchain/openai";
import {
  HumanMessage,
  AIMessage,
  SystemMessage,
} from "@langchain/core/messages";
import { config } from "../config/index.ts";

export type LLMProvider = "openai" | "ollama";

/**
 * LLM 服务
 * 统一管理 LLM 调用，支持 Ollama 和 OpenAI
 */
export class LLMService {
  private provider: LLMProvider = "openai";
  // private model: ChatOllama | ChatOpenAI | null = null;
  private model: ChatOpenAI | null = null;

  constructor(provider?: LLMProvider) {
    this.provider = provider || config.llm.provider;
  }

  /**
   * 获取 LLM 实例
   */
  getModel(): ChatOpenAI {
    if (this.model) return this.model;

    // if (this.provider === 'ollama') {
    //   this.model = new ChatOllama({
    //     baseUrl: config.llm.ollama.baseUrl,
    //     model: config.llm.ollama.model,
    //     temperature: 0.7,
    //   });
    // } else {
    //   this.model = new ChatOpenAI({
    //     apiKey: config.llm.openai.apiKey,
    //     model: config.llm.openai.model,
    //     temperature: 0.7,
    //   });
    // }

    this.model = new ChatOpenAI({
      apiKey: config.llm.openai.apiKey,
      model: config.llm.openai.model,
      temperature: 0.7,
    });

    return this.model;
  }

  /**
   * 发送消息并获取响应
   */
  async chat(
    messages: Array<{ role: string; content: string }>,
  ): Promise<string> {
    const model = this.getModel();

    // LangChain 消息格式转换
    const formattedMessages = messages.map((m) => {
      if (m.role === "user" || m.role === "human") {
        return new HumanMessage(m.content);
      } else if (m.role === "system") {
        return new SystemMessage(m.content);
      } else {
        return new AIMessage(m.content);
      }
    });

    const response = await model.invoke(formattedMessages);
    return typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);
  }

  /**
   * 流式响应
   */
  async *streamChat(
    messages: Array<{ role: string; content: string }>,
  ): AsyncGenerator<string> {
    const model = this.getModel();

    // TODO: 实现流式调用
    // const stream = await model.stream(messages);
    // for await (const chunk of stream) {
    //   yield chunk.content;
    // }

    yield "Streaming response (to be implemented)";
  }

  /**
   * 切换 Provider
   */
  switchProvider(provider: LLMProvider): void {
    this.provider = provider;
    this.model = null;
  }

  /**
   * 获取 Embedding 向量
   */
  async getEmbedding(text: string): Promise<number[]> {
    // TODO: 调用 Embedding 模型
    // const embeddings = new OllamaEmbeddings({
    //   baseUrl: config.llm.ollama.baseUrl,
    //   model: config.llm.ollama.embeddingModel,
    // });
    // return await embeddings.embedQuery(text);

    console.log("[LLM] Embedding generation pending:", text.substring(0, 50));
    return new Array(768).fill(0);
  }
}

// 导出单例
export const llmService = new LLMService();
export default LLMService;
