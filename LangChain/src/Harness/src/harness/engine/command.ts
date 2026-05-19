/**
 * Command - 图执行控制指令
 *
 * 提供控制流机制：goto（跳转）、resume（恢复）、interrupt（中断）
 */

/**
 * InterruptRequest - 图执行中断时生成的请求
 */
export interface InterruptRequest {
  /** 产生中断的节点名称 */
  node: string;
  /** 传递给 interrupt() 的值 - 供人工审核参考 */
  value: any;
  /** 中断时间戳 */
  timestamp?: number;
  /** 附加元数据 */
  metadata?: Record<string, any>;
}

/**
 * Command - 图执行控制指令
 *
 * 两种模式：
 *   1. goto: 覆盖默认边，跳转到指定节点
 *   2. resume: 中断后继续执行，传入恢复值
 */
export class Command<T = any> {
  goto: string | undefined;
  resume: T | undefined;

  constructor(options: { goto?: string | undefined; resume?: T | undefined }) {
    this.goto = options.goto;
    this.resume = options.resume;
  }

  /**
   * 判断是否为 goto 命令
   */
  isGoto(): boolean {
    return this.goto !== undefined;
  }

  /**
   * 判断是否为 resume 命令
   */
  isResume(): boolean {
    return this.resume !== undefined;
  }

  /**
   * 创建 goto 命令 - 强制跳转到目标节点
   */
  static goto(target: string): Command {
    return new Command({ goto: target });
  }

  /**
   * 创建 resume 命令 - 中断后继续执行
   */
  static resume<T>(value: T): Command<T> {
    return new Command({ resume: value });
  }

  /**
   * 序列化为 JSON（用于调试/日志）
   */
  toJSON(): object {
    return {
      type: this.isGoto() ? "goto" : "resume",
      ...(this.isGoto() ? { target: this.goto } : { resume: this.resume }),
    };
  }
}

/**
 * InterruptSignal - 内部中断信号
 *
 * 用于图执行器标记执行应暂停。
 * 不应直接抛出 - 请使用 interrupt() 函数代替。
 */
export class InterruptSignal {
  public readonly timestamp: number;

  constructor(public value: any) {
    this.timestamp = Date.now();
  }

  /**
   * 从此信号创建中断请求
   */
  toInterruptRequest(node: string): InterruptRequest {
    return {
      node,
      value: this.value,
      timestamp: this.timestamp,
    };
  }
}

/**
 * interrupt - 暂停图执行，等待人工输入
 *
 * 在节点函数内部调用此函数可暂停执行。
 * 图将返回 __interrupt__ 包含传入的值。
 *
 * @param info - 向人工审核者展示的信息
 * @returns 恢复时传入的值（Command({ resume: value })）
 *
 * @example
 * async function approvalNode(state) {
 *   const approved = interrupt({
 *     question: "是否批准此文件删除操作？",
 *     details: { path: state.filePath, size: state.fileSize }
 *   });
 *
 *   if (approved) {
 *     return { status: "approved", action: "delete" };
 *   }
 *   return { status: "rejected", action: "cancelled" };
 * }
 */
export function interrupt<T = any>(info: any): T {
  // 此函数在运行时由 StateGraph 执行器处理
  // 实际不会正常执行 - 而是抛出中断信号
  throw new InterruptSignal(info);
}

/**
 * waitForApproval - 审批流程便捷函数
 *
 * @param action - 待审批的操作名称
 * @param details - 操作详情
 */
export function waitForApproval(action: string, details: any): boolean {
  return interrupt({
    type: "approval",
    action,
    details,
    question: `是否继续执行：${action}？`,
  });
}

/**
 * waitForInput - 用户输入便捷函数
 *
 * @param prompt - 向用户提出的问题
 * @param defaultValue - 可选的默认值
 */
export function waitForInput<T = string>(prompt: string, defaultValue?: T): T {
  return interrupt({
    type: "input",
    prompt,
    defaultValue,
  });
}