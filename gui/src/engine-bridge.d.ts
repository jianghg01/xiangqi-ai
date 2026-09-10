export {};

declare global {
  interface Window {
    engine?: {
      start(exePath: string): Promise<boolean>;
      write(cmd: string): void;
      alive(): Promise<boolean>;
      onLine(cb: (line: string) => void): void;
      saveText(defaultName: string, content: string, kind?: 'json' | 'pgn'): Promise<string | null>;
      saveImage(defaultName: string, dataUrl: string): Promise<string | null>;
      openText(): Promise<{ path: string; content: string } | null>;
      libList(): Promise<{ name: string; size: number; mtime: number }[] | { error: string }>;
      libRead(name: string): Promise<{ content: string } | { error: string }>;
      libSave(name: string, content: string): Promise<boolean | { error: string }>;
      libDelete(name: string): Promise<boolean | { error: string }>;
    };
  }
}
