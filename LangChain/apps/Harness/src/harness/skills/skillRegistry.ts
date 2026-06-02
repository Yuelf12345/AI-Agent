/**
 * SkillRegistry — 技能注册中心
 *
 * 核心职责：
 *   1. 技能注册 / 注销 / 查询
 *   2. 输入匹配 — 根据用户输入自动匹配最合适的技能
 *   3. 技能激活 — 匹配后自动激活，注入 Prompt 和规则
 *   4. 冲突解决 — 多技能匹配时按优先级 + 置信度排序
 *   5. 规则引擎 — 执行前置/后置规则
 *
 * 使用方式：
 *   import { skillRegistry } from "./skillRegistry.ts";
 *
 *   // 注册技能
 *   skillRegistry.register(new NoteManagementSkill());
 *
 *   // 匹配技能
 *   const matches = skillRegistry.matchSkills("帮我记一下今天的会议内容");
 *   // => [{ skill: NoteSkill, confidence: 0.6, matchedKeywords: ["笔记", "记"] }]
 *
 *   // 激活并获取增强上下文
 *   const ctx = await skillRegistry.activateBest("帮我记一下会议内容");
 *   // => { systemPrompt: "...", tools: ["read_file", "write_file"], rulesApplied: [...] }
 */

import { BaseSkill, type SkillMatchResult, type SkillExecutionResult } from "./baseSkill.ts";
import type { SkillContext, SkillDefinition } from "../../types/index.ts";

/**
 * 技能匹配条目
 */
export interface SkillMatchEntry {
  skill: BaseSkill;
  matchResult: SkillMatchResult;
}

/**
 * 技能激活结果
 */
export interface SkillActivationResult {
  activatedSkills: SkillExecutionResult[];
  combinedPrompt: string;
  combinedTools: string[];
  matchedDefinitions: SkillDefinition[];
}

/**
 * SkillRegistry — 技能注册中心
 */
export class SkillRegistry {
  private skills: Map<string, BaseSkill> = new Map();
  private activationHistory: Array<{
    skillName: string;
    input: string;
    timestamp: number;
  }> = [];

  // ==================== 注册管理 ====================

  /**
   * 注册技能
   *
   * 注册后技能处于 REGISTERED 状态，需要显式激活或自动匹配后激活。
   */
  register(skill: BaseSkill): void {
    if (this.skills.has(skill.name)) {
      console.warn(`[SkillRegistry] 技能 "${skill.name}" 已存在，将被覆盖`);
    }
    this.skills.set(skill.name, skill);
    console.log(`[SkillRegistry] 已注册: ${skill.name} (${skill.domain})`);
  }

  /**
   * 批量注册
   */
  registerAll(skills: BaseSkill[]): void {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  /**
   * 注销技能
   */
  async unregister(name: string): Promise<void> {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`技能 "${name}" 不存在`);
    }
    await skill.deprecate();
    this.skills.delete(name);
    console.log(`[SkillRegistry] 已注销: ${name}`);
  }

  /**
   * 获取技能实例
   */
  get(name: string): BaseSkill | undefined {
    return this.skills.get(name);
  }

  /**
   * 获取所有已注册的技能
   */
  getAll(): BaseSkill[] {
    return Array.from(this.skills.values());
  }

  /**
   * 按领域过滤
   */
  getByDomain(domain: string): BaseSkill[] {
    return this.getAll().filter((s) => s.domain === domain);
  }

  /**
   * 列出所有技能名
   */
  list(): string[] {
    return Array.from(this.skills.keys());
  }

  /**
   * 获取技能数量
   */
  get size(): number {
    return this.skills.size;
  }

  // ==================== 技能匹配 ====================

  /**
   * 匹配技能 — 根据用户输入找到最合适的技能
   *
   * 匹配流程：
   *   1. 遍历所有非 DEPRECATED 技能
   *   2. 对每个技能调用 match()
   *   3. 按 confidence × priority 综合排序
   *   4. 返回所有匹配结果
   *
   * @param input 用户输入
   * @param intent 外部意图（可选）
   * @param topK 返回前 K 个匹配（默认 3）
   */
  matchSkills(input: string, intent?: string, topK: number = 3): SkillMatchEntry[] {
    const matches: SkillMatchEntry[] = [];

    for (const skill of this.skills.values()) {
      if (skill.state === "DEPRECATED") continue;

      const result = skill.match(input, intent);
      if (result.matched) {
        matches.push({ skill, matchResult: result });
      }
    }

    // 综合排序：confidence × priority
    matches.sort((a, b) => {
      const scoreA = a.matchResult.confidence * (a.skill.priority / 10);
      const scoreB = b.matchResult.confidence * (b.skill.priority / 10);
      return scoreB - scoreA;
    });

    return matches.slice(0, topK);
  }

  /**
   * 获取最佳匹配技能
   */
  matchBest(input: string, intent?: string): SkillMatchEntry | null {
    const matches = this.matchSkills(input, intent, 1);
    return matches.length > 0 ? matches[0] : null;
  }

  // ==================== 技能激活 ====================

  /**
   * 激活最佳匹配技能
   *
   * 完整流程：
   *   1. 匹配技能
   *   2. 激活匹配到的技能（如果尚未激活）
   *   3. 执行前置规则
   *   4. 收集 System Prompt 和 Tools
   *   5. 返回增强上下文
   *
   * @param input 用户输入
   * @param context 当前上下文
   * @param intent 外部意图（可选）
   */
  async activateBest(
    input: string,
    context?: SkillContext,
    intent?: string,
  ): Promise<SkillActivationResult | null> {
    const matches = this.matchSkills(input, intent);

    if (matches.length === 0) {
      console.log("[SkillRegistry] 未匹配到任何技能");
      return null;
    }

    const activatedSkills: SkillExecutionResult[] = [];
    const allPrompts: string[] = [];
    const allTools: Set<string> = new Set();
    const definitions: SkillDefinition[] = [];

    for (const { skill, matchResult } of matches) {
      // 1. 激活技能（如果尚未激活）
      if (skill.state !== "ACTIVE") {
        await skill.activate();
      }

      // 2. 执行前置规则
      const ruleCtx: SkillContext = context ?? { message: { id: "", role: "user", content: input, timestamp: new Date() } };
      const { applied, skipped } = await skill.executePreRules(ruleCtx);

      // 3. 收集 Prompt 和 Tools
      const prompt = skill.getSystemPrompt();
      allPrompts.push(`## ${skill.name} (${skill.description})\n${prompt}`);

      for (const tool of skill.tools) {
        allTools.add(tool);
      }

      // 4. 记录使用
      skill.recordUsage();

      // 5. 记录激活历史
      this.activationHistory.push({
        skillName: skill.name,
        input,
        timestamp: Date.now(),
      });

      activatedSkills.push({
        skillName: skill.name,
        rulesApplied: applied,
        rulesSkipped: skipped,
        systemPrompt: prompt,
        availableTools: skill.tools,
      });

      definitions.push(skill.toDefinition());

      console.log(
        `[SkillRegistry] 激活: ${skill.name} (置信度: ${matchResult.confidence.toFixed(2)}, 关键词: ${matchResult.matchedKeywords.join(", ")})`,
      );
    }

    return {
      activatedSkills,
      combinedPrompt: allPrompts.join("\n\n"),
      combinedTools: Array.from(allTools),
      matchedDefinitions: definitions,
    };
  }

  /**
   * 手动激活指定技能
   */
  async activate(name: string): Promise<void> {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`技能 "${name}" 不存在`);
    }
    await skill.activate();
  }

  /**
   * 手动暂停指定技能
   */
  async suspend(name: string, reason?: string): Promise<void> {
    const skill = this.skills.get(name);
    if (!skill) {
      throw new Error(`技能 "${name}" 不存在`);
    }
    await skill.suspend(reason);
  }

  // ==================== 统计与诊断 ====================

  /**
   * 获取所有技能的摘要
   */
  getSummary(): string {
    if (this.skills.size === 0) {
      return "[SkillRegistry] 暂无已注册技能";
    }

    const lines = [`[SkillRegistry] 共 ${this.skills.size} 个技能：`];
    for (const skill of this.skills.values()) {
      lines.push(skill.getSummary());
      lines.push("");
    }
    return lines.join("\n");
  }

  /**
   * 获取激活历史
   */
  getHistory(limit: number = 20): typeof this.activationHistory {
    return this.activationHistory.slice(-limit);
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    total: number;
    active: number;
    suspended: number;
    deprecated: number;
    registered: number;
    totalActivations: number;
  } {
    const skills = this.getAll();
    return {
      total: skills.length,
      active: skills.filter((s) => s.state === "ACTIVE").length,
      suspended: skills.filter((s) => s.state === "SUSPENDED").length,
      deprecated: skills.filter((s) => s.state === "DEPRECATED").length,
      registered: skills.filter((s) => s.state === "REGISTERED").length,
      totalActivations: this.activationHistory.length,
    };
  }

  /**
   * 导出所有技能定义为 SkillDefinition 数组
   */
  exportDefinitions(): SkillDefinition[] {
    return this.getAll().map((s) => s.toDefinition());
  }

  /**
   * 清空注册中心
   */
  async clear(): Promise<void> {
    for (const skill of this.skills.values()) {
      if (skill.state === "ACTIVE") {
        await skill.suspend("registry_clear");
      }
    }
    this.skills.clear();
    this.activationHistory = [];
    console.log("[SkillRegistry] 已清空");
  }
}

// ==================== 全局单例 ====================

/**
 * 全局技能注册中心
 *
 * 使用方式：
 *   import { skillRegistry } from "./skillRegistry.ts";
 *   skillRegistry.register(new NoteManagementSkill());
 */
export const skillRegistry = new SkillRegistry();
