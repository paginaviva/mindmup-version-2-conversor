/**
 * @module url-classifier
 * URL classification map by domain (Annex C, level 4).
 *
 * Known domains are assigned a specific ref_type. Domains that are not listed
 * are classified by protocol.
 *
 * Matching is done by exact domain or by suffix (endsWith('.domain')), so a
 * root domain also covers its subdomains (for example 'cloudflare.com' covers
 * 'developers.cloudflare.com'). When a subdomain has its own classification
 * (for example 'docs.google.com' as a document versus 'google.com' as a
 * search), it is registered explicitly and the function picks the longest
 * domain match (the most specific one), regardless of object order.
 */

export const URL_CLASSIFIER = {
  // Common public services
  'facebook.com': 'social',
  'twitter.com': 'social',
  'x.com': 'social',
  'instagram.com': 'social',
  'linkedin.com': 'social',
  'pinterest.com': 'social',
  'youtube.com': 'video',

  'wikipedia.org': 'reference',
  'sciencedirect.com': 'reference',

  'github.com': 'code',
  'github.io': 'code',

  'notion.so': 'tool',
  'notion.site': 'tool',
  'trello.com': 'tool',
  'miro.com': 'tool',
  'app.raindrop.io': 'tool',
  'asana.com': 'tool',

  'cloudflare.com': 'cloud',
  'workers.dev': 'cloud',
  'r2.dev': 'cloud',
  'alibabacloud.com': 'cloud',
  'pages.dev': 'cloud',

  'google.com': 'search',
  'bing.com': 'search',

  'chatgpt.com': 'ai_chat',
  'chat.deepseek.com': 'ai_chat',
  'docs.google.com': 'document',
  'drive.google.com': 'document',
  'notebooklm.google.com': 'ai_chat',
  'academy.openai.com': 'reference',
  'docs.anthropic.com': 'reference',
  'learn.microsoft.com': 'reference',

  'mindmup.com': 'mindmap',

  'directorist.com': 'web_page',
  'woocommerce.com': 'web_page',

  'youtu.be': 'video',
  'loom.com': 'video',
  'developers.google.com': 'reference',
  'support.google.com': 'reference',
  'mapsplatform.google.com': 'reference',
  'marketingplatform.google.com': 'reference',
  'business.google.com': 'web_page',
};

export const DEFAULT_REF_TYPE = 'web_page';

/**
 * Classifies a URL by its domain.
 *
 * @param {string} url - URL to classify
 * @returns {string} ref_type
 */
export function classifyUrl(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');

    // Every domain is evaluated and the most specific match wins (the longest
    // domain). This way a typed subdomain (for example docs.google.com ->
    // document) prevails over its root domain (google.com -> search),
    // regardless of object order.
    let bestMatch = null;
    for (const [domain, refType] of Object.entries(URL_CLASSIFIER)) {
      if (hostname === domain || hostname.endsWith('.' + domain)) {
        if (!bestMatch || domain.length > bestMatch.domain.length) {
          bestMatch = { domain, refType };
        }
      }
    }
    if (bestMatch) return bestMatch.refType;

    if (url.startsWith('https:') || url.startsWith('http:')) {
      return DEFAULT_REF_TYPE;
    }
    if (url.startsWith('mailto:')) return 'email';
    if (url.startsWith('tel:')) return 'phone';
    return 'other';
  } catch {
    return DEFAULT_REF_TYPE;
  }
}
