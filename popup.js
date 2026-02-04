// State
let currentMarkdown = null;

// DOM Elements
const createBtn = document.getElementById('createBtn');
const copyBtn = document.getElementById('copyBtn');
const createCopyBtn = document.getElementById('createCopyBtn');
const includeImagesCheckbox = document.getElementById('includeImages');
const preview = document.getElementById('preview');
const status = document.getElementById('status');

// Event Listeners
createBtn.addEventListener('click', () => createMarkdown(false));
copyBtn.addEventListener('click', copyMarkdown);
createCopyBtn.addEventListener('click', () => createMarkdown(true));

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
 * Set button disabled states
 */
function setButtonsDisabled(disabled) {
  createBtn.disabled = disabled;
  createCopyBtn.disabled = disabled;
  // Copy button has special handling - only enabled when there's content
  copyBtn.disabled = disabled || !currentMarkdown;
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
async function createMarkdown(copyAfter = false) {
  setButtonsDisabled(true);
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
    displayMarkdown(currentMarkdown);
    setStatus('Generated successfully', 'success');
    copyBtn.disabled = false;
    
    // Copy if requested
    if (copyAfter) {
      await copyMarkdown();
    }
    
  } catch (error) {
    console.error('Error creating markdown:', error);
    currentMarkdown = null;
    displayError(error.message);
    setStatus(error.message, 'error');
    copyBtn.disabled = true;
  } finally {
    createBtn.disabled = false;
    createCopyBtn.disabled = false;
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
    copyBtn.textContent = 'Copied!';
    
    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.textContent = 'Copy';
    }, 1500);
    
  } catch (error) {
    console.error('Error copying to clipboard:', error);
    setStatus('Failed to copy: ' + error.message, 'error');
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
  
  function getMainContent() {
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
    
    return document.body;
  }
  
  try {
    const title = document.title || 'Untitled Page';
    const contentElement = getMainContent();
    const html = contentElement.innerHTML;
    
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
      .replace(/\n{3,}/g, '\n\n')
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
