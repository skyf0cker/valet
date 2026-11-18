declare module "bun:test" {
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export const expect: {
    (value: unknown): {
      toBe(expected: unknown): void;
      toEqual(expected: unknown): void;
      toContain(expected: unknown): void;
      toMatch(expected: RegExp): void;
      toHaveLength(expected: number): void;
      not: {
        toContain(expected: unknown): void;
        toBe(expected: unknown): void;
        toMatch(expected: RegExp): void;
      };
    };
  };
}
