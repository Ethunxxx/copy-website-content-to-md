/**
 * Content script for Web Content to MD
 * Extracts page content and converts to Markdown using Turndown
 */

(function() {
  'use strict';
  
  /**
   * Extract metadata from the page
   */
  function extractMetadata(title) {
    const url = window.location.href;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10) + ' at ' + 
                    now.toTimeString().slice(0, 5);
    
    // Try to get site name from meta tags
    const siteName = 
      getMetaContent('og:site_name') ||
      getMetaContent('application-name') ||
      getMetaContent('publisher') ||
      window.location.hostname.replace(/^www\./, '');
    
    // Try to get author from meta tags
    const authorName =
      getMetaContent('author') ||
      getMetaContent('article:author') ||
      getMetaContent('twitter:creator') ||
      null;
    
    // Try to get section/category
    const section = 
      getMetaContent('article:section') ||
      getMetaContent('category') ||
      null;
    
    return { title, url, dateStr, siteName, authorName, section };
  }
  
  /**
   * Helper to get meta tag content by name or property
   */
  function getMetaContent(name) {
    const meta = document.querySelector(
      `meta[name="${name}"], meta[property="${name}"]`
    );
    return meta?.content?.trim() || null;
  }
  
  /**
   * Build the metadata header block
   */
  function buildMetadataHeader(meta) {
    const lines = [
      `> **Source:** ${meta.url}`,
      `> **Extracted:** ${meta.dateStr}`,
      `> **Site:** ${meta.siteName}`
    ];
    
    if (meta.authorName) {
      lines.push(`> **Author:** ${meta.authorName}`);
    }
    if (meta.section) {
      lines.push(`> **Section:** ${meta.section}`);
    }
    
    return lines.join('\n') + '\n';
  }
  
  /**
   * Get the main content element or fallback to body
   */
  function getMainContent() {
    // Try common content selectors in order of preference
    const selectors = [
      'article',
      '[role="main"]',
      'main',
      '.post-content',
      '.article-content',
      '.entry-content',
      '.content',
      '#content'
    ];
    
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim().length > 100) {
        return element;
      }
    }
    
    // Fallback to body
    return document.body;
  }
  
  /**
   * Main extraction function
   */
  function extractContent() {
    try {
      const title = document.title || 'Untitled Page';
      const contentElement = getMainContent();
      const html = contentElement.innerHTML;
      
      // Extract metadata
      const metadata = extractMetadata(title);
      
      // Configure Turndown for clean markdown output
      const turndownService = new TurndownService({
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
        strongDelimiter: '**',
        linkStyle: 'inlined'
      });
      
      // Add rules to filter out unwanted elements
      turndownService.addRule('removeUnwanted', {
        filter: ['script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'aside', 'header'],
        replacement: () => ''
      });
      
      // Remove hidden elements
      turndownService.addRule('removeHidden', {
        filter: function(node) {
          const style = node.style;
          return style && (style.display === 'none' || style.visibility === 'hidden');
        },
        replacement: () => ''
      });
      
      // Convert HTML to Markdown
      let markdown = turndownService.turndown(html);
      
      // Build final output: Title + Metadata + Separator + Content
      const header = buildMetadataHeader(metadata);
      markdown = `# ${metadata.title}\n\n${header}\n---\n\n${markdown}`;
      
      // Clean up excessive whitespace
      markdown = markdown
        .replace(/\n{3,}/g, '\n\n')  // Max 2 consecutive newlines
        .replace(/[ \t]+$/gm, '')     // Remove trailing spaces
        .trim();
      
      return { 
        success: true, 
        markdown, 
        title: metadata.title,
        url: metadata.url
      };
      
    } catch (error) {
      return { 
        success: false, 
        error: error.message || 'Unknown error during extraction'
      };
    }
  }
  
  // Execute and return result
  return extractContent();
})();
