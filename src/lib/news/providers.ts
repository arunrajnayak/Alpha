/**
 * News source provider registry — shared, client-safe metadata (no secrets).
 *
 * Each provider declares which credential fields it needs so the settings UI
 * can render the right inputs dynamically, and the server knows how to fetch.
 */

export interface CredField {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  placeholder?: string;
}

export interface ProviderSpec {
  id: string;
  label: string;
  /** Domains that imply this provider when typed by the user. */
  domains: string[];
  /** Credential inputs (empty for a plain public RSS site). */
  fields: CredField[];
  note?: string;
}

export const DEFAULT_PROVIDER = 'rss';

export const PROVIDER_SPECS: ProviderSpec[] = [
  {
    id: 'rss',
    label: 'Website (RSS / feed)',
    domains: [],
    // Optional credentials only for private/authenticated feeds.
    fields: [
      { key: 'token', label: 'API key / token', secret: true, placeholder: 'optional' },
      { key: 'user', label: 'Username', placeholder: 'optional' },
      { key: 'pass', label: 'Password', secret: true, placeholder: 'optional' },
    ],
    note: "We'll try the site's feed (/feed, /rss…) over HTTPS with these credentials.",
  },
  {
    id: 'x',
    label: 'X (Twitter) API',
    domains: ['x.com', 'twitter.com'],
    fields: [
      { key: 'bearerToken', label: 'Bearer Token', secret: true, required: true, placeholder: 'App-only Bearer Token (read)' },
    ],
    note: 'Only the App-only Bearer Token is needed. Recent-search may require a paid X API tier.',
  },
];

export function providerById(id: string): ProviderSpec {
  return PROVIDER_SPECS.find((p) => p.id === id) ?? PROVIDER_SPECS[0];
}

/** Infer a provider id from a bare domain (x.com/twitter.com → "x"). */
export function providerForDomain(domain: string): string {
  const d = domain.toLowerCase();
  for (const spec of PROVIDER_SPECS) {
    if (spec.domains.includes(d)) return spec.id;
  }
  return DEFAULT_PROVIDER;
}
