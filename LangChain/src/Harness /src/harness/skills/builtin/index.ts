import { BaseSkill } from '../base.js';
import type { SkillContext } from '../../../types/index.js';

/**
 * 笔记管理技能
 * 处理笔记的创建、搜索、更新等操作
 */
export class NoteManagementSkill extends BaseSkill {
  name = 'note_management';
  description = 'Note management skill - handles create, search, and update operations';
  domain = 'knowledge';
  triggers = {
    intent: ['create_note', 'search_note', 'update_note', 'delete_note'],
    keywords: ['笔记', 'note', '记录', '记一下', '找笔记', '查找笔记'],
  };
  rules = [
    {
      name: 'auto_tag_meeting',
      condition: (ctx: SkillContext) => {
        const content = ctx.note?.content || ctx.message?.content || '';
        return /会议|meeting|周会|月会|例会/.test(content);
      },
      action: async (ctx: SkillContext) => {
        if (ctx.note) {
          ctx.note.tags = ctx.note.tags || [];
          if (!ctx.note.tags.includes('meeting')) {
            ctx.note.tags.push('meeting');
          }
        }
        console.log('[Skill] Auto-tagged as meeting');
      },
      priority: 10,
    },
    {
      name: 'auto_tag_important',
      condition: (ctx: SkillContext) => {
        const content = ctx.note?.content || ctx.message?.content || '';
        return /重要|important|紧急|urgent|关键|key/.test(content);
      },
      action: async (ctx: SkillContext) => {
        if (ctx.note) {
          ctx.note.tags = ctx.note.tags || [];
          if (!ctx.note.tags.includes('important')) {
            ctx.note.tags.push('important');
          }
        }
        console.log('[Skill] Auto-tagged as important');
      },
      priority: 15,
    },
  ];
  tools = ['note_create', 'note_search', 'note_get'];
  priority = 10;
}

/**
 * 待办提取技能
 * 从文本中自动提取待办事项
 */
export class TaskExtractionSkill extends BaseSkill {
  name = 'task_extraction';
  description = 'Task extraction skill - extracts todo items from text';
  domain = 'productivity';
  triggers = {
    intent: ['extract_todo', 'create_task'],
    keywords: ['待办', 'todo', '任务', '需要做', '别忘了', '提醒我'],
  };
  rules = [
    {
      name: 'detect_priority_keywords',
      condition: (ctx: SkillContext) => {
        const content = ctx.message?.content || '';
        return /紧急|urgent|重要|important|尽快|asap/i.test(content);
      },
      action: async (ctx: SkillContext) => {
        console.log('[Skill] Detected high priority task');
        // 可以设置 context 中的优先级信息
      },
      priority: 20,
    },
  ];
  tools = ['todo_extract'];
  priority = 15;
}

/**
 * 日程查询技能
 * 处理日历和日程相关的查询
 */
export class CalendarQuerySkill extends BaseSkill {
  name = 'calendar_query';
  description = 'Calendar query skill - handles schedule and event queries';
  domain = 'calendar';
  triggers = {
    intent: ['query_calendar', 'check_schedule'],
    keywords: ['日程', 'calendar', '安排', '计划', '明天', '下周', '什么安排', '有什么事'],
  };
  rules = [];
  tools = ['calendar_query'];
  priority = 12;
}

/**
 * 知识检索技能
 * 从知识库中检索相关信息
 */
export class KnowledgeSearchSkill extends BaseSkill {
  name = 'knowledge_search';
  description = 'Knowledge search skill - retrieves information from knowledge base';
  domain = 'knowledge';
  triggers = {
    intent: ['search_knowledge', 'explain_concept'],
    keywords: ['什么是', '解释', 'how to', '怎么', '如何', '查一下', '找一下'],
  };
  rules = [
    {
      name: 'suggest_web_search',
      condition: (ctx: SkillContext) => {
        const content = ctx.message?.content || '';
        // 如果本地知识库没有答案，建议网络搜索
        return content.includes('网络') || content.includes('网上');
      },
      action: async (ctx: SkillContext) => {
        console.log('[Skill] Suggesting web search as fallback');
      },
      priority: 5,
    },
  ];
  tools = ['note_search', 'web_search'];
  priority = 8;
}

// 导出所有内置 Skills
export const builtinSkills: BaseSkill[] = [
  new NoteManagementSkill(),
  new TaskExtractionSkill(),
  new CalendarQuerySkill(),
  new KnowledgeSearchSkill(),
];
