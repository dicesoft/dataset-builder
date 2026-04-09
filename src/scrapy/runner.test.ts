// Simple regression test for runner.ts generateSpider function
// Run with: npx ts-node src/scrapy/runner.test.ts

import { generateSpider } from './runner';
import assert from 'assert';

console.log('Running runner.ts regression tests...\n');

// Test 1: Verify proper escape sequences in generated Python code
console.log('Test 1: Checking for proper escape sequences...');
const spiderCode = generateSpider('test_spider', 'example.com', 2);

// Verify the code contains the literal \n\n (escaped backslashes in the generated Python)
const expectedPattern = 'text = "\\n\\n".join(unique_texts)';
assert(spiderCode.includes(expectedPattern), `Generated code should contain "${expectedPattern}"`);
console.log('✓ Found correct escape sequence: text = "\\n\\n".join(unique_texts)');

// Verify there are no actual newline characters inside the string literal
const problematicPattern = /text = "[\r\n]+/;
assert(
  !problematicPattern.test(spiderCode),
  'Generated code should NOT contain actual newlines inside the string literal'
);
console.log('✓ No actual newlines found inside string literals\n');

// Test 2: Verify valid Python syntax structure
console.log('Test 2: Checking Python syntax structure...');
assert(spiderCode.includes('import scrapy'), 'Should import scrapy');
console.log('✓ Contains import scrapy');

assert(
  spiderCode.includes('class test_spiderSpider(scrapy.Spider):'),
  'Should have correct class definition'
);
console.log('✓ Contains class definition');

assert(spiderCode.includes('name = "test_spider"'), 'Should have correct spider name');
console.log('✓ Contains spider name');

assert(spiderCode.includes('def parse(self, response):'), 'Should have parse method');
console.log('✓ Contains parse method');

assert(spiderCode.includes('yield {'), 'Should have yield statement');
console.log('✓ Contains yield statement\n');

// Test 3: Verify URL handling
console.log('Test 3: Checking URL handling...');
const codeWithUrl = generateSpider('test', 'example.com', 1);
assert(codeWithUrl.includes('"https://example.com"'), 'Should add https scheme if missing');
console.log('✓ Adds https scheme when missing');

const codeWithHttps = generateSpider('test', 'https://example.com', 1);
assert(codeWithHttps.includes('"https://example.com"'), 'Should preserve https scheme');
console.log('✓ Preserves https scheme when present\n');

// Test 4: Verify hyphen handling in spider names
console.log('Test 4: Checking spider name handling...');
const codeWithHyphen = generateSpider('my-spider', 'example.com', 1);
assert(
  codeWithHyphen.includes('class my_spiderSpider'),
  'Should replace hyphens with underscores in class name'
);
assert(codeWithHyphen.includes('name = "my-spider"'), 'Should preserve hyphens in name property');
console.log('✓ Correctly handles spider names with hyphens\n');

// Test 5: Verify YouTube regex patterns have proper backslash escaping
console.log('Test 5: Checking YouTube regex backslash preservation...');
const youtubeCode = generateSpider('yt_test', 'https://www.youtube.com/watch?v=abc', 1);

// The generated Python code must contain actual backslashes in regex patterns
// e.g. r'youtube\.com/watch\?v=' (with real backslash characters)
assert(
  youtubeCode.includes('youtube\\.com/watch\\?v='),
  'YouTube regex should contain backslash-escaped dot and question mark in watch pattern'
);
console.log('✓ youtube\\.com/watch\\?v= pattern has proper backslashes');

assert(
  youtubeCode.includes('youtu\\.be/'),
  'YouTube regex should contain backslash-escaped dot in youtu.be pattern'
);
console.log('✓ youtu\\.be/ pattern has proper backslashes');

assert(
  youtubeCode.includes('youtube\\.com/playlist\\?list='),
  'YouTube regex should contain backslash-escaped dot and question mark in playlist pattern'
);
console.log('✓ youtube\\.com/playlist\\?list= pattern has proper backslashes');

assert(
  youtubeCode.includes('www\\.youtube\\.com/watch\\?v='),
  'YouTube regex should contain backslash-escaped dots in www pattern'
);
console.log('✓ www\\.youtube\\.com/watch\\?v= pattern has proper backslashes');

// Negative check: ensure the broken unescaped patterns are NOT present
// Look for the specific broken pattern where dots and ? are unescaped in the regex
const brokenPattern = "r'youtube.com/watch?v='";
assert(
  !youtubeCode.includes(brokenPattern),
  'Generated code should NOT contain unescaped youtube regex pattern'
);
console.log('✓ No unescaped YouTube regex patterns found\n');

console.log('✅ All tests passed!');
process.exit(0);
