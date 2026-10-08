import * as cheerio from 'cheerio';

/**
 * Web Scraper Service
 * Extracts readable article/post content from creator URLs.
 */
class WebScraperService {
  /**
   * Scrapes and extracts clean readable text from a URL
   * @param {string} url - Target URL to scrape
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise<{ title: string, content: string, wordCount: number, url: string }>}
   */
  async scrapeUrl(url, timeoutMs = 12000) {
    if (!url || typeof url !== 'string') {
      throw new Error('Valid URL string is required');
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new Error('Only HTTP and HTTPS protocols are supported');
      }
    } catch {
      throw new Error(`Invalid URL format: ${url}`);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let html;
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 AI-Mind-Ingestion/1.0',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch URL: HTTP ${response.status} ${response.statusText}`);
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        throw new Error(`Unsupported content type: ${contentType}. Expected HTML.`);
      }

      html = await response.text();
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Connection timed out after ${timeoutMs}ms while fetching ${url}`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }

    const $ = cheerio.load(html);

    // Remove noise elements
    const noisySelectors = [
      'script',
      'style',
      'noscript',
      'iframe',
      'header',
      'footer',
      'nav',
      'aside',
      '.cookie-banner',
      '#cookie-notice',
      '.advertisement',
      '.adsbygoogle',
      '.sidebar',
      '.comments',
      '#comments',
      '.social-share',
      '.modal',
      '.popup',
      'svg',
      'canvas',
    ];
    $(noisySelectors.join(', ')).remove();

    // Extract page title
    let title =
      $('meta[property="og:title"]').attr('content') ||
      $('title').text() ||
      $('h1').first().text() ||
      parsedUrl.hostname;
    title = title.replace(/\s+/g, ' ').trim();

    // Extract main text content
    let content = '';
    const mainContainers = ['article', 'main', '[role="main"]', '.post-content', '.entry-content', '#content', 'body'];
    for (const selector of mainContainers) {
      const el = $(selector);
      if (el.length > 0 && el.text().trim().length > 150) {
        content = el.text();
        break;
      }
    }

    if (!content) {
      content = $('body').text();
    }

    // Clean whitespace and normalize
    const cleanedContent = content
      .split('\n')
      .map((line) => line.replace(/[ \t]+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    const wordCount = cleanedContent.split(/\s+/).filter(Boolean).length;

    if (wordCount < 10) {
      throw new Error(`Extracted text from ${url} is too short (${wordCount} words) to ingest.`);
    }

    return {
      title: title.slice(0, 255),
      content: cleanedContent,
      wordCount,
      url,
    };
  }
}

export default new WebScraperService();
