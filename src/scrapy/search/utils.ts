/**
 * Shared utilities for search providers
 */

import { verboseLog } from '../../utils/logger';
import type * as cheerio from 'cheerio';

/** Anti-bot detection patterns */
const ANTI_BOT_INDICATORS = [
  { pattern: 'captcha', reason: 'CAPTCHA challenge detected' },
  { pattern: 'robot', reason: 'Anti-bot protection (robot check) detected' },
  { pattern: 'verify you are human', reason: 'Human verification required' },
  { pattern: 'unusual traffic', reason: 'Unusual traffic detected (rate limited)' },
  { pattern: 'select all squares', reason: 'Image CAPTCHA challenge detected' },
  { pattern: 'recaptcha', reason: 'Google reCAPTCHA detected' },
  { pattern: 'cf-browser-verification', reason: 'Cloudflare verification detected' },
  { pattern: 'ddos protection', reason: 'DDoS protection active' },
  { pattern: 'access denied', reason: 'Access denied by server' },
  { pattern: 'blocked', reason: 'IP/user agent blocked' },
  { pattern: 'security check', reason: 'Security check required' },
  { pattern: 'please click here if', reason: 'Google redirect/bot detection page' },
  { pattern: 'redirected', reason: 'Redirect page detected' },
  { pattern: 'enable javascript', reason: 'JavaScript requirement detected' },
];

/**
 * Check if HTML contains CAPTCHA or anti-bot indicators
 */
export function detectAntiBot(html: string): { isBlocked: boolean; reason: string } {
  const lowerHtml = html.toLowerCase();

  for (const indicator of ANTI_BOT_INDICATORS) {
    if (lowerHtml.includes(indicator.pattern)) {
      return { isBlocked: true, reason: indicator.reason };
    }
  }

  // Check for RTL text (often indicates Google redirect pages in Arabic)
  const rtlPattern = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/;
  if (rtlPattern.test(html)) {
    return { isBlocked: true, reason: 'RTL text detected (likely bot redirect page)' };
  }

  // Check for noscript meta refresh patterns
  if (html.includes('noscript') && html.includes('meta') && html.includes('refresh')) {
    return { isBlocked: true, reason: 'Noscript/refresh meta tag detected' };
  }

  return { isBlocked: false, reason: '' };
}

/**
 * Try multiple CSS selectors and return the first that matches elements
 */
export function trySelectors(
  $: cheerio.CheerioAPI,
  selectors: string[]
): cheerio.Cheerio<any> | null {
  for (const selector of selectors) {
    const elements = $(selector);
    const count = elements.length;
    verboseLog(`  Selector "${selector}": ${count} elements found`);

    if (count > 0) {
      verboseLog(`  Using selector: ${selector}`);
      return elements;
    }
  }
  return null;
}

/** Default browser-like headers for scraping */
export const DEFAULT_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  DNT: '1',
  Connection: 'keep-alive',
};

/** Rotating user agents for anti-bot evasion */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
];

/** Get a random user agent string */
export function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}
