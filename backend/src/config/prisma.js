import { PrismaClient } from '@prisma/client';
import { env } from './env.js';

// Single client per process. datasourceUrl lets tests point at TEST_DATABASE_URL.
export const prisma = new PrismaClient({
  datasourceUrl: env.DATABASE_URL,
  log: env.isProduction ? ['error'] : ['error', 'warn'],
});
