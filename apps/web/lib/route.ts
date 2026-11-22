export interface Point {
  x: number;
  y: number;
}
export type Dir = "left" | "right" | "up" | "down";

const STUB = 14;

const horizontal = (d: Dir) => d === "left" || d === "right";

function stub(p: Point, d: Dir): Point {
  switch (d) {
    case "left":
      return { x: p.x - STUB, y: p.y };
    case "right":
      return { x: p.x + STUB, y: p.y };
    case "up":
      return { x: p.x, y: p.y - STUB };
    case "down":
      return { x: p.x, y: p.y + STUB };
  }
}

/**
 * Orthogonal wire path. Without directions: horizontal, vertical, horizontal
 * with the bend at the midpoint. With directions, the wire first leaves each pin
 * along its direction (so it never runs back over the device it comes from).
 */
export function routeWire(a: Point, b: Point, da?: Dir, db?: Dir): string {
  if (!da || !db) {
    if (a.y === b.y) return `M ${a.x} ${a.y} H ${b.x}`;
    const mx = Math.round((a.x + b.x) / 2);
    return `M ${a.x} ${a.y} H ${mx} V ${b.y} H ${b.x}`;
  }
  const sa = stub(a, da);
  const sb = stub(b, db);
  const pts: Point[] = [a, sa];
  if (horizontal(da) && horizontal(db)) {
    // Same direction: use a channel beyond both stubs so the wire never doubles back over its own device.
    const mx =
      da === db
        ? da === "right"
          ? Math.max(sa.x, sb.x)
          : Math.min(sa.x, sb.x)
        : Math.round((sa.x + sb.x) / 2);
    pts.push({ x: mx, y: sa.y }, { x: mx, y: sb.y });
  } else if (!horizontal(da) && !horizontal(db)) {
    const my =
      da === db
        ? da === "down"
          ? Math.max(sa.y, sb.y)
          : Math.min(sa.y, sb.y)
        : Math.round((sa.y + sb.y) / 2);
    pts.push({ x: sa.x, y: my }, { x: sb.x, y: my });
  } else if (horizontal(da)) {
    // Arrive at a vertical pin from outside the device: from below a down pin, from above an up pin.
    const fromOutside = db === "down" ? sa.y >= sb.y : sa.y <= sb.y;
    pts.push(fromOutside ? { x: sb.x, y: sa.y } : { x: sa.x, y: sb.y });
  } else {
    const outward = da === "down" ? sb.y >= sa.y : sb.y <= sa.y;
    pts.push(outward ? { x: sa.x, y: sb.y } : { x: sb.x, y: sa.y });
  }
  pts.push(sb, b);
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
}
