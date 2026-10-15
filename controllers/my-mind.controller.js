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
      const audience_questions = await mindKnowledgeRepository.findAudienceQuestionsByMindId(mind.id, 20);
      const paid_sessions = await mindKnowledgeRepository.findPaidHumanSessionsByMindId(mind.id);

      return res.status(200).json({
        success: true,
        data: {
          ...mind,
          sources,
          audience_questions,
          paid_sessions,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * PUT /api/my-mind
   * Update profile (handle, display_name, headline, bio, philosophy, frameworks, publish toggle, direct chat settings).
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
        direct_chat_enabled,
        direct_chat_price,
        direct_chat_sla,
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
        direct_chat_enabled,
        direct_chat_price,
        direct_chat_sla,
        voice_provider: req.body.voice_provider || req.body.voiceProvider,
        voice_id: req.body.voice_id || req.body.voiceId,
        voice_sample_url: req.body.voice_sample_url || req.body.voiceSampleUrl,
        voice_settings: req.body.voice_settings || req.body.voiceSettings,
      });

      const sources = await mindKnowledgeRepository.findSourcesByMindId(updated.id);
      const audience_questions = await mindKnowledgeRepository.findAudienceQuestionsByMindId(updated.id, 20);
      const paid_sessions = await mindKnowledgeRepository.findPaidHumanSessionsByMindId(updated.id);

      return res.status(200).json({
        success: true,
        message: updated.is_published
          ? `AI Mind @${updated.handle} is now published in the Commons.`
          : 'AI Mind updated successfully (Private draft).',
        data: {
          ...updated,
          sources,
          audience_questions,
          paid_sessions,
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

  /**
   * POST /api/my-mind/interview
   * Extract creator's philosophy, mental models, and knowledge from guided interview answers.
   */
  async submitInterview(req, res, next) {
    try {
      const userId = req.user.id;
      let mind = await userMindRepository.findByUserId(userId);
      if (!mind) {
        mind = await userMindRepository.upsert(userId, {
          handle: `user_${userId}`,
          display_name: 'My AI Mind',
        });
      }

      const { answers } = req.body;
      if (!Array.isArray(answers) || answers.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'EMPTY_INTERVIEW', message: 'At least one interview answer is required.' },
        });
      }

      const validAnswers = answers.filter((a) => a && a.answer && String(a.answer).trim().length > 0);
      if (validAnswers.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: 'EMPTY_INTERVIEW', message: 'Please provide at least one response.' },
        });
      }

      // Build formatted knowledge document from interview
      const documentBlocks = validAnswers.map(
        (item, idx) =>
          `### Interview Question ${idx + 1}: ${item.question}\nCreator Response & Doctrine:\n${String(item.answer).trim()}`
      );
      const fullContent = `# Creator Brain Interview — Core Philosophy, Frameworks & Wisdom\n\n${documentBlocks.join('\n\n')}`;

      const ingestResult = await knowledgeService.ingestManualText(mind.id, {
        title: `🎙️ Creator Brain Interview (${new Date().toLocaleDateString()})`,
        content: fullContent,
        topic: 'creator_interview',
      });

      // Also enrich philosophy_statement & decision_frameworks if empty or requested
      const firstAnswer = String(validAnswers[0].answer).trim();
      const updatedPhilosophy =
        !mind.philosophy_statement || mind.philosophy_statement.trim().length < 20
          ? firstAnswer
          : `${mind.philosophy_statement}\n\n${firstAnswer}`;

      const existingFrameworks = Array.isArray(mind.decision_frameworks) ? mind.decision_frameworks : [];
      const extractedFrameworks = [...existingFrameworks];
      if (validAnswers[1] && validAnswers[1].answer) {
        const fwSnippet = String(validAnswers[1].answer).trim().slice(0, 140);
        if (!extractedFrameworks.includes(fwSnippet)) {
          extractedFrameworks.push(fwSnippet);
        }
      }

      const updatedMind = await userMindRepository.upsert(userId, {
        ...mind,
        philosophy_statement: updatedPhilosophy,
        decision_frameworks: extractedFrameworks,
      });

      const sources = await mindKnowledgeRepository.findSourcesByMindId(mind.id);
      const audience_questions = await mindKnowledgeRepository.findAudienceQuestionsByMindId(mind.id, 20);

      return res.status(201).json({
        success: true,
        message: `Interview indexed! Extracted ${ingestResult.chunksCreated} knowledge nodes and updated your Mind's core philosophy.`,
        data: {
          ...updatedMind,
          sources,
          audience_questions,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/my-mind/teach-qa
   * Train the AI Mind with a canonical answer to an audience question.
   */
  async teachQuestionAnswer(req, res, next) {
    try {
      const userId = req.user.id;
      const mind = await userMindRepository.findByUserId(userId);
      if (!mind) {
        return res.status(404).json({
          success: false,
          error: { code: 'MIND_NOT_FOUND', message: 'User mind not found.' },
        });
      }

      const { question, answer } = req.body;
      if (!question || !answer || !String(answer).trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_QA', message: 'Both question and canonical answer are required.' },
        });
      }

      const cleanQ = String(question).trim();
      const cleanA = String(answer).trim();
      const sourceTitle = `Q&A: ${cleanQ.slice(0, 120)}`;
      const content = `Audience Question: "${cleanQ}"\n\nCanonical Answer & Principle from ${mind.display_name || mind.handle}:\n${cleanA}`;

      await knowledgeService.ingestManualText(mind.id, {
        title: sourceTitle,
        content,
        topic: 'creator_qa',
      });

      const sources = await mindKnowledgeRepository.findSourcesByMindId(mind.id);
      const audience_questions = await mindKnowledgeRepository.findAudienceQuestionsByMindId(mind.id, 20);

      return res.status(201).json({
        success: true,
        message: 'Your Mind has permanently learned this answer!',
        data: {
          sources,
          audience_questions,
        },
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * GET /api/my-mind/paid-sessions
   * Fetch all paid direct human chat sessions for the creator's VIP Inbox.
   */
  async getPaidSessions(req, res, next) {
    try {
      const userId = req.user.id;
      const mind = await userMindRepository.findByUserId(userId);
      if (!mind) {
        return res.status(200).json({ success: true, data: [] });
      }
      const paid_sessions = await mindKnowledgeRepository.findPaidHumanSessionsByMindId(mind.id);
      return res.status(200).json({
        success: true,
        data: paid_sessions,
      });
    } catch (err) {
      return next(err);
    }
  }

  /**
   * POST /api/my-mind/paid-sessions/:sessionId/reply
   * Creator sends a personal human reply directly into a visitor's unlocked paid session.
   */
  async replyToPaidSession(req, res, next) {
    try {
      const userId = req.user.id;
      const mind = await userMindRepository.findByUserId(userId);
      if (!mind) {
        return res.status(404).json({
          success: false,
          error: { code: 'MIND_NOT_FOUND', message: 'User mind not found.' },
        });
      }

      const sessionId = parseInt(req.params.sessionId, 10);
      const { content } = req.body || {};
      if (!content || !String(content).trim()) {
        return res.status(400).json({
          success: false,
          error: { code: 'EMPTY_REPLY', message: 'Reply message text is required.' },
        });
      }

      const session = await mindKnowledgeRepository.findConsultationSessionById(sessionId);
      if (!session || Number(session.mind_id) !== Number(mind.id)) {
        return res.status(404).json({
          success: false,
          error: { code: 'SESSION_NOT_FOUND', message: 'Paid session not found.' },
        });
      }

      // Save message with sender_type = 'creator' (Verified Human Reply)
      await mindKnowledgeRepository.createConsultationMessage(
        sessionId,
        'creator',
        String(content).trim()
      );
      await mindKnowledgeRepository.markCreatorSessionRead(sessionId);

      const paid_sessions = await mindKnowledgeRepository.findPaidHumanSessionsByMindId(mind.id);

      return res.status(201).json({
        success: true,
        message: 'Personal reply sent to visitor.',
        data: paid_sessions,
      });
    } catch (err) {
      return next(err);
    }
  }
}

export const myMindController = new MyMindController();
export default myMindController;
