/**
 * Command - 图执行控制指令
 *
 * 提供控制流机制：goto（跳转）、resume（恢复）、interrupt（中断）
 *
 * 中断/恢复机制设计（借鉴 LangGraph）:
 *   - interrupt() 在节点内暂停执行，抛出 InterruptSignal
 *   - 恢复时，resumeValue 通过 state.__resumeValue__ 传递给节点
 *   - 节点函数应先检查 state.__resumeValue__，有值则跳过 interrupt() 调用
 */

/**
 * 内部状态键 - 恢复值传递
 *
 * 当使用 Command.resume(value) 恢复执行时，
 * resumeValue 会注入到 state.__resumeValue__ 中。
 * 节点函数通过检查此字段获取恢复值。
 */
export const RESUME_VALUE_KEY = "__resumeValue__";

/**
 * 内部状态键 - 中断类型标记
 *
 * 用于 _resumeFromInterrupt 区分中断类型，决定恢复策略:
 *   - "interrupt_before"：节点未执行，恢复时需执行节点
 *   - "interrupt_after"：节点已执行完毕，恢复时跳过节点
 *   - "interrupt_signal"：节点内部 interrupt() 抛出，恢复时注入 resumeValue 后重新执行
 */
export const INTERRUPT_TYPE_KEY = "__interruptType__";

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
  //
  // 恢复模式：当 graph.invoke(Command.resume(value)) 时，
  // resumeValue 会注入到 state.__resumeValue__ 中。
  // 节点函数应按以下模式使用 interrupt():
  //
  //   async function approvalNode(state) {
  //     // 恢复模式：检查 __resumeValue__
  //     if (state.__resumeValue__ !== undefined) {
  //       const decision = state.__resumeValue__;
  //       // 使用 decision 继续处理...
  //     } else {
  //       // 新调用：触发中断
  //       const decision = interrupt({ question: "是否批准？" });
  //       // interrupt() 抛出 InterruptSignal，此行不会执行
  //     }
  //   }
  throw new InterruptSignal(info);
}

/**
 * waitForApproval - 审批流程便捷函数
 *
 * @param action - 待审批的操作名称
 * @param details - 操作详情
 */
/**
 * waitForApproval - 审批流程便捷函数
 *
 * 重要：恢复时不再调用此函数！
 * 节点应先检查 state.__resumeValue__ 获取审批结果。
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
/**
 * waitForInput - 用户输入便捷函数
 *
 * 重要：恢复时不再调用此函数！
 * 节点应先检查 state.__resumeValue__ 获取用户输入。
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