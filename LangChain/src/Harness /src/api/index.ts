import { Router } from 'express';
import chatRouter from './chat.js';
import conversationsRouter from './conversations.js';
import toolsRouter from './tools.js';
import notesRouter from './notes.js';

const router = Router();

// 挂载各路由
router.use('/chat', chatRouter);
router.use('/conversations', conversationsRouter);
router.use('/tools', toolsRouter);
router.use('/notes', notesRouter);

// 健康检查
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

export default router;
