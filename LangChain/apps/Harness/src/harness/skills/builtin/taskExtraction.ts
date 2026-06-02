/**
 * TaskExtractionSkill — 待办提取技能
 *
 * 对应 PRD §3.3.2 中的 task_extraction
 *
 * 触发场景：
 *   "提取待办"、"有什么任务"、"todo"、"待办"
 *
 * 关联工具：
 *   read_file, write_file
 *
 * 行为规则：
 *   1. 自动识别文本中的行动项（action items）
 *   2. 为每个待办分配优先级
 *   3. 提取截止日期（如果有）
 */

import { BaseSkill, type SkillConfig } from "../baseSkill.ts";
import type { SkillContext, SkillRule } from "../../../types/index.ts";

/**
 * 待办提取技能
 */
export class TaskExtractionSkill extends BaseSkill {
  constructor() {
    const config: SkillConfig = {
      name: "task_extraction",
      description: "待办提取技能 — 从文本中提取和管理待办事项",
      domain: "productivity",
      triggers: [
        {
          intent: ["extract_todos", "create_task", "list_tasks", "manage_tasks"],
          keywords: [
            "待办",
            "todo",
            "任务",
            "task",
            "提取",
            "行动项",
            "action item",
            "要做",
            "别忘了",
            "提醒我",
          ],
        },
      ],
      rules: TaskExtractionSkill.buildRules(),
      tools: ["read_file", "write_file"],
      priority: 9,
    };

    super(config);
  }

  /**
   * 构建行为规则
   */
  private static buildRules(): SkillRule[] {
    return [
      {
        name: "detect_urgency",
        condition: (ctx: SkillContext) => {
          const content =
            ctx.message?.content ?? ctx.note?.content ?? "";
          const urgentKeywords = ["紧急", "urgent", "马上", "立刻", "尽快", "今天", "ASAP"];
          return urgentKeywords.some((kw) =>
            content.toLowerCase().includes(kw.toLowerCase()),
          );
        },
        action: async (ctx: SkillContext) => {
          ctx["defaultPriority"] = "high";
          console.log("[TaskSkill] 检测到紧急关键词，默认优先级: high");
        },
        priority: 10,
      },
      {
        name: "detect_deadline",
        condition: (ctx: SkillContext) => {
          const content =
            ctx.message?.content ?? ctx.note?.content ?? "";
          // 简易日期模式匹配：明天、下周、X月X日
          const datePatterns = [
            /明天/,
            /后天/,
            /下周/,
            /\d{1,2}月\d{1,2}[日号]/,
            /\d{4}[-/]\d{1,2}[-/]\d{1,2}/,
            /today/,
            /tomorrow/,
          ];
          return datePatterns.some((p) => p.test(content));
        },
        action: async (ctx: SkillContext) => {
          ctx["hasDeadline"] = true;
          console.log("[TaskSkill] 检测到截止日期信息");
        },
        priority: 8,
      },
      {
        name: "batch_extraction",
        condition: (ctx: SkillContext) => {
          const content =
            ctx.message?.content ?? ctx.note?.content ?? "";
          // 如果包含多个行动项标记（如编号列表），认为是批量提取
          const listPatterns = /^\s*[\d]+[.、)]/gm;
          const matches = content.match(listPatterns);
          return matches !== null && matches.length >= 2;
        },
        action: async (ctx: SkillContext) => {
          ctx["batchMode"] = true;
          console.log("[TaskSkill] 批量模式: 检测到多个待办项");
        },
        priority: 5,
      },
    ];
  }

  /**
   * 待办提取的专属 System Prompt
   */
  getSystemPrompt(): string {
    return `你是待办事项管理专家，遵循以下行为准则：

## 核心能力
- **提取待办**：从对话、笔记、会议记录中自动识别行动项
- **结构化整理**：将提取的待办整理为标准格式
- **优先级评估**：根据紧急程度和重要性分配优先级
- **截止日期识别**：自动识别文本中提到的时间信息

## 行为规范
1. 每个待办必须包含：描述、优先级、来源
2. 优先级分三级：high（紧急重要）、medium（重要不紧急）、low（日常）
3. 如果检测到截止日期，必须标注
4. 批量提取时，按优先级排序输出

## 待办输出格式
\`\`\`json
{
  "todos": [
    {
      "id": "todo-1",
      "content": "具体任务描述",
      "priority": "high|medium|low",
      "deadline": "2024-01-15 或 null",
      "source": "来源（如：会议记录）",
      "status": "todo"
    }
  ]
}
\`\`\`

## 注意事项
- 区分"讨论过的内容"和"真正需要行动的待办"
- 模糊的行动项要主动确认
- 如果文本中没有明确的待办，告知用户`;
  }

  protected async onActivate(): Promise<void> {
    console.log("[TaskSkill] 待办提取技能已就绪");
  }
}
