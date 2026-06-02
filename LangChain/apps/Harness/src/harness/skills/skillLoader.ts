/**
 * SkillLoader — .skill.md 文件加载器
 *
 * 职责：
 *   1. 扫描指定目录，找到所有 .skill.md 文件
 *   2. 解析 YAML frontmatter + Markdown 正文
 *   3. 构造 DeclarativeSkill 实例
 *   4. 注册到 SkillRegistry
 *
 * 使用方式：
 *   import { loadSkillsFromDir } from "./skillLoader.ts";
 *   import { skillRegistry } from "./skillRegistry.ts";
 *
 *   const skills = await loadSkillsFromDir("./builtin");
 *   skillRegistry.registerAll(skills);
 *
 * .skill.md 文件格式：
 *   ```markdown
 *   ---
 *   name: my_skill
 *   description: 我的技能
 *   domain: general
 *   priority: 5
 *   triggers:
 *     - keywords: [关键词1, 关键词2]
 *       intent: [intent_1]
 *   tools: [tool_1, tool_2]
 *   rules:
 *     - name: my_rule
 *       condition: "always"
 *       action: "do_something()"
 *       priority: 1
 *   ---
 *
 *   # System Prompt 正文（Markdown）
 *   你是一个...
 *   ```
 */

import * as fs from "fs/promises";
import * as path from "path";
import { DeclarativeSkill, type SkillFileData } from "./declarativeSkill.ts";

// ==================== YAML 简易解析器 ====================

/**
 * 简易 YAML 解析器（仅支持 .skill.md 所需的子集）
 *
 * 支持：
 *   - 顶层键值对（string, number）
 *   - 数组（- item 格式）
 *   - 嵌套对象列表（- key: value）
 *   - 内联数组 [a, b, c]
 *
 * 不支持：
 *   - 复杂嵌套
 *   - 多行字符串
 *   - 引用和锚点
 */
function parseSimpleYaml(yamlText: string): Record<string, any> {
  const result: Record<string, any> = {};
  const lines = yamlText.split("\n");
  let currentKey = "";
  let currentArray: any[] = [];
  let currentItem: Record<string, any> | null = null;
  let inArray = false;
  let inArrayItem = false;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // 跳过空行和注释
    if (!line.trim() || line.trim().startsWith("#")) {
      // 如果在数组项内部，空行属于该项
      if (inArrayItem && currentItem) {
        continue;
      }
      continue;
    }

    // 顶层键值对（无缩进）
    if (!line.startsWith(" ") && !line.startsWith("-")) {
      // 先保存之前的数组
      if (inArray && currentKey) {
        if (currentItem && Object.keys(currentItem).length > 0) {
          currentArray.push(currentItem);
          currentItem = null;
        }
        result[currentKey] = currentArray;
        inArray = false;
        inArrayItem = false;
      }

      const colonIdx = line.indexOf(":");
      if (colonIdx === -1) continue;

      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();

      if (value === "" || value === undefined) {
        // 值是后续行的数组或嵌套结构
        currentKey = key;
        currentArray = [];
        inArray = true;
        inArrayItem = false;
      } else {
        currentKey = key;
        result[key] = parseYamlValue(value);
        inArray = false;
      }
      continue;
    }

    // 数组项开始（  - xxx）
    if (line.trimStart().startsWith("- ")) {
      const content = line.trimStart().slice(2).trim();

      if (inArrayItem && currentItem && Object.keys(currentItem).length > 0) {
        currentArray.push(currentItem);
      }

      // 检查是 "  - key: value" 还是 "  - simple_value"
      const itemColonIdx = content.indexOf(":");
      if (itemColonIdx !== -1 && !content.startsWith("[") && !content.startsWith('"')) {
        // 对象数组项
        currentItem = {};
        inArrayItem = true;
        const k = content.slice(0, itemColonIdx).trim();
        const v = content.slice(itemColonIdx + 1).trim();
        currentItem[k] = parseYamlValue(v);
      } else {
        // 简单数组项
        currentArray.push(parseYamlValue(content));
        inArrayItem = false;
      }
      continue;
    }

    // 数组项内的子键值对（    key: value）
    if (inArrayItem && currentItem && line.trimStart().startsWith(" ")) {
      const trimmed = line.trim();
      const colonIdx = trimmed.indexOf(":");
      if (colonIdx !== -1) {
        const k = trimmed.slice(0, colonIdx).trim();
        const v = trimmed.slice(colonIdx + 1).trim();
        currentItem[k] = parseYamlValue(v);
      }
    }
  }

  // 收尾：保存最后一个数组
  if (inArray) {
    if (currentItem && Object.keys(currentItem).length > 0) {
      currentArray.push(currentItem);
    }
    result[currentKey] = currentArray;
  }

  return result;
}

/**
 * 解析单个 YAML 值
 */
function parseYamlValue(raw: string): any {
  const trimmed = raw.trim();

  // 内联数组 [a, b, c]
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const inner = trimmed.slice(1, -1);
    return inner
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => parseScalar(s));
  }

  return parseScalar(trimmed);
}

/**
 * 解析标量值
 */
function parseScalar(s: string): string | number | boolean {
  const trimmed = s.trim();

  // 去引号
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  // 布尔值
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;

  // 数字
  if (/^-?\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  if (/^-?\d+\.\d+$/.test(trimmed)) return parseFloat(trimmed);

  return trimmed;
}

// ==================== .skill.md 解析器 ====================

/**
 * 解析 .skill.md 文件内容
 *
 * 格式：YAML frontmatter（--- 包裹）+ Markdown 正文
 */
function parseSkillFile(content: string, filePath: string): SkillFileData {
  // 提取 frontmatter
  const fmRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;
  const match = content.match(fmRegex);

  if (!match) {
    throw new Error(`无法解析 ${filePath}: 缺少 YAML frontmatter（需要 --- 包裹）`);
  }

  const yamlText = match[1]!;
  const body = (match[2] ?? "").trim();
  const frontmatter = parseSimpleYaml(yamlText);

  // 验证必填字段
  if (!frontmatter.name) {
    throw new Error(`${filePath}: frontmatter 缺少 name 字段`);
  }
  if (!frontmatter.description) {
    throw new Error(`${filePath}: frontmatter 缺少 description 字段`);
  }

  return {
    frontmatter: {
      name: frontmatter.name as string,
      description: frontmatter.description as string,
      domain: (frontmatter.domain as string) ?? "general",
      priority: (frontmatter.priority as number) ?? 5,
      triggers: (frontmatter.triggers as any[]) ?? [],
      tools: (frontmatter.tools as string[]) ?? [],
      rules: (frontmatter.rules as any[]) ?? [],
    },
    body,
    filePath,
  };
}

// ==================== 文件扫描与加载 ====================

/**
 * 扫描目录，找到所有 .skill.md 文件并解析为 DeclarativeSkill
 *
 * @param dirPath 要扫描的目录路径
 * @param recursive 是否递归扫描子目录（默认 true）
 * @returns DeclarativeSkill 实例数组
 */
export async function loadSkillsFromDir(
  dirPath: string,
  recursive: boolean = true,
): Promise<DeclarativeSkill[]> {
  const skills: DeclarativeSkill[] = [];

  let entries: import("fs").Dirent[];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (error: any) {
    console.warn(`[SkillLoader] 无法读取目录 ${dirPath}: ${error.message}`);
    return [];
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory() && recursive) {
      const subSkills = await loadSkillsFromDir(fullPath, true);
      skills.push(...subSkills);
    } else if (entry.isFile() && entry.name.endsWith(".skill.md")) {
      try {
        const content = await fs.readFile(fullPath, "utf-8");
        const data = parseSkillFile(content, fullPath);
        const skill = new DeclarativeSkill(data);
        skills.push(skill);
        console.log(
          `[SkillLoader] ✅ 加载: ${data.frontmatter.name} (${fullPath})`,
        );
      } catch (error: any) {
        console.error(
          `[SkillLoader] ❌ 解析失败 ${fullPath}: ${error.message}`,
        );
      }
    }
  }

  return skills;
}

/**
 * 加载单个 .skill.md 文件
 */
export async function loadSkillFile(filePath: string): Promise<DeclarativeSkill> {
  const content = await fs.readFile(filePath, "utf-8");
  const data = parseSkillFile(content, filePath);
  return new DeclarativeSkill(data);
}

/**
 * 加载并注册目录下所有 .skill.md 到 registry
 *
 * 使用方式：
 *   import { loadAndRegisterSkills } from "./skillLoader.ts";
 *   import { skillRegistry } from "./skillRegistry.ts";
 *
 *   await loadAndRegisterSkills("./builtin", skillRegistry);
 */
export async function loadAndRegisterSkills(
  dirPath: string,
  registry: { registerAll: (skills: DeclarativeSkill[]) => void },
  recursive: boolean = true,
): Promise<DeclarativeSkill[]> {
  const skills = await loadSkillsFromDir(dirPath, recursive);
  if (skills.length > 0) {
    registry.registerAll(skills);
    console.log(
      `[SkillLoader] 共加载 ${skills.length} 个声明式技能`,
    );
  }
  return skills;
}
