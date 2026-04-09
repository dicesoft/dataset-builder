import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { CLIError, ErrorCodes } from '../utils/errorCodes';
import { ExitCode } from '../utils/exitCodes';

export interface ScrapyOptions {
  url: string;
  spider: string;
  output: string;
  depth: number;
  settings?: string;
  engine?: string;
  outputDir?: string;
}

export interface ScrapyResult {
  success: boolean;
  outputFile?: string;
  error?: string;
}

export async function runScrapy(options: ScrapyOptions): Promise<ScrapyResult> {
  const { url, spider, output, depth, settings, engine, outputDir } = options;

  // Check if Scrapy is available
  const scrapyPath = await findScrapy();
  if (!scrapyPath) {
    return {
      success: false,
      error: 'Scrapy not found. Please install Scrapy: pip install scrapy',
    };
  }

  // Create a temporary spider for the URL
  const tempSpiderName = `temp_${Date.now()}`;
  const projectDir = path.join(process.cwd(), 'scrapy-projects/base');
  const spiderDir = path.join(projectDir, 'dataset_builder/spiders');
  // BUG FIX 2: Use provided outputDir or fall back to default output directory
  const baseOutputDir = outputDir || path.join(process.cwd(), 'output');
  const outputFile = path.join(baseOutputDir, `scraped_${Date.now()}.${output}`);

  // Ensure output directory exists
  await fs.mkdir(path.dirname(outputFile), { recursive: true });

  try {
    // Ensure spider directory exists
    await fs.mkdir(spiderDir, { recursive: true });

    // Generate spider file
    const spiderCode = generateSpider(tempSpiderName, url, depth);
    await fs.writeFile(path.join(spiderDir, `${tempSpiderName}.py`), spiderCode, 'utf-8');

    // Run Scrapy using runspider instead of crawl to avoid project loading issues
    // This runs the spider directly without needing a project structure
    // Note: Scrapy uses -o FILE:FORMAT syntax, not -o FILE -t FORMAT
    // We pass FEED_EXPORTERS settings explicitly to ensure output format works correctly
    const spiderPath = path.join(spiderDir, `${tempSpiderName}.py`);
    const args = [
      '-W',
      'ignore',
      '-m',
      'scrapy',
      'runspider',
      spiderPath,
      '-o',
      `${outputFile}:${output}`,
      '-s',
      'FEED_EXPORTERS.json=scrapy.exporters.JsonItemExporter',
      '-s',
      'FEED_EXPORTERS.jsonl=scrapy.exporters.JsonLinesItemExporter',
      '-s',
      'FEED_EXPORTERS.csv=scrapy.exporters.CsvItemExporter',
      '-s',
      'FEED_EXPORTERS.xml=scrapy.exporters.XmlItemExporter',
    ];

    const result = await runCommand('python', args, {
      cwd: process.cwd(),
      streamStderr: true,
    });

    // Cleanup temp spider
    await fs.unlink(path.join(spiderDir, `${tempSpiderName}.py`)).catch(() => {});

    if (result.success) {
      return {
        success: true,
        outputFile,
      };
    } else {
      return {
        success: false,
        error: result.error,
      };
    }
  } catch (error) {
    return {
      success: false,
      error: String(error),
    };
  }
}

/**
 * Sanitize a spider URL: reject dangerous patterns and overly long URLs.
 * Returns the sanitized URL string.
 * Throws CLIError for malicious or invalid URLs.
 */
export function sanitizeSpiderUrl(url: string): string {
  // Reject URLs exceeding 2000 characters
  if (url.length > 2000) {
    throw new CLIError(
      ErrorCodes.INVALID_INPUT,
      `URL exceeds maximum length of 2000 characters (got ${url.length})`,
      ExitCode.INVALID_INPUT
    );
  }

  // Reject null bytes
  if (url.includes('\0')) {
    throw new CLIError(
      ErrorCodes.INVALID_INPUT,
      'URL contains null bytes which are not allowed',
      ExitCode.INVALID_INPUT
    );
  }

  // Reject Unicode escape sequences (\uXXXX)
  if (/\\u[0-9a-fA-F]{4}/.test(url)) {
    throw new CLIError(
      ErrorCodes.INVALID_INPUT,
      'URL contains Unicode escape sequences which are not allowed',
      ExitCode.INVALID_INPUT
    );
  }

  // Reject triple-quote sequences (Python string injection)
  if (url.includes('"""')) {
    throw new CLIError(
      ErrorCodes.INVALID_INPUT,
      'URL contains triple-quote sequences which are not allowed',
      ExitCode.INVALID_INPUT
    );
  }

  // Escape backslashes and double quotes for safe Python string embedding
  return url.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function generateSpider(name: string, url: string, depth: number): string {
  // Ensure URL has a scheme
  const fullUrl = url.match(/^https?:\/\//) ? url : `https://${url}`;
  // Extract domain for allowed_domains
  const domainMatch = fullUrl.match(/https?:\/\/([^\/]+)/);
  const domain = domainMatch ? domainMatch[1] : '';

  // Sanitize and escape the URL for safe Python string embedding
  const escapedUrl = sanitizeSpiderUrl(fullUrl);

  return `
import scrapy
import re

class ${name.replace(/-/g, '_')}Spider(scrapy.Spider):
    name = "${name}"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.start_urls = ["${escapedUrl}"]
        self.max_depth = ${depth}
        self.allowed_domains = ["${domain}"]
        self.visited_urls = set()  # Global visited URL tracking

    def parse(self, response):
        # Global loop prevention - skip if already visited this URL
        normalized_url = response.url.lower().split('#')[0]  # Normalize: lowercase and remove hash
        if normalized_url in self.visited_urls:
            self.logger.info(f"Skipping already visited: {response.url}")
            return
        self.visited_urls.add(normalized_url)

        # Get current depth and source chain from response meta
        current_depth = response.meta.get('depth', 0)
        source_chain = response.meta.get('source_chain', [])
        if not source_chain:
            source_chain = [self.start_urls[0]]

        # Build source chain for this URL (still track for path analysis)
        current_source_chain = source_chain + [response.url] if response.url not in source_chain else source_chain
        # Extract clean text content from semantic elements only
        # Exclude scripts, styles, and non-content elements
        content_selectors = [
            "blockquote.abstract", "#abs",
            "p", "h1", "h2", "h3", "h4", "h5", "h6",
            "article", "section", "main", "[role='main']",
            ".content", ".article", ".post", ".entry",
            "#content", "#main", "#article",
            "[class*='content']", "[class*='text']",
            "div[class*='article']", "div[class*='post']",
            ".page-content", ".main-content", ".entry-content",
            "[itemprop='articleBody']", "[itemtype*='Article']"
        ]

        # BUG FIX 3: Enhanced ad/spam detection - CSS selectors to exclude
        ad_selectors = """
            .ad, .ads, .advertisement, [class*="ad-"], [id*="ad-"],
            .cookie-banner, .cookie-consent, #cookie-notice,
            .newsletter, .subscribe, .signup, .email-signup,
            .social-share, .share-buttons, .social-media,
            .related-posts, .recommended, .you-may-like, .similar-articles,
            .comments, #comments, .disqus, .comment-section,
            .breadcrumb, .pagination, .page-nav,
            .popup, .modal, .overlay, .lightbox,
            .sidebar-widget, .widget, .sidebar-ad,
            .footer-links, .site-footer, .bottom-nav
        """

        # BUG FIX 3: Ad keywords to filter out from text
        ad_keywords = [
            "advertisement", "sponsored", "promoted content", "ad choices",
            "subscribe now", "sign up for", "click here to buy",
            "follow us on", "like us on", "share this",
            "newsletter signup", "get updates", "stay connected",
            "we use cookies", "cookie consent", "accept cookies"
        ]

        text_parts = []
        for selector in content_selectors:
            elements = response.css(selector)
            for el in elements:
                # BUG FIX 3: Enhanced element filtering - skip ads, cookies, etc.
                is_junk = el.css(ad_selectors).get()
                if is_junk:
                    continue

                # Also check parent elements for ad containers
                parent_check = el.xpath("ancestor::*[contains(@class, 'ad') or contains(@class, 'cookie') or contains(@class, 'newsletter') or contains(@class, 'sidebar') or contains(@id, 'ad')]").get()
                if parent_check:
                    continue

                txt = " ".join(el.css("::text").getall()).strip()
                # BUG FIX 3: Minimum length threshold for text extraction
                if txt and len(txt) > 10:
                    # BUG FIX 3: Check for ad keywords in text
                    txt_lower = txt.lower()
                    if any(keyword in txt_lower for keyword in ad_keywords):
                        continue
                    text_parts.append(txt)

        # Remove duplicates while preserving order
        seen_texts = set()
        unique_texts = []
        for txt in text_parts:
            if txt not in seen_texts:
                seen_texts.add(txt)
                unique_texts.append(txt)

        text = "\\n\\n".join(unique_texts)

        # If no text found from semantic selectors, fall back to body text extraction
        if not text:
            body_text = response.css('body ::not(script, style, nav, footer, header, aside) ::text').getall()
            body_text = ' '.join(t.strip() for t in body_text if t.strip())
            body_text = ' '.join(body_text.split())
            if len(body_text) > 50:
                text = body_text[:5000]

        # Extract links
        links = response.css("a::attr(href)").getall()

        # Extract title
        title = response.css("title::text").get() or response.css("h1::text").get() or ""

        # Extract file URLs (images, PDFs, videos, etc.)
        file_urls = []
        file_extensions = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.ico', '.bmp',
                          '.mp4', '.webm', '.avi', '.mov', '.mkv', '.flv', '.wmv',
                          '.ppt', '.pptx', '.doc', '.docx', '.xls', '.xlsx', '.csv',
                          '.zip', '.rar', '.tar', '.gz', '.bz2', '.7z',
                          '.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a',
                          '.txt', '.rtf', '.md', '.json', '.xml']

        # BUG FIX 6: Detect YouTube URLs
        youtube_pattern = r'(?:youtube\\.com/watch\\?v=|youtu\\.be/|youtube\\.com/shorts/|www\\.youtube\\.com/watch\\?v=|www\\.youtube\\.com/shorts/|youtube\\.com/playlist\\?list=|www\\.youtube\\.com/playlist\\?list=)'

        # Check all links for file extensions
        for link in links:
            if link:
                link_lower = link.lower()
                # Check for file extensions
                if any(link_lower.endswith(ext) for ext in file_extensions):
                    full_url = response.urljoin(link)
                    if full_url not in file_urls:
                        file_urls.append(full_url)

        # BUG FIX 6: Detect YouTube video URLs
        youtube_patterns = [
            r'youtube\\.com/watch\\?v=',
            r'youtu\\.be/',
            r'youtube\\.com/shorts/',
            r'www\\.youtube\\.com/watch\\?v=',
            r'www\\.youtube\\.com/shorts/',
            r'youtube\\.com/playlist\\?list=',
            r'www\\.youtube\\.com/playlist\\?list='
        ]

        # Check links for YouTube URLs (convert to absolute first, then match)
        for link in links:
            if link:
                # Convert to absolute URL first, then lowercase for matching
                full_url = response.urljoin(link)
                url_lower = full_url.lower()
                if any(re.search(pattern, url_lower) for pattern in youtube_patterns):
                    if full_url not in file_urls:
                        file_urls.append(full_url)

        # BUG FIX 7: Check if the current page URL itself is a YouTube video/playlist
        # This handles cases where the scraped URL directly is a YouTube video
        if response.url:
            url_lower = response.url.lower()
            if any(re.search(pattern, url_lower) for pattern in youtube_patterns):
                if response.url not in file_urls:
                    file_urls.append(response.url)
        embed_srcs = response.css("embed::attr(src)").getall()
        iframe_srcs = response.css("iframe::attr(src)").getall()
        for src in embed_srcs + iframe_srcs:
            if src:
                full_url = response.urljoin(src)
                if ".pdf" in full_url.lower() and full_url not in file_urls:
                    file_urls.append(full_url)

        # Check for links with type="application/pdf"
        pdf_links = response.css("a[type='application/pdf']::attr(href)").getall()
        for link in pdf_links:
            if link:
                full_url = response.urljoin(link)
                if full_url not in file_urls:
                    file_urls.append(full_url)

        # Check for data-pdf or similar attributes
        data_pdf_links = response.css("a[data-pdf]::attr(data-pdf), a[data-file]::attr(data-file)").getall()
        for link in data_pdf_links:
            if link:
                full_url = response.urljoin(link)
                if ".pdf" in full_url.lower() and full_url not in file_urls:
                    file_urls.append(full_url)

        # Also check for image/video sources in img, video, source tags
        img_urls = response.css("img::attr(src)").getall()
        img_srcset = response.css("img::attr(srcset)").getall()
        # Parse srcset for image URLs
        for srcset in img_srcset:
            if srcset:
                # srcset format: "url1 size1, url2 size2"
                parts = srcset.split(',')
                for part in parts:
                    url = part.strip().split()[0]
                    if url:
                        full_url = response.urljoin(url)
                        if full_url not in img_urls:
                            img_urls.append(full_url)

        video_urls = response.css("video source::attr(src), video::attr(src)").getall()
        source_urls = response.css("source::attr(src)").getall()

        # Add all media URLs to file_urls
        for src in img_urls + video_urls + source_urls:
            if src:
                full_url = response.urljoin(src)
                if full_url not in file_urls:
                    file_urls.append(full_url)

        yield {
            "url": response.url,
            "title": title.strip() if title else "",
            "text": text[:5000] if text else "",  # Limit text length
            "links": [response.urljoin(l) if l and not l.startswith('http') else l for l in links[:50]],
            "files": file_urls[:50],  # Add discovered file URLs
            "depth": current_depth,
            "source_chain": current_source_chain,
        }

        # Follow links if within depth
        if self.max_depth > 1:
            if current_depth < self.max_depth - 1:
                for link in links[:20]:  # Limit following
                    if link:
                        full_link = response.urljoin(link)
                        if full_link.startswith("http"):
                            yield response.follow(link, self.parse, meta={
                                'depth': current_depth + 1,
                                'source_chain': current_source_chain
                            })
`;
}

async function findScrapy(): Promise<string | null> {
  try {
    // Use "python -W ignore -m scrapy" for cross-platform compatibility
    // -W ignore suppresses Python warnings that can cause false failures
    // Note: scrapy --version exits with code 2 even on success, so we check the output
    const result = await runCommand('python', ['-W', 'ignore', '-m', 'scrapy', '--version'], {});
    // Check if the output contains "Scrapy" to confirm it's installed
    const output = result.output || result.error || '';
    if (output.includes('Scrapy')) {
      return 'python -W ignore -m scrapy';
    }
    return null;
  } catch {
    return null;
  }
}

function runCommand(
  cmd: string,
  args: string[],
  options: { cwd?: string; streamStderr?: boolean }
): Promise<{ success: boolean; output?: string; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, {
      cwd: options.cwd,
      shell: false,
    });

    let stderr = '';
    let stdout = '';
    let stderrLineBuffer = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      const chunk = data.toString();
      stderr += chunk;

      // Stream scrapy's stderr lines to parent process stderr in real-time
      // so the executor can surface them as live job logs. Only enable for
      // long-running spider runs (not version probes etc.)
      if (options.streamStderr) {
        stderrLineBuffer += chunk;
        const lines = stderrLineBuffer.split('\n');
        // Keep last incomplete line
        stderrLineBuffer = lines.pop() || '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            // Forward to parent stderr; executor will treat non-JSON as log event
            process.stderr.write(trimmed + '\n');
          }
        }
      }
    });

    proc.on('close', (code) => {
      // Flush any remaining buffered line
      if (options.streamStderr && stderrLineBuffer.trim()) {
        process.stderr.write(stderrLineBuffer.trim() + '\n');
      }
      // Only treat as success if exit code is 0
      if (code === 0) {
        resolve({ success: true, output: stdout + stderr });
      } else {
        resolve({ success: false, error: stderr || `Process exited with code ${code}` });
      }
    });

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });
  });
}
