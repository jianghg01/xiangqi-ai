export {};

declare global {
  interface Window {
    engine?: {
      start(slot: 'main' | 'red' | 'black', exePath: string): Promise<boolean>;
      write(slot: 'main' | 'red' | 'black', cmd: string): void;
      alive(slot: 'main' | 'red' | 'black'): Promise<boolean>;
      onLine(cb: (msg: { slot: 'main' | 'red' | 'black'; line: string }) => void): void;
      saveText(defaultName: string, content: string, kind?: 'json' | 'pgn' | 'md' | 'txt'): Promise<string | null>;
      saveImage(defaultName: string, dataUrl: string): Promise<string | null>;
      openText(): Promise<{ path: string; content: string } | null>;
      libList(): Promise<{ name: string; size: number; mtime: number; redName?: string | null; blackName?: string | null; date?: string | null; result?: string | null }[] | { error: string }>;
      libRead(name: string): Promise<{ content: string } | { error: string }>;
      libSave(name: string, content: string): Promise<boolean | { error: string }>;
      libBackup(name: string, content: string): Promise<boolean | { error: string }>;
      libDelete(name: string): Promise<boolean | { error: string }>;
      llmChat(payload: {
        baseUrl: string;
        apiKey: string;
        model: string;
        messages: { role: 'system' | 'user'; content: string }[];
        maxTokens?: number;
        temperature?: number;
      }): Promise<{ content: string } | { error: string }>;
      getMem(): Promise<{ totalMB: number; freeMB: number }>;
      exportData(localStorageData: Record<string, string>): Promise<{ canceled: boolean; path?: string }>;
      importData(): Promise<{ canceled: boolean; path?: string; localStorageData?: Record<string, string> }>;
    };
  }
}
