import 'server-only';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { dbLogger } from '@/lib/logger';

const globalForPrisma = global as unknown as { prisma_v2: PrismaClient };

/**
 * Splits an array into chunks for batched queries.
 * Postgres handles large IN clauses natively, but batching is still
 * useful for bulk inserts (createMany) and to keep individual queries
 * from becoming too large.
 */
export function chunkArray<T>(array: T[], chunkSize: number = 50): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

// Keep the old name exported as an alias for backward compat in imports
// SQLite maximum expression tree depth is 100, which restricts IN clause elements.
export const SQLITE_IN_CLAUSE_LIMIT = 50;

function createPrismaClient(): PrismaClient {
  // DATABASE_URL is the canonical name used throughout the app.
  // TURSO_DATABASE_URL is the variable name injected by the Vercel Marketplace
  // Turso integration, so we fall back to it automatically.
  const dbUrl = process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL;

  // Always require Turso credentials via DATABASE_URL
  if (!dbUrl) {
    throw new Error(
      'Missing database credentials. Please set DATABASE_URL (or TURSO_DATABASE_URL) in your .env.local file.\n' +
      'Example: DATABASE_URL="libsql://your-database.turso.io"'
    );
  }

  // Convert libsql:// to https:// to force HTTP transport, which is required
  // because Vercel Serverless Functions do not support persistent WebSockets (wss://).
  // This trim/replace is robust against leading whitespaces, surrounding quotes, and case sensitivity.
  let cleanUrl = dbUrl.trim().replace(/^["']|["']$/g, '');
  if (/^libsql:\/\//i.test(cleanUrl)) {
    cleanUrl = cleanUrl.replace(/^libsql:\/\//i, 'https://');
  }

  dbLogger.info('Connected to Turso/SQLite via HTTP libSQL adapter');

  const adapter = new PrismaLibSql({
    url: cleanUrl,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma_v2 || createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma_v2 = prisma;
