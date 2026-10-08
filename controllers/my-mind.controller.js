import userMindRepository from '../repositories/user-mind.repository.js';
import mindKnowledgeRepository from '../repositories/mind-knowledge.repository.js';
import knowledgeService from '../services/ingestion/knowledge.service.js';

/**
 * MyMindController
 * Authenticated creator controls for the user's single 1:1 Digital Twin AI Mind.
 */
export class MyMindController {
  /**
   * GET /api/my-mind
   * Fetch authenticated user's mind and active training sources.
   */
  async getMyMind(req, res, next) {
    try {
      const userId = req.user.id;
      let mind = await userMindRepository.findByUserId(userId);

      // Auto-provision a default empty draft mind if user doesn't have one yet
      if (!mind) {
        const defaultHandle = `user_${userId}`;
        mind = await userMindRepository.upsert(userId, {
          handle: defaultHandle,
          display_name: req.user.email ? req.user.email.split('@')[0] : 'My AI Mind',
          headline: 'Thinker & Creator',
          philosophy_statement: '',
          decision_frameworks: [],
          tags: [],
          is_published: false,
        });
      }

      const sources = await mindKnowledgeRepository.findSourcesByMindId(mind.id);

      return res.status(200).json({
        success: true,
        data: {
          ...mind,
          sources,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * PUT /api/my-mind
   * Update profile (handle, display_name, headline, bio, philosophy, frameworks, publish toggle).
   */
  async updateMyMind(req, res, next) {
    try {
      const userId = req.user.id;
      const {
        handle,
        display_name,
        headline,
        avatar_url,
        website_url,
        bio,
        philosophy_statement,
        decision_frameworks,
        tags,
        is_published,
      } = req.body;

      const updated = await userMindRepository.upsert(userId, {
        handle,
        display_name,
        headline,
        avatar_url,
        website_url,
        bio,
        philosophy_statement,
        decision_frameworks,
        tags,
        is_published,
        voice_provider: req.body.voice_provider || req.body.voiceProvider,
        voice_id: req.body.voice_id || req.body.voiceId,
        voice_sample_url: req.body.voice_sample_url || req.body.voiceSampleUrl,
        voice_settings: req.body.voice_settings || req.body.voiceSettings,
      });

      const sources = await mindKnowledgeRepository.findSourcesByMindId(updated.id);

      return res.status(200).json({
        success: true,
        message: updated.is_published
          ? `AI Mind @${updated.handle} is now published in the Commons.`
          : 'AI Mind updated successfully (Private draft).',
        data: {
          ...updated,
          sources,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/my-mind/sources/url
   * Link website or blog post for background ingestion.
   */
  async ingestUrl(req, res, next) {
    try {
      const userId = req.user.id;
      let mind = await userMindRepository.findByUserId(userId);
      if (!mind) {
        mind = await userMindRepository.upsert(userId, {
          handle: `user_${userId}`,
          display_name: 'My AI Mind',
        });
      }

      const { url, title, topic } = req.body;
      if (!url || !url.trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_URL', message: 'A valid website or article URL is required.' },
        });
      }

      const result = await knowledgeService.ingestUrl(mind.id, url.trim(), { title, topic });

      return res.status(201).json({
        success: true,
        message: `Successfully ingested URL. Extracted ${result.chunksCreated} knowledge chunks.`,
        data: result,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/my-mind/sources/file
   * Upload PDF, text, or markdown document for ingestion.
   */
  async ingestDocument(req, res, next) {
    try {
      const userId = req.user.id;
      let mind = await userMindRepository.findByUserId(userId);
      if (!mind) {
        mind = await userMindRepository.upsert(userId, {
          handle: `user_${userId}`,
          display_name: 'My AI Mind',
        });
      }

      if (!req.file) {
        return res.status(400).json({
          success: false,
          error: { code: 'MISSING_FILE', message: 'A document file (.pdf, .txt, .md) is required.' },
        });
      }

      const { title, topic } = req.body;
      const result = await knowledgeService.ingestDocument(
        mind.id,
        req.file.buffer,
        req.file.originalname,
        { title, topic }
      );

      return res.status(201).json({
        success: true,
        message: `Successfully indexed ${req.file.originalname}. Created ${result.chunksCreated} chunks.`,
        data: result,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/my-mind/sources/text
   * Add direct doctrine or rulebook text.
   */
  async ingestText(req, res, next) {
    try {
      const userId = req.user.id;
      let mind = await userMindRepository.findByUserId(userId);
      if (!mind) {
        mind = await userMindRepository.upsert(userId, {
          handle: `user_${userId}`,
          display_name: 'My AI Mind',
        });
      }

      const { title, content, topic } = req.body;
      if (!content || !content.trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'EMPTY_CONTENT', message: 'Text content is required.' },
        });
      }

      const result = await knowledgeService.ingestManualText(mind.id, {
        title: title || 'Core Philosophy & Rules',
        content,
        topic,
      });

      return res.status(201).json({
        success: true,
        message: `Successfully added doctrine text. Created ${result.chunksCreated} chunks.`,
        data: result,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * DELETE /api/my-mind/sources/:id
   * Remove training source and its indexed chunks.
   */
  async deleteSource(req, res, next) {
    try {
      const userId = req.user.id;
      const sourceId = parseInt(req.params.id, 10);

      const mind = await userMindRepository.findByUserId(userId);
      if (!mind) {
        return res.status(404).json({
          success: false,
          error: { code: 'MIND_NOT_FOUND', message: 'User mind not found.' },
        });
      }

      const deleted = await mindKnowledgeRepository.deleteSource(sourceId, mind.id);
      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: { code: 'SOURCE_NOT_FOUND', message: 'Source not found or unauthorized.' },
        });
      }

      return res.status(200).json({
        success: true,
        message: 'Source and associated knowledge chunks removed cleanly.',
      });
    } catch (err) {
      return next(err);
    }
  }
}

export const myMindController = new MyMindController();
export default myMindController;
