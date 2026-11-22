import { create } from "zustand";

export type Lang = "py" | "ino";

export const DEFAULT_PY = `from machine import Pin
import time

led = Pin(2, Pin.OUT)

while True:
    led.value(1)
    time.sleep(0.5)
    led.value(0)
    time.sleep(0.5)
`;

export const DEFAULT_INO = `void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}
`;

export interface ProjectStore {
  lang: Lang;
  code: Record<Lang, string>;
  setLang(lang: Lang): void;
  setCode(lang: Lang, code: string): void;
}

export const useProject = create<ProjectStore>((set) => ({
  lang: "py",
  code: { py: DEFAULT_PY, ino: DEFAULT_INO },
  setLang: (lang) => set({ lang }),
  setCode: (lang, code) => set((s) => ({ code: { ...s.code, [lang]: code } })),
}));
