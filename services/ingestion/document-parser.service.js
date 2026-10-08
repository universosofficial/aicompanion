import path from 'path';
import { PDFParse } from 'pdf-parse';

/**
 * Document Parser Service
 * Extracts clean plaintext from .pdf, .txt, and .md files.
 */
class DocumentParserService {
  /**
   * Parse uploaded or local document into plaintext
   * @param {Buffer|string} fileInput - Buffer or file text
   * @param {string} originalFilename - Original filename with extension
   * @returns {Promise<{ title: string, content: string, format: string, wordCount: number }>}
   */
  async parseDocument(fileInput, originalFilename = 'document.txt') {
    const ext = path.extname(originalFilename).toLowerCase();
    const basename = path.basename(originalFilename, ext);
    let title = basename.replace(/[-_]+/g, ' ').trim();
    let rawText = '';
    let format = 'text';

    if (ext === '.pdf') {
      format = 'pdf';
      const buffer = Buffer.isBuffer(fileInput) ? fileInput : Buffer.from(fileInput);
      try {
        const parser = new PDFParse({ data: buffer });
        const result = await parser.getText();
        rawText = result?.text || '';
        await parser.destroy();
      } catch (pdfErr) {
        throw new Error(`Failed to parse PDF document (${originalFilename}): ${pdfErr.message}`);
      }
    } else if (ext === '.md' || ext === '.markdown') {
      format = 'markdown';
      rawText = Buffer.isBuffer(fileInput) ? fileInput.toString('utf-8') : String(fileInput);
      // Extract title from first markdown header if present
      const headerMatch = rawText.match(/^#\s+(.+)$/m);
      if (headerMatch) {
        title = headerMatch[1].trim();
      }
    } else if (ext === '.txt' || ext === '') {
      format = 'text';
      rawText = Buffer.isBuffer(fileInput) ? fileInput.toString('utf-8') : String(fileInput);
      // Extract title from first line if short
      const firstLine = rawText.split('\n')[0]?.trim();
      if (firstLine && firstLine.length > 3 && firstLine.length < 80) {
        title = firstLine;
      }
    } else {
      throw new Error(`Unsupported document extension '${ext}'. Supported formats: .pdf, .txt, .md`);
    }

    // Clean whitespace and normalize text
    const cleanedText = rawText
      .replace(/\r\n/g, '\n')
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const wordCount = cleanedText.split(/\s+/).filter(Boolean).length;
    if (wordCount < 5) {
      throw new Error(`Document "${originalFilename}" does not contain sufficient text (${wordCount} words).`);
    }

    return {
      title: title.slice(0, 255),
      content: cleanedText,
      format,
      wordCount,
    };
  }
}

export default new DocumentParserService();
