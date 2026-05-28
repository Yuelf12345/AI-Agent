import { BaseAgent } from "./baseAgent.ts";
import { AgentState } from "../../types/index.ts";
import { BaseMessage, SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { llmService } from "../../services/llm.ts";
import {
  ReActAgentSchema,
  getReActAgentJsonSchema,
  parseReActAgentOutput,
} from "../output/schemas.ts";
import { RegexFallbackParser } from "../output/parser.ts";

/**
 * ReAct Agent - 实现 ReAct (Reasoning + Acting) 循环
 *
 * 设计理念：
 * 1. 迭代式推理：Thought → Action → Observation → Thought → ...
 * 2. 每次迭代都有明确的思考过程
 * 3. 可以处理复杂的多步骤任务
 * 4. 支持最多 N 次迭代防止无限循环
 *
 * 使用结构化输出：优先使用 OpenAI response_format，
 * 失败时降级到正则解析
 *
 * ReAct 循环流程：
 * 1. Thought: 分析当前状态，决定下一步
 * 2. Action: 选择并执行工具
 * 3. Observation: 观察工具返回结果
 * 4. 如果需要更多步骤，回到 1
 * 5. 最终给出答案
 */
export class ReActAgent extends BaseAgent {
  private maxIterations: number;
  private currentIteration: number;

  constructor(options?: { maxIterations?: number }) {
    super({
      id: "react-agent",
      name: "ReActAgent",
      toolNames: ["read_file", "write_file", "file_edit", "bash", "search"],
      systemPrompt: `你是知识管理助手，使用 ReAct (Reasoning + Acting) 模式来解决问题。

工作方式：
1. 思考当前情况 (Thought)
2. 决定需要执行的行动 (Action)
3. 观察行动结果 (Observation)
4. 根据结果继续推理或给出最终答案

可用工具：
${"TODO: will be dynamically injected"}

输出格式（严格 JSON）：
{
  "thought": "你对当前情况的分析",
  "action": "工具名称（如果需要执行工具，否则为 'finish'）",
  "actionParams": {工具参数对象，如果 action 是 'finish' 则为空对象},
  "response": "给用户的最终回复（仅当 action 为 'finish' 时需要）"
}

注意：
- 只有在确实需要获取信息或执行操作时才使用工具
- 简单问答可以直接 finish
- 每次迭代都要有清晰的 thought
- 如果超过最大迭代次数，必须给出答案`
    });

    this.maxIterations = options?.maxIterations || 5;
    this.currentIteration = 0;
  }

  async execute(input: string): Promise<any> {
    this.setState(AgentState.RUNNING);
    this.currentIteration = 0;

    // 构建系统提示
    const systemContent = this.systemPrompt.replace(
      "TODO: will be dynamically injected",
      this.getToolDescriptions()
    );

    // ReAct 循环历史
    const reactHistory: Array<{
      thought: string;
      action: string;
      actionParams?: Record<string, any>;
      observation?: string;
      response?: string;
    }> = [];

    // 初始消息
    let messages: Array<{ role: string; content: string }> = [
      { role: "system", content: systemContent },
      { role: "user", content: input }
    ];

    try {
      while (this.currentIteration < this.maxIterations) {
        this.currentIteration++;
        console.log(`[ReActAgent] 迭代 ${this.currentIteration}/${this.maxIterations}`);

        // 调用 LLM 获取下一步行动（结构化输出）
        let content: string;
        try {
          content = await llmService.structuredChat(messages, {
            jsonSchema: getReActAgentJsonSchema(),
            structured: true,
          });
        } catch (error) {
          console.warn("[ReActAgent] 结构化输出失败，降级到普通调用:", error);
          content = await llmService.chat(messages);
        }

        // 解析结果（优先结构化，降级正则）
        let parsed;
        try {
          parsed = parseReActAgentOutput(JSON.parse(content));
        } catch {
          console.warn("[ReActAgent] 结构化解析失败，使用正则降级");
          parsed = RegexFallbackParser.parseReActAgentFallback(content);
        }

        console.log(`[ReActAgent] Thought: ${parsed.thought}`);
        console.log(`[ReActAgent] Action: ${parsed.action}`);

        // 记录到历史
        const historyItem: any = {
          thought: parsed.thought,
          action: parsed.action,
        };

        // 检查是否完成
        if (parsed.action === "finish" || parsed.action === "FINISH") {
          this.setState(AgentState.COMPLETED);

          const finalResponse = parsed.response || "任务完成";
          console.log(`[ReActAgent] 完成: ${finalResponse}`);

          return {
            type: "react_completed",
            iterations: this.currentIteration,
            history: reactHistory,
            finalResponse: finalResponse
          };
        }

        // 执行工具
        if (parsed.action && parsed.actionParams) {
          console.log(`[ReActAgent] 执行工具: ${parsed.action}`);
          console.log(`[ReActAgent] 工具参数:`, parsed.actionParams);

          try {
            const toolResult = await this.callTool(parsed.action, parsed.actionParams);
            console.log(`[ReActAgent] 工具结果:`, toolResult);

            // 记录观察结果
            historyItem.actionParams = parsed.actionParams;
            historyItem.observation = toolResult;
            reactHistory.push(historyItem);

            // 将工具结果添加到消息历史
            messages = [
              ...messages,
              { role: "assistant", content: content },
              { role: "user", content: `Observation: ${toolResult}` }
            ];

          } catch (error) {
            console.error(`[ReActAgent] 工具执行失败:`, error);
            historyItem.observation = `工具执行失败: ${(error as Error).message}`;
            reactHistory.push(historyItem);

            // 继续循环，让 LLM 处理错误
            messages = [
              ...messages,
              { role: "assistant", content: content },
              { role: "user", content: `Observation: 工具执行失败 - ${(error as Error).message}` }
            ];
          }
        } else {
          // 没有有效的 action，继续循环
          console.log(`[ReActAgent] 无效的 action，继续循环`);
          messages = [
            ...messages,
            { role: "assistant", content: content }
          ];
        }
      }

      // 达到最大迭代次数
      console.log(`[ReActAgent] 达到最大迭代次数 ${this.maxIterations}`);
      this.setState(AgentState.COMPLETED);

      return {
        type: "react_max_iterations",
        iterations: this.currentIteration,
        history: reactHistory,
        finalResponse: "已达到最大迭代次数，请检查任务或增加迭代限制"
      };

    } catch (error) {
      await this.handleError(error as Error);
      throw error;
    }
  }

  /**
   * 重置迭代计数器
   */
  reset(): void {
    this.currentIteration = 0;
    this.setState(AgentState.IDLE);
  }

  /**
   * 设置最大迭代次数
   */
  setMaxIterations(max: number): void {
    this.maxIterations = max;
  }
}