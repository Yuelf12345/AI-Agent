import { llmService } from "../../services/llm.ts";
import { ToolRegistry, toolRegistry } from "../tools/registry.ts";
import { AgentState, type AgentConfig} from "../../types/index.ts";
import { SystemMessage } from "@langchain/core/messages";

/**
 * Agent基类
 * 所有Agent的抽象基类，提供统一的接口和扩展能力
 */
abstract class BaseAgent {
  protected id: string;
  protected name: string;
  protected state: AgentState;
  protected registry: ToolRegistry;
  protected llm: any;
  protected logger: Console;
  protected systemPrompt: string;

  constructor(config: AgentConfig) {
    this.id = config.id;
    this.name = config.name;
    this.state = AgentState.IDLE;
    this.registry = new ToolRegistry();
    this.logger = console;
    this.llm = config.llm || llmService.getModel();
    this.systemPrompt = config.systemPrompt || '';

    // 从全局registry复制指定工具
    config.toolNames?.forEach((name: string) => {
      const tool = toolRegistry.get(name);
      if (tool) {
        this.registry.register(tool);
      }
    });
  }

  /**
   * 执行入口（子类必须实现）
   */
  abstract execute(input: any): Promise<any>;

  /**
   * 状态管理
   */
  setState(state: AgentState): void {
    this.logger.debug(`[${this.name}] State: ${this.state} → ${state}`);
    this.state = state;
  }

  getState(): AgentState {
    return this.state;
  }

  /**
   * 错误处理（子类可重写）
   */
  async handleError(error: Error): Promise<void> {
    this.setState(AgentState.ERROR);
    this.logger.error(`[${this.name}] Error:`, error.message);
    // 默认错误处理逻辑
  }

  /**
   * 调用工具
   */
  protected async callTool(toolName: string, params: any): Promise<string> {
    return await this.registry.invoke({ name: toolName, args: params });
  }

  /**
   * 获取可用工具列表
   */
  getAvailableTools(): string[] {
    return this.registry.list();
  }

  /**
   * 获取工具描述（用于LLM提示）
   */
  getToolDescriptions(): string {
    return this.registry.getDescriptions();
  }

  /**
   * LLM调用
   */
  protected async callLLM(prompt: string): Promise<string> {
    const response = await this.llm.invoke(prompt);
    return response.content || response;
  }

  /**
   * 获取系统消息
   */
  getSystemMessage(): SystemMessage {
    return new SystemMessage(this.systemPrompt);
  }

  /**
   * 设置系统提示
   */
  setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt;
  }

  /**
   * 获取Agent信息
   */
  getInfo(): { id: string; name: string; state: AgentState; tools: string[] } {
    return {
      id: this.id,
      name: this.name,
      state: this.state,
      tools: this.getAvailableTools(),
    };
  }
}

export { BaseAgent };
