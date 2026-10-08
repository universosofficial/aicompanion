import webScraperService from './web-scraper.service.js';
import documentParserService from './document-parser.service.js';
import chunkerService from './chunker.service.js';
import mindKnowledgeRepository from '../../repositories/mind-knowledge.repository.js';

/**
 * KnowledgeService
 * Orchestrates multi-source ingestion (web scraping, document parsing, manual text),
 * chunking with context headers, and storage in mind_sources and mind_knowledge_nodes.
 */
class KnowledgeService {
  /**
   * Ingest website/article URL for an AI Mind.
   * @param {number|string} mindId
   * @param {string} url
   * @param {Object} [options]
   * @returns {Promise<{ source: Object, chunksCreated: number }>}
   */
  async ingestUrl(mindId, url, options = {}) {
    const targetMindId = mindId || options.mindId || options.characterId;

    const source = await mindKnowledgeRepository.createSource({
      mindId: targetMindId,
      sourceType: 'url',
      title: options.title || url,
      sourceUri: url,
      status: 'processing',
    });

    try {
      const scraped = await webScraperService.scrapeUrl(url);
      const effectiveTitle = options.title || scraped.title || url;

      // Slice into searchable chunks with context headers (~500 tokens)
      const chunks = chunkerService.chunkText(scraped.content, {
        title: effectiveTitle,
        topic: options.topic || 'article',
        maxChunkChars: 2000,
        overlapChars: 350,
      });

      if (chunks.length === 0) {
        throw new Error('No searchable content chunks could be generated from this URL.');
      }

      // Batch insert knowledge nodes
      const chunksCreated = await mindKnowledgeRepository.insertKnowledgeChunks(targetMindId, source.id, chunks);

      // Update source status
      await mindKnowledgeRepository.updateSourceStatus(source.id, {
        status: 'indexed',
        chunkCount: chunksCreated,
      });

      const updatedSource = await mindKnowledgeRepository.findSourceById(source.id);
      return Object.assign({}, updatedSource, {
        source: updatedSource,
        chunksCreated,
      });
    } catch (err) {
      await mindKnowledgeRepository.updateSourceStatus(source.id, {
        status: 'failed',
        chunkCount: 0,
        errorMessage: err.message,
      });
      throw err;
    }
  }

  /**
   * Ingest uploaded file (.pdf, .txt, .md).
   * Supports both positional and object arguments.
   * @param {number|string|Object} mindIdOrParams
   * @param {Buffer|string} [maybeFileBuffer]
   * @param {string} [maybeOriginalFilename]
   * @param {Object} [maybeOptions]
   * @returns {Promise<{ source: Object, chunksCreated: number }>}
   */
  async ingestDocument(mindIdOrParams, maybeFileBuffer, maybeOriginalFilename, maybeOptions = {}) {
    let mindId;
    let fileBuffer;
    let originalFilename;
    let options = {};

    if (
      typeof mindIdOrParams === 'object' &&
      mindIdOrParams !== null &&
      !Buffer.isBuffer(mindIdOrParams)
    ) {
      mindId = mindIdOrParams.mindId || mindIdOrParams.characterId;
      fileBuffer = mindIdOrParams.fileBuffer;
      originalFilename =
        mindIdOrParams.fileName ||
        mindIdOrParams.originalFilename ||
        'document.txt';
      options = {
        title: mindIdOrParams.customTitle || mindIdOrParams.title,
        topic: mindIdOrParams.topic || mindIdOrParams.mimetype,
      };
    } else {
      mindId = mindIdOrParams;
      fileBuffer = maybeFileBuffer;
      originalFilename = maybeOriginalFilename || 'document.txt';
      options = maybeOptions || {};
    }

    const ext = originalFilename.toLowerCase().endsWith('.pdf') ? 'pdf' : 'document';

    const source = await mindKnowledgeRepository.createSource({
      mindId,
      sourceType: ext,
      title: options.title || originalFilename,
      sourceUri: originalFilename,
      status: 'processing',
    });

    try {
      const parsed = await documentParserService.parseDocument(fileBuffer, originalFilename);
      const effectiveTitle = options.title || parsed.title || originalFilename;

      const chunks = chunkerService.chunkText(parsed.content, {
        title: effectiveTitle,
        topic: options.topic || parsed.format,
        maxChunkChars: 2000,
        overlapChars: 350,
      });

      if (chunks.length === 0) {
        throw new Error('No indexable chunks could be generated from document.');
      }

      const chunksCreated = await mindKnowledgeRepository.insertKnowledgeChunks(mindId, source.id, chunks);

      await mindKnowledgeRepository.updateSourceStatus(source.id, {
        status: 'indexed',
        chunkCount: chunksCreated,
      });

      const updatedSource = await mindKnowledgeRepository.findSourceById(source.id);
      return Object.assign({}, updatedSource, {
        source: updatedSource,
        chunksCreated,
      });
    } catch (err) {
      await mindKnowledgeRepository.updateSourceStatus(source.id, {
        status: 'failed',
        chunkCount: 0,
        errorMessage: err.message,
      });
      throw err;
    }
  }

  /**
   * Ingest raw manual text / doctrine / rulebook directly written in the Training Studio.
   * @param {number|string} mindId
   * @param {Object} payload
   * @param {string} payload.title
   * @param {string} payload.content
   * @param {string} [payload.topic]
   * @returns {Promise<{ source: Object, chunksCreated: number }>}
   */
  async ingestManualText(mindId, { title, content, topic = 'doctrine' }) {
    if (!content || !content.trim()) {
      throw new Error('Content is required for manual doctrine ingestion');
    }

    const effectiveTitle = (title && title.trim()) || 'Core Doctrine';

    const source = await mindKnowledgeRepository.createSource({
      mindId,
      sourceType: 'manual_text',
      title: effectiveTitle,
      sourceUri: null,
      status: 'processing',
    });

    try {
      const chunks = chunkerService.chunkText(content.trim(), {
        title: effectiveTitle,
        topic,
        maxChunkChars: 2000,
        overlapChars: 350,
      });

      if (chunks.length === 0) {
        throw new Error('No searchable chunks could be extracted from text.');
      }

      const chunksCreated = await mindKnowledgeRepository.insertKnowledgeChunks(mindId, source.id, chunks);

      await mindKnowledgeRepository.updateSourceStatus(source.id, {
        status: 'indexed',
        chunkCount: chunksCreated,
      });

      const updatedSource = await mindKnowledgeRepository.findSourceById(source.id);
      return Object.assign({}, updatedSource, {
        source: updatedSource,
        chunksCreated,
      });
    } catch (err) {
      await mindKnowledgeRepository.updateSourceStatus(source.id, {
        status: 'failed',
        chunkCount: 0,
        errorMessage: err.message,
      });
      throw err;
    }
  }

  async ingestTextNote(mindId, title, content, topic = 'doctrine') {
    return this.ingestManualText(mindId, { title, content, topic });
  }
}

export const knowledgeService = new KnowledgeService();
export default knowledgeService;
