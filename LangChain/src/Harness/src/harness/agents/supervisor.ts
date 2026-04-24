import type{ SubTask, TaskResult, ExecutionContext } from "../../types/index.ts";

/**
 * Supervisor组件
 * 职责：监控子任务执行，处理依赖关系，汇总结果
 */
export class Supervisor {
  private maxRetries: number;

  constructor(config?: { maxRetries?: number }) {
    this.maxRetries = config?.maxRetries || 3;
  }

  /**
   * 执行子任务列表
   * @param subtasks 子任务列表
   * @returns TaskResult[] 所有子任务的执行结果
   */
  async execute(subtasks: SubTask[]): Promise<TaskResult[]> {
    const ctx: ExecutionContext = {
      taskId: this.generateTaskId(),
      subtasks: [...subtasks],
      results: [],
      currentTaskIndex: 0,
      maxRetries: this.maxRetries
    };

    // 按依赖顺序执行
    while (this.hasPendingTasks(ctx)) {
      const task = this.getNextRunnableTask(ctx);
      
      if (!task) {
        // 没有可执行的任务（可能依赖未满足）
        break;
      }

      const result = await this.executeTask(task, ctx);
      ctx.results.push(result);

      // 更新任务状态
      task.status = result.success ? 'completed' : 'failed';
    }

    return ctx.results;
  }

  /**
   * 执行单个子任务
   */
  private async executeTask(task: SubTask, ctx: ExecutionContext): Promise<TaskResult> {
    task.status = 'running';
    
    let lastError: string | undefined;
    
    for (let attempt = 1; attempt <= ctx.maxRetries; attempt++) {
      try {
        // TODO: 这里暂时模拟执行，后续注入真正的Worker Agent
        console.log(`[Supervisor] 执行任务: ${task.description} (尝试 ${attempt}/${ctx.maxRetries})`);
        
        // 模拟异步执行
        await this.simulateExecution(task);

        return {
          taskId: task.id,
          success: true,
          data: { result: `任务完成: ${task.description}` }
        };
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        console.error(`[Supervisor] 任务失败: ${task.id}, 尝试 ${attempt}/${ctx.maxRetries}`);
      }
    }

    return {
      taskId: task.id,
      success: false,
      error: lastError || '未知错误'
    };
  }

  /**
   * 检查是否还有待执行的任务
   */
  private hasPendingTasks(ctx: ExecutionContext): boolean {
    return ctx.subtasks.some(t => t.status === 'pending');
  }

  /**
   * 获取下一个可执行的任务（依赖已满足）
   */
  private getNextRunnableTask(ctx: ExecutionContext): SubTask | undefined {
    return ctx.subtasks.find(task => {
      if (task.status !== 'pending') return false;
      
      // 检查依赖是否全部完成
      return task.dependencies.every(depId => {
        const depTask = ctx.subtasks.find(t => t.id === depId);
        return depTask?.status === 'completed';
      });
    });
  }

  /**
   * 模拟任务执行（后续替换为真实Worker调用）
   */
  private async simulateExecution(task: SubTask): Promise<void> {
    // 模拟耗时操作
    await new Promise(resolve => setTimeout(resolve, 100));
    console.log(`[Supervisor] ${task.assignedAgent} 完成任务: ${task.description}`);
  }

  /**
   * 生成任务ID
   */
  private generateTaskId(): string {
    return `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}