import { BaseSkill } from './base.js';
import type { SkillDefinition, SkillContext } from '../../types/index.js';

/**
 * Skills 注册中心
 * 管理所有可用的 Skills
 */
export class SkillRegistry {
  private skills: Map<string, BaseSkill> = new Map();
  private activeSkills: Set<string> = new Set();

  /**
   * 注册 Skill
   */
  register(skill: BaseSkill): void {
    if (this.skills.has(skill.name)) {
      throw new Error(`Skill "${skill.name}" is already registered`);
    }
    this.skills.set(skill.name, skill);
    console.log(`[SkillRegistry] Registered skill: ${skill.name}`);
  }

  /**
   * 批量注册 Skills
   */
  registerAll(skills: BaseSkill[]): void {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  /**
   * 获取 Skill
   */
  get(name: string): BaseSkill | undefined {
    return this.skills.get(name);
  }

  /**
   * 检查 Skill 是否存在
   */
  has(name: string): boolean {
    return this.skills.has(name);
  }

  /**
   * 列出所有 Skills
   */
  list(): string[] {
    return Array.from(this.skills.keys());
  }

  /**
   * 列出激活的 Skills
   */
  listActive(): string[] {
    return Array.from(this.activeSkills);
  }

  /**
   * 获取所有定义
   */
  getDefinitions(): SkillDefinition[] {
    return Array.from(this.skills.values()).map(skill => skill.toDefinition());
  }

  /**
   * 激活 Skill
   */
  activate(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) {
      return false;
    }
    skill.activate();
    this.activeSkills.add(name);
    return true;
  }

  /**
   * 暂停 Skill
   */
  suspend(name: string): boolean {
    const skill = this.skills.get(name);
    if (!skill) {
      return false;
    }
    skill.suspend();
    this.activeSkills.delete(name);
    return true;
  }

  /**
   * 匹配意图和内容，返回激活的 Skills
   */
  match(intent: string, content: string): BaseSkill[] {
    const matched: BaseSkill[] = [];
    
    for (const skill of this.skills.values()) {
      if (skill.state === 'ACTIVE' && skill.match(intent, content)) {
        matched.push(skill);
      }
    }
    
    // 按优先级排序
    matched.sort((a, b) => b.priority - a.priority);
    return matched;
  }

  /**
   * 执行匹配的 Skills 规则
   */
  async executeMatchedSkills(context: SkillContext, intent: string, content: string): Promise<void> {
    const matched = this.match(intent, content);
    
    for (const skill of matched) {
      const rules = await skill.evaluateRules(context);
      await skill.executeRules(rules, context);
    }
  }

  /**
   * 移除 Skill
   */
  unregister(name: string): boolean {
    if (!this.skills.has(name)) {
      return false;
    }
    this.skills.delete(name);
    this.activeSkills.delete(name);
    return true;
  }

  /**
   * 清空所有
   */
  clear(): void {
    this.skills.clear();
    this.activeSkills.clear();
  }
}

// 全局单例
export const skillRegistry = new SkillRegistry();

export default SkillRegistry;
