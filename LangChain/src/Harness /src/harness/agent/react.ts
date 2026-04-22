import type { AgentContext, StreamEvent, ToolResult } from '../../types/index.js';
import { toolRegistry } from '../tool/index.js';
import { skillRegistry } from '../skills/index.js';

/**
 * ReAct 循环实现
 * Reasoning -> Acting -> Observing 循环
 */
export class ReActLoop {
  private maxIterations: number;
  private currentIteration: number = 0;

  constructor(maxIterations: number = 10) {
    this.maxIterations = maxIterations;
  }

  /**
   * 执行 ReAct 循环
   */
  async *run(context: AgentContext): AsyncGenerator<StreamEvent> {
    this.currentIteration = 0;

    while (this.currentIteration < this.maxIterations) {
      this.currentIteration++;

      // 1. Reasoning - 分析当前状态，决定下一步
      yield* this.reason(context);

      // 2. Acting - 执行动作（调用 Tool）
      const shouldContinue = yield* this.act(context);
      
      // 3. Observing - 观察结果，决定是否继续
      if (!shouldContinue) {
        break;
      }
    }

    if (this.currentIteration >= this.maxIterations) {
      yield {
        type: 'error',
        code: 'MAX_ITERATIONS',
        message: 'Maximum iterations reached',
      };
    }
  }

  /**
   * Reasoning 阶段
   */
  private async *reason(context: AgentContext): AsyncGenerator<StreamEvent> {
    yield {
      type: 'thought',
      content: `Analyzing request (iteration ${this.currentIteration})...`,
    };

    // TODO: 调用 LLM 进行推理
    // 这里需要集成 LangChain.js 的 LLM 调用
  }

  /**
   * Acting 阶段
   */
  private async *act(context: AgentContext): AsyncGenerator<StreamEvent> {
    // TODO: 根据 LLM 输出选择要执行的 Tool
    // 当前是占位实现
    
    // 如果有要执行的 Tool
    // yield* this.executeTool(toolName, params, context);
    
    return true; // 是否继续循环
  }

  /**
   * 执行单个 Tool
   */
  async *executeTool(
    toolName: string,
    params: Record<string, unknown>,
    context: AgentContext
  ): AsyncGenerator<StreamEvent> {
    yield {
      type: 'tool_call',
      tool: toolName,
      parameters: params,
    };

    // 执行 Tool 前应用 Skills 规则
    await skillRegistry.executeMatchedSkills(
      context,
      '', // intent
      JSON.stringify(params)
    );

    // 执行 Tool
    const result = await toolRegistry.execute(toolName, params);
    context.toolResults.push(result);

    yield {
      type: 'tool_result',
      tool: toolName,
      result: result.success ? result.data : result.error,
    };

    if (!result.success) {
      yield {
        type: 'error',
        code: 'TOOL_FAILED',
        message: result.error || 'Tool execution failed',
      };
    }
  }

  /**
   * 重置循环状态
   */
  reset(): void {
    this.currentIteration = 0;
  }
}

export default ReActLoop;
