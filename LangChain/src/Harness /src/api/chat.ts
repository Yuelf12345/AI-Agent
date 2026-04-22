import { Router, Request, Response } from 'express';
import { agent } from '../harness/index.js';
import type { StreamEvent } from '../types/index.js';

const router = Router();

/**
 * POST /api/chat
 * 发起对话，返回 SSE 流式响应
 */
router.post('/', async (req: Request, res: Response) => {
  const { message, conversation_id } = req.body;

  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  // 设置 SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  try {
    // 流式返回 Agent 响应
    for await (const event of agent.chat(message, conversation_id)) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  } catch (error) {
    const errorEvent: StreamEvent = {
      type: 'error',
      code: 'INTERNAL_ERROR',
      message: error instanceof Error ? error.message : 'Unknown error',
    };
    res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
  }

  res.end();
});

/**
 * POST /api/chat/sync
 * 同步对话接口，返回完整响应
 */
router.post('/sync', async (req: Request, res: Response) => {
  const { message, conversation_id } = req.body;

  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  try {
    const events: StreamEvent[] = [];
    for await (const event of agent.chat(message, conversation_id)) {
      events.push(event);
    }

    // 提取最终的 assistant 消息
    const lastMessage = events.filter(e => e.type === 'message' && e.role === 'assistant').pop();

    res.json({
      conversation_id: conversation_id || 'new',
      events,
      response: lastMessage?.content || '',
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
