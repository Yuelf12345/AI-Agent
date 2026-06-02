/**
 * BaseSkill — 技能基类
 *
 * 设计理念（来自 PRD §3.3）：
 *   Skills 是一组预定义的行为模式，用于指导 Agent 在特定场景下的行为。
 *   每个 Skill 有明确的生命周期：REGISTERED → ACTIVE → SUSPENDED → DEPRECATED
 *
 * 核心职责：
 *   1. 定义触发条件（intent + keywords）
 *   2. 定义行为规则（前置检查 + 后置处理）
 *   3. 关联 Tools（告诉 Agent 可以用哪些工具）
 *   4. 提供领域专属的 System Prompt 增强
 *
 * 子类只需实现：
 *   - getSystemPrompt()  — 返回该技能的专属提示词
 *   - onActivate()       — 激活时的初始化逻辑（可选）
 *   - onDeactivate()     — 停用时的清理逻辑（可选）
 *
 * 使用方式：
 *   class NoteSkill extends BaseSkill {
 *     constructor() {
 *       super({
 *         name: "note_management",
 *         description: "笔记管理技能",
 *         domain: "knowledge",
 *         triggers: [{ keywords: ["笔记", "note"] }],
 *         tools: ["read_file", "write_file"],
 *         priority: 10,
 *       });
 *     }
 *     getSystemPrompt(): string { return "..."; }
 *   }
 */

import type {
  SkillState,
  SkillTrigger,
  SkillRule,
  SkillContext,
  SkillDefinition,
} from "../../types/index.ts";

/**
 * Skill 构造配置
 */
export interface SkillConfig {
  name: string;
  description: string;
  domain: string;
  triggers: SkillTrigger[];
  rules?: SkillRule[];
  tools: string[];
  priority: number;
}

/**
 * Skill 匹配结果
 */
export interface SkillMatchResult {
  matched: boolean;
  matchedTriggers: SkillTrigger[];
  matchedKeywords: string[];
  confidence: number; // 0-1
}

/**
 * Skill 执行结果
 */
export interface SkillExecutionResult {
  skillName: string;
  rulesApplied: string[];
  rulesSkipped: string[];
  systemPrompt: string;
  availableTools: string[];
}

/**
 * BaseSkill — 技能基类
 */
export abstract class BaseSkill {
  readonly name: string;
  readonly description: string;
  readonly domain: string;
  readonly triggers: SkillTrigger[];
  readonly rules: SkillRule[];
  readonly tools: string[];
  readonly priority: number;

  private _state: SkillState = "REGISTERED";
  private _activatedAt: number | null = null;
  private _usageCount: number = 0;

  constructor(config: SkillConfig) {
    this.name = config.name;
    this.description = config.description;
    this.domain = config.domain;
    this.triggers = config.triggers;
    this.rules = config.rules ?? [];
    this.tools = config.tools;
    this.priority = config.priority;
  }

  // ==================== 生命周期管理 ====================

  /** 获取当前状态 */
  get state(): SkillState {
    return this._state;
  }

  /** 获取激活时间 */
  get activatedAt(): number | null {
    return this._activatedAt;
  }

  /** 获取使用次数 */
  get usageCount(): number {
    return this._usageCount;
  }

  /**
   * 激活技能
   *
   * REGISTERED → ACTIVE
   * SUSPENDED  → ACTIVE
   */
  async activate(): Promise<void> {
    if (this._state === "DEPRECATED") {
      throw new Error(`Skill "${this.name}" 已废弃，无法激活`);
    }

    this._state = "ACTIVE";
    this._activatedAt = Date.now();
    await this.onActivate();
    console.log(`[Skill:${this.name}] 已激活`);
  }

  /**
   * 暂停技能
   *
   * ACTIVE → SUSPENDED
   */
  async suspend(reason?: string): Promise<void> {
    if (this._state !== "ACTIVE") {
      throw new Error(`Skill "${this.name}" 当前状态为 ${this._state}，无法暂停`);
    }

    this._state = "SUSPENDED";
    await this.onSuspend(reason);
    console.log(`[Skill:${this.name}] 已暂停${reason ? `: ${reason}` : ""}`);
  }

  /**
   * 废弃技能
   *
   * ANY → DEPRECATED（不可逆）
   */
  async deprecate(): Promise<void> {
    this._state = "DEPRECATED";
    await this.onDeactivate();
    console.log(`[Skill:${this.name}] 已废弃`);
  }

  /**
   * 记录一次使用
   */
  recordUsage(): void {
    this._usageCount++;
  }

  // ==================== 触发匹配 ====================

  /**
   * 检测输入是否匹配该技能
   *
   * 匹配策略：
   *   1. 关键词匹配（keywords）— 输入文本中包含任一关键词
   *   2. 意图匹配（intent）— 由外部 Intent Router 传入
   *
   * @param input 用户输入文本
   * @param intent 外部识别的意图（可选）
   * @returns 匹配结果
   */
  match(input: string, intent?: string): SkillMatchResult {
    if (this._state === "DEPRECATED" || this._state === "SUSPENDED") {
      return { matched: false, matchedTriggers: [], matchedKeywords: [], confidence: 0 };
    }

    const matchedTriggers: SkillTrigger[] = [];
    const matchedKeywords: string[] = [];
    let maxConfidence = 0;

    for (const trigger of this.triggers) {
      let triggerMatched = false;

      // 1. 关键词匹配
      if (trigger.keywords?.length) {
        const inputLower = input.toLowerCase();
        for (const kw of trigger.keywords) {
          if (inputLower.includes(kw.toLowerCase())) {
            matchedKeywords.push(kw);
            triggerMatched = true;
          }
        }
      }

      // 2. 意图匹配
      if (intent && trigger.intent?.length) {
        if (trigger.intent.includes(intent)) {
          triggerMatched = true;
          maxConfidence = Math.max(maxConfidence, 0.9);
        }
      }

      if (triggerMatched) {
        matchedTriggers.push(trigger);
        // 关键词命中数量越多，置信度越高
        const keywordConfidence = Math.min(
          matchedKeywords.length * 0.3,
          0.8,
        );
        maxConfidence = Math.max(maxConfidence, keywordConfidence);
      }
    }

    return {
      matched: matchedTriggers.length > 0,
      matchedTriggers,
      matchedKeywords,
      confidence: maxConfidence,
    };
  }

  // ==================== 规则执行 ====================

  /**
   * 执行前置规则（Pre-Rules）
   *
   * 在 Agent 执行前，检查并应用所有匹配的规则。
   * 返回被触发的规则名称列表。
   */
  async executePreRules(context: SkillContext): Promise<{
    applied: string[];
    skipped: string[];
  }> {
    const applied: string[] = [];
    const skipped: string[] = [];

    // 按优先级排序
    const sortedRules = [...this.rules].sort(
      (a, b) => (b.priority ?? 0) - (a.priority ?? 0),
    );

    for (const rule of sortedRules) {
      const conditionMet = this.evaluateCondition(rule.condition, context);

      if (conditionMet) {
        await this.executeRuleAction(rule, context);
        applied.push(rule.name);
      } else {
        skipped.push(rule.name);
      }
    }

    return { applied, skipped };
  }

  /**
   * 执行后置规则（Post-Rules）
   *
   * 在 Agent 执行后，对结果进行后处理。
   */
  async executePostRules(
    context: SkillContext,
    result: unknown,
  ): Promise<void> {
    // 后置规则目前通过 context 中的 result 字段传递
    context["result"] = result;
    await this.executePreRules(context); // 复用规则评估逻辑
  }

  /**
   * 评估规则条件
   */
  private evaluateCondition(
    condition: SkillRule["condition"],
    context: SkillContext,
  ): boolean {
    if (typeof condition === "function") {
      return condition(context);
    }

    if (condition instanceof RegExp) {
      // 对 context 中的文本字段做正则匹配
      const textFields = [
        context.message?.content ?? "",
        context.note?.content ?? "",
      ].join(" ");
      return condition.test(textFields);
    }

    // 字符串条件：简易 DSL 解析
    // 支持 "note.content contains 'xxx'" 格式
    if (typeof condition === "string") {
      return this.evaluateStringCondition(condition, context);
    }

    return false;
  }

  /**
   * 简易字符串条件解析器
   *
   * 支持格式：
   *   "field contains 'value'"
   *   "field.length > N"
   *   "always"
   */
  private evaluateStringCondition(
    condition: string,
    context: SkillContext,
  ): boolean {
    const trimmed = condition.trim();

    // always = 永远为真
    if (trimmed === "always") return true;

    // contains 模式
    const containsMatch = trimmed.match(
      /^(\w+(?:\.\w+)*)\s+contains\s+'([^']*)'$/,
    );
    if (containsMatch) {
      const fieldPath = containsMatch[1]!;
      const value = containsMatch[2]!;
      const fieldValue = this.resolveFieldPath(fieldPath, context);
      if (typeof fieldValue === "string") {
        return fieldValue.includes(value);
      }
    }

    // length > N 模式
    const lengthMatch = trimmed.match(
      /^(\w+(?:\.\w+)*)\.length\s*>\s*(\d+)$/,
    );
    if (lengthMatch) {
      const fieldPath = lengthMatch[1]!;
      const threshold = lengthMatch[2]!;
      const fieldValue = this.resolveFieldPath(fieldPath, context);
      if (typeof fieldValue === "string") {
        return fieldValue.length > parseInt(threshold, 10);
      }
    }

    return false;
  }

  /**
   * 解析字段路径（如 "note.content"）
   */
  private resolveFieldPath(path: string, context: SkillContext): unknown {
    const parts = path.split(".");
    let current: unknown = context;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      current = (current as Record<string, unknown>)[part];
    }

    return current;
  }

  /**
   * 执行规则动作
   */
  private async executeRuleAction(
    rule: SkillRule,
    context: SkillContext,
  ): Promise<void> {
    if (typeof rule.action === "function") {
      await rule.action(context);
      console.log(`[Skill:${this.name}] 规则 "${rule.name}" 已执行`);
    } else if (typeof rule.action === "string") {
      // 字符串动作：记录日志（后续可扩展为 DSL 执行器）
      console.log(
        `[Skill:${this.name}] 规则 "${rule.name}" 触发: ${rule.action}`,
      );
    }
  }

  // ==================== 子类必须实现 ====================

  /**
   * 返回该技能的专属 System Prompt
   *
   * Agent 激活该技能后，会将此 Prompt 注入到自己的 System Message 中，
   * 从而获得该领域的专业知识和行为约束。
   */
  abstract getSystemPrompt(): string;

  // ==================== 子类可选覆写 ====================

  /** 激活时的初始化逻辑 */
  protected async onActivate(): Promise<void> {}

  /** 暂停时的清理逻辑 */
  protected async onSuspend(_reason?: string): Promise<void> {}

  /** 废弃时的清理逻辑 */
  protected async onDeactivate(): Promise<void> {}

  // ==================== 工具方法 ====================

  /**
   * 导出为 SkillDefinition（兼容 types/index.ts 的接口）
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
      state: this._state,
    };
  }

  /**
   * 生成技能的摘要信息
   */
  getSummary(): string {
    return [
      `[${this.name}] ${this.description}`,
      `  状态: ${this._state}`,
      `  领域: ${this.domain}`,
      `  优先级: ${this.priority}`,
      `  关联工具: ${this.tools.join(", ")}`,
      `  触发词: ${this.triggers.flatMap((t) => t.keywords ?? []).join(", ")}`,
      `  规则数: ${this.rules.length}`,
      `  使用次数: ${this._usageCount}`,
    ].join("\n");
  }
}
