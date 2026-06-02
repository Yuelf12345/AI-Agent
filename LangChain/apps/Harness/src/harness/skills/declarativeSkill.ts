/**
 * DeclarativeSkill — 声明式技能（从 .skill.md 文件加载）
 *
 * 设计理念：
 *   市面上主流框架（CrewAI、Dify、CodeFlicker）都采用声明式配置定义 Skill。
 *   一个 .skill.md 文件 = 一个完整的技能定义：
 *
 *   ```markdown
 *   ---
 *   name: note_management
 *   description: 笔记管理技能
 *   domain: knowledge
 *   priority: 10
 *   triggers:
 *     - keywords: [笔记, note, 记录]
 *       intent: [create_note, search_note]
 *   tools: [read_file, write_file]
 *   rules:
 *     - name: auto_tag
 *       condition: "message.content contains '会议'"
 *       action: "add_tag('meeting')"
 *       priority: 10
 *   ---
 *
 *   # System Prompt（Markdown 正文即为 Prompt）
 *   你是笔记管理专家...
 *   ```
 *
 * 优势：
 *   - 非开发者也能编写和修改
 *   - Git diff 友好
 *   - 无需重启即可热重载
 *   - Prompt 直接写在 Markdown 中，直观清晰
 */

import { BaseSkill, type SkillConfig } from "./baseSkill.ts";
import type { SkillTrigger, SkillRule } from "../../types/index.ts";

/**
 * .skill.md 文件解析后的原始结构
 */
export interface SkillFileData {
  /** YAML frontmatter 解析结果 */
  frontmatter: {
    name: string;
    description: string;
    domain: string;
    priority: number;
    triggers: Array<{
      keywords?: string[];
      intent?: string[];
    }>;
    tools: string[];
    rules?: Array<{
      name: string;
      condition: string;
      action: string;
      priority?: number;
    }>;
  };
  /** Markdown 正文（即 System Prompt） */
  body: string;
  /** 源文件路径 */
  filePath: string;
}

/**
 * DeclarativeSkill — 声明式技能
 *
 * 从 .skill.md 文件解析构造，Markdown 正文作为 System Prompt。
 * 与代码式 BaseSkill 子类共享相同的匹配、规则、生命周期机制。
 */
export class DeclarativeSkill extends BaseSkill {
  private readonly _prompt: string;
  readonly filePath: string;

  constructor(data: SkillFileData) {
    const config: SkillConfig = {
      name: data.frontmatter.name,
      description: data.frontmatter.description,
      domain: data.frontmatter.domain,
      triggers: (data.frontmatter.triggers ?? []) as SkillTrigger[],
      tools: data.frontmatter.tools ?? [],
      priority: data.frontmatter.priority ?? 5,
      rules: DeclarativeSkill.buildRulesFromStrings(
        data.frontmatter.rules ?? [],
      ),
    };

    super(config);
    this._prompt = data.body;
    this.filePath = data.filePath;
  }

  /**
   * 返回 Markdown 正文作为 System Prompt
   */
  getSystemPrompt(): string {
    return this._prompt;
  }

  /**
   * 将字符串格式的 rules 转为 SkillRule 对象
   *
   * .skill.md 中 rules 的 condition 和 action 都是字符串，
   * 这里直接保留字符串格式，由 BaseSkill 的 evaluateCondition 处理。
   */
  private static buildRulesFromStrings(
    rules: Array<{
      name: string;
      condition: string;
      action: string;
      priority?: number;
    }>,
  ): SkillRule[] {
    return rules.map((r) => ({
      name: r.name,
      condition: r.condition,
      action: r.action,
      priority: r.priority,
    }));
  }

  /**
   * 覆写摘要，增加文件路径信息
   */
  override getSummary(): string {
    return [
      super.getSummary(),
      `  来源: ${this.filePath}`,
      `  类型: 声明式 (.skill.md)`,
    ].join("\n");
  }
}
