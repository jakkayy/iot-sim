/**
 * Line buffer for the serial monitor. Programs can print thousands of lines per
 * second; pushing each one into React state would freeze the page. Lines are
 * appended to a ring buffer and listeners are notified at most once per
 * `flushMs` with a stable snapshot.
 */
export class SerialLog {
  private lines: string[] = [];
  private version = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();
  /** Immutable view handed to React; replaced on flush. */
  private snapshot: readonly string[] = [];

  constructor(
    private readonly maxLines = 5000,
    private readonly flushMs = 50,
  ) {}

  push(text: string): void {
    for (const line of text.split("\n")) this.lines.push(line);
    const overflow = this.lines.length - this.maxLines;
    if (overflow > 0) this.lines.splice(0, overflow);
    this.version++;
    if (!this.timer) this.timer = setTimeout(() => this.flush(), this.flushMs);
  }

  clear(): void {
    this.lines = [];
    this.version++;
    this.flush();
  }

  private flush(): void {
    this.timer = null;
    this.snapshot = this.lines.slice();
    for (const l of this.listeners) l();
  }

  // useSyncExternalStore API
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): readonly string[] => this.snapshot;
}
