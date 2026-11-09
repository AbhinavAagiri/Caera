import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { AgentError } from '../errorHandling';
import type { AgentTool } from '../types';

const MAX_BYTES = 1_500_000;
const MAX_LINKS = 12;

function blocked(message: string): AgentError {
  return new AgentError('AGENT_WEB_BLOCKED', message, {
    status: 400,
    hint: 'Use a public http(s) URL. Localhost, private network addresses and non-web ports are blocked.',
  });
}

function privateIpv4(parts: number[]): boolean {
  const [a = 0, b = 0] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51) ||
    (a === 203 && b === 0) ||
    a === 255
  );
}

function privateAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return privateIpv4(address.split('.').map(Number));
  if (version !== 6) return true;

  const normalized = address.toLowerCase().split('%')[0] ?? '';
  if (normalized === '::' || normalized === '::1') return true;
  if (normalized.startsWith('::ffff:')) {
    const tail = normalized.slice('::ffff:'.length);
    return isIP(tail) === 4 ? privateIpv4(tail.split('.').map(Number)) : true;
  }
  return (
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe8') ||
    normalized.startsWith('fe9') ||
    normalized.startsWith('fea') ||
    normalized.startsWith('feb') ||
    normalized.startsWith('ff') ||
    normalized.startsWith('2001:db8')
  );
}

async function validateUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw blocked('That is not a valid URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw blocked('Only http and https URLs can be researched.');
  }
  if (url.username || url.password) {
    throw blocked('URLs containing credentials are not allowed.');
  }
  if (url.port && url.port !== '80' && url.port !== '443') {
    throw blocked('Only standard web ports 80 and 443 are allowed.');
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal')
  ) {
    throw blocked('Local and private hostnames cannot be researched.');
  }

  const literalVersion = isIP(hostname);
  if (literalVersion !== 0) {
    if (privateAddress(hostname)) throw blocked('Private network addresses cannot be researched.');
    return url;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new AgentError('AGENT_TOOL_FAILED', 'The public host could not be resolved.', {
      status: 502,
      hint: 'Check the URL and this computer’s internet connection.',
    });
  }

  if (addresses.length === 0 || addresses.some((entry) => privateAddress(entry.address))) {
    throw blocked('That hostname resolves to a private or reserved address.');
  }

  return url;
}

interface FetchedPage {
  finalUrl: string;
  contentType: string;
  body: string;
  truncated: boolean;
}

async function readBounded(response: Response, signal: AbortSignal): Promise<{ body: string; truncated: boolean }> {
  if (!response.body) return { body: '', truncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let body = '';
  let truncated = false;

  try {
    while (true) {
      if (signal.aborted) throw new AgentError('AGENT_CANCELLED', 'The web request was cancelled.');
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        const remaining = Math.max(0, MAX_BYTES - (total - value.byteLength));
        body += decoder.decode(value.subarray(0, remaining), { stream: true });
        truncated = true;
        await reader.cancel();
        break;
      }
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }

  body += decoder.decode();
  return { body, truncated };
}

async function fetchPublic(url: URL, signal: AbortSignal): Promise<FetchedPage> {
  let current = url;

  for (let redirect = 0; redirect <= 2; redirect += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.any([signal, AbortSignal.timeout(18_000)]),
        headers: {
          Accept: 'text/html, text/plain;q=0.9',
          'User-Agent': 'CAERA-Agent/0.1 (local personal assistant)',
        },
      });
    } catch (cause) {
      throw new AgentError(
        'AGENT_TOOL_FAILED',
        cause instanceof Error && cause.name === 'TimeoutError'
          ? 'The web page did not respond in time.'
          : 'The web page could not be reached.',
        {
          status: 502,
          hint: 'No page content was returned. Check the URL and connection.',
        },
      );
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new AgentError('AGENT_TOOL_FAILED', 'The web page returned an incomplete redirect.', {
          status: 502,
        });
      }
      current = await validateUrl(new URL(location, current).toString());
      continue;
    }

    if (!response.ok) {
      throw new AgentError(
        'AGENT_TOOL_FAILED',
        `The web page returned HTTP ${response.status}.`,
        {
          status: response.status === 404 ? 404 : 502,
          hint: 'The page may be private, removed or temporarily unavailable.',
        },
      );
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      throw new AgentError('AGENT_TOOL_FAILED', 'That URL is not an HTML or plain-text page.', {
        status: 415,
        hint: 'Only readable web pages are supported; binaries and downloads are rejected.',
      });
    }

    const { body, truncated } = await readBounded(response, signal);
    return { finalUrl: current.toString(), contentType, body, truncated };
  }

  throw new AgentError('AGENT_WEB_BLOCKED', 'The web page redirected too many times.', {
    status: 400,
  });
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    ndash: '–',
    mdash: '—',
  };
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name.toLowerCase()] ?? match);
}

function pageTitle(html: string): string {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? compact(decodeEntities(match[1] ?? '')).slice(0, 200) : '';
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function htmlToText(html: string): string {
  return compact(
    decodeEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<template[\s\S]*?<\/template>/gi, ' ')
        .replace(/<!--[\s\S]*?-->/g, ' ')
        .replace(/<\/(p|div|li|h[1-6]|tr|section|article|header|footer)>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' '),
    ).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n'),
  );
}

function extractLinks(html: string, base: string): string[] {
  const links: string[] = [];
  const seen = new Set<string>();
  const pattern = /href\s*=\s*["']([^"']+)["']/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    try {
      const url = new URL(decodeEntities(match[1] ?? ''), base);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      if (url.hostname === new URL(base).hostname) {
        const value = url.toString();
        if (!seen.has(value)) {
          seen.add(value);
          links.push(value);
        }
      }
    } catch {
      // Ignore malformed links.
    }
    if (links.length >= MAX_LINKS) break;
  }
  return links;
}

function relevantText(text: string, focus: string, maxChars: number): string {
  if (!focus.trim()) return text.slice(0, maxChars);
  const terms = focus.toLowerCase().split(/\s+/).filter((term) => term.length >= 3);
  if (terms.length === 0) return text.slice(0, maxChars);

  const paragraphs = text.split(/\n{2,}|(?<=\.)\s+/).filter((part) => part.trim().length > 0);
  const selected = paragraphs
    .filter((part) => terms.some((term) => part.toLowerCase().includes(term)))
    .slice(0, 12)
    .join('\n\n');
  return (selected || text).slice(0, maxChars);
}

export const webResearchTool: AgentTool = {
  name: 'web.research',
  label: 'Read a public web page',
  description:
    'Fetch one public HTML or plain-text page, extract its readable text and document links, and focus the returned excerpt on optional terms. Local and private network addresses are blocked.',
  source: 'web',
  sourceLabel: 'Public web',
  permission: 'network',
  risk: 'low',
  requiresConfirmation: false,
  timeoutMs: 20_000,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      url: {
        type: 'string',
        description: 'Public http(s) URL to read.',
        maxLength: 2_048,
      },
      focus: {
        type: 'string',
        description: 'Optional terms to prioritize in the returned excerpt.',
        maxLength: 200,
      },
      maxChars: {
        type: 'integer',
        description: 'Maximum extracted characters to return, from 2,000 to 12,000.',
        minimum: 2_000,
        maximum: 12_000,
      },
    },
    required: ['url'],
  },
  async execute(args, context) {
    const rawUrl = String(args.url ?? '').trim();
    if (!rawUrl) throw blocked('A public URL is required.');
    const focus = typeof args.focus === 'string' ? args.focus : '';
    const maxChars =
      typeof args.maxChars === 'number' ? Math.min(Math.max(args.maxChars, 2_000), 12_000) : 8_000;
    const url = await validateUrl(rawUrl);
    const page = await fetchPublic(url, context.signal);
    const title = page.contentType.includes('text/html') ? pageTitle(page.body) : '';
    const text =
      page.contentType.includes('text/html') ? htmlToText(page.body) : compact(page.body);
    const content = relevantText(text, focus, maxChars);

    return {
      summary: `Read ${title || new URL(page.finalUrl).hostname} (${content.length} characters returned)`,
      data: {
        url: page.finalUrl,
        title: title || null,
        content,
        truncated: page.truncated || content.length < text.length,
        links: page.contentType.includes('text/html')
          ? extractLinks(page.body, page.finalUrl)
          : [],
      },
    };
  },
};
