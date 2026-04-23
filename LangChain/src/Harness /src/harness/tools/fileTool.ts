import { z } from "zod";
import { BaseTool } from "./baseTool.ts";
import * as fs from "fs/promises";
import * as path from "path";
import { execSync } from "child_process";

// ==================== 安全路径校验 ====================
const DEFAULT_WORKDIR = process.cwd();
const DANGEROUS = [
  "rm -rf /",
  "sudo",
  "shutdown",
  "reboot", 
  "> /dev/",
  ">> /dev/",
  "curl",
  "wget",
  "ssh",
  "scp"
];

/**
 * 安全路径校验 - 确保路径不会逃逸出工作目录
 */
function safePath(userPath: string, workdir: string = DEFAULT_WORKDIR): string {
  const resolved = path.resolve(workdir, userPath);
  const normalizedWorkdir = path.resolve(workdir);
  
  if (!resolved.startsWith(normalizedWorkdir + path.sep) && resolved !== normalizedWorkdir) {
    throw new Error(`路径逃逸检测: "${userPath}" 超出工作目录 "${normalizedWorkdir}"`);
  }
  return resolved;
}

/**
 * 禁止访问的敏感路径模式
 */
const FORBIDDEN_PATTERNS = [
  /\.env/i,
  /\.git\//i,
  /node_modules\//i,
  /\.ssh\//i,
  /\.gnupg\//i,
  /credentials/i,
  /secrets?\.json$/i,
  /private.*key/i,
];

function isForbidden(targetPath: string): boolean {
  return FORBIDDEN_PATTERNS.some(pattern => pattern.test(targetPath));
}

// ==================== BashTool ====================
const BashSchema = z.object({
  command: z.string().describe("要执行的shell命令"),
});

export class BashTool extends BaseTool<typeof BashSchema> {
  constructor() {
    super({
      name: "bash",
      description: "执行shell命令",
      schema: BashSchema,
      metadata: {
        category: "system",
        permissions: ["exec"],
        dangerous: true,
        localOnly: true,
      },
    });
  }

  async _call(args: z.infer<typeof BashSchema>): Promise<string> {
    const { command } = args;
    
    // 危险命令检查
    if (DANGEROUS.some(danger => command.includes(danger))) {
      return "Error: 危险命令已被阻止";
    }
    
    try {
      const result = execSync(command, {
        cwd: DEFAULT_WORKDIR,
        encoding: "utf-8",
        timeout: 120000,
      });
      return result.slice(0, 50000) || "(无输出)";
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }
}

// ==================== FileReadTool ====================
const FileReadSchema = z.object({
  filePath: z.string().describe("要读取的文件路径"),
  encoding: z.string().optional().default("utf-8").describe("文件编码"),
  limit: z.number().optional().describe("限制读取的行数"),
});

export class FileReadTool extends BaseTool<typeof FileReadSchema> {
  private workdir: string;

  constructor(workdir: string = DEFAULT_WORKDIR) {
    super({
      name: "read_file",
      description: "读取指定路径的文件内容",
      schema: FileReadSchema,
      metadata: {
        category: "filesystem",
        permissions: ["fs.read"],
        localOnly: true,
      },
    });
    this.workdir = workdir;
  }

  async _call(args: z.infer<typeof FileReadSchema>): Promise<string> {
    const { filePath, encoding, limit } = args;
    
    // 安全校验
    if (isForbidden(filePath)) {
      throw new Error(`禁止访问敏感文件: ${filePath}`);
    }
    const absolutePath = safePath(filePath, this.workdir);
    
    const content = await fs.readFile(absolutePath, { encoding: encoding as BufferEncoding });
    const lines = content.split("\n");
    if (limit && limit < lines.length) {
      return lines
        .slice(0, limit)
        .concat([`... (${lines.length - limit} more lines)`])
        .join("\n")
        .slice(0, 50000);
    }
    return content.slice(0, 50000);
  }
}

// ==================== FileWriteTool ====================
const FileWriteSchema = z.object({
  filePath: z.string().describe("要写入的文件路径"),
  content: z.string().describe("要写入的内容"),
  encoding: z.string().optional().default("utf-8").describe("文件编码"),
  overwrite: z.boolean().optional().default(true).describe("是否覆盖已存在的文件"),
});

export class FileWriteTool extends BaseTool<typeof FileWriteSchema> {
  private workdir: string;

  constructor(workdir: string = DEFAULT_WORKDIR) {
    super({
      name: "write_file",
      description: "将内容写入指定路径的文件",
      schema: FileWriteSchema,
      metadata: {
        category: "filesystem",
        permissions: ["fs.write"],
        dangerous: true,
        localOnly: true,
      },
    });
    this.workdir = workdir;
  }

  async _call(args: z.infer<typeof FileWriteSchema>): Promise<string> {
    const { filePath, content, encoding, overwrite } = args;
    
    // 安全校验
    if (isForbidden(filePath)) {
      throw new Error(`禁止写入敏感文件: ${filePath}`);
    }
    const absolutePath = safePath(filePath, this.workdir);
    
    // 确保目录存在
    const dir = path.dirname(absolutePath);
    await fs.mkdir(dir, { recursive: true });
    
    // 检查文件是否存在
    if (!overwrite) {
      try {
        await fs.access(absolutePath);
        return `Error: 文件已存在: ${absolutePath}`;
      } catch {
        // 文件不存在，可以继续写入
      }
    }
    
    await fs.writeFile(absolutePath, content, { encoding: encoding as BufferEncoding });
    return `成功写入文件: ${absolutePath}`;
  }
}

// ==================== FileEditTool ====================
const FileEditScheam= z.object({
  filePath: z.string().describe("要编辑的文件路径"),
  oldText: z.string().describe("要被替换的旧文本"),
  newText: z.string().describe("替换后的新文本"),
  encoding: z.string().optional().default("utf-8").describe("文件编码"),
});

export class FileEditTool extends BaseTool<typeof FileEditScheam> {
  private workdir: string;

  constructor(workdir: string = DEFAULT_WORKDIR) {
    super({
      name: "edit_file",
      description: "编辑文件内容，将旧文本替换为新文本",
      schema: FileEditScheam,
      metadata: {
        category: "filesystem",
        permissions: ["fs.read", "fs.write"],
        dangerous: true,
        localOnly: true,
      },
    });
    this.workdir = workdir;
  }

  async _call(args: z.infer<typeof FileEditScheam>): Promise<string> {
    const { filePath, oldText, newText, encoding } = args;
    
    // 安全校验
    if (isForbidden(filePath)) {
      throw new Error(`禁止编辑敏感文件: ${filePath}`);
    }
    const absolutePath = safePath(filePath, this.workdir);
    
    const content = await fs.readFile(absolutePath, { encoding: encoding as BufferEncoding });
    if (!content.includes(oldText)) {
      return `Error: 文本未在文件中找到: ${filePath}`;
    }
    const newContent = content.replace(new RegExp(oldText, "g"), newText);
    await fs.writeFile(absolutePath, newContent, { encoding: encoding as BufferEncoding });
    return `成功编辑文件: ${filePath}`;
  }
}

// ==================== FileTool 工具集 ====================
const FileToolSchema = z.object({
  action: z.enum(["bash", "read", "write", "edit", "list", "exists"]).describe("操作类型"),
  filePath: z.string().describe("文件路径"),
  content: z.string().optional().describe("写入内容（write操作需要）"),
  oldText: z.string().optional().describe("要替换的旧文本（edit操作需要）"),
  newText: z.string().optional().describe("替换后的新文本（edit操作需要）"),
});

export class FileTool extends BaseTool<typeof FileToolSchema> {
  private workdir: string;
  private bashTool: BashTool;
  private readFileTool: FileReadTool;
  private writeFileTool: FileWriteTool;
  private editFileTool: FileEditTool;

  constructor(workdir: string = DEFAULT_WORKDIR) {
    super({
      name: "file_tool",
      description: "文件操作工具集，支持读取、写入、列出目录、检查文件存在。所有路径限制在工作目录内。",
      schema: FileToolSchema,
      metadata: {
        category: "filesystem",
        permissions: ["fs.read", "fs.write"],
        dangerous: true,
        localOnly: true,
      },
    });

    this.workdir = workdir;
    this.bashTool = new BashTool();
    this.readFileTool = new FileReadTool(workdir);
    this.writeFileTool = new FileWriteTool(workdir);
    this.editFileTool = new FileEditTool(workdir);
  }

  async _call(args: z.infer<typeof FileToolSchema>): Promise<string> {
    const { action, filePath, content } = args;

    try {
      switch (action) {
        case "bash":
          // 对于 bash 命令，我们使用单独的 BashTool
          return this.bashTool._call({ command: filePath });
        case "read":
          return this.readFileTool._call({ filePath, encoding: "utf-8" });
        case "write":
          if (!content) {
            return "Error: write 操作需要提供 content 参数";
          }
          return this.writeFileTool._call({ filePath, content, encoding: "utf-8", overwrite: true });
        case "edit":
            return this.editFileTool._call({ filePath, oldText: content!, newText: args.newText!, encoding: "utf-8" });
        case "list":
          return this.listDirectory(filePath);
        case "exists":
          return this.checkExists(filePath);
        default:
          return `Error: 未知的操作类型: ${action}`;
      }
    } catch (error: any) {
      return `Error: ${error.message}`;
    }
  }

  private async listDirectory(dirPath: string): Promise<string> {
    // 安全校验
    if (isForbidden(dirPath)) {
      throw new Error(`禁止访问敏感目录: ${dirPath}`);
    }
    const absolutePath = safePath(dirPath, this.workdir);
    
    const files = await fs.readdir(absolutePath, { withFileTypes: true });
    const result = files.map(f => `${f.isDirectory() ? "[DIR]" : "[FILE]"} ${f.name}`);
    return result.join("\n") || "空目录";
  }

  private async checkExists(filePath: string): Promise<string> {
    // 安全校验（存在性检查相对宽松，不检查 forbidden）
    const absolutePath = safePath(filePath, this.workdir);
    
    try {
      const stat = await fs.stat(absolutePath);
      return `存在: ${absolutePath} (${stat.isDirectory() ? "目录" : "文件"})`;
    } catch {
      return `不存在: ${absolutePath}`;
    }
  }

  // 提供访问内部工具的方法
  getFileReadTool(): FileReadTool {
    return this.readFileTool;
  }

  getFileWriteTool(): FileWriteTool {
    return this.writeFileTool;
  }

  getWorkdir(): string {
    return this.workdir;
  }
}
