// State
let currentMarkdown = null;
let currentTitle = null;

// DOM Elements
const copyBtn = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');
const includeImagesCheckbox = document.getElementById('includeImages');
const preview = document.getElementById('preview');
const status = document.getElementById('status');

// Event Listeners
copyBtn.addEventListener('click', copyMarkdown);
downloadBtn.addEventListener('click', downloadMarkdown);
includeImagesCheckbox.addEventListener('change', createMarkdown);

// Auto-trigger create when extension opens
document.addEventListener('DOMContentLoaded', () => createMarkdown());

/**
 * Check if URL is restricted (cannot inject content scripts)
 */
function isRestrictedUrl(url) {
  if (!url) return true;
  
  const restrictedPatterns = [
    /^chrome:\/\//,
    /^chrome-extension:\/\//,
    /^edge:\/\//,
    /^about:/,
    /^view-source:/,
    /^file:\/\//,
    /^https:\/\/chrome\.google\.com\/webstore/,
    /^https:\/\/microsoftedge\.microsoft\.com\/addons/
  ];
  
  return restrictedPatterns.some(pattern => pattern.test(url));
}

/**
 * Set action buttons disabled state
 */
function setActionsDisabled(disabled) {
  const isDisabled = disabled || !currentMarkdown;
  copyBtn.disabled = isDisabled;
  downloadBtn.disabled = isDisabled;
}

/**
 * Set status message with optional type
 */
function setStatus(message, type = '') {
  status.textContent = message;
  status.className = 'status' + (type ? ` ${type}` : '');
}

/**
 * Display markdown in preview area
 */
function displayMarkdown(markdown) {
  preview.textContent = markdown;
  preview.className = 'preview';
}

/**
 * Display error in preview area
 */
function displayError(message) {
  preview.textContent = `Error: ${message}`;
  preview.className = 'preview error';
}

/**
 * Display loading state
 */
function displayLoading() {
  preview.textContent = 'Extracting content...';
  preview.className = 'preview loading';
}

/**
 * Main function to create markdown from current tab
 */
async function createMarkdown() {
  setActionsDisabled(true);
  setStatus('Processing...', 'loading');
  displayLoading();
  
  try {
    // Get active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    if (!tab) {
      throw new Error('No active tab found');
    }
    
    // Check for restricted URLs
    if (isRestrictedUrl(tab.url)) {
      throw new Error('Cannot access this page. Chrome system pages, the Web Store, and local files are restricted.');
    }
    
    // Get options
    const options = {
      includeImages: includeImagesCheckbox.checked
    };
    
    // Inject Turndown library first
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/turndown.js']
    });
    
    // Inject and execute content script with options
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContent,
      args: [options]
    });
    
    const result = results[0]?.result;
    
    if (!result) {
      throw new Error('Failed to extract content - no result returned');
    }
    
    if (!result.success) {
      throw new Error(result.error || 'Content extraction failed');
    }
    
    // Success - store and display markdown
    currentMarkdown = result.markdown;
    currentTitle = result.title;
    displayMarkdown(currentMarkdown);
    setStatus('Generated successfully', 'success');
    setActionsDisabled(false);
    
  } catch (error) {
    console.error('Error creating markdown:', error);
    currentMarkdown = null;
    currentTitle = null;
    displayError(error.message);
    setStatus(error.message, 'error');
    setActionsDisabled(true);
  }
}

/**
 * Copy markdown to clipboard
 */
async function copyMarkdown() {
  if (!currentMarkdown) {
    setStatus('No content to copy', 'error');
    return;
  }
  
  try {
    await navigator.clipboard.writeText(currentMarkdown);
    setStatus('Copied to clipboard!', 'success');
    
    // Visual feedback on copy button
    copyBtn.classList.add('copied');
    copyBtn.querySelector('.btn-text').textContent = 'Copied!';
    
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.querySelector('.btn-text').textContent = 'Copy';
    }, 1500);
    
  } catch (error) {
    console.error('Error copying to clipboard:', error);
    setStatus('Failed to copy: ' + error.message, 'error');
  }
}

/**
 * Download markdown as .md file
 */
function downloadMarkdown() {
  if (!currentMarkdown) {
    setStatus('No content to download', 'error');
    return;
  }
  
  try {
    // Create filename from title, sanitizing invalid characters
    const sanitizedTitle = (currentTitle || 'content')
      .replace(/[<>:"/\\|?*]/g, '-')  // Replace invalid filename chars
      .replace(/\s+/g, '-')           // Replace spaces with hyphens
      .replace(/-+/g, '-')            // Collapse multiple hyphens
      .replace(/^-|-$/g, '')          // Remove leading/trailing hyphens
      .substring(0, 100);             // Limit length
    
    const filename = `${sanitizedTitle}.md`;
    
    // Create blob and download
    const blob = new Blob([currentMarkdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    setStatus('Downloaded!', 'success');
    
    // Visual feedback on download button
    downloadBtn.classList.add('copied');
    downloadBtn.querySelector('.btn-text').textContent = 'Done!';
    
    setTimeout(() => {
      downloadBtn.classList.remove('copied');
      downloadBtn.querySelector('.btn-text').textContent = 'Download';
    }, 1500);
    
  } catch (error) {
    console.error('Error downloading file:', error);
    setStatus('Failed to download: ' + error.message, 'error');
  }
}

/**
 * Content extraction function - injected into the page
 * This function runs in the context of the target page
 */
function extractPageContent(options) {
  'use strict';
  
  function extractMetadata(title) {
    const url = window.location.href;
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10) + ' at ' + 
                    now.toTimeString().slice(0, 5);
    
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
  
  function getMetaContent(name) {
    const meta = document.querySelector(
      `meta[name="${name}"], meta[property="${name}"]`
    );
    return meta?.content?.trim() || null;
  }
  
  function buildMetadataHeader(meta) {
    // Use plain text format without blockquotes for better Notion compatibility
    // Notion treats > as callouts which don't render multi-line content well
    // Use double newlines to ensure proper line breaks in Notion
    const lines = [
      `**Source:** ${meta.url}`,
      `**Extracted:** ${meta.dateStr}`,
      `**Site:** ${meta.siteName}`
    ];
    
    if (meta.authorName) {
      lines.push(`**Author:** ${meta.authorName}`);
    }
    if (meta.section) {
      lines.push(`**Section:** ${meta.section}`);
    }
    
    return lines.join('\n\n') + '\n';
  }
  
  function getMainContent() {
    // Site-specific selectors (most specific first)
    const siteSpecificSelectors = {
      'substack.com': [
        '.body.markup',           // Substack article body
        '.post-content',          // Alternative Substack selector
        'article .body',
        'article'
      ],
      'medium.com': [
        'article section',
        'article'
      ]
    };
    
    // Generic selectors
    const genericSelectors = [
      'article',
      '[role="main"]',
      'main',
      '.post-content',
      '.article-content',
      '.entry-content',
      '.content',
      '#content',
      '[role="article"]',
      '.feed-shared-update-v2',  // LinkedIn posts
      '.scaffold-layout__main'   // LinkedIn main area
    ];
    
    // Check for site-specific selectors first
    const hostname = window.location.hostname;
    for (const [site, selectors] of Object.entries(siteSpecificSelectors)) {
      if (hostname.includes(site)) {
        for (const selector of selectors) {
          const element = document.querySelector(selector);
          if (element && element.textContent.trim().length > 100) {
            return cleanContentElement(element.cloneNode(true));
          }
        }
      }
    }
    
    const bodyTextLength = document.body.textContent.trim().length;
    const MIN_CONTENT_RATIO = 0.3;  // Candidate must have at least 30% of body text
    
    for (const selector of genericSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim().length > 100) {
        const elementTextLength = element.textContent.trim().length;
        
        // If candidate has reasonable portion of body content, use it
        if (elementTextLength >= bodyTextLength * MIN_CONTENT_RATIO) {
          return cleanContentElement(element.cloneNode(true));
        }
        // Otherwise continue checking other selectors
      }
    }
    
    // Fall back to body if no suitable element found
    return cleanContentElement(document.body.cloneNode(true));
  }
  
  /**
   * Remove unwanted elements from content before conversion
   * Conservative approach: only remove elements we're confident are UI cruft
   */
  function cleanContentElement(element) {
    const hostname = window.location.hostname;
    
    // Site-specific selectors - only apply to known sites
    const siteSpecificRemovals = {
      'substack.com': [
        '.subscribe-widget',
        '.subscription-widget', 
        '.subscribe-prompt',
        '.post-ufi',                    // Likes/shares row
        '.like-button-container',
        '.share-dialog',
        '.restack-button',
        '.frontend-components-notification',
        '.paywall',
        '.guest-post-subscribe-section',
        '.recommendations',
        '.recommendations-container'
      ],
      'medium.com': [
        '[data-testid="audioPlayButton"]',
        '[data-testid="headerSocialShareButton"]'
      ]
    };
    
    // Apply site-specific removals
    for (const [site, selectors] of Object.entries(siteSpecificRemovals)) {
      if (hostname.includes(site)) {
        for (const selector of selectors) {
          try {
            element.querySelectorAll(selector).forEach(el => el.remove());
          } catch (e) {
            // Ignore invalid selectors
          }
        }
      }
    }
    
    // Very conservative generic removals - only things that are clearly not content
    // These use exact class names, not substring matches
    const safeGenericRemovals = [
      'nav',
      '[role="navigation"]'
    ];
    
    for (const selector of safeGenericRemovals) {
      try {
        element.querySelectorAll(selector).forEach(el => el.remove());
      } catch (e) {
        // Ignore invalid selectors
      }
    }
    
    return element;
  }
  
  /**
   * Preprocess HTML to normalize strong/b tags before Turndown conversion
   * This fixes issues with malformed bold tags that span block elements
   */
  function preprocessHtml(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    
    // Find all strong/b elements and normalize them
    doc.querySelectorAll('strong, b').forEach(el => {
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
      
      // If after trimming, element is empty, remove it
      if (!el.textContent.trim()) {
        el.replaceWith(...el.childNodes);
      }
    });
    
    return doc.body.innerHTML;
  }
  
  try {
    const title = document.title || 'Untitled Page';
    const contentElement = getMainContent();
    const html = preprocessHtml(contentElement.innerHTML);
    
    const metadata = extractMetadata(title);
    
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '*',
      strongDelimiter: '**',
      linkStyle: 'inlined'
    });
    
    // Filter out unwanted elements
    const filterElements = ['script', 'style', 'noscript', 'iframe', 'nav', 'footer', 'aside', 'header'];
    
    // Add img to filter if not including images
    if (!options.includeImages) {
      filterElements.push('img');
    }
    
    turndownService.addRule('removeUnwanted', {
      filter: filterElements,
      replacement: () => ''
    });
    
    turndownService.addRule('removeHidden', {
      filter: function(node) {
        const style = node.style;
        return style && (style.display === 'none' || style.visibility === 'hidden');
      },
      replacement: () => ''
    });
    
    // Remove empty links (links with no text content)
    // Safe: empty links are never meaningful content
    turndownService.addRule('removeEmptyLinks', {
      filter: function(node) {
        return node.nodeName === 'A' && !node.textContent.trim();
      },
      replacement: () => ''
    });
    
    // Custom rule for strong/bold to handle whitespace properly
    turndownService.addRule('strong', {
      filter: ['strong', 'b'],
      replacement: function(content, node, options) {
        // Trim and normalize whitespace
        content = content.trim();
        if (!content) return '';
        
        // Don't bold if content is just punctuation or whitespace
        if (/^[\s.,;:!?\-]+$/.test(content)) return content;
        
        return '**' + content + '**';
      }
    });
    
    // Custom rule for images to handle CDN URLs properly
    turndownService.addRule('images', {
      filter: 'img',
      replacement: function(content, node) {
        let src = node.getAttribute('src') || '';
        const alt = node.getAttribute('alt') || '';
        
        // Skip if no src or if images are disabled
        if (!src || !options.includeImages) return '';
        
        // Fix Substack CDN URLs - extract the actual image URL
        // Substack uses format: https://substackcdn.com/image/fetch/...params.../https%3A%2F%2F...
        const substackMatch = src.match(/substackcdn\.com\/image\/fetch\/[^/]+\/+(https?%3A%2F%2F[^\s]+)/i);
        if (substackMatch) {
          try {
            src = decodeURIComponent(substackMatch[1]);
          } catch (e) {
            // If decode fails, try to use as-is
          }
        }
        
        // Also handle other CDN URL patterns that encode the source URL
        const encodedUrlMatch = src.match(/\/(https?%3A%2F%2F[^\s?]+)/i);
        if (!substackMatch && encodedUrlMatch) {
          try {
            src = decodeURIComponent(encodedUrlMatch[1]);
          } catch (e) {
            // Keep original if decode fails
          }
        }
        
        // Clean up any remaining URL issues
        src = src.replace(/\s+/g, '%20');
        
        return alt ? `![${alt}](${src})` : `![](${src})`;
      }
    });
    
    // Use 4-space indentation for nested lists (universal compatibility with Notion, GitHub, etc.)
    turndownService.addRule('listItem', {
      filter: 'li',
      replacement: function(content, node, options) {
        content = content
          .replace(/^\n+/, '')
          .replace(/\n+$/, '\n')
          .replace(/\n/gm, '\n    '); // 4 spaces for nested content
        
        let prefix = options.bulletListMarker + ' ';
        const parent = node.parentNode;
        if (parent.nodeName === 'OL') {
          const start = parent.getAttribute('start');
          const index = Array.from(parent.children)
            .filter(el => el.nodeName === 'LI')
            .indexOf(node);
          const number = (start ? parseInt(start, 10) : 1) + index;
          prefix = number + '. ';
        }
        
        return prefix + content + (node.nextSibling && !/\n$/.test(content) ? '\n' : '');
      }
    });
    
    let markdown = turndownService.turndown(html);
    
    const header = buildMetadataHeader(metadata);
    markdown = `# ${metadata.title}\n\n${header}\n---\n\n${markdown}`;
    
    markdown = markdown
      // Remove empty bold markers (including those with just whitespace)
      .replace(/\*\*\s*\*\*/g, '')
      // Fix double-double asterisks from adjacent strong tags: **** → single space
      .replace(/\*\*\*\*/g, ' ')
      // Remove standalone ** on their own line
      .replace(/^\*\*\s*$/gm, '')
      // Add line break before bold section headers that follow periods/links
      // Pattern: text ending with . or ) followed by **BoldText (likely a section header)
      .replace(/([.)\]])\s*(\*\*[A-ZÄÖÜ])/g, '$1\n\n$2')
      // Fix missing space/line break when period is immediately followed by capital letter (no space)
      // This indicates text running together that should be separate sections
      .replace(/\.([A-ZÄÖÜ][a-zäöüß])/g, '.\n\n$1')
      
      // Remove specific concatenated UI text patterns (exact matches only)
      .replace(/SubscribeSign in/g, '')
      .replace(/Sign inSubscribe/g, '')
      
      // Remove empty link references like [](/path) - these are never content
      .replace(/\[\s*\]\([^)]*\)/g, '')
      
      // Remove duplicate horizontal rules
      .replace(/(\n---\n)+/g, '\n---\n')
      
      // Clean up excessive newlines
      .replace(/\n{3,}/g, '\n\n')
      // Remove trailing whitespace on lines
      .replace(/[ \t]+$/gm, '')
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
