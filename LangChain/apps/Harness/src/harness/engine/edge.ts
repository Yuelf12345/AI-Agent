/**
 * Edge - 边类型和定义
 *
 * 定义节点之间的连接方式以及流如何在它们之间转换。
 */

/**
 * START - 特殊边起点，表示图入口
 */
export const START = "__START__";

/**
 * END - 特殊边终点，表示图出口
 */
export const END = "__END__";

/**
 * EdgeType - 边类型
 */
export enum EdgeType {
  /** 固定边：无条件 A → B */
  Fixed = "fixed",
  /** 条件边：基于状态动态路由 */
  Conditional = "conditional",
}

/**
 * ConditionalRouter - 条件边路由函数
 *
 * 接收当前状态，返回下一个节点名（或 END）
 *
 * 示例：
 *   const router = (state) => {
 *     if (state.taskType === "simple") return "simpleAgent";
 *     if (state.taskType === "complex") return "planner";
 *     return END;
 *   };
 */
export type ConditionalRouter<TState extends Record<string, any>> =
  (state: TState) => string;

/**
 * EdgeDefinition - 边连接定义
 */
export interface EdgeDefinition {
  type: EdgeType;
  from: string;
  /** 固定边：单一目标节点 */
  to?: string | undefined;
  /** 条件边：路由函数 */
  router?: ConditionalRouter<any> | undefined;
  /** 条件边可能的跳转目标（用于验证） */
  targets?: string[] | undefined;
}

/**
 * EdgeBuilder - 边构建流式 API
 */
export class EdgeBuilder {
  private edges: EdgeDefinition[] = [];

  /**
   * 添加固定边
   */
  addEdge(from: string, to: string): this {
    this.edges.push({ type: EdgeType.Fixed, from, to });
    return this;
  }

  /**
   * 添加条件边
   */
  addConditionalEdges(
    from: string,
    router: ConditionalRouter<any>,
    targets?: string[] | undefined
  ): this {
    this.edges.push({ type: EdgeType.Conditional, from, router, targets });
    return this;
  }

  /**
   * 获取所有边
   */
  getEdges(): EdgeDefinition[] {
    return this.edges;
  }

  /**
   * 获取指定节点的出边
   */
  getOutgoingEdges(node: string): EdgeDefinition[] {
    return this.edges.filter(e => e.from === node);
  }
}