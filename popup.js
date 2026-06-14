'use strict';

// State
let currentMarkdown = null;
let currentHtml = null;
let currentTitle = null;
let isProcessing = false; // guards against overlapping extraction runs

// Files injected into the page before extraction runs. Order matters: Turndown
// and the cleanup helpers must be defined before the extractor uses them.
const INJECTED_FILES = [
  'lib/turndown.js',
  'lib/markdown-cleanup.js',
  'content/extractor.js'
];

// DOM Elements
const copyBtn = document.getElementById('copyBtn');
const downloadBtn = document.getElementById('downloadBtn');
const regenerateBtn = document.getElementById('regenerateBtn');
const includeImagesCheckbox = document.getElementById('includeImages');
const includeHtmlCheckbox = document.getElementById('includeHtml');
const preview = document.getElementById('preview');
const status = document.getElementById('status');

// Event Listeners
copyBtn.addEventListener('click', copyMarkdown);
downloadBtn.addEventListener('click', downloadMarkdown);
regenerateBtn.addEventListener('click', createMarkdown);
includeImagesCheckbox.addEventListener('change', createMarkdown);
includeHtmlCheckbox.addEventListener('change', renderPreview);

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

  return restrictedPatterns.some((pattern) => pattern.test(url));
}

/**
 * Reflect processing/content state in the controls. Copy & Download require
 * generated content; Regenerate and the options are only locked while a run
 * is in flight.
 */
function updateControls() {
  const noContent = !currentMarkdown;
  copyBtn.disabled = isProcessing || noContent;
  downloadBtn.disabled = isProcessing || noContent;
  regenerateBtn.disabled = isProcessing;
  includeImagesCheckbox.disabled = isProcessing;
  includeHtmlCheckbox.disabled = isProcessing;
  regenerateBtn.classList.toggle('spinning', isProcessing);
}

/**
 * Set status message with optional type
 */
function setStatus(message, type = '') {
  status.textContent = message;
  status.className = 'status' + (type ? ` ${type}` : '');
}

/**
 * Render the preview area from current content + options.
 */
function renderPreview() {
  if (!currentMarkdown) return;
  preview.textContent = buildCopyContent();
  preview.className = 'preview';
}

function displayError(message) {
  preview.textContent = `Error: ${message}`;
  preview.className = 'preview error';
}

function displayLoading() {
  preview.textContent = 'Extracting content...';
  preview.className = 'preview loading';
}

/**
 * Main function to create markdown from current tab
 */
async function createMarkdown() {
  if (isProcessing) return; // ignore overlapping triggers (e.g. rapid toggles)
  isProcessing = true;
  updateControls();
  setStatus('Processing...', 'loading');
  displayLoading();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      throw new Error('No active tab found');
    }

    if (isRestrictedUrl(tab.url)) {
      throw new Error('Cannot access this page. Chrome system pages, the Web Store, and local files are restricted.');
    }

    const options = {
      includeImages: includeImagesCheckbox.checked
    };

    // Inject the libraries + extractor (idempotent; survives page reloads)
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: INJECTED_FILES
    });

    // Run the extractor with the current options
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (opts) => globalThis.__WCM_EXTRACT__(opts),
      args: [options]
    });

    const result = results[0]?.result;

    if (!result) {
      throw new Error('Failed to extract content - no result returned');
    }

    if (!result.success) {
      throw new Error(result.error || 'Content extraction failed');
    }

    currentMarkdown = result.markdown;
    currentHtml = result.html;
    currentTitle = result.title;
    renderPreview();
    setStatus('Generated successfully', 'success');
  } catch (error) {
    console.error('Error creating markdown:', error);
    currentMarkdown = null;
    currentHtml = null;
    currentTitle = null;
    displayError(error.message);
    setStatus(error.message, 'error');
  } finally {
    isProcessing = false;
    updateControls();
  }
}

/**
 * Build the content to copy/preview based on options
 */
function buildCopyContent() {
  if (!currentMarkdown) return null;

  if (includeHtmlCheckbox.checked && currentHtml) {
    // Include both MD and HTML with start/end flags
    return [
      '<!-- MARKDOWN START -->',
      currentMarkdown,
      '<!-- MARKDOWN END -->',
      '',
      '<!-- HTML START -->',
      currentHtml,
      '<!-- HTML END -->'
    ].join('\n');
  }

  return currentMarkdown;
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
    await navigator.clipboard.writeText(buildCopyContent());
    setStatus('Copied to clipboard!', 'success');

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
 * Download a single file with given content, filename, and MIME type
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Get sanitized filename base from title
 */
function getSanitizedFilename() {
  const sanitized = (currentTitle || 'content')
    .replace(/[<>:"/\\|?*]/g, '-')  // Replace invalid filename chars
    .replace(/\s+/g, '-')           // Replace spaces with hyphens
    .replace(/-+/g, '-')            // Collapse multiple hyphens
    .substring(0, 100)              // Limit length
    .replace(/^-|-$/g, '');         // Trim leading/trailing hyphens (after truncation)
  // Fall back to a default if the title sanitized down to nothing
  return sanitized || 'content';
}

/**
 * Download markdown (and optionally HTML) as file(s)
 */
function downloadMarkdown() {
  if (!currentMarkdown) {
    setStatus('No content to download', 'error');
    return;
  }

  try {
    const sanitizedTitle = getSanitizedFilename();

    downloadFile(currentMarkdown, `${sanitizedTitle}.md`, 'text/markdown');

    if (includeHtmlCheckbox.checked && currentHtml) {
      // Small delay to avoid browser blocking multiple downloads
      setTimeout(() => {
        downloadFile(currentHtml, `${sanitizedTitle}.html`, 'text/html');
      }, 100);
      setStatus('Downloaded MD & HTML!', 'success');
    } else {
      setStatus('Downloaded!', 'success');
    }

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
