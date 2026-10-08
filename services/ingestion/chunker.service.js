/**
 * ChunkerService
 * Segments text into searchable paragraphs (~500 tokens) with context headers.
 */
export class ChunkerService {
  /**
   * Split document into overlapping chunks with context headers.
   * @param {string} text - Cleaned source text
   * @param {Object} [options]
   * @param {number} [options.maxChunkChars=2000] - ~500 tokens (approx 4 chars/token)
   * @param {number} [options.overlapChars=350] - ~85 tokens overlap
   * @param {string} [options.title=''] - Default title for chunk context header
   * @param {string} [options.topic='general'] - Topic category
   * @returns {Array<{ title: string, topic: string, content: string, chunkIndex: number }>}
   */
  chunkText(text, options = {}) {
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return [];
    }

    const maxChars = options.maxChunkChars || 2000;
    const overlapChars = Math.min(options.overlapChars || 350, Math.floor(maxChars / 2));
    const title = (options.title || 'Knowledge Note').trim();
    const topic = options.topic || 'general';

    const normalized = text.trim();
    const contextHeader = `[Source: ${title}]\n\n`;

    // If text is shorter than max chunk length, return as single chunk with context header
    if (normalized.length <= maxChars) {
      return [
        {
          title,
          topic,
          content: `${contextHeader}${normalized}`,
          chunkIndex: 0,
        },
      ];
    }

    // Split text by paragraphs first to preserve semantic cohesion
    const paragraphs = normalized.split(/\n\n+/);
    const rawChunks = [];
    let currentChunk = '';

    for (const para of paragraphs) {
      const trimmedPara = para.trim();
      if (!trimmedPara) continue;

      if (!currentChunk) {
        currentChunk = trimmedPara;
      } else if (currentChunk.length + trimmedPara.length + 2 <= maxChars) {
        currentChunk += '\n\n' + trimmedPara;
      } else {
        // Current chunk reached capacity
        rawChunks.push(currentChunk.trim());

        // Calculate overlap from the end of currentChunk
        const overlapSlice = currentChunk.slice(-overlapChars);
        const sentenceBreak = overlapSlice.search(/[.?!]\s+/);
        const cleanOverlap = sentenceBreak !== -1 ? overlapSlice.slice(sentenceBreak + 2) : overlapSlice;

        currentChunk = (cleanOverlap.trim() ? cleanOverlap.trim() + '\n\n' : '') + trimmedPara;

        // If a single paragraph itself exceeds maxChars, slice by natural sentence break
        while (currentChunk.length > maxChars) {
          const slicePoint = this.findNaturalBreak(currentChunk, maxChars);
          const chunkContent = currentChunk.slice(0, slicePoint).trim();
          rawChunks.push(chunkContent);

          const remainingOverlap = chunkContent.slice(-overlapChars);
          currentChunk = remainingOverlap.trim() + ' ' + currentChunk.slice(slicePoint).trim();
        }
      }
    }

    if (currentChunk.trim().length > 0) {
      rawChunks.push(currentChunk.trim());
    }

    // Format final chunks with context headers and parts
    return rawChunks.map((chunk, index) => {
      const chunkTitle = rawChunks.length > 1 ? `${title} (Part ${index + 1})` : title;
      return {
        title: chunkTitle,
        topic,
        content: `[Source: ${chunkTitle}]\n\n${chunk}`,
        chunkIndex: index,
      };
    });
  }

  /**
   * Find a natural sentence or word break near target length
   */
  findNaturalBreak(text, targetLength) {
    if (text.length <= targetLength) return text.length;

    const window = text.slice(Math.floor(targetLength * 0.75), targetLength + 50);
    const sentenceMatch = window.match(/[.?!](\s+|$)/);
    if (sentenceMatch && sentenceMatch.index !== undefined) {
      return Math.floor(targetLength * 0.75) + sentenceMatch.index + 1;
    }

    const lastSpace = text.lastIndexOf(' ', targetLength);
    if (lastSpace > targetLength * 0.6) {
      return lastSpace;
    }

    return targetLength;
  }
}

export default new ChunkerService();
