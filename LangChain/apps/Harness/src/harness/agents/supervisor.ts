import type { SubTask, TaskResult } from "../../types/index.ts";
import { getWorker } from "./workerAgents.ts";
import { globalLogger } from "../../services/observability/logger.ts";

/**
 * Supervisor 组件
 * 职责：监控子任务执行，处理依赖关系，汇总结果
 *
 * 改造：从模拟执行 → 调用真实 Worker Agent
 */
export class Supervisor {
  private maxRetries: number;

  constructor(config?: { maxRetries?: number }) {
    this.maxRetries = config?.maxRetries || 2;
  }

  /**
   * 执行子任务列表（按依赖顺序）
   * @param subtasks 子任务列表
   * @returns TaskResult[] 所有子任务的执行结果
   */
  async execute(subtasks: SubTask[]): Promise<TaskResult[]> {
    const results: TaskResult[] = [];
    const taskMap = new Map(subtasks.map(t => [t.id, t]));

    // 按依赖顺序依次执行
    let iteration = 0;
    const maxIterations = subtasks.length + 2; // 防死循环

    while (iteration < maxIterations) {
      iteration++;

      const runnableTask = this.getNextRunnableTask(subtasks, results);

      if (!runnableTask) {
        // 检查是否所有任务都完成或失败
        const pending = subtasks.filter(t => t.status === "pending");
        if (pending.length === 0) break;

        // 有 pending 但无法执行 → 依赖死锁，强制失败
        globalLogger.warn("Supervisor: 依赖死锁，强制失败未完成的任务", {
          pendingIds: pending.map(t => t.id),
        });
        for (const t of pending) {
          t.status = "failed";
          results.push({
            taskId: t.id,
            success: false,
            error: "依赖未满足，无法执行",
          });
        }
        break;
      }

      // 执行单个子任务
      const result = await this.executeTask(runnableTask);
      runnableTask.status = result.success ? "completed" : "failed";
      results.push(result);
    }

    globalLogger.info("Supervisor: 任务编排完成", {
      total: subtasks.length,
      completed: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
    });

    return results;
  }

  /**
   * 执行单个子任务（调用真实 Worker Agent）
   */
  private async executeTask(task: SubTask): Promise<TaskResult> {
    task.status = "running";

    globalLogger.info(`Supervisor: 执行任务 ${task.id}`, {
      task: task.id,
      agent: task.assignedAgent,
      description: task.description.slice(0, 100),
    });

    // 查找 Worker Agent
    const worker = getWorker(task.assignedAgent);

    if (!worker) {
      globalLogger.error(`Supervisor: Worker ${task.assignedAgent} 不存在`);
      return {
        taskId: task.id,
        success: false,
        error: `Worker Agent "${task.assignedAgent}" 未注册`,
      };
    }

    // 构造输入：任务描述 + 参数
    const input = task.params
      ? `${task.description}\n参数: ${JSON.stringify(task.params)}`
      : task.description;

    // 带重试的执行
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await worker.execute(input);

        globalLogger.info(`Supervisor: 任务 ${task.id} 完成`, {
          task: task.id,
          agent: task.assignedAgent,
          attempt,
          type: result.type,
        });

        return {
          taskId: task.id,
          success: result.type !== "worker_error",
          data: result,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        globalLogger.warn(`Supervisor: 任务 ${task.id} 失败 (尝试 ${attempt}/${this.maxRetries})`, {
          task: task.id,
          error: errorMsg,
        });

        if (attempt === this.maxRetries) {
          return {
            taskId: task.id,
            success: false,
            error: errorMsg,
          };
        }
      }
    }

    return {
      taskId: task.id,
      success: false,
      error: "达到最大重试次数",
    };
  }

  /**
   * 获取下一个可执行的任务（依赖已满足）
   */
  private getNextRunnableTask(subtasks: SubTask[], results: TaskResult[]): SubTask | undefined {
    const completedIds = new Set(
      results.filter(r => r.success).map(r => r.taskId)
    );

    return subtasks.find(task => {
      if (task.status !== "pending") return false;
      return task.dependencies.every(depId => completedIds.has(depId));
    });
  }
}