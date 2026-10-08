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
