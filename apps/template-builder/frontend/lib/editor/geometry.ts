// Small geometry helpers shared by the canvas mapping and the element operations.

export type Segment = ["M" | "L", number, number] | ["C", number, number, number, number, number, number] | ["Z"];

export const r3 = (v: number): number => {
  const out = Math.round(v * 1000) / 1000;
  return out === 0 ? 0 : out;
};

/** Rotate a vector clockwise (y axis pointing down) by `degrees`. */
export function rotate(dx: number, dy: number, degrees: number): [number, number] {
  if (!degrees) return [dx, dy];
  const a = (degrees * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [dx * cos - dy * sin, dx * sin + dy * cos];
}

const TOKEN = /[MLCZ]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g;
const ARITY = { M: 2, L: 2, C: 6, Z: 0 } as const;

/** Parse the subset of SVG path syntax the backend emits: absolute M, L, C and Z. */
export function parsePath(d: string): Segment[] {
  const tokens = d.match(TOKEN) ?? [];
  const segments: Segment[] = [];
  let i = 0;
  let command: keyof typeof ARITY | null = null;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token in ARITY) {
      command = token as keyof typeof ARITY;
      i += 1;
      if (command === "Z") {
        segments.push(["Z"]);
        continue;
      }
    }
    if (command === null || command === "Z") {
      i += 1;
      continue;
    }
    const n = ARITY[command];
    if (i + n > tokens.length) break;
    segments.push([command, ...tokens.slice(i, i + n).map(Number)] as Segment);
    i += n;
    if (command === "M") command = "L";
  }
  return segments;
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/** Serialise segments, passing every point through `map`. */
export function mapPath(segments: Segment[], map: (x: number, y: number) => [number, number]): string {
  return segments
    .map((s) => {
      if (s[0] === "Z") return "Z";
      const out: string[] = [];
      for (let i = 1; i < s.length; i += 2) {
        const [x, y] = map(s[i] as number, s[i + 1] as number);
        out.push(fmt(x), fmt(y));
      }
      return `${s[0]} ${out.join(" ")}`;
    })
    .join(" ");
}

/** "#rrggbb" + opacity -> CSS colour ("" for no colour, which Fabric treats as none). */
export function rgba(hex: string | null | undefined, opacity = 1): string {
  if (!hex) return "";
  const c = hex.replace("#", "");
  const full = c.length === 3 ? [...c].map((ch) => ch + ch).join("") : c;
  const n = Number.parseInt(full, 16);
  if (Number.isNaN(n)) return "";
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`;
}
