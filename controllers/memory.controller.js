import memoryService from '../services/ai/memory.service.js';

export class MemoryController {
  /**
   * GET /api/memories/:characterId
   * Fetch all memories associated with user and companion
   */
  async getMemories(req, res, next) {
    try {
      const { characterId } = req.params;
      const memories = await memoryService.getMemories(req.user.id, characterId);
      return res.status(200).json({
        success: true,
        data: memories,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/memories/:characterId
   * Directly teach / add a memory for a companion
   */
  async createMemory(req, res, next) {
    try {
      const { characterId } = req.params;
      const { content, category, memoryType, importanceScore } = req.body;
      if (!content || typeof content !== 'string' || !content.trim()) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Memory content is required.',
          },
        });
      }

      const memory = await memoryService.createMemory({
        userId: req.user.id,
        characterId,
        content: content.trim(),
        category: category || 'fact',
        memoryType: memoryType || 'user_fact',
        importanceScore: importanceScore || 5,
      });

      return res.status(201).json({
        success: true,
        data: memory,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * PUT /api/memories/:id
   * Edit / correct an existing memory item
   */
  async updateMemory(req, res, next) {
    try {
      const { id } = req.params;
      const { content, category, importanceScore } = req.body;
      const updated = await memoryService.updateMemory(id, req.user.id, {
        content,
        category,
        importanceScore,
      });

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Memory not found or could not be updated.',
          },
        });
      }

      return res.status(200).json({
        success: true,
        data: updated,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * DELETE /api/memories/:id
   * Forget / delete a specific memory item
   */
  async deleteMemory(req, res, next) {
    try {
      const { id } = req.params;
      const deleted = await memoryService.deleteMemory(id, req.user.id);
      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Memory not found or you do not have permission to delete it.',
          },
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Memory forgotten successfully.',
      });
    } catch (err) {
      return next(err);
    }
  }
}

export const memoryController = new MemoryController();
export default memoryController;
