# Web Content to MD

This is a Chrome extension that converts web page content to clean Markdown format with metadata headers. Typical use cases could be providing the website content as context for an LLM or copying the content to other tools (Google Docs, Notion etc.).

I created this extension for my own use with the help of AI coding agents. Feel free to use the code however you like!

## Features

- **Automatic extraction** - Content is extracted and previewed automatically when you open the popup
- **Regenerate** - Re-run extraction at any time (e.g. after the page finishes loading)
- **Copy to clipboard** - Copy the generated Markdown with one click
- **Download** - Save the Markdown as a `.md` file (and a `.html` file when "Include HTML" is enabled)
- **Metadata headers** - Includes source URL, extraction date, site name, author, and section
- **Include images** - Option to include or exclude images (excluded by default)
- **Include HTML** - Option to append the cleaned source HTML alongside the Markdown
- **Site-aware cleanup** - Tailored extraction for Substack, Medium, and LinkedIn
- **Private by design** - All processing happens locally in your browser; no data is sent anywhere

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select this folder (`copy-website-content-to-md`)

## Usage

1. Navigate to any web page you want to convert
2. Click the extension icon in Chrome's toolbar - the content is extracted and previewed automatically
3. Optionally toggle **Include images** or **Include HTML** to adjust the output, or click the refresh button to **Regenerate**
4. Click **Copy** to copy the Markdown to your clipboard, or **Download** to save it as a file

## Output Format

The generated Markdown includes a metadata header:

```markdown
# Page Title

**Source:** https://example.com/article

**Extracted:** 2026-02-04 at 14:30

**Site:** Example Site

**Author:** John Doe

**Section:** Technology

---

Article content here...
```

> Author and Section lines are only included when that metadata is available on the page.

## Limitations

- Cannot access Chrome system pages (`chrome://`), the Chrome Web Store, or local files
- Content extraction uses simple heuristics - results may vary by site

## Project Structure

```
├── manifest.json            # Extension manifest (MV3)
├── popup.html               # Popup UI
├── popup.css                # Popup styles
├── popup.js                 # Popup UI controller (injects scripts, handles actions)
├── content/
│   └── extractor.js         # Injected DOM extraction + Turndown configuration
├── lib/
│   ├── turndown.js          # HTML to Markdown converter (vendored)
│   └── markdown-cleanup.js  # Pure Markdown post-processing + site-handler registry
├── test/
│   └── markdown-cleanup.test.js  # Unit tests for the pure cleanup logic
├── package.json             # Dev scripts (tests / syntax checks)
└── icons/                   # Extension icons
```

The runtime has three layers: `popup.js` (UI + orchestration) injects `lib/turndown.js`,
`lib/markdown-cleanup.js`, and `content/extractor.js` into the page, then calls the
extractor. Site-specific behavior (content selectors, element removals, title and
Markdown cleanup) lives in the **site-handler registry** in `lib/markdown-cleanup.js`,
keeping the pure, regex-heavy logic isolated and testable.

## Development

The extension ships as plain JavaScript with no build step. Tests use Node's
built-in test runner:

- `test/markdown-cleanup.test.js` - pure Markdown/registry logic (no dependencies)
- `test/extractor.test.js` - DOM extraction run under [jsdom](https://github.com/jsdom/jsdom)

```bash
npm install    # install dev dependencies (jsdom)
npm test       # run all unit tests
npm run check  # syntax-check the source files
```

> jsdom is not a real browser, so the DOM tests cover extraction logic, not
> pixel-faithful rendering. Verify site-specific behavior (Substack, LinkedIn)
> by loading the unpacked extension in Chrome.

## License

Public domain (Unlicense). You may use, modify, and distribute this code for any purpose with no conditions. See [LICENSE](LICENSE).
