/**
 * Pure Markdown post-processing + the site-handler registry.
 *
 * This module is intentionally free of DOM/browser dependencies so it can be:
 *   1. Injected into a page (sets `globalThis.__WCM_CLEANUP__`), and
 *   2. Imported in Node for unit testing (`module.exports`).
 *
 * Site-specific DOM selectors live here too (as plain strings) so all
 * per-site configuration is in one place; the DOM extractor consumes them.
 */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (root) root.__WCM_CLEANUP__ = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // Some cleanup passes use backreferences that can backtrack badly on huge
  // inputs. Skip those passes once the document exceeds this size to keep the
  // popup responsive.
  const MAX_DEDUP_LENGTH = 500000;

  function buildMetadataHeader(meta) {
    // Plain-text format (no blockquotes) for better Notion compatibility, since
    // Notion treats `>` as callouts that don't render multi-line content well.
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

  function cleanLinkedInTitle(title) {
    return title
      .replace(/^\(\d+\)\s*/, '')
      .replace(/\s*\|\s*LinkedIn\s*$/, '')
      .trim();
  }

  function cleanLinkedInMarkdown(markdown) {
    // Remove entire Activity and Interests sections (not useful in profile extraction)
    const lines = markdown.split('\n');
    const result = [];
    let skipSection = false;
    const sectionsToRemove = ['Activity', 'Interests'];

    for (const line of lines) {
      const headerMatch = line.match(/^## (.+)/);
      if (headerMatch) {
        const sectionName = headerMatch[1].trim();
        skipSection = sectionsToRemove.some(name => sectionName === name || sectionName.startsWith(name));
      }
      if (!skipSection) {
        result.push(line);
      }
    }
    markdown = result.join('\n');

    markdown = markdown
      // Remove H1s from content (the profile name duplicates the page title)
      .replace(/^# .+$/gm, '')

      // Normalize multi-line link text: collapse internal whitespace in [...](url) blocks.
      // LinkedIn wraps card content in <a> tags, leaving blank lines inside the link after
      // images and buttons are stripped. Collapse to a single line.
      .replace(/\[([\s\S]*?)\]\(([^)]*)\)/g, function(match, text, url) {
        const clean = text.replace(/\s+/g, ' ').trim();
        if (!clean) return '';
        return `[${clean}](${url})`;
      })

      // Deduplicate section headers: "## AboutAbout" → "## About"
      .replace(/^(#{1,6}\s+)(.+?)\2\s*$/gm, '$1$2')

      // Remove navigation/UI text
      .replace(/^Skip to (?:search|main content)\s*$/gm, '')
      .replace(/^Keyboard shortcuts.*$/gm, '')
      .replace(/^Status is (?:offline|online|reachable|busy|away)\s*$/gm, '')
      .replace(/^Close jump menu\s*$/gm, '')

      // Remove profile action menu items
      .replace(/^-\s*Send profile in a message\s*$/gm, '')
      .replace(/^-\s*Save to PDF\s*$/gm, '')
      .replace(/^-\s*Request a recommendation\s*$/gm, '')
      .replace(/^-\s*Recommend\s*$/gm, '')
      .replace(/^-\s*Unfollow\s*$/gm, '')
      .replace(/^-\s*Remove Connection\s*$/gm, '')
      .replace(/^-\s*Report \/ Block\s*$/gm, '')
      .replace(/^-\s*About this profile.*$/gm, '')

      // Remove standalone action words on their own line
      .replace(/^Message\s*$/gm, '')
      .replace(/^More\s*$/gm, '')
      .replace(/^Endorse\s*$/gm, '')
      .replace(/^Follow\s*$/gm, '')
      .replace(/^Following\s*$/gm, '')
      .replace(/^Subscribe\s*$/gm, '')
      .replace(/^Join\b.*$/gm, '')
      .replace(/^Comment\s*$/gm, '')
      .replace(/^Repost\s*$/gm, '')
      .replace(/^Send\s*$/gm, '')
      .replace(/^Pending\s*$/gm, '')
      .replace(/^Connect\s*$/gm, '')

      // Remove connection degree indicators ("1st", "2nd" standalone)
      .replace(/^\d+(?:st|nd|rd|th)\s*$/gm, '')
      .replace(/^\d+(?:st|nd|rd|th) degree connection.*$/gm, '')

      // Remove "Loaded N Posts posts" type text
      .replace(/^Loaded \d+ \w+.*$/gm, '')

      // Remove "Show all N ..." lines (with or without link formatting)
      .replace(/^\[?Show all \d+.*$/gm, '')

      // Remove "…see more" / "…more" at end of lines
      .replace(/\s*…(?:see )?more\s*$/gm, '')

      // Remove "Recommend [Name]" lines
      .replace(/^\[?Recommend \w+.*$/gm, '')

      // Remove empty state text
      .replace(/^Nothing to see for now.*$/gm, '')
      .replace(/^Recommendations that .+ will appear here\.?\s*$/gm, '')

      // Remove "Endorsed by" lines and endorsement counts
      .replace(/^[ \t]*-?\s*Endorsed by.*$/gm, '')
      .replace(/^[ \t]*-?\s*\d+ endorsements?.*$/gm, '')

      // Remove "Other authors" / "Other inventors" lines (handles "- - Other authors" too)
      .replace(/^[ \t]*(?:-\s*)*Other (?:authors|inventors).*$/gm, '')

      // Remove "Show publication" / "Show all posts" action links
      .replace(/\[Show publication\]\([^)]*\)/g, '')
      .replace(/\[Show all posts\]\([^)]*\)/g, '')

      // Remove connection degree in recommendations: "· 2nd", "· 3rd"
      .replace(/·\s*\d+(?:st|nd|rd|th)\b/g, '')

      // Remove follower/connection count standalone lines
      .replace(/^\d[\d,]+ (?:followers|members)\s*$/gm, '')
      .replace(/^\d+\+ connections\s*$/gm, '')

      // Remove tab navigation text
      .replace(/^Posts\s+Comments\s+Images\s*$/gm, '')
      .replace(/^Received\s+Given\s*$/gm, '')
      .replace(/^Companies\s+Groups\s+Newsletters\s+Schools\s*$/gm, '')

      // Remove "Contact info" links (keep the surrounding location text on the line)
      .replace(/\s*\[Contact info\]\([^)]*\)\s*/g, ' ')

      // Remove "[Name] has verifications" lines
      .replace(/^\w[\w\s]+ has verifications\s*$/gm, '')

      // Remove mutual connections search links (span multiple lines)
      .replace(/\[[\s\S]*?mutual connections[\s\S]*?\]\(https:\/\/www\.linkedin\.com\/search\/results\/people\/[^)]*\)/g, '')

      // Remove LinkedIn overlay links but keep text
      .replace(/\[([^\]]*)\]\(\/in\/[^)]*overlay[^)]*\)/g, '$1')

      // Remove engagement metric lines (likes, comments, reposts as list items)
      .replace(/^-\s+\d[\d,]*\s*$/gm, '')
      .replace(/^-\s+-\s+\d+ comments?\s*$/gm, '')
      .replace(/^-\s+-\s+\d+ reposts?\s*$/gm, '')

      // Remove "Visible to anyone on or off LinkedIn"
      .replace(/Visible to anyone on or off LinkedIn/g, '')

      // Remove LinkedIn hashtag link formatting: [hashtag#word](...) → #word
      .replace(/\[hashtag(#\w+)\]\([^)]*\)/g, '$1')

      // Remove "Post" / "Link" type labels in Featured section (indented lone words)
      .replace(/^[ \t]+Post\s*$/gm, '')
      .replace(/^[ \t]+Link\s*$/gm, '')
      .replace(/^[ \t]+Article\s*$/gm, '')
      .replace(/^[ \t]+Video\s*$/gm, '')

      // Remove broken endorser URL fragments left by stripped endorsement links
      // These appear as lines starting with /endorsers?... or just the URL path
      .replace(/^[ \t]*-?\s*\/endorsers\?[^\n]*$/gm, '')
      .replace(/^[ \t]*-?\s*\/details\/skills\/[^\n]*$/gm, '')

      // Remove lines that are only standalone dashes (empty list items from stripped images)
      .replace(/^([ \t]*-\s*\n){2,}/gm, '');

    // Remove duplicate paragraph blocks (LinkedIn renders truncated + full
    // versions). Uses a backreference that can backtrack on large inputs, so
    // it is gated behind a size check.
    if (markdown.length <= MAX_DEDUP_LENGTH) {
      markdown = markdown.replace(/^(.{80,})\n+\1/gm, '$1');
    }

    // Clean up excessive newlines
    markdown = markdown.replace(/\n{3,}/g, '\n\n');

    return markdown;
  }

  // Aggressive "run-together text" fixes. These would corrupt ordinary prose
  // (e.g. "Node.Js" → "Node.\n\nJs"), so they are only applied to sites known
  // to render content without proper whitespace between sections.
  function applyRunTogetherFixes(markdown) {
    return markdown
      // Add line break before bold section headers that follow periods/links
      .replace(/([.)\]])\s*(\*\*[A-ZÄÖÜ])/g, '$1\n\n$2')
      // Fix missing space/line break when a period is immediately followed by a capital letter
      .replace(/\.([A-ZÄÖÜ][a-zäöüß])/g, '.\n\n$1')
      // Remove specific concatenated UI text patterns (exact matches only)
      .replace(/SubscribeSign in/g, '')
      .replace(/Sign inSubscribe/g, '');
  }

  /**
   * Generic Markdown cleanup applied to every page. Site-specific run-together
   * fixes are applied only when the matched handler opts in via `fixRunTogether`.
   */
  function postProcessMarkdown(markdown, opts) {
    opts = opts || {};
    const handler = opts.handler || null;

    markdown = markdown
      // Remove empty bold markers (including those with just whitespace)
      .replace(/\*\*\s*\*\*/g, '')
      // Fix double-double asterisks from adjacent strong tags: **** → single space
      .replace(/\*\*\*\*/g, ' ')
      // Remove standalone ** on their own line
      .replace(/^\*\*\s*$/gm, '');

    if (handler && handler.fixRunTogether) {
      markdown = applyRunTogetherFixes(markdown);
    }

    markdown = markdown
      // Collapse multi-line link text into a single line. Links that wrap
      // buttons or other block-level elements (common for "Apply"/"View" CTAs)
      // leave blank lines inside the [...] after their contents are stripped,
      // which breaks the markdown link. The negative lookbehind keeps image
      // syntax (![alt](src)) intact.
      .replace(/(?<!!)\[([\s\S]*?)\]\(([^)]*)\)/g, (match, text, url) => {
        const clean = text.replace(/\s+/g, ' ').trim();
        return clean ? `[${clean}](${url})` : '';
      })
      // Collapse consecutive duplicate links (e.g. mobile + desktop variants of
      // the same CTA that render as two identical adjacent links)
      .replace(/(\[[^\]]+\]\([^)]*\))\1+/g, '$1')
      // Remove empty link references like [](/path) - these are never content
      .replace(/\[\s*\]\([^)]*\)/g, '')
      // Remove duplicate horizontal rules
      .replace(/(\n---\n)+/g, '\n---\n')
      // Remove trailing whitespace on lines. Must run before collapsing blank
      // lines so that whitespace-only lines (e.g. from <br> emitting "  \n")
      // don't survive the \n{3,} collapse below.
      .replace(/[ \t]+$/gm, '')
      // Clean up excessive newlines
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return markdown;
  }

  /**
   * Per-site configuration. `contentSelectors` / `removeSelectors` are plain
   * strings consumed by the DOM extractor; `cleanTitle` / `cleanMarkdown` are
   * pure string transforms; `fixRunTogether` opts into the aggressive fixes.
   */
  const SITE_HANDLERS = [
    {
      id: 'substack',
      match: (hostname) => hostname.includes('substack.com'),
      contentSelectors: [
        '.body.markup',   // Substack article body
        '.post-content',  // Alternative Substack selector
        'article .body',
        'article'
      ],
      removeSelectors: [
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
      fixRunTogether: true
    },
    {
      id: 'medium',
      match: (hostname) => hostname.includes('medium.com'),
      contentSelectors: [
        'article section',
        'article'
      ],
      removeSelectors: [
        '[data-testid="audioPlayButton"]',
        '[data-testid="headerSocialShareButton"]'
      ],
      fixRunTogether: true
    },
    {
      id: 'linkedin',
      match: (hostname) => hostname.includes('linkedin.com'),
      contentSelectors: [
        'main',
        '.scaffold-layout__main',
        '.scaffold-layout__content',
        '.core-rail'
      ],
      removeSelectors: [
        // Visually hidden elements that cause text duplication
        '.visually-hidden',
        '.a11y-text',
        '#skip-link',
        '.skip-link',
        // Interactive elements
        'button',
        'input',
        'textarea',
        // Navigation and overlays
        '.artdeco-dropdown',
        '.artdeco-modal',
        '.global-nav',
        // Sidebar
        '.scaffold-layout__aside',
        '.scaffold-layout__sidebar',
        // Profile action buttons
        '.pvs-header__action',
        '.pv-top-card-v2-ctas',
        '.pvs-profile-actions',
        '.pv-top-card__action-list',
        // "Show all" / "See more" links
        '.pvs-list__footer-wrapper',
        '.pv-profile-section__see-more-inline',
        '.inline-show-more-text__button',
        // Activity feed with reposts from others
        '.scaffold-finite-scroll',
        // Engagement / social counts
        '.social-details-social-counts',
        '.social-details-social-activity',
        // Messaging overlay
        '.msg-overlay-list-bubble',
        '.msg-form',
        // Premium upsell
        '.premium-upsell-link',
        // Presence indicator
        '.presence-entity',
        // Skill endorsement details
        '.pv-skill-endorsement-entity',
        // Endorsement sub-components within the Skills section only
        'section:has(#skills) .pvs-entity__sub-components',
        // Profile photo containers (no useful text)
        '.pv-top-card__photo',
        '.profile-background-image',
        // Connection degree badge ("1st", "2nd", etc.)
        '.distance-badge',
        // Image view model containers (become empty bullet points when images are stripped)
        '.ivm-image-view-model',
        // Stacked face-pile images (mutual connections, endorsers)
        'ul.ivm-entity-pile',
        // Footer
        '.global-footer'
      ],
      cleanTitle: cleanLinkedInTitle,
      cleanMarkdown: cleanLinkedInMarkdown,
      fixRunTogether: true
    }
  ];

  function getSiteHandler(hostname) {
    if (!hostname) return null;
    return SITE_HANDLERS.find((handler) => handler.match(hostname)) || null;
  }

  return {
    MAX_DEDUP_LENGTH,
    SITE_HANDLERS,
    getSiteHandler,
    buildMetadataHeader,
    cleanLinkedInTitle,
    cleanLinkedInMarkdown,
    applyRunTogetherFixes,
    postProcessMarkdown
  };
});
