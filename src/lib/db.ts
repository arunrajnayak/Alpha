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
  const dbUrl = process.env.DATABASE_URL;

  // Always require Turso credentials via DATABASE_URL
  if (!dbUrl) {
    throw new Error(
      'Missing database credentials. Please set DATABASE_URL in your .env.local file.\n' +
      'Example: DATABASE_URL="libsql://your-db.turso.io?authToken=your-token"'
    );
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(dbUrl);
  } catch (e) {
    throw new Error('Invalid DATABASE_URL format.');
  }

  const scheme = parsedUrl.protocol.replace(':', '');
  const supportedSchemes = new Set(['libsql', 'wss', 'ws', 'https', 'http', 'file']);
  
  if (!supportedSchemes.has(scheme)) {
    if (scheme === 'postgres' || scheme === 'postgresql') {
      throw new Error(
        `Unsupported database URL scheme "${scheme}:". This app requires a Turso/libSQL URL. ` +
        `Please set DATABASE_URL to your Turso connection string (libsql/https/wss).`
      );
    }
    throw new Error('Unsupported database URL. DATABASE_URL must be a libsql/https/wss/file URL.');
  }

  // Extract auth token from URL query params
  const authToken = parsedUrl.searchParams.get('authToken') ?? undefined;
  
  // Clean URL for the adapter by removing query params Prisma doesn't need
  parsedUrl.searchParams.delete('sslmode');
  parsedUrl.searchParams.delete('authToken');
  const cleanUrl = parsedUrl.toString();

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

  const adapter = new PrismaLibSql({
    url: cleanUrl,
    authToken,
  });

  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma_v2 || createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma_v2 = prisma;
