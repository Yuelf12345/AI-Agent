import type { SkillDefinition, SkillState, SkillTrigger, SkillRule, SkillContext } from '../../types/index.js';

/**
 * Skill 基类
 * 所有内置 Skills 需要继承此类
 */
export abstract class BaseSkill {
  abstract name: string;
  abstract description: string;
  abstract domain: string;
  abstract triggers: SkillTrigger[];
  abstract rules: SkillRule[];
  abstract tools: string[];
  
  priority: number = 10;
  state: SkillState = 'REGISTERED';

  /**
   * 检查是否应该触发此 Skill
   */
  match(intent: string, content: string): boolean {
    // 检查意图匹配
    if (this.triggers.intent?.length && this.triggers.intent.includes(intent)) {
      return true;
    }
    
    // 检查关键词匹配
    if (this.triggers.keywords?.length) {
      for (const keyword of this.triggers.keywords) {
        if (content.toLowerCase().includes(keyword.toLowerCase())) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * 评估规则条件
   */
  async evaluateRules(context: SkillContext): Promise<SkillRule[]> {
    const matchedRules: SkillRule[] = [];
    
    for (const rule of this.rules) {
      try {
        let matched = false;
        
        if (typeof rule.condition === 'string') {
          // 简单字符串条件评估（可扩展为表达式引擎）
          matched = this.evaluateStringCondition(rule.condition, context);
        } else if (rule.condition instanceof RegExp) {
          // 正则匹配
          const content = context.note?.content || context.message?.content || '';
          matched = rule.condition.test(content);
        } else if (typeof rule.condition === 'function') {
          // 函数条件
          matched = await rule.condition(context);
        }
        
        if (matched) {
          matchedRules.push(rule);
        }
      } catch (error) {
        console.error(`[Skill] Rule evaluation error in ${this.name}:`, error);
      }
    }
    
    return matchedRules;
  }

  /**
   * 执行规则动作
   */
  async executeRules(rules: SkillRule[], context: SkillContext): Promise<void> {
    for (const rule of rules) {
      try {
        if (typeof rule.action === 'string') {
          // 字符串动作（可扩展为动作解释器）
          console.log(`[Skill] Executing action: ${rule.action}`);
        } else if (typeof rule.action === 'function') {
          await rule.action(context);
        }
      } catch (error) {
        console.error(`[Skill] Rule execution error in ${this.name}:`, error);
      }
    }
  }

  /**
   * 简单字符串条件评估
   */
  private evaluateStringCondition(condition: string, context: SkillContext): boolean {
    // 简单的包含检查
    const content = context.note?.content || context.message?.content || '';
    return content.includes(condition);
  }

  /**
   * 激活 Skill
   */
  activate(): void {
    this.state = 'ACTIVE';
  }

  /**
   * 暂停 Skill
   */
  suspend(): void {
    this.state = 'SUSPENDED';
  }

  /**
   * 废弃 Skill
   */
  deprecate(): void {
    this.state = 'DEPRECATED';
  }

  /**
   * 转换为定义格式
   */
  toDefinition(): SkillDefinition {
    return {
      name: this.name,
      description: this.description,
      domain: this.domain,
      triggers: this.triggers,
      rules: this.rules,
      tools: this.tools,
      priority: this.priority,
      state: this.state,
    };
  }
}

export type { SkillDefinition, SkillState, SkillTrigger, SkillRule, SkillContext };
