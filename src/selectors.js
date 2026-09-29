// The ONLY place where LinkedIn DOM knowledge lives. Update here when LinkedIn ships new markup.
// Ordered fallback chains. First selector that yields elements wins for the whole page.
export const POST_SELECTORS = [
  '[data-testid="mainFeed"] [role="listitem"]',      // React front end (2026-09)
  'div[data-urn^="urn:li:activity"]',                 // legacy
  '[data-id^="urn:li:activity"]',                     // legacy
  '.feed-shared-update-v2',                           // legacy
];

export const TEXT_SELECTORS = [
  '[data-testid="expandable-text-box"]',
  '.update-components-text',
  '.feed-shared-inline-show-more-text',
  '.feed-shared-text',
];

export const AUTHOR_SELECTORS = [
  '[data-testid="actor-name"]',
  '.update-components-actor__title',
  '.update-components-actor__name',
  'a[href*="/in/"] span[aria-hidden="true"]',
];

// Text boxes inside these containers are comments and must never be touched.
export const COMMENT_SELECTORS = [
  '[data-testid*="comment"]',
  '.comments-comments-list',
  '.comments-comment-entity',
  '.comments-comment-item',
];

export const SPONSORED_MARKERS = ['Sponsorisé', 'Promoted', 'Sponsored'];
export const SEE_MORE_LABELS = ['…plus', '… plus', 'voir plus', '…more', '… more', 'see more'];
