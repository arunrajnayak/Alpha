/**
 * Standalone Prisma client for scripts.
 * Loads .env.local for DATABASE_URL (Turso libSQL).
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
config({ path: '.env' });

import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';

const dbUrl = process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL;
if (!dbUrl) throw new Error('Missing DATABASE_URL / TURSO_DATABASE_URL env var');

// Convert libsql:// to https:// for HTTP transport
let cleanUrl = dbUrl.trim().replace(/^["']|["']$/g, '');
if (/^libsql:\/\//i.test(cleanUrl)) {
  cleanUrl = cleanUrl.replace(/^libsql:\/\//i, 'https://');
}

const adapter = new PrismaLibSql({
  url: cleanUrl,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

export const prisma = new PrismaClient({ adapter });

export function chunkArray<T>(array: T[], chunkSize: number = 500): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}
