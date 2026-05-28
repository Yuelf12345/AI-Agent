/**
 * State - 状态 Schema 和字段定义
 *
 * 核心概念：状态是贯穿整个图的共享数据。
 * 每个节点读取和更新其中的部分字段。
 *
 * 两种归约策略：
 *   - overwrite: 新值直接替换旧值（默认）
 *   - append: 新值追加到旧值（用于消息历史、步骤记录等）
 */

import { z } from "zod";

/**
 * StateField - 定义状态中每个字段的更新策略
 */
export class StateField<T> {
  constructor(
    public schema: z.ZodType<T>,
    public reducer: "overwrite" | "append" | ((current: T, update: T) => T) = "overwrite"
  ) {}
}

/**
 * StateSchema - 定义整个图的状态结构
 *
 * 类似 LangGraph 的 StateSchema，简化版：
 *   - 每个字段有自己的归约策略
 *   - 支持 Zod 验证
 *
 * 使用示例：
 *   const AgentState = new StateSchema()
 *     .addField("messages", z.array(z.any()), "append")
 *     .addField("currentStep", z.string())
 *     .addField("taskType", z.enum(["simple", "complex"]))
 */
export class StateSchema {
  private fields: Map<string, StateField<any>> = new Map();

  /**
   * 向状态 Schema 添加字段
   */
  addField<T>(name: string, schema: z.ZodType<T>, reducer?: StateField<T>["reducer"]): this {
    this.fields.set(name, new StateField(schema, reducer));
    return this;
  }

  /**
   * 从输入创建初始状态
   */
  createInitialState(input: Record<string, any>): Record<string, any> {
    const state: Record<string, any> = {};
    for (const [name, field] of this.fields) {
      if (input[name] !== undefined) {
        try {
          state[name] = field.schema.parse(input[name]);
        } catch {
          state[name] = this._getDefaultValue(field.schema);
        }
      } else {
        state[name] = this._getDefaultValue(field.schema);
      }
    }
    return state;
  }

  /**
   * 将节点返回的部分更新应用到当前状态
   */
  applyUpdate(current: Record<string, any>, update: Record<string, any>): Record<string, any> {
    const newState = { ...current };
    for (const [key, value] of Object.entries(update)) {
      if (value === undefined || value === null) continue;

      const field = this.fields.get(key);
      if (!field) {
        // 未知字段 - 直接赋值
        newState[key] = value;
        continue;
      }

      if (field.reducer === "overwrite") {
        try {
          newState[key] = field.schema.parse(value);
        } catch {
          newState[key] = value;
        }
      } else if (field.reducer === "append") {
        try {
          const currentVal = current[key];
          const newVal = Array.isArray(value) ? value : [value];
          const parsed = field.schema.parse([...(Array.isArray(currentVal) ? currentVal : []), ...newVal]);
          newState[key] = parsed;
        } catch {
          // 降级处理：直接拼接
          newState[key] = Array.isArray(current[key])
            ? [...current[key], value]
            : [current[key], value];
        }
      } else if (typeof field.reducer === "function") {
        try {
          newState[key] = field.schema.parse(field.reducer(current[key], value));
        } catch {
          newState[key] = value;
        }
      }
    }
    return newState;
  }

  /**
   * 获取所有字段名
   */
  getFieldNames(): string[] {
    return Array.from(this.fields.keys());
  }

  /**
   * 获取指定字段
   */
  getField(name: string): StateField<any> | undefined {
    return this.fields.get(name);
  }

  /**
   * 从 Zod Schema 获取默认值
   */
  private _getDefaultValue(schema: z.ZodType<any>): any {
    // 尝试从 Zod schema 提取默认值
    // 注意：Zod v4 的 _def 结构可能不同，需要兼容处理
    try {
      const def = (schema as any)._def;
      if (def && "defaultValue" in def) {
        const dv = def.defaultValue;
        return typeof dv === "function" ? dv() : dv;
      }
    } catch {
      // 忽略，继续使用类型推断
    }

    // 基于类型的默认值
    if (schema instanceof z.ZodArray) return [];
    if (schema instanceof z.ZodString) return "";
    if (schema instanceof z.ZodNumber) return 0;
    if (schema instanceof z.ZodBoolean) return false;
    if (schema instanceof z.ZodObject) return {};
    if (schema instanceof z.ZodNullable) return null;
    if (schema instanceof z.ZodOptional) return undefined;

    return null;
  }
}

/**
 * 预定义的状态 Schema
 */

// 消息状态 - append 模式用于对话历史
export const MessagesState = new StateSchema()
  .addField("messages", z.array(z.any()), "append");

// Agent 状态 - 包含常用字段
export const AgentState = new StateSchema()
  .addField("messages", z.array(z.any()), "append")
  .addField("currentStep", z.string())
  .addField("iteration", z.number())
  .addField("error", z.string().nullable())
  .addField("status", z.enum(["idle", "running", "paused", "completed", "failed"]));

// 任务状态 - 用于编排器
export const TaskState = new StateSchema()
  .addField("taskType", z.enum(["simple", "complex"]))
  .addField("plan", z.any())
  .addField("subtasks", z.array(z.any()), "append")
  .addField("results", z.array(z.any()), "append")
  .addField("currentTask", z.number());