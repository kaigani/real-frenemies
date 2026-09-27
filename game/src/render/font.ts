/** 3 × 5 bitmap font, drawn as whole pixels. Advance 4 px, line height 7 px. Lowercase renders as uppercase. */
const G: Record<string, string> = {
  "0": "####.##.##.####",
  "1": ".#.##..#..#.###",
  "2": "##...#.#.#..###",
  "3": "##...#.#...###.",
  "4": "#.##.####..#..#",
  "5": "####..##...###.",
  "6": ".###..####.####",
  "7": "###..#.#..#..#.",
  "8": "####.#####.####",
  "9": "####.####..###.",
  "A": ".#.#.#####.##.#",
  "B": "##.#.###.#.###.",
  "C": ".###..#..#...##",
  "D": "##.#.##.##.###.",
  "E": "####..##.#..###",
  "F": "####..##.#..#..",
  "G": ".###..#.##.#.##",
  "H": "#.##.#####.##.#",
  "I": "###.#..#..#.###",
  "J": "..#..#..##.#.#.",
  "K": "#.##.###.#.##.#",
  "L": "#..#..#..#..###",
  "M": "#.########.##.#",
  "N": "##.#.##.##.##.#",
  "O": ".#.#.##.##.#.#.",
  "P": "##.#.###.#..#..",
  "Q": ".#.#.##.###..##",
  "R": "##.#.###.#.##.#",
  "S": ".###...#...###.",
  "T": "###.#..#..#..#.",
  "U": "#.##.##.##.####",
  "V": "#.##.##.#.#..#.",
  "W": "#.##.########.#",
  "X": "#.##.#.#.#.##.#",
  "Y": "#.##.#.#..#..#.",
  "Z": "###..#.#.#..###",
  ".": ".............#.",
  ",": "..........#.#..",
  ":": "....#.....#....",
  ";": "....#.....#.#..",
  "!": ".#..#..#.....#.",
  "?": "##...#.#.....#.",
  "-": "......###......",
  "+": "....#.###.#....",
  "/": "..#..#.#.#..#..",
  "(": ".#.#..#..#...#.",
  ")": ".#...#..#..#.#.",
  "%": "#.#..#.#.#..#.#",
  "#": "#.#####.#####.#",
  "'": ".#..#..........",
  "\"": "#.##.#.........",
  "<": "..#.#.#...#...#",
  ">": "#...#...#.#.#..",
  "=": "...###...###...",
  "*": "...#.#.#.#.#...",
  "_": "............###",
  "[": "##.#..#..#..##.",
  "]": ".##..#..#..#.##",
  "&": ".#.#.#.#.#.#.##",
  "^": ".#.#.#.........",
  "|": ".#..#..#..#..#.",
  "·": ".......#.......",
  "×": "...#.#.#.#.#...",
  "↑": ".#.###.#..#..#.",
  "↓": ".#..#..#.###.#.",
  "→": ".....####..#...",
  "←": "...#..####.....",
  "►": "#..##.#####.#..",
  "◄": "..#.#####.##..#",
  "▲": "....#.###......",
  "♥": "...#.####.#....",
  "$": ".####..#..####.",
  " ": "...............",
};

/** Glyph rows as bit masks; malformed or unknown glyphs render as a hollow box. */
const glyphs = new Map<string, number[]>();
for (const [ch, raw] of Object.entries(G)) {
  const bits = raw;
  glyphs.set(ch, Array.from({ length: 5 }, (_, row) => [0, 1, 2].reduce((m, col) => bits[row * 3 + col] === "#" ? m | (1 << col) : m, 0)));
}
const BOX = [7, 5, 5, 5, 7];

export const CHAR_W = 4;
export const LINE_H = 7;

export function glyph(ch: string) {
  return glyphs.get(ch) ?? glyphs.get(ch.toUpperCase()) ?? BOX;
}

export function textWidth(text: string) {
  return text.length ? text.length * CHAR_W - 1 : 0;
}

/** Greedy word wrap to a pixel width. */
export function wrap(text: string, width: number): string[] {
  const max = Math.max(1, Math.floor((width + 1) / CHAR_W));
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= max) line += " " + word;
      else { lines.push(line); line = word; }
      while (line.length > max) { lines.push(line.slice(0, max)); line = line.slice(max); }
    }
    lines.push(line);
  }
  return lines;
}
