/**
 * Page content extractor. Injected into the target page (ISOLATED world) after
 * `lib/turndown.js` and `lib/markdown-cleanup.js`, both of which it depends on.
 *
 * Exposes `globalThis.__WCM_EXTRACT__(options)` which the popup calls to run
 * extraction and receive `{ success, markdown, html, title }`.
 */
(function () {
  'use strict';

  const CLEANUP = globalThis.__WCM_CLEANUP__;

  // Generic content selectors, tried when no site handler matches (or the
  // handler's selectors don't yield enough content).
  const GENERIC_SELECTORS = [
    'article',
    '[role="main"]',
    'main',
    '.post-content',
    '.article-content',
    '.entry-content',
    '.content',
    '#content',
    '[role="article"]'
  ];

  const MIN_CONTENT_LENGTH = 100;   // A candidate must contain at least this much text
  const MIN_CONTENT_RATIO = 0.3;    // ...and at least 30% of the body's text

  function getMetaContent(name) {
    const meta = document.querySelector(
      `meta[name="${name}"], meta[property="${name}"]`
    );
    return meta?.content?.trim() || null;
  }

  function extractMetadata(title) {
    const url = window.location.href;
    const now = new Date();
    // Format date and time in the user's local timezone. (Mixing toISOString,
    // which is UTC, with local time produced mismatched values near midnight.)
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr =
      `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
      ` at ${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const siteName =
      getMetaContent('og:site_name') ||
      getMetaContent('application-name') ||
      getMetaContent('publisher') ||
      window.location.hostname.replace(/^www\./, '');

    const authorName =
      getMetaContent('author') ||
      getMetaContent('article:author') ||
      getMetaContent('twitter:creator') ||
      null;

    const section =
      getMetaContent('article:section') ||
      getMetaContent('category') ||
      null;

    return { title, url, dateStr, siteName, authorName, section };
  }

  /**
   * Remove site-specific UI cruft from a cloned content element.
   * Conservative: only removes elements we're confident are not content.
   */
  function cleanContentElement(element, handler) {
    if (handler && handler.removeSelectors) {
      for (const selector of handler.removeSelectors) {
        try {
          element.querySelectorAll(selector).forEach((el) => el.remove());
        } catch (e) {
          // Ignore invalid selectors
        }
      }
    }
    return element;
  }

  function getMainContent(handler) {
    // Site-specific selectors first (most specific wins)
    if (handler && handler.contentSelectors) {
      for (const selector of handler.contentSelectors) {
        const element = document.querySelector(selector);
        if (element && element.textContent.trim().length > MIN_CONTENT_LENGTH) {
          return cleanContentElement(element.cloneNode(true), handler);
        }
      }
    }

    const bodyTextLength = document.body.textContent.trim().length;

    for (const selector of GENERIC_SELECTORS) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim().length > MIN_CONTENT_LENGTH) {
        // Only use a candidate that holds a reasonable portion of body content
        if (element.textContent.trim().length >= bodyTextLength * MIN_CONTENT_RATIO) {
          return cleanContentElement(element.cloneNode(true), handler);
        }
      }
    }

    // Fall back to body if no suitable element found
    return cleanContentElement(document.body.cloneNode(true), handler);
  }

  /**
   * Normalize strong/b tags before Turndown conversion to fix malformed bold
   * tags that span block elements.
   */
  function preprocessHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    doc.querySelectorAll('strong, b').forEach((el) => {
      // Remove empty or whitespace-only strong tags
      if (!el.textContent.trim()) {
        el.replaceWith(...el.childNodes);
        return;
      }

      // If strong contains block elements, unwrap it to prevent broken markdown
      const hasBlockChild = el.querySelector('p, div, ul, ol, li, br, h1, h2, h3, h4, h5, h6');
      if (hasBlockChild) {
        el.replaceWith(...el.childNodes);
        return;
      }

      // Trim whitespace from text nodes at start and end of strong element
      const firstChild = el.firstChild;
      const lastChild = el.lastChild;

      if (firstChild && firstChild.nodeType === Node.TEXT_NODE) {
        firstChild.textContent = firstChild.textContent.replace(/^\s+/, '');
      }
      if (lastChild && lastChild.nodeType === Node.TEXT_NODE) {
        lastChild.textContent = lastChild.textContent.replace(/\s+$/, '');
      }

      // If after trimming the element is empty, unwrap it
      if (!el.textContent.trim()) {
        el.replaceWith(...el.childNodes);
      }
    });

    return doc.body.innerHTML;
  }

  function buildTurndownService(options) {
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined'
    });

    // Remove elements hidden via inline styles. NOTE: this only catches inline
    // style="display:none" — class-based hiding isn't detectable here because
    // the content is converted from a detached clone (no computed styles).
    turndownService.addRule('removeHidden', {
      filter: function (node) {
        const style = node.style;
        return style && (style.display === 'none' || style.visibility === 'hidden');
      },
      replacement: () => ''
    });

    // Remove empty links (links with no text content) - never meaningful content
    turndownService.addRule('removeEmptyLinks', {
      filter: function (node) {
        return node.nodeName === 'A' && !node.textContent.trim();
      },
      replacement: () => ''
    });

    // Handle strong/bold whitespace properly
    turndownService.addRule('strong', {
      filter: ['strong', 'b'],
      replacement: function (content) {
        content = content.trim();
        if (!content) return '';
        // Don't bold if content is just punctuation or whitespace
        if (/^[\s.,;:!?\-]+$/.test(content)) return content;
        return '**' + content + '**';
      }
    });

    // Handle images, including decoding CDN URLs that wrap the real source
    turndownService.addRule('images', {
      filter: 'img',
      replacement: function (content, node) {
        let src = node.getAttribute('src') || '';
        const alt = node.getAttribute('alt') || '';

        if (!src || !options.includeImages) return '';

        // Substack: https://substackcdn.com/image/fetch/...params.../https%3A%2F%2F...
        const substackMatch = src.match(/substackcdn\.com\/image\/fetch\/[^/]+\/+(https?%3A%2F%2F[^\s]+)/i);
        if (substackMatch) {
          try {
            src = decodeURIComponent(substackMatch[1]);
          } catch (e) {
            // Use as-is if decode fails
          }
        }

        // Other CDN patterns that encode the source URL
        const encodedUrlMatch = src.match(/\/(https?%3A%2F%2F[^\s?]+)/i);
        if (!substackMatch && encodedUrlMatch) {
          try {
            src = decodeURIComponent(encodedUrlMatch[1]);
          } catch (e) {
            // Keep original if decode fails
          }
        }

        src = src.replace(/\s+/g, '%20');
        return alt ? `![${alt}](${src})` : `![](${src})`;
      }
    });

    // 4-space indentation for nested lists (compatible with Notion, GitHub, etc.)
    turndownService.addRule('listItem', {
      filter: 'li',
      replacement: function (content, node, opts) {
        content = content
          .replace(/^\n+/, '')
          .replace(/\n+$/, '\n')
          .replace(/\n/gm, '\n    ');

        let prefix = opts.bulletListMarker + ' ';
        const parent = node.parentNode;
        if (parent.nodeName === 'OL') {
          const start = parent.getAttribute('start');
          const index = Array.from(parent.children)
            .filter((el) => el.nodeName === 'LI')
            .indexOf(node);
          const number = (start ? parseInt(start, 10) : 1) + index;
          prefix = number + '. ';
        }

        return prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '');
      }
    });

    return turndownService;
  }

  function extractPageContent(options) {
    options = options || {};
    try {
      const hostname = window.location.hostname;
      const handler = CLEANUP.getSiteHandler(hostname);

      let title = document.title || 'Untitled Page';
      if (handler && handler.cleanTitle) {
        title = handler.cleanTitle(title);
      }

      const contentElement = getMainContent(handler);

      // Remove non-content / unsafe elements once, so the Markdown conversion
      // and the raw HTML export stay consistent. (Previously this was split
      // between a DOM pass and a Turndown filter rule.) `img` is dropped only
      // when images are disabled; otherwise the image rule handles them.
      const outputRemovals = [
        'script', 'style', 'noscript', 'iframe',
        'nav', '[role="navigation"]',
        'footer', 'aside', 'header'
      ];
      if (!options.includeImages) {
        outputRemovals.push('img');
      }
      outputRemovals.forEach((selector) => {
        try {
          contentElement.querySelectorAll(selector).forEach((el) => el.remove());
        } catch (e) {
          // Ignore invalid selectors
        }
      });

      const html = preprocessHtml(contentElement.innerHTML);
      const metadata = extractMetadata(title);

      const turndownService = buildTurndownService(options);
      let markdown = turndownService.turndown(html);

      // Site-specific markdown cleanup before generic post-processing
      if (handler && handler.cleanMarkdown) {
        markdown = handler.cleanMarkdown(markdown);
      }

      const header = CLEANUP.buildMetadataHeader(metadata);
      markdown = `# ${metadata.title}\n\n${header}\n---\n\n${markdown}`;
      markdown = CLEANUP.postProcessMarkdown(markdown, { hostname, handler });

      return { success: true, markdown, html, title: metadata.title };
    } catch (error) {
      return { success: false, error: error.message || 'Unknown error during extraction' };
    }
  }

  globalThis.__WCM_EXTRACT__ = extractPageContent;
})();
