import * as cheerio from 'cheerio';

/**
 * TextCleanerService
 * Sanitizes and cleans scraped webpage content and raw document text
 * to optimize token density and remove noise for knowledge ingestion.
 */
export class TextCleanerService {
  /**
   * Cleans raw HTML from a scraped website or blog post.
   * Extracts primary article body and document title.
   * @param {string} html - Raw HTML string
   * @returns {{ title: string, text: string }}
   */
  cleanHtml(html) {
    if (!html || typeof html !== 'string') {
      return { title: '', text: '' };
    }

    const $ = cheerio.load(html);

    // Extract title before removing elements
    const pageTitle = ($('title').text() || $('meta[property="og:title"]').attr('content') || $('h1').first().text() || '')
      .trim()
      .replace(/\s+/g, ' ');

    // Remove noisy / non-content elements
    $(
      'script, style, nav, footer, header, noscript, iframe, aside, svg, form, ' +
      'dialog, button, [role="banner"], [role="navigation"], [role="dialog"], ' +
      '.cookie, .cookie-banner, #cookie-banner, .advertisement, .ads, .sidebar, ' +
      '.menu, #menu, .nav, #nav, .footer, #footer, .share-buttons, .social-share'
    ).remove();

    // Prefer primary content container if present
    let rawContent = '';
    const mainSelectors = ['article', 'main', '[role="main"]', '.post-content', '.entry-content', '.article-content', '#content', '.content'];
    for (const selector of mainSelectors) {
      const match = $(selector);
      if (match.length > 0) {
        rawContent = match.text();
        break;
      }
    }

    if (!rawContent) {
      rawContent = $('body').text() || $.text();
    }

    const cleanedText = this.cleanText(rawContent);

    return {
      title: pageTitle,
      text: cleanedText,
    };
  }

  /**
   * Normalizes whitespace, strips excessive line breaks, and trims text.
   * @param {string} text - Raw text
   * @returns {string} Cleaned normalized text
   */
  cleanText(text) {
    if (!text || typeof text !== 'string') return '';

    return text
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      // Replace tabs or multiple spaces with a single space
      .replace(/[ \t]+/g, ' ')
      // Remove lines that are just whitespace
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .join('\n\n')
      .trim();
  }
}

export const textCleanerService = new TextCleanerService();
export default textCleanerService;
