import { BaseSkill } from './base.js';
import { skillRegistry } from './registry.js';
import type { SkillDefinition } from '../../types/index.js';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Skills 动态加载器
 * 支持从文件系统加载 Skills
 */
export class SkillLoader {
  /**
   * 从目录加载所有 Skills
   */
  async loadFromDirectory(dirPath: string): Promise<BaseSkill[]> {
    const skills: BaseSkill[] = [];
    
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.ts')) {
          const filePath = path.join(dirPath, entry.name);
          const skill = await this.loadFromFile(filePath);
          if (skill) {
            skills.push(skill);
          }
        }
      }
    } catch (error) {
      console.error('[SkillLoader] Failed to load from directory:', error);
    }
    
    return skills;
  }

  /**
   * 从单个文件加载 Skill
   */
  async loadFromFile(filePath: string): Promise<BaseSkill | null> {
    try {
      const module = await import(filePath);
      
      // 查找默认导出的 BaseSkill 实例
      for (const exportValue of Object.values(module)) {
        if (exportValue instanceof BaseSkill) {
          return exportValue;
        }
      }
      
      // 尝试查找类并实例化
      for (const [key, exportValue] of Object.entries(module)) {
        if (typeof exportValue === 'function' && exportValue.prototype instanceof BaseSkill) {
          return new (exportValue as typeof BaseSkill)();
        }
      }
    } catch (error) {
      console.error(`[SkillLoader] Failed to load from ${filePath}:`, error);
    }
    
    return null;
  }

  /**
   * 从 JSON 定义创建 Skill
   */
  createFromDefinition(definition: SkillDefinition): BaseSkill {
    const skill = new (class extends BaseSkill {
      name = definition.name;
      description = definition.description;
      domain = definition.domain;
      triggers = definition.triggers;
      rules = definition.rules;
      tools = definition.tools;
      priority = definition.priority;
      state = definition.state || 'REGISTERED';
    })();
    
    return skill;
  }

  /**
   * 加载并注册所有内置 Skills
   */
  async loadBuiltin(): Promise<void> {
    const { builtinSkills } = await import('./builtin/index.js');
    skillRegistry.registerAll(builtinSkills);
    
    // 默认激活所有内置 Skills
    for (const skill of builtinSkills) {
      skillRegistry.activate(skill.name);
    }
  }
}

export const skillLoader = new SkillLoader();

export default SkillLoader;
