/**
 * Skills 模块 — 统一导出
 *
 * 支持两种技能定义方式：
 *
 * 1. 代码式（.ts）— 需要自定义运行时逻辑时使用
 *    import { NoteManagementSkill } from "./builtin/noteManagement.ts";
 *
 * 2. 声明式（.skill.md）— 简单的 Prompt + 配置，推荐大多数场景
 *    // skills/builtin/note_management.skill.md
 *    ---
 *    name: note_management
 *    description: 笔记管理技能
 *    triggers: [{ keywords: [笔记, note] }]
 *    tools: [read_file, write_file]
 *    ---
 *    你是笔记管理专家...
 *
 * 使用方式：
 *   import { initializeSkills, initializeSkillsAsync } from "../skills/index.ts";
 *
 *   // 方式 1：仅加载代码式技能（同步）
 *   const registry = initializeSkills();
 *
 *   // 方式 2：加载代码式 + 声明式技能（异步，推荐）
 *   const registry = await initializeSkillsAsync();
 */

// ==================== 基类与注册中心 ====================

export { BaseSkill } from "./baseSkill.ts";
export type { SkillConfig, SkillMatchResult, SkillExecutionResult } from "./baseSkill.ts";

export { SkillRegistry, skillRegistry } from "./skillRegistry.ts";
export type { SkillMatchEntry, SkillActivationResult } from "./skillRegistry.ts";

// ==================== 声明式技能 ====================

export { DeclarativeSkill } from "./declarativeSkill.ts";
export type { SkillFileData } from "./declarativeSkill.ts";

export {
  loadSkillsFromDir,
  loadSkillFile,
  loadAndRegisterSkills,
} from "./skillLoader.ts";

// ==================== 内置代码式技能 ====================

export { NoteManagementSkill } from "./builtin/noteManagement.ts";
export { KnowledgeSearchSkill } from "./builtin/knowledgeSearch.ts";
export { TaskExtractionSkill } from "./builtin/taskExtraction.ts";

// ==================== 便捷初始化函数 ====================

import * as path from "path";
import { skillRegistry } from "./skillRegistry.ts";
import { NoteManagementSkill } from "./builtin/noteManagement.ts";
import { KnowledgeSearchSkill } from "./builtin/knowledgeSearch.ts";
import { TaskExtractionSkill } from "./builtin/taskExtraction.ts";
import { loadAndRegisterSkills } from "./skillLoader.ts";

/**
 * 同步初始化：仅注册代码式内置技能
 *
 * 适用于不需要加载 .skill.md 文件的场景
 */
export function initializeSkills() {
  skillRegistry.registerAll([
    new NoteManagementSkill(),
    new KnowledgeSearchSkill(),
    new TaskExtractionSkill(),
  ]);

  console.log(`[Skills] 已初始化 ${skillRegistry.size} 个代码式技能`);
  return skillRegistry;
}

/**
 * 异步初始化：注册代码式技能 + 扫描 .skill.md 声明式技能（推荐）
 *
 * 自动扫描 skills/builtin/ 目录下的 .skill.md 文件，
 * 解析 frontmatter + Markdown 正文，注册为 DeclarativeSkill。
 *
 * @param skillDirs 额外的技能目录（相对路径），默认扫描 builtin/
 */
export async function initializeSkillsAsync(skillDirs?: string[]) {
  // 1. 注册代码式技能
  initializeSkills();

  // 2. 扫描并注册声明式技能
  const builtinDir = path.join(
    import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
    "builtin",
  );

  const dirsToScan = [builtinDir, ...(skillDirs ?? [])];

  for (const dir of dirsToScan) {
    await loadAndRegisterSkills(dir, skillRegistry);
  }

  console.log(
    `[Skills] 初始化完毕: 共 ${skillRegistry.size} 个技能 (代码式 + 声明式)`,
  );

  return skillRegistry;
}
