declare const Buffer: {
  from(input: string, encoding?: string): any;
};

declare module 'node:crypto' {
  export function randomUUID(): string;
  export function createHash(algorithm: string): { update(input: string): any; digest(encoding: string): string };
  export function createPublicKey(input: string): any;
  export function verify(algorithm: null, data: any, key: any, signature: any): boolean;
  export function sign(algorithm: null, data: any, key: any): any;
  export function generateKeyPairSync(type: 'ed25519'): { publicKey: { export(options: any): any }; privateKey: any };
}

declare module 'node:test' {
  type TestFunction = (name: string, fn: () => void | Promise<void>) => void;
  const test: TestFunction;
  export default test;
}

declare module 'node:assert/strict' {
  const assert: any;
  export default assert;
}

declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(location: string, options?: any);
    exec(sql: string): void;
    prepare(sql: string): {
      run(...params: any[]): { changes: number | bigint; lastInsertRowid: number | bigint };
      get(...params: any[]): any;
      all(...params: any[]): any[];
    };
    close(): void;
  }
}

declare module 'node:fs' {
  export function readFileSync(path: string | URL, encoding: 'utf8'): string;
  export function writeFileSync(path: string | URL, data: string, encoding?: 'utf8'): void;
}

declare module 'node:http' {
  export function createServer(handler: (req: any, res: any) => void | Promise<void>): any;
}

declare module 'node:crypto' {
  export function createHmac(algorithm: string, key: string): { update(input: string): any; digest(encoding: string): string };
  export function timingSafeEqual(a: any, b: any): boolean;
}

declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  exitCode?: number;
};

declare module 'node:crypto' {
  export function createPublicKey(input: any): any;
  export function verify(algorithm: string | null, data: any, key: any, signature: any): boolean;
  export function generateKeyPairSync(type: 'rsa', options: any): { publicKey: any; privateKey: any };
}

declare function setTimeout(handler: (...args:any[]) => void, timeout?: number): any;
declare module 'node:crypto' { export function sign(algorithm: string | null, data: any, key: any): any; }

declare module 'pg-native' {
  export default class PgNativeClient {
    connectSync(connectionString?: string): void;
    querySync(sql: string, params?: readonly any[]): any[];
    end(): void;
  }
}
