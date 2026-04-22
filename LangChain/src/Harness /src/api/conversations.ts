import { Router, Request, Response } from 'express';
import { storageService } from '../services/index.js';
import { v4 as uuidv4 } from 'uuid';
import type { Conversation } from '../types/index.js';

const router = Router();

/**
 * GET /api/conversations
 * 获取所有对话列表
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    // TODO: 确保存储服务已初始化
    // await storageService.init();
    
    const conversations = storageService.getAllConversations();
    res.json(conversations);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * GET /api/conversations/:id
 * 获取指定对话详情
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const conversation = storageService.getConversation(req.params.id);
    
    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    res.json(conversation);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * POST /api/conversations
 * 创建新对话
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { title } = req.body;

    const conversation: Conversation = {
      id: uuidv4(),
      title: title || 'New Conversation',
      messages: [],
      created_at: new Date(),
    };

    storageService.saveConversation(conversation);

    res.status(201).json(conversation);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

/**
 * DELETE /api/conversations/:id
 * 删除对话
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    // TODO: 实现删除逻辑
    res.json({ success: true, message: 'Conversation deleted' });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

export default router;
