import 'server-only';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';

const globalForPrisma = global as unknown as { prisma_v2: PrismaClient };

/**
 * SQLite has a limit on expression tree depth (max 100).
 * When using IN clauses with many values, we need to batch the queries.
 * This constant defines the maximum number of items per IN clause.
 */
export const SQLITE_IN_CLAUSE_LIMIT = 50;

/**
 * Splits an array into chunks for batched queries.
 * Use this when building IN clauses with potentially large arrays.
 */
export function chunkArray<T>(array: T[], chunkSize: number = SQLITE_IN_CLAUSE_LIMIT): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

function createPrismaClient(): PrismaClient {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoAuth = process.env.TURSO_AUTH_TOKEN;

  // Always require Turso credentials - no local database fallback
  if (!tursoUrl || !tursoAuth) {
    throw new Error(
      'Missing database credentials. Please set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in your .env.local file.\n' +
      'Copy .env.local.example to .env.local and fill in your Turso credentials.'
    );
  }

  const supportedSchemes = new Set(['libsql', 'wss', 'ws', 'https', 'http', 'file']);
  const resolveLibsqlUrl = (primary: string, fallback?: string) => {
    const candidates = [primary, fallback].filter(Boolean) as string[];
    for (const candidate of candidates) {
      try {
        const url = new URL(candidate);
        if (supportedSchemes.has(url.protocol.replace(':', ''))) {
          url.searchParams.delete('sslmode');
          return url.toString();
        }
      } catch {
        // ignore parse errors for now; we'll validate below
      }
    }

    const firstCandidate = candidates[0];
    if (firstCandidate) {
      const scheme = firstCandidate.split(':')[0];
      if (scheme === 'postgres' || scheme === 'postgresql') {
        throw new Error(
          `Unsupported database URL scheme "${scheme}:". This app requires a Turso/libSQL URL. ` +
          `Please set TURSO_DATABASE_URL to your Turso connection string (libsql/https/wss), not a Postgres URL.`
        );
      }
    }

    throw new Error(
      'Unsupported database URL. TURSO_DATABASE_URL must be a libsql/https/wss/file URL.'
    );
  };

  // Suppress TLS warning in development (Turso connection)
  if (process.env.NODE_ENV !== 'production') {
    const originalWarn = process.emitWarning;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    process.emitWarning = (warning: any, ...args: any[]) => {
      if (typeof warning === 'string' && warning.includes('NODE_TLS_REJECT_UNAUTHORIZED')) {
        return;
      }
      return originalWarn.call(process, warning, ...args);
    };
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  console.log('[Database] Connected to Turso (Serverless SQLite)');

  const libsqlUrl = resolveLibsqlUrl(tursoUrl, process.env.DATABASE_URL);

  const adapter = new PrismaLibSql({
    url: libsqlUrl,
    authToken: tursoAuth,
  });

  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma_v2 || createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma_v2 = prisma;
