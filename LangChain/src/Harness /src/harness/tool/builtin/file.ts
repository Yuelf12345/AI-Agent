import { BaseTool } from '../base.js';
import { promises as fs } from 'fs';
import path from 'path';
import type { ToolResult } from '../../../types/index.js';

/**
 * 文件读取 Tool
 */
export class FileReadTool extends BaseTool {
  name = 'file_read';
  description = 'Read content from a local file';
  parameters = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'The absolute or relative path to the file to read',
      },
    },
    required: ['path'],
  };
  permissions = ['read:files'];
  localOnly = true;

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const filePath = params.path as string;
    if (!filePath) {
      return this.error('Path parameter is required');
    }

    try {
      const content = await fs.readFile(filePath, 'utf-8');
      return this.success({ path: filePath, content });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return this.error(`Failed to read file: ${message}`);
    }
  }
}

/**
 * 文件写入 Tool
 */
export class FileWriteTool extends BaseTool {
  name = 'file_write';
  description = 'Write content to a local file';
  parameters = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'The absolute or relative path to the file to write',
      },
      content: {
        type: 'string',
        description: 'The content to write to the file',
      },
    },
    required: ['path', 'content'],
  };
  permissions = ['write:files'];
  localOnly = true;

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const filePath = params.path as string;
    const content = params.content as string;

    if (!filePath) {
      return this.error('Path parameter is required');
    }
    if (content === undefined) {
      return this.error('Content parameter is required');
    }

    try {
      // 确保目录存在
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(filePath, content, 'utf-8');
      return this.success({ path: filePath, written: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return this.error(`Failed to write file: ${message}`);
    }
  }
}

/**
 * 文件列表 Tool
 */
export class FileListTool extends BaseTool {
  name = 'file_list';
  description = 'List files in a directory';
  parameters = {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'The directory path to list',
      },
      recursive: {
        type: 'boolean',
        description: 'Whether to list recursively',
      },
    },
    required: ['path'],
  };
  permissions = ['read:files'];
  localOnly = true;

  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const dirPath = params.path as string;
    const recursive = params.recursive === true;

    if (!dirPath) {
      return this.error('Path parameter is required');
    }

    try {
      const files = await this.listDirectory(dirPath, recursive);
      return this.success({ path: dirPath, files });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return this.error(`Failed to list directory: ${message}`);
    }
  }

  private async listDirectory(dirPath: string, recursive: boolean): Promise<string[]> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory() && recursive) {
        const subFiles = await this.listDirectory(fullPath, recursive);
        files.push(...subFiles);
      } else {
        files.push(fullPath);
      }
    }

    return files;
  }
}

// 导出所有内置文件 Tools
export const fileTools = [new FileReadTool(), new FileWriteTool(), new FileListTool()];
