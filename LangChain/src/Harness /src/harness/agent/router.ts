import type { Message, StreamEvent, AgentContext } from '../../types/index.js';

type IntentType = 'simple' | 'complex' | 'clarification_needed';

interface IntentResult {
  type: IntentType;
  intent: string;
  confidence: number;
  subIntents?: string[];
}

/**
 * 意图路由器
 * 识别用户意图，决定处理方式
 */
export class IntentRouter {
  private intentPatterns: Map<string, RegExp[]> = new Map([
    ['create_note', [/创建.*笔记/, /记.*一下/, /写.*笔记/, /add.*note/i, /create.*note/i]],
    ['search_note', [/找.*笔记/, /查.*笔记/, /搜索.*笔记/, /find.*note/i, /search.*note/i]],
    ['extract_todo', [/提取.*待办/, /获取.*任务/, /extract.*todo/i]],
    ['query_calendar', [/日程/, /安排/, /计划/, /calendar/i, /schedule/i]],
    ['knowledge_search', [/什么是/, /怎么/, /如何/, /解释/, /what is/i, /how to/i]],
  ]);

  /**
   * 分析意图
   */
  async analyze(message: Message): Promise<IntentResult> {
    const content = message.content.toLowerCase();

    // 检查匹配的模式
    for (const [intent, patterns] of this.intentPatterns) {
      for (const pattern of patterns) {
        if (pattern.test(content)) {
          // 判断是简单还是复杂任务
          const type = this.determineComplexity(content);
          
          return {
            type,
            intent,
            confidence: 0.8, // 简单模式匹配的置信度
            subIntents: type === 'complex' ? await this.extractSubIntents(content) : undefined,
          };
        }
      }
    }

    // 没有匹配的模式
    return {
      type: 'clarification_needed',
      intent: 'unknown',
      confidence: 0.3,
    };
  }

  /**
   * 判断任务复杂度
   */
  private determineComplexity(content: string): IntentType {
    // 简单任务的特征
    const simplePatterns = [
      /^找.*笔记/,  // 单一搜索
      /^什么是/,    // 单一问题
      /^日程$/,     // 单一查询
    ];

    for (const pattern of simplePatterns) {
      if (pattern.test(content)) {
        return 'simple';
      }
    }

    // 复杂任务的特征
    const complexPatterns = [
      /和/,        // 多个对象
      /然后/,      // 多步骤
      /之后/,      // 有顺序
      /并且/,      // 并行任务
    ];

    for (const pattern of complexPatterns) {
      if (pattern.test(content)) {
        return 'complex';
      }
    }

    // 默认简单
    return 'simple';
  }

  /**
   * 提取子意图
   */
  private async extractSubIntents(content: string): Promise<string[]> {
    // TODO: 使用 LLM 进行更精确的子任务提取
    const subIntents: string[] = [];
    
    // 简单的关键词分割
    const connectors = ['和', '然后', '之后', '并且'];
    let remaining = content;
    
    for (const connector of connectors) {
      if (remaining.includes(connector)) {
        const [first, second] = remaining.split(connector, 2);
        if (first) subIntents.push(first.trim());
        remaining = second || '';
      }
    }
    
    if (remaining) {
      subIntents.push(remaining.trim());
    }

    return subIntents.length > 1 ? subIntents : [content];
  }

  /**
   * 路由到合适的处理器
   */
  async *route(message: Message, context: AgentContext): AsyncGenerator<StreamEvent> {
    const result = await this.analyze(message);

    yield {
      type: 'thought',
      content: `Detected intent: ${result.intent} (confidence: ${result.confidence})`,
    };

    switch (result.type) {
      case 'simple':
        // 直接执行单一 Tool
        yield {
          type: 'state_change',
          state: 'EXECUTING',
        };
        break;

      case 'complex':
        // 进入 Planning 状态
        yield {
          type: 'state_change',
          state: 'PLANNING',
        };
        break;

      case 'clarification_needed':
        // 需要用户澄清
        yield {
          type: 'message',
          role: 'assistant',
          content: '我不太确定你的意思，能否详细描述一下你想要做什么？',
        };
        yield {
          type: 'state_change',
          state: 'WAITING_HUMAN',
        };
        break;
    }
  }
}

export default IntentRouter;
