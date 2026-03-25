import { jest } from "@jest/globals";

const mockFn = () => jest.fn<(...args: any[]) => any>();

export const mockPrisma = {
  user: {
    findUnique: mockFn(),
    findMany: mockFn(),
    count: mockFn(),
    update: mockFn(),
  },
  userIdentityProfile: {
    upsert: mockFn(),
  },
  verificationSubmission: {
    findFirst: mockFn(),
    findMany: mockFn(),
    create: mockFn(),
    update: mockFn(),
  },
  listing: {
    findMany: mockFn(),
    count: mockFn(),
    create: mockFn(),
  },
  notification: {
    createMany: mockFn(),
    create: mockFn(),
  },
  jointOffer: {
    findMany: mockFn(),
  },
};

export const resetMockPrisma = () => {
  Object.values(mockPrisma).forEach((group) => {
    if (!group || typeof group !== 'object') return;
    Object.values(group).forEach((fn) => {
      if (typeof fn === 'function' && 'mockReset' in fn) {
        (fn as jest.Mock).mockReset();
      }
    });
  });
};
