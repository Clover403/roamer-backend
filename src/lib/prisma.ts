import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env";

let _prisma: PrismaClient | undefined;

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
});

/**
 * Lazy-load Prisma client only when first accessed.
 * This ensures environment variables are loaded before PrismaClient initialization.
 */
const getPrisma = (): PrismaClient => {
  if (!_prisma) {
    _prisma = new PrismaClient({ adapter });
  }
  return _prisma;
};

/**
 * Create a proxy that lazy-loads the Prisma client on first access.
 * This allows us to ensure environment variables are loaded before creating the client.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get: (_target: any, prop: string | symbol): any => {
    const client = getPrisma();
    const value = client[prop as keyof PrismaClient];
    // Bind methods to maintain 'this' context
    if (typeof value === "function") {
      return value.bind(client);
    }
    return value;
  },
});
