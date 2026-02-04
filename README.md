# Web Content to MD

A Chrome extension that converts web page content to clean Markdown format with metadata headers.

## Features

- **Create markdown** - Extract content from the current page and convert to Markdown
- **Copy to clipboard** - Copy the generated Markdown with one click
- **Create & copy** - Generate and copy in one action
- **Metadata headers** - Includes source URL, extraction date, site name, author, and section

## Installation

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select this folder (`copy-website-content-to-md`)

## Usage

1. Navigate to any web page you want to convert
2. Click the extension icon in Chrome's toolbar
3. Click **Create markdown** to extract and preview the content
4. Click **Copy** to copy the Markdown to your clipboard

## Output Format

The generated Markdown includes a metadata header:

```markdown
# Page Title

> **Source:** https://example.com/article
> **Extracted:** 2026-02-04 at 14:30
> **Site:** Example Site
> **Author:** John Doe
> **Section:** Technology

---

Article content here...
```

## Limitations

- Cannot access Chrome system pages (`chrome://`), the Chrome Web Store, or local files
- Content extraction uses simple heuristics - results may vary by site

## Project Structure

```
├── manifest.json      # Extension manifest (MV3)
├── popup.html         # Popup UI
├── popup.css          # Popup styles
├── popup.js           # Popup logic
├── content.js         # Content extraction script
├── lib/
│   └── turndown.js    # HTML to Markdown converter
└── icons/             # Extension icons
```

## License

MIT
