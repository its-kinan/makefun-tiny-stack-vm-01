// tiny-stack-vm: interpreter for make.fun's tiny stack ISA v1.
import * as fs from "node:fs";
import * as path from "node:path";

const STEP_CAP = 1000000;
const OUT_CAP = 65536;
const STK_CAP = 256;
const CALL_CAP = 64;
const MEM_N = 256;

function runOne(prog: Buffer, feed: Buffer) {
  const mem = new Int32Array(MEM_N);
  const stk: number[] = [];
  const ret: number[] = [];
  const out: number[] = [];
  let ip = 0;
  let fed = 0;
  let steps = 0;
  let trap = 0;
  const end = (code: number) => ({ bytes: Buffer.from(out), code });
  const need = (n: number) => stk.length >= n;
  const room = () => stk.length < STK_CAP;
  const two = (f: (a: number, b: number) => number | null) => {
    if (!need(2)) { trap = 2; return; }
    const b = stk.pop() as number;
    const a = stk.pop() as number;
    const r = f(a, b);
    if (r === null) trap = 4; else stk.push(r);
  };
  const one = (f: (a: number) => number) => {
    if (!need(1)) { trap = 2; return; }
    stk.push(f(stk.pop() as number));
  };
  for (;;) {
    if (steps >= STEP_CAP) return end(10);
    if (ip < 0 || ip >= prog.length) return end(9);
    const op = prog[ip];
    if (!(op <= 0x07 || (op >= 0x10 && op <= 0x22) || (op >= 0x30 && op <= 0x34) || (op >= 0x40 && op <= 0x41) || (op >= 0x50 && op <= 0x53))) return end(5);
    if (ip + 1 + (op === 0x01 ? 1 : op === 0x02 ? 4 : op >= 0x30 && op <= 0x33 ? 2 : 0) > prog.length) return end(9);
    steps += 1;
    switch (op) {
      case 0x00: return end(0);
      case 0x01:
        if (!room()) return end(3);
        { const b = prog[ip + 1]; stk.push(b >= 128 ? b - 256 : b); }
        ip += 2;
        break;
      case 0x02:
        if (!room()) return end(3);
        stk.push(prog.readInt32LE(ip + 1));
        ip += 5;
        break;
      case 0x03: if (!need(1)) return end(2); stk.pop(); ip += 1; break;
      case 0x04: if (!need(1)) return end(2); if (!room()) return end(3); stk.push(stk[stk.length - 1]); ip += 1; break;
      case 0x05: if (!need(2)) return end(2); { const t = stk.pop() as number; const u = stk.pop() as number; stk.push(t, u); } ip += 1; break;
      case 0x06: if (!need(2)) return end(2); if (!room()) return end(3); stk.push(stk[stk.length - 2]); ip += 1; break;
      case 0x07: if (!need(3)) return end(2); { const c = stk.pop() as number; const b = stk.pop() as number; const a = stk.pop() as number; stk.push(b, c, a); } ip += 1; break;
      case 0x10: two((a, b) => (a + b) | 0); ip += 1; break;
      case 0x11: two((a, b) => (a - b) | 0); ip += 1; break;
      case 0x12: two((a, b) => Math.imul(a, b)); ip += 1; break;
      case 0x13: two((a, b) => (b === 0 ? null : Math.trunc(a / b) | 0)); ip += 1; break;
      case 0x14: two((a, b) => (b === 0 ? null : (a % b) | 0)); ip += 1; break;
      case 0x15: two((a, b) => (b === 0 ? null : Math.trunc((a >>> 0) / (b >>> 0)) | 0)); ip += 1; break;
      case 0x16: two((a, b) => (b === 0 ? null : ((a >>> 0) % (b >>> 0)) | 0)); ip += 1; break;
      case 0x17: one((a) => (-a) | 0); ip += 1; break;
      case 0x18: two((a, b) => a & b); ip += 1; break;
      case 0x19: two((a, b) => a | b); ip += 1; break;
      case 0x1a: two((a, b) => a ^ b); ip += 1; break;
      case 0x1b: one((a) => ~a); ip += 1; break;
      case 0x1c: two((a, b) => a << (b & 31)); ip += 1; break;
      case 0x1d: two((a, b) => a >> (b & 31)); ip += 1; break;
      case 0x1e: two((a, b) => (a >>> (b & 31)) | 0); ip += 1; break;
      case 0x20: two((a, b) => (a === b ? 1 : 0)); ip += 1; break;
      case 0x21: two((a, b) => (a < b ? 1 : 0)); ip += 1; break;
      case 0x22: two((a, b) => ((a >>> 0) < (b >>> 0) ? 1 : 0)); ip += 1; break;
      case 0x30: ip = ip + 3 + (((prog[ip + 1] | (prog[ip + 2] << 8)) << 16) >> 16); break;
      case 0x31: if (!need(1)) return end(2); { const v = stk.pop() as number; ip = v === 0 ? ip + 3 + (((prog[ip + 1] | (prog[ip + 2] << 8)) << 16) >> 16) : ip + 3; } break;
      case 0x32: if (!need(1)) return end(2); { const v = stk.pop() as number; ip = v !== 0 ? ip + 3 + (((prog[ip + 1] | (prog[ip + 2] << 8)) << 16) >> 16) : ip + 3; } break;
      case 0x33: if (ret.length >= CALL_CAP) return end(7); ret.push(ip + 3); ip = prog[ip + 1] | (prog[ip + 2] << 8); break;
      case 0x34: if (ret.length === 0) return end(8); ip = ret.pop() as number; break;
      case 0x40: if (!need(1)) return end(2); { const a = stk.pop() as number; if (a < 0 || a > 255) return end(6); stk.push(mem[a]); } ip += 1; break;
      case 0x41: if (!need(2)) return end(2); { const a = stk.pop() as number; const v = stk.pop() as number; if (a < 0 || a > 255) return end(6); mem[a] = v; } ip += 1; break;
      case 0x50: if (!need(1)) return end(2); { const s = String(stk.pop() as number); if (out.length + s.length > OUT_CAP) return end(11); out.push(...Buffer.from(s)); } ip += 1; break;
      case 0x51: if (!need(1)) return end(2); if (out.length + 1 > OUT_CAP) return end(11); out.push((stk.pop() as number) & 255); ip += 1; break;
      case 0x52: if (!room()) return end(3); stk.push(fed < feed.length ? feed[fed++] : -1); ip += 1; break;
      case 0x53: if (!need(1)) return end(2); return end((stk.pop() as number) & 255);
      default: return end(5);
    }
    if (trap) return end(trap);
  }
}

function main() {
  const inDir = process.env.MAKEFUN_INPUT_DIR ?? "/input";
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  const ids = fs.readdirSync(inDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const id of ids) {
    const dir = path.join(inDir, id);
    const prog = fs.readFileSync(path.join(dir, "program.bin"));
    const inPath = path.join(dir, "input.bin");
    const feed = fs.existsSync(inPath) ? fs.readFileSync(inPath) : Buffer.alloc(0);
    const r = runOne(prog, feed);
    const od = path.join(outDir, id);
    fs.mkdirSync(od, { recursive: true });
    fs.writeFileSync(path.join(od, "stdout.bin"), r.bytes);
    fs.writeFileSync(path.join(od, "exit.txt"), `${r.code}\n`);
  }
}

main();
