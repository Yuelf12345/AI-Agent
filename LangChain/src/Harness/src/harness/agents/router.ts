import { llmService } from "../../services/llm.ts";
import { type RouterResult } from "../../types/index.ts";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";

/**
 * Router组件
 * 职责:分析用户输入,判断任务类型(simple/complex)
 */
export class Router {
  private llm: any;
  
  private systemPrompt = `你是一个任务分类器。分析用户输入,判断任务类型。

判断标准:
- SIMPLE:单步操作,可直接调用一个工具完成(如:查询时间、读取文件)
- COMPLEX:需要多个步骤,涉及多个工具或Agent协作(如:整理笔记并提取待办)

请严格按照以下JSON格式返回,不要包含其他内容:
{
  "taskType": "simple" 或 "complex",
  "reasoning": "判断理由",
  "targetAgent": "目标Agent名称(仅simple时需要)",
  "confidence": 0到1之间的数字
}`;

  constructor() {
    this.llm = llmService.getModel();
  }

  /**
   * 路由决策
   * @param input 用户输入
   * @returns RouterResult 路由结果
   */
  async route(input: string): Promise<RouterResult> {
    const messages = [
      new SystemMessage(this.systemPrompt),
      new HumanMessage(`用户输入:${input}`)
    ];

    const response = await this.llm.invoke(messages);
    const content = typeof response.content === 'string' 
      ? response.content 
      : JSON.stringify(response.content);

    // 解析LLM返回的JSON
    const result = this.parseResult(content);
    return result;
  }

  /**
   * 解析LLM返回结果
   */
  private parseResult(content: string): RouterResult {
    try {
      // 提取JSON部分(处理LLM可能返回的markdown格式)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("无法解析LLM返回结果");
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        taskType: parsed.taskType,
        reasoning: parsed.reasoning || '',
        targetAgent: parsed.targetAgent,
        confidence: parsed.confidence || 0.5
      };
    } catch (error) {
      // 解析失败,默认返回complex
      return {
        taskType: 'complex',
        reasoning: '无法解析任务类型,默认按复杂任务处理',
        confidence: 0.5
      };
    }
  }
}