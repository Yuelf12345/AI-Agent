/**
 * NoteManagementSkill — 笔记管理技能
 *
 * 对应 PRD §3.3.2 中的 note_management
 *
 * 触发场景：
 *   "帮我记一下..."、"创建笔记"、"找笔记"、"更新笔记"、"笔记"、"note"
 *
 * 关联工具：
 *   read_file, write_file, file_edit
 *
 * 行为规则：
 *   1. auto_tag — 如果笔记内容包含"会议"，自动添加 meeting 标签
 *   2. auto_backup — 如果笔记内容超过 1000 字，触发备份提示
 *   3. timestamp — 自动为新建笔记添加时间戳
 */

import { BaseSkill, type SkillConfig } from "../baseSkill.ts";
import type { SkillContext, SkillRule } from "../../../types/index.ts";

/**
 * 笔记管理技能
 */
export class NoteManagementSkill extends BaseSkill {
  constructor() {
    const config: SkillConfig = {
      name: "note_management",
      description: "笔记管理技能 — 创建、搜索、编辑笔记",
      domain: "knowledge",
      triggers: [
        {
          intent: ["create_note", "search_note", "update_note", "delete_note"],
          keywords: ["笔记", "note", "记录", "记一下", "备忘", "memo", "写下来"],
        },
      ],
      rules: NoteManagementSkill.buildRules(),
      tools: ["read_file", "write_file", "file_edit"],
      priority: 10,
    };

    super(config);
  }

  /**
   * 构建行为规则
   */
  private static buildRules(): SkillRule[] {
    return [
      {
        name: "auto_tag_meeting",
        condition: (ctx: SkillContext) => {
          const content =
            ctx.note?.content ?? ctx.message?.content ?? "";
          return content.includes("会议") || content.toLowerCase().includes("meeting");
        },
        action: async (ctx: SkillContext) => {
          // 在 context 中注入标签提示，供 Agent 后续使用
          ctx["suggestedTags"] = ctx["suggestedTags"] ?? [];
          (ctx["suggestedTags"] as string[]).push("meeting");
          console.log("[NoteSkill] 自动标签: meeting");
        },
        priority: 10,
      },
      {
        name: "auto_tag_important",
        condition: (ctx: SkillContext) => {
          const content =
            ctx.note?.content ?? ctx.message?.content ?? "";
          return (
            content.includes("重要") ||
            content.includes("urgent") ||
            content.includes("紧急")
          );
        },
        action: async (ctx: SkillContext) => {
          ctx["suggestedTags"] = ctx["suggestedTags"] ?? [];
          (ctx["suggestedTags"] as string[]).push("important");
          console.log("[NoteSkill] 自动标签: important");
        },
        priority: 8,
      },
      {
        name: "auto_backup_large",
        condition: "note.content.length > 1000",
        action: async (ctx: SkillContext) => {
          ctx["needsBackup"] = true;
          console.log("[NoteSkill] 大笔记检测: 建议自动备份");
        },
        priority: 5,
      },
      {
        name: "auto_timestamp",
        condition: "always",
        action: async (ctx: SkillContext) => {
          ctx["autoTimestamp"] = new Date().toISOString();
          console.log("[NoteSkill] 自动时间戳: " + ctx["autoTimestamp"]);
        },
        priority: 1,
      },
    ];
  }

  /**
   * 笔记管理的专属 System Prompt
   */
  getSystemPrompt(): string {
    return `你是笔记管理专家，遵循以下行为准则：

## 核心能力
- **创建笔记**：将用户内容整理为结构化 Markdown 笔记
- **搜索笔记**：根据关键词或语义搜索已有笔记
- **编辑笔记**：更新已有笔记的内容、标签、元数据

## 行为规范
1. 创建笔记时，自动生成标题、时间戳、标签
2. 笔记格式统一使用 Markdown，包含 frontmatter 元数据
3. 搜索时先尝试精确匹配，再降级到模糊匹配
4. 编辑时保留原始内容的版本历史

## 笔记模板
\`\`\`markdown
---
title: {标题}
created: {ISO时间}
tags: [{标签}]
---

{正文内容}
\`\`\`

## 注意事项
- 敏感内容不要写入文件
- 超过 1000 字的笔记建议提醒用户备份
- 如果内容涉及会议，自动添加 meeting 标签`;
  }

  /**
   * 激活时初始化
   */
  protected async onActivate(): Promise<void> {
    console.log("[NoteSkill] 笔记管理技能已就绪");
  }
}
