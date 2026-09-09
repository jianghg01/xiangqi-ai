export {};

declare global {
  interface Window {
    engine?: {
      start(exePath: string): Promise<boolean>;
      write(cmd: string): void;
      alive(): Promise<boolean>;
      onLine(cb: (line: string) => void): void;
      saveText(defaultName: string, content: string): Promise<string | null>;
      openText(): Promise<{ path: string; content: string } | null>;
    };
  }
}
