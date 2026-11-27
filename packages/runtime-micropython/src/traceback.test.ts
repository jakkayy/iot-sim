import { describe, expect, test } from "bun:test";
import { parseTraceback } from "./traceback";

describe("parseTraceback", () => {
  test("maps a NameError to the innermost user line", () => {
    const tb =
      'Traceback (most recent call last):\n  File "main.py", line 7, in <module>\n  File "main.py", line 3, in f\nNameError: name \'x\' isn\'t defined\n';
    expect(parseTraceback(tb, "NameError")).toEqual({
      type: "NameError",
      message: "NameError: name 'x' isn't defined",
      line: 3,
    });
  });

  test("ignores frames outside the user file", () => {
    const tb = 'Traceback (most recent call last):\n  File "<stdin>", line 1, in <module>\n  File "main.py", line 2, in <module>\nValueError: bad\n';
    expect(parseTraceback(tb, "ValueError").line).toBe(2);
  });

  test("no user frame -> no line", () => {
    const tb = 'Traceback (most recent call last):\n  File "<stdin>", line 9, in <module>\nOSError: x\n';
    expect(parseTraceback(tb).line).toBeUndefined();
  });
});
