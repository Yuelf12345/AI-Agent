/**
 * StateGraph - 核心编排引擎
 *
 * 设计理念（借鉴 LangGraph）：
 *   1. 声明式：通过 addNode + addEdge 构建图，然后 compile 编译
 *   2. 状态驱动：所有节点共享同一状态，各自读取并返回更新
 *   3. 条件分支：通过 ConditionalRouter 实现动态路由
 *   4. 中断/恢复：interrupt() 暂停，Command({ resume }) 恢复
 *   5. 可观测：每个节点执行自动记录追踪和指标
 */

import { StateSchema } from "./state.ts";
import type { GraphNode, NodeConfig, NodeDefinition } from "./node.ts";
import { Command, InterruptSignal, RESUME_VALUE_KEY, INTERRUPT_TYPE_KEY } from "./command.ts";
import type { InterruptRequest } from "./command.ts";
import { EdgeType } from "./edge.ts";
import type { EdgeDefinition, ConditionalRouter } from "./edge.ts";
import { START, END } from "./edge.ts";

/**
 * Checkpointer - 状态持久化接口
 *
 * 用于在中断时保存状态，恢复时加载状态。
 * 默认提供 MemoryCheckpointer（内存实现）。
 * 可扩展为 SQLiteCheckpointer / RedisCheckpointer。
 */
export interface Checkpointer {
  /** 保存检查点 */
  save(threadId: string, state: Record<string, any>, nodeId: string, interruptType?: string | undefined): Promise<void>;
  /** 加载检查点 */
  load(threadId: string): Promise<{ state: Record<string, any>; nodeId: string; interruptType?: string | undefined } | null>;
  /** 删除检查点 */
  delete(threadId: string): Promise<void>;
  /** 列出可用的线程 ID */
  listThreads(): Promise<string[]>;
}

/**
 * MemoryCheckpointer - 内存实现（开发用）
 */
export class MemoryCheckpointer implements Checkpointer {
  private checkpoints: Map<string, { state: Record<string, any>; nodeId: string; interruptType?: string | undefined }> = new Map();

  async save(threadId: string, state: Record<string, any>, nodeId: string, interruptType?: string | undefined): Promise<void> {
    this.checkpoints.set(threadId, { state: JSON.parse(JSON.stringify(state)), nodeId, interruptType });
  }

  async load(threadId: string): Promise<{ state: Record<string, any>; nodeId: string; interruptType?: string | undefined } | null> {
    return this.checkpoints.get(threadId) || null;
  }

  async delete(threadId: string): Promise<void> {
    this.checkpoints.delete(threadId);
  }

  async listThreads(): Promise<string[]> {
    return Array.from(this.checkpoints.keys());
  }
}

/**
 * GraphConfig - 图执行配置
 */
export interface GraphConfig {
  configurable?: {
    thread_id?: string | undefined;
    recursion_limit?: number | undefined;
    [key: string]: any;
  } | undefined;
}

/**
 * StateGraph - 有状态图的构建器
 *
 * @example
 * const graph = new StateGraph(HarnessState)
 *   .addNode("router", routerNode)
 *   .addNode("simpleAgent", simpleAgentNode)
 *   .addNode("reactAgent", reactAgentNode)
 *   .addNode("approval", approvalNode, { interruptAfter: true })
 *   .addEdge(START, "router")
 *   .addConditionalEdges("router", routeByTaskType)
 *   .addEdge("simpleAgent", END)
 *   .compile({ checkpointer: new MemoryCheckpointer() });
 *
 * // 执行
 * const result = await graph.invoke({ messages: [...] }, { thread_id: "session-1" });
 */
export class StateGraph<TState extends Record<string, any> = Record<string, any>> {
  private schema: StateSchema;
  private nodes: Map<string, NodeDefinition<TState>> = new Map();
  private edges: EdgeDefinition[] = [];

  constructor(schema: StateSchema) {
    this.schema = schema;
  }

  // ==================== 构建器 API ====================

  /**
   * 向图中添加节点
   */
  addNode(name: string, fn: GraphNode<TState>, config?: NodeConfig): this {
    if (this.nodes.has(name)) {
      throw new Error(`节点 "${name}" 已存在`);
    }
    this.nodes.set(name, { name, fn, config: config ?? undefined });
    return this;
  }

  /**
   * 添加固定边：from → to
   */
  addEdge(from: string, to: string): this {
    this.edges.push({ type: EdgeType.Fixed, from, to });
    return this;
  }

  /**
   * 添加条件边：from → router(state) → target
   */
  addConditionalEdges(from: string, router: ConditionalRouter<TState>): this {
    this.edges.push({ type: EdgeType.Conditional, from, router });
    return this;
  }

  /**
   * 将图编译为可执行形式
   */
  compile(options?: { checkpointer?: Checkpointer | undefined }): CompiledGraph<TState> {
    this._validate();
    return new CompiledGraph(
      this.schema,
      new Map(this.nodes),
      [...this.edges],
      options?.checkpointer
    );
  }

  /**
   * 验证图结构
   */
  private _validate(): void {
    const nodeNames = new Set(this.nodes.keys());

    for (const edge of this.edges) {
      // 检查源节点是否存在（START 除外）
      if (edge.from !== START && !nodeNames.has(edge.from)) {
        throw new Error(`边的源 "${edge.from}" 不是已注册的节点`);
      }

      // 检查目标节点是否存在（END 除外）
      if (edge.type === EdgeType.Fixed && edge.to !== END && !nodeNames.has(edge.to!)) {
        throw new Error(`边的目标 "${edge.to}" 不是已注册的节点`);
      }
    }

    // 检查 START 有出边
    const startEdges = this.edges.filter(e => e.from === START);
    if (startEdges.length === 0) {
      throw new Error("START 没有出边 - 图没有入口点");
    }
  }
}

/**
 * CompiledGraph - 编译后的可执行图
 *
 * 核心执行逻辑：
 *   1. 从 START 节点开始
 *   2. 找到当前节点的出边
 *   3. 执行目标节点函数
 *   4. 将返回的更新合并到状态
 *   5. 检查 InterruptSignal → 暂停并保存检查点
 *   6. 检查 Command → 按 goto 跳转
 *   7. 重复直到到达 END
 */
export class CompiledGraph<TState extends Record<string, any> = Record<string, any>> {
  private schema: StateSchema;
  private nodes: Map<string, NodeDefinition<TState>>;
  private edges: EdgeDefinition[];
  private checkpointer: Checkpointer;
  private recursionLimit: number = 25;

  constructor(
    schema: StateSchema,
    nodes: Map<string, NodeDefinition<TState>>,
    edges: EdgeDefinition[],
    checkpointer?: Checkpointer
  ) {
    this.schema = schema;
    this.nodes = nodes;
    this.edges = edges;
    this.checkpointer = checkpointer ?? new MemoryCheckpointer();
  }

  /**
   * 使用输入状态调用图
   *
   * @param input - 初始状态或 Command（用于恢复）
   * @param config - 执行配置
   * @returns 最终状态或包含 __interrupt__ 的状态
   */
  async invoke(
    input: Partial<TState> | Command,
    config?: GraphConfig
  ): Promise<TState & { __interrupt__?: InterruptRequest[] }> {
    const threadId = config?.configurable?.thread_id ?? `thread-${Date.now()}`;
    this.recursionLimit = config?.configurable?.recursion_limit ?? 25;

    // 处理恢复：从检查点加载并继续
    if (input instanceof Command && input.isResume()) {
      return this._resumeFromInterrupt(threadId, input.resume);
    }

    // 新执行：创建初始状态
    let state = this.schema.createInitialState(input as Record<string, any>) as TState;
    let currentNode = this._getFirstNode();
    let iteration = 0;

    // 主执行循环
    while (currentNode !== END) {
      iteration++;
      if (iteration > this.recursionLimit) {
        return {
          ...state,
          status: "failed",
          error: `超出递归限制 (${this.recursionLimit})`,
        } as unknown as TState & { __interrupt__?: InterruptRequest[] };
      }

      const nodeDef = this.nodes.get(currentNode);
      if (!nodeDef) {
        throw new Error(`节点 "${currentNode}" 未找到`);
      }

      // interruptBefore: 执行前暂停
      if (nodeDef.config?.interruptBefore) {
        await this.checkpointer.save(threadId, state, currentNode, "interrupt_before");
        return {
          ...state,
          status: "paused",
          __interrupt__: [{
            node: currentNode,
            value: { reason: "interrupt_before", state: this._sanitizeForInterrupt(state) },
          }],
        } as unknown as TState & { __interrupt__?: InterruptRequest[] };
      }

      // 执行节点
      state = { ...state, currentStep: currentNode, iteration };

      let result: any;
      try {
        result = await nodeDef.fn(state);
      } catch (error) {
        // 处理 InterruptSignal
        if (error instanceof InterruptSignal) {
          await this.checkpointer.save(threadId, state, currentNode, "interrupt_signal");
          return {
            ...state,
            status: "paused",
            __interrupt__: [error.toInterruptRequest(currentNode)],
          } as unknown as TState & { __interrupt__?: InterruptRequest[] };
        }
        // 其他错误重新抛出
        throw error;
      }

      // 处理 Command goto
      if (result instanceof Command && result.isGoto()) {
        currentNode = result.goto!;
        continue;
      }

      // 处理 Command resume（正常流程中不应出现）
      if (result instanceof Command && result.isResume()) {
        console.warn("在正常流程中收到 resume Command，忽略");
      }

      // 合并状态更新
      if (result && typeof result === "object" && !(result instanceof Command)) {
        state = this.schema.applyUpdate(state, result as Record<string, any>) as TState;
      }

      // interruptAfter: 执行后暂停
      if (nodeDef.config?.interruptAfter) {
        await this.checkpointer.save(threadId, state, currentNode, "interrupt_after");
        return {
          ...state,
          status: "paused",
          __interrupt__: [{
            node: currentNode,
            value: { reason: "interrupt_after", state: this._sanitizeForInterrupt(state) },
          }],
        } as unknown as TState & { __interrupt__?: InterruptRequest[] };
      }

      // 查找下一个节点
      currentNode = this._getNextNode(currentNode, state);
    }

    // 到达 END
    return { ...state, status: "completed" } as unknown as TState & { __interrupt__?: InterruptRequest[] };
  }

  /**
   * 中断后恢复执行
   *
   * 根据中断类型决定恢复策略：
   *   - interrupt_before：节点未执行过 → 注入 resumeValue 后执行节点
   *   - interrupt_after：节点已执行完毕 → 不重执行，直接继续下一个节点
   *   - interrupt_signal：节点内部 interrupt() 抛出 → 注入 resumeValue 后重新执行节点
   *
   * resumeValue 通过 state.__resumeValue__ 传递给节点函数，
   * 节点函数应先检查此字段，跳过 interrupt() 调用。
   */
  private async _resumeFromInterrupt(
    threadId: string,
    resumeValue: any
  ): Promise<TState & { __interrupt__?: InterruptRequest[] }> {
    const checkpoint = await this.checkpointer.load(threadId);
    if (!checkpoint) {
      throw new Error(`未找到线程 "${threadId}" 的检查点`);
    }

    let state = checkpoint.state as TState;
    let currentNode = checkpoint.nodeId;
    const interruptType = checkpoint.interruptType || "interrupt_signal";

    const nodeDef = this.nodes.get(currentNode);
    if (!nodeDef) {
      throw new Error(`检查点中的节点 "${currentNode}" 未找到`);
    }

    // ---- 根据中断类型决定恢复策略 ----

    let startNode: string;

    if (interruptType === "interrupt_after") {
      // 节点已执行完毕，恢复时跳过该节点，直接继续下一个
      startNode = this._getNextNode(currentNode, state);
      console.log(`[Resume] interrupt_after: 跳过节点 "${currentNode}", 从 "${startNode}" 继续`);
    } else {
      // interrupt_before 或 interrupt_signal：注入 resumeValue 后重新执行当前节点
      // 注入 resumeValue 到状态，节点函数通过 state.__resumeValue__ 获取
      state = { ...state, [RESUME_VALUE_KEY]: resumeValue } as TState;
      console.log(`[Resume] ${interruptType}: 注入 __resumeValue__, 重新执行节点 "${currentNode}"`);

      try {
        const result = await nodeDef.fn(state);

        // 合并恢复执行的更新
        if (result instanceof Command && result.isGoto()) {
          startNode = result.goto!;
        } else if (result instanceof Command && result.isResume()) {
          console.warn("[Resume] 节点返回了 resume Command，忽略");
          startNode = this._getNextNode(currentNode, state);
        } else if (result && typeof result === "object" && !(result instanceof Command)) {
          // 清除 __resumeValue__，不再需要
          const cleanResult = { ...result };
          delete cleanResult[RESUME_VALUE_KEY];
          state = this.schema.applyUpdate(state, cleanResult as Record<string, any>) as TState;
          // 清除状态中的 __resumeValue__
          delete (state as any)[RESUME_VALUE_KEY];
          startNode = this._getNextNode(currentNode, state);
        } else {
          startNode = this._getNextNode(currentNode, state);
        }
      } catch (error) {
        // 如果再次调用 interrupt，则产生新的中断
        if (error instanceof InterruptSignal) {
          await this.checkpointer.save(threadId, state, currentNode, "interrupt_signal");
          return {
            ...state,
            status: "paused",
            __interrupt__: [error.toInterruptRequest(currentNode)],
          } as unknown as TState & { __interrupt__?: InterruptRequest[] };
        }
        throw error;
      }
    }

    // 恢复后继续执行后续节点
    let nextNode = startNode;
    let iteration = (state as any).iteration ?? 0;

    while (nextNode !== END) {
      iteration++;
      if (iteration > this.recursionLimit) {
        return {
          ...state,
          status: "failed",
          error: `超出递归限制 (${this.recursionLimit})`,
        } as unknown as TState & { __interrupt__?: InterruptRequest[] };
      }

      const nextDef = this.nodes.get(nextNode);
      if (!nextDef) {
        throw new Error(`节点 "${nextNode}" 未找到`);
      }

      state = { ...state, currentStep: nextNode, iteration };

      // interruptBefore: 执行前暂停（恢复时也可能遇到新的中断）
      if (nextDef.config?.interruptBefore) {
        await this.checkpointer.save(threadId, state, nextNode, "interrupt_before");
        return {
          ...state,
          status: "paused",
          __interrupt__: [{
            node: nextNode,
            value: { reason: "interrupt_before", state: this._sanitizeForInterrupt(state) },
          }],
        } as unknown as TState & { __interrupt__?: InterruptRequest[] };
      }

      try {
        const nextResult = await nextDef.fn(state);

        if (nextResult instanceof Command && nextResult.isGoto()) {
          nextNode = nextResult.goto!;
          continue;
        }

        if (nextResult && typeof nextResult === "object" && !(nextResult instanceof Command)) {
          state = this.schema.applyUpdate(state, nextResult as Record<string, any>) as TState;
        }
      } catch (error) {
        if (error instanceof InterruptSignal) {
          await this.checkpointer.save(threadId, state, nextNode, "interrupt_signal");
          return {
            ...state,
            status: "paused",
            __interrupt__: [error.toInterruptRequest(nextNode)],
          } as unknown as TState & { __interrupt__?: InterruptRequest[] };
        }
        throw error;
      }

      // interruptAfter: 执行后暂停
      if (nextDef.config?.interruptAfter) {
        await this.checkpointer.save(threadId, state, nextNode, "interrupt_after");
        return {
          ...state,
          status: "paused",
          __interrupt__: [{
            node: nextNode,
            value: { reason: "interrupt_after", state: this._sanitizeForInterrupt(state) },
          }],
        } as unknown as TState & { __interrupt__?: InterruptRequest[] };
      }

      nextNode = this._getNextNode(nextNode, state);
    }

    // 清除检查点
    await this.checkpointer.delete(threadId);

    return { ...state, status: "completed" } as unknown as TState & { __interrupt__?: InterruptRequest[] };
  }

  /**
   * 获取 START 后的第一个节点
   */
  private _getFirstNode(): string {
    const startEdges = this.edges.filter(e => e.from === START);
    if (startEdges.length === 0) {
      throw new Error("START 没有出边");
    }

    // 对于 START，优先使用固定边
    const fixedEdge = startEdges.find(e => e.type === EdgeType.Fixed);
    if (fixedEdge) {
      return fixedEdge.to!;
    }

    throw new Error("START 只支持固定边作为入口");
  }

  /**
   * 根据当前节点和状态获取下一个节点
   */
  private _getNextNode(currentNode: string, state: TState): string {
    const outgoingEdges = this.edges.filter(e => e.from === currentNode);

    for (const edge of outgoingEdges) {
      if (edge.type === EdgeType.Fixed) {
        return edge.to!;
      }

      if (edge.type === EdgeType.Conditional && edge.router) {
        const target = edge.router(state);
        if (target === END || this.nodes.has(target)) {
          return target;
        }
      }
    }

    // 没有出边 → 结束
    return END;
  }

  /**
   * 清理中断状态中的敏感数据
   */
  private _sanitizeForInterrupt(state: Record<string, any>): Record<string, any> {
    const sensitive = ["apiKey", "password", "token", "secret"];
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(state)) {
      const isSensitive = sensitive.some(s => key.toLowerCase().includes(s.toLowerCase()));
      sanitized[key] = isSensitive ? "[已过滤]" : value;
    }

    return sanitized;
  }

  /**
   * 获取图元数据
   */
  getGraphInfo(): {
    nodes: string[];
    edges: EdgeDefinition[];
  } {
    return {
      nodes: Array.from(this.nodes.keys()),
      edges: this.edges,
    };
  }
}