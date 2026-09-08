export {};

declare global {
  interface Window {
    engine?: {
      start(exePath: string): Promise<boolean>;
      write(cmd: string): void;
      alive(): Promise<boolean>;
      onLine(cb: (line: string) => void): void;
    };
  }
}
