/**
 * Rumus ukuran terhitung BI (mis. `[Omzet] - [HPP]`, `DIVIDE([Laba], [Omzet])`). Diurai sendiri (tanpa `eval`):
 * angka, referensi `[nama ukuran]`, `+ - * /`, kurung, dan fungsi DIVIDE, ABS, ROUND, MIN, MAX, IF.
 */

export type FormulaNode =
  | { kind: "num"; value: number }
  | { kind: "ref"; name: string }
  | { kind: "neg"; arg: FormulaNode }
  | {
      kind: "bin";
      op: "+" | "-" | "*" | "/" | ">" | "<" | ">=" | "<=" | "=" | "<>";
      left: FormulaNode;
      right: FormulaNode;
    }
  | { kind: "call"; fn: FormulaFunction; args: FormulaNode[] };

export const FORMULA_FUNCTIONS = ["DIVIDE", "ABS", "ROUND", "MIN", "MAX", "IF"] as const;
export type FormulaFunction = (typeof FORMULA_FUNCTIONS)[number];
const ARITY: Record<FormulaFunction, [number, number]> = {
  DIVIDE: [2, 3],
  ABS: [1, 1],
  ROUND: [1, 2],
  MIN: [2, 10],
  MAX: [2, 10],
  IF: [2, 3],
};

/** Galat rumus; pesan berbahasa Indonesia (diterjemahkan di API lewat peta pesan). */
export class FormulaError extends Error {}

type Token =
  | { t: "num"; v: number }
  | { t: "ref"; v: string }
  | { t: "id"; v: string }
  | { t: "op"; v: string }
  | { t: "("; v: "(" }
  | { t: ")"; v: ")" }
  | { t: ","; v: "," };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "[") {
      const end = src.indexOf("]", i + 1);
      if (end < 0) throw new FormulaError("Rumus: kurung siku belum ditutup");
      const name = src.slice(i + 1, end).trim();
      if (!name) throw new FormulaError("Rumus: nama ukuran kosong");
      out.push({ t: "ref", v: name });
      i = end + 1;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      const m = src.slice(i).match(/^\d*\.?\d+(?:[eE][+-]?\d+)?/);
      if (!m) throw new FormulaError(`Rumus: angka tidak valid di posisi ${i + 1}`);
      out.push({ t: "num", v: Number(m[0]) });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = src.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)!;
      out.push({ t: "id", v: m[0].toUpperCase() });
      i += m[0].length;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === ">=" || two === "<=" || two === "<>") {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/><=".includes(c)) {
      out.push({ t: "op", v: c });
      i++;
      continue;
    }
    if (c === "(" || c === ")" || c === ",") {
      out.push({ t: c, v: c } as Token);
      i++;
      continue;
    }
    throw new FormulaError(`Rumus: karakter "${c}" tidak dikenal`);
  }
  return out;
}

/** Urai rumus menjadi pohon; melempar `FormulaError` bila tidak valid. */
export function parseFormula(src: string): FormulaNode {
  if (!src.trim()) throw new FormulaError("Rumus kosong");
  if (src.length > 500) throw new FormulaError("Rumus terlalu panjang");
  const tokens = tokenize(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const expectClose = () => {
    if (peek()?.t !== ")") throw new FormulaError("Rumus: kurung belum ditutup");
    pos++;
  };

  // comparison > additive > multiplicative > unary > primary
  const comparison = (): FormulaNode => {
    let left = additive();
    while (peek()?.t === "op" && [">", "<", ">=", "<=", "=", "<>"].includes(peek()!.v as string)) {
      const op = next()!.v as ">";
      left = { kind: "bin", op, left, right: additive() };
    }
    return left;
  };
  const additive = (): FormulaNode => {
    let left = multiplicative();
    while (peek()?.t === "op" && (peek()!.v === "+" || peek()!.v === "-")) {
      const op = next()!.v as "+" | "-";
      left = { kind: "bin", op, left, right: multiplicative() };
    }
    return left;
  };
  const multiplicative = (): FormulaNode => {
    let left = unary();
    while (peek()?.t === "op" && (peek()!.v === "*" || peek()!.v === "/")) {
      const op = next()!.v as "*" | "/";
      left = { kind: "bin", op, left, right: unary() };
    }
    return left;
  };
  const unary = (): FormulaNode => {
    if (peek()?.t === "op" && peek()!.v === "-") {
      next();
      return { kind: "neg", arg: unary() };
    }
    if (peek()?.t === "op" && peek()!.v === "+") {
      next();
      return unary();
    }
    return primary();
  };
  const primary = (): FormulaNode => {
    const tok = next();
    if (!tok) throw new FormulaError("Rumus tidak lengkap");
    if (tok.t === "num") return { kind: "num", value: tok.v };
    if (tok.t === "ref") return { kind: "ref", name: tok.v };
    if (tok.t === "(") {
      const inner = comparison();
      expectClose();
      return inner;
    }
    if (tok.t === "id") {
      const fn = tok.v as FormulaFunction;
      if (!FORMULA_FUNCTIONS.includes(fn)) throw new FormulaError(`Rumus: fungsi ${tok.v} tidak dikenal`);
      if (peek()?.t !== "(") throw new FormulaError(`Rumus: ${fn} harus diikuti "("`);
      next();
      const args: FormulaNode[] = [];
      if (peek()?.t !== ")") {
        args.push(comparison());
        while (peek()?.t === ",") {
          next();
          args.push(comparison());
        }
      }
      expectClose();
      const [min, max] = ARITY[fn];
      if (args.length < min || args.length > max)
        throw new FormulaError(`Rumus: ${fn} butuh ${min === max ? min : `${min}–${max}`} argumen`);
      return { kind: "call", fn, args };
    }
    throw new FormulaError(`Rumus: "${tok.v}" tidak terduga`);
  };

  const tree = comparison();
  if (pos < tokens.length) throw new FormulaError(`Rumus: "${tokens[pos]!.v}" tidak terduga`);
  return tree;
}

/** Nama ukuran yang dirujuk rumus. */
export function formulaRefs(node: FormulaNode, out = new Set<string>()): Set<string> {
  switch (node.kind) {
    case "ref":
      out.add(node.name);
      break;
    case "neg":
      formulaRefs(node.arg, out);
      break;
    case "bin":
      formulaRefs(node.left, out);
      formulaRefs(node.right, out);
      break;
    case "call":
      for (const a of node.args) formulaRefs(a, out);
      break;
  }
  return out;
}

/**
 * Hitung rumus. `lookup` mengembalikan nilai ukuran (null = kosong). Pembagian dengan nol menghasilkan null
 * (atau nilai alternatif DIVIDE), bukan Infinity.
 */
export function evaluateFormula(node: FormulaNode, lookup: (name: string) => number | null): number | null {
  const ev = (n: FormulaNode): number | null => {
    switch (n.kind) {
      case "num":
        return n.value;
      case "ref":
        return lookup(n.name);
      case "neg": {
        const v = ev(n.arg);
        return v === null ? null : -v;
      }
      case "bin": {
        const a = ev(n.left);
        const b = ev(n.right);
        if (["+", "-"].includes(n.op)) {
          // Penjumlahan/pengurangan memperlakukan kosong sebagai 0 (mis. omzet tanpa HPP).
          if (a === null && b === null) return null;
          return n.op === "+" ? (a ?? 0) + (b ?? 0) : (a ?? 0) - (b ?? 0);
        }
        if (a === null || b === null) return null;
        switch (n.op) {
          case "*":
            return a * b;
          case "/":
            return b === 0 ? null : a / b;
          case ">":
            return a > b ? 1 : 0;
          case "<":
            return a < b ? 1 : 0;
          case ">=":
            return a >= b ? 1 : 0;
          case "<=":
            return a <= b ? 1 : 0;
          case "=":
            return a === b ? 1 : 0;
          default:
            return a !== b ? 1 : 0;
        }
      }
      case "call": {
        const args = n.args;
        switch (n.fn) {
          case "DIVIDE": {
            const a = ev(args[0]!);
            const b = ev(args[1]!);
            const alt = args[2] ? ev(args[2]) : null;
            return a === null || b === null || b === 0 ? alt : a / b;
          }
          case "ABS": {
            const v = ev(args[0]!);
            return v === null ? null : Math.abs(v);
          }
          case "ROUND": {
            const v = ev(args[0]!);
            const d = args[1] ? (ev(args[1]) ?? 0) : 0;
            if (v === null) return null;
            const f = 10 ** Math.max(0, Math.min(6, Math.trunc(d)));
            return Math.round(v * f) / f;
          }
          case "MIN":
          case "MAX": {
            const vs = args.map(ev).filter((v): v is number => v !== null);
            if (!vs.length) return null;
            return n.fn === "MIN" ? Math.min(...vs) : Math.max(...vs);
          }
          case "IF": {
            const c = ev(args[0]!);
            return c ? ev(args[1]!) : args[2] ? ev(args[2]) : null;
          }
        }
      }
    }
  };
  const v = ev(node);
  return v === null || !Number.isFinite(v) ? null : v;
}
