import { BaseTool } from '../base.js';
import type { Note, ToolResult } from '../../../types/index.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * 笔记搜索 Tool
 */
export class NoteSearchTool extends BaseTool {
  name = 'note_search';
  description = 'Search notes by semantic similarity';
  parameters = {
    type: 'object' as const,
    properties: {
      query: {
        type: 'string',
        description: 'The search query',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by tags',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results',
      },
    },
    required: ['query'],
  };
  permissions = ['read:notes'];
  localOnly = true;

  // TODO: 注入向量检索服务
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const query = params.query as string;
    const tags = params.tags as string[] | undefined;
    const limit = (params.limit as number) || 5;

    if (!query) {
      return this.error('Query parameter is required');
    }

    // TODO: 实现实际的向量检索逻辑
    // 当前返回模拟数据
    return this.success({
      query,
      matches: [],
      message: 'Note search not yet implemented - connect to Chroma',
    });
  }
}

/**
 * 笔记创建 Tool
 */
export class NoteCreateTool extends BaseTool {
  name = 'note_create';
  description = 'Create a new note';
  parameters = {
    type: 'object' as const,
    properties: {
      title: {
        type: 'string',
        description: 'The note title',
      },
      content: {
        type: 'string',
        description: 'The note content in Markdown format',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for the note',
      },
    },
    required: ['title', 'content'],
  };
  permissions = ['write:notes'];
  localOnly = true;

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const title = params.title as string;
    const content = params.content as string;
    const tags = (params.tags as string[]) || [];

    if (!title) {
      return this.error('Title parameter is required');
    }
    if (!content) {
      return this.error('Content parameter is required');
    }

    const note: Note = {
      id: uuidv4(),
      title,
      content,
      tags,
      created_at: new Date(),
      updated_at: new Date(),
    };

    // TODO: 保存到数据库和向量索引
    return this.success({ note_id: note.id, created: true });
  }
}

/**
 * 笔记获取 Tool
 */
export class NoteGetTool extends BaseTool {
  name = 'note_get';
  description = 'Get a specific note by ID';
  parameters = {
    type: 'object' as const,
    properties: {
      note_id: {
        type: 'string',
        description: 'The note ID',
      },
    },
    required: ['note_id'],
  };
  permissions = ['read:notes'];
  localOnly = true;

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const noteId = params.note_id as string;

    if (!noteId) {
      return this.error('note_id parameter is required');
    }

    // TODO: 从数据库获取
    return this.success({ note_id: noteId, note: null, message: 'Note retrieval not yet implemented' });
  }
}

// 导出所有内置笔记 Tools
export const noteTools = [new NoteSearchTool(), new NoteCreateTool(), new NoteGetTool()];
