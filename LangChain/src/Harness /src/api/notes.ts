import { Router, Request, Response } from 'express';
import { storageService } from '../services/index.js';
import { v4 as uuidv4 } from 'uuid';
import type { Note } from '../types/index.js';

const router = Router();

/**
 * GET /api/notes
 * 搜索/列出笔记
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const { q, tags } = req.query;

    let notes = storageService.getAllNotes();

    // 按标签过滤
    if (tags) {
      const tagList = (tags as string).split(',').map(t => t.trim());
      notes = notes.filter(note =>
        tagList.some(tag => note.tags.includes(tag))
      );
    }

    // 简单文本搜索（待向量检索替代）
    if (q) {
      const query = (q as string).toLowerCase();
      notes = notes.filter(note =>
        note.title.toLowerCase().includes(query) ||
        note.content.toLowerCase().includes(query)
      );
    }

    res.json({
      count: notes.length,
      notes: notes.map(({ content, ...rest }) => rest) // 列表不返回完整内容
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/notes/:id
 * 获取笔记详情
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const note = storageService.getNote(req.params.id);
    
    if (!note) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    res.json(note);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * POST /api/notes
 * 创建新笔记
 */
router.post('/', async (req: Request, res: Response) => {
  try {
    const { title, content, tags } = req.body;

    if (!title) {
      res.status(400).json({ error: 'title is required' });
      return;
    }

    const note: Note = {
      id: uuidv4(),
      title,
      content: content || '',
      tags: tags || [],
      created_at: new Date(),
      updated_at: new Date(),
    };

    storageService.saveNote(note);

    // TODO: 异步添加到向量索引

    res.status(201).json({
      note_id: note.id,
      created: true,
      note
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * PUT /api/notes/:id
 * 更新笔记
 */
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const existingNote = storageService.getNote(req.params.id);
    
    if (!existingNote) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    const { title, content, tags } = req.body;

    const updatedNote: Note = {
      ...existingNote,
      title: title ?? existingNote.title,
      content: content ?? existingNote.content,
      tags: tags ?? existingNote.tags,
      updated_at: new Date(),
    };

    storageService.saveNote(updatedNote);

    // TODO: 异步更新向量索引

    res.json({
      note_id: updatedNote.id,
      updated: true,
      note: updatedNote
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * DELETE /api/notes/:id
 * 删除笔记
 */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const deleted = storageService.deleteNote(req.params.id);
    
    if (!deleted) {
      res.status(404).json({ error: 'Note not found' });
      return;
    }

    // TODO: 从向量索引删除

    res.json({
      note_id: req.params.id,
      deleted: true
    });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;
