export interface PythonErrorInfo {
  /** Error type, e.g. NameError. */
  type: string;
  /** Last line of the traceback, e.g. "NameError: name 'x' isn't defined". */
  message: string;
  /** 1-based line in the user's file (innermost frame in main.py), if any. */
  line?: number;
}

export const USER_FILE = "main.py";

/** Parse a MicroPython traceback; user frames are `File "main.py", line N`. */
export function parseTraceback(traceback: string, type = "Error"): PythonErrorInfo {
  const lines = traceback.split("\n").map((l) => l.trimEnd()).filter(Boolean);
  const message = lines.at(-1) ?? type;
  let line: number | undefined;
  const re = new RegExp(`File "${USER_FILE.replace(".", "\\.")}", line (\\d+)`);
  for (const l of lines) {
    const m = re.exec(l);
    if (m) line = Number(m[1]); // keep the innermost (last) user frame
  }
  return { type, message, line };
}
