import { describe, expect, test } from "bun:test";
import { crc32, exportFiles, makeZip, wiringMarkdown, wiringTable } from "./export";
import { TEMPLATES } from "./templates";

const tpl = (id: string) => {
  const t = TEMPLATES.find((x) => x.id === id)!;
  return { components: t.components.map(({ id, type }) => ({ id, type })), wires: t.wires };
};

describe("wiringTable", () => {
  test("lists direct connections and connections through a resistor", () => {
    const rows = wiringTable(tpl("blink"));
    const find = (device: string, pin: string) => rows.find((r) => r.device.startsWith(device) && r.pin === pin)!;
    expect(find("led1", "K").connectedTo).toEqual(["GND"]);
    expect(find("r1", "1").connectedTo).toEqual(["GPIO2"]);
    // the LED anode only reaches GPIO2 through the resistor
    expect(find("led1", "A").connectedTo).toEqual(["GPIO2 (through r1)"]);
  });

  test("covers every pin of every non-board part exactly once", () => {
    const rows = wiringTable(tpl("dht22-oled"));
    expect(rows.length).toBe(3 + 4);
    expect(rows.find((r) => r.device.startsWith("oled1") && r.pin === "SDA")!.connectedTo).toEqual(["GPIO21"]);
    expect(rows.find((r) => r.device.startsWith("dht1") && r.pin === "DATA")!.connectedTo).toEqual(["GPIO4"]);
  });

  test("an unconnected pin is reported as such", () => {
    const data = { components: [{ id: "esp1", type: "esp32-devkit" }, { id: "led1", type: "led" }], wires: [] };
    const md = wiringMarkdown(wiringTable(data));
    expect(md).toContain("| led1 (LED) | A | (not connected) |");
    expect(md).toContain("| Part | Pin | Connect to |");
  });
});

describe("zip writer", () => {
  test("crc32 matches the standard check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  /** Read our own archive back using only the central directory (what unzip does). */
  function readZip(zip: Uint8Array) {
    const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const eocd = zip.length - 22;
    expect(v.getUint32(eocd, true)).toBe(0x06054b50);
    const count = v.getUint16(eocd + 10, true);
    let p = v.getUint32(eocd + 16, true);
    const out: Record<string, { text: string; crcOk: boolean }> = {};
    for (let i = 0; i < count; i++) {
      expect(v.getUint32(p, true)).toBe(0x02014b50);
      const crc = v.getUint32(p + 16, true);
      const size = v.getUint32(p + 24, true);
      const nameLen = v.getUint16(p + 28, true);
      const localOff = v.getUint32(p + 42, true);
      const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
      expect(v.getUint32(localOff, true)).toBe(0x04034b50);
      const dataStart = localOff + 30 + v.getUint16(localOff + 26, true) + v.getUint16(localOff + 28, true);
      const data = zip.subarray(dataStart, dataStart + size);
      out[name] = { text: new TextDecoder().decode(data), crcOk: crc32(data) === crc };
      p += 46 + nameLen;
    }
    return out;
  }

  test("round-trips files including UTF-8 content", () => {
    const enc = new TextEncoder();
    const zip = makeZip([
      { name: "a.txt", data: enc.encode("hello") },
      { name: "dir/ไทย.txt", data: enc.encode("สวัสดี") },
    ]);
    const files = readZip(zip);
    expect(files["a.txt"]).toEqual({ text: "hello", crcOk: true });
    expect(files["dir/ไทย.txt"]).toEqual({ text: "สวัสดี", crcOk: true });
  });

  test("exportFiles bundles program, wiring and project", () => {
    const files = exportFiles({ lang: "py", code: "print(1)", circuit: tpl("blink"), project: { a: 1 } });
    expect(files.map((f) => f.name)).toEqual(["main.py", "wiring.md", "project.json"]);
    const read = readZip(makeZip(files));
    expect(read["main.py"].text).toBe("print(1)");
    expect(read["wiring.md"].text).toContain("GPIO2");
    expect(JSON.parse(read["project.json"].text)).toEqual({ a: 1 });
    expect(exportFiles({ lang: "ino", code: "", circuit: tpl("blink"), project: {} })[0].name).toBe("sketch/sketch.ino");
  });
});
