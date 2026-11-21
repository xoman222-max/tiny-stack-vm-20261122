// Tiny stack VM for make.fun's tiny stack ISA v1 (see kit: generator/subject/ISA.md).
// Written from the ISA spec. One run answers every instance in a set:
// reads /input/<id>/{program,input}.bin, writes /output/<id>/{stdout.bin,exit.txt}.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const MAX_STEPS = 1000000, MAX_OUT = 65536;

function run(prog, input) {
  const st = new Int32Array(256); let sp = 0;      // data stack
  const cs = new Int32Array(64); let cp = 0;       // call stack
  const mem = new Int32Array(256);                 // memory, zeroed
  const out = []; let ip = 0, pc = 0, steps = 0;   // output bytes, input ptr, pc, steps
  const n = prog.length;
  while (true) {
    if (steps >= MAX_STEPS) return [out, 10];
    if (pc < 0 || pc >= n) return [out, 9];
    const op = prog[pc];
    // Immediate length per opcode; truncated immediate traps 9.
    const il = op === 0x01 ? 1 : op === 0x02 ? 4 : (op >= 0x30 && op <= 0x33) ? 2 : 0;
    if (op === 0x01 || op === 0x02 || (op >= 0x30 && op <= 0x33)) {
      if (pc + il >= n) return [out, 9];
    } else if (op > 0x53 || (op >= 0x08 && op <= 0x0f) || (op >= 0x23 && op <= 0x2f) ||
               (op >= 0x35 && op <= 0x3f) || (op >= 0x42 && op <= 0x4f) || op >= 0x54) {
      return [out, 5]; // unknown opcode
    }
    steps++;
    let a, b, v;
    switch (op) {
      case 0x00: return [out, 0]; // HALT
      case 0x01: // PUSH8, sign-extended
        if (sp >= 256) return [out, 3];
        st[sp++] = (prog[pc + 1] << 24) >> 24; pc += 2; break;
      case 0x02: // PUSH32
        if (sp >= 256) return [out, 3];
        st[sp++] = prog.readInt32LE(pc + 1); pc += 5; break;
      case 0x03: if (sp < 1) return [out, 2]; sp--; pc++; break; // POP
      case 0x04: if (sp < 1 || sp >= 256) return [out, sp < 1 ? 2 : 3]; st[sp] = st[sp - 1]; sp++; pc++; break; // DUP
      case 0x05: if (sp < 2) return [out, 2]; v = st[sp - 1]; st[sp - 1] = st[sp - 2]; st[sp - 2] = v; pc++; break; // SWAP
      case 0x06: if (sp < 2 || sp >= 256) return [out, sp < 2 ? 2 : 3]; st[sp] = st[sp - 2]; sp++; pc++; break; // OVER
      case 0x07: if (sp < 3) return [out, 2]; v = st[sp - 3]; st[sp - 3] = st[sp - 2]; st[sp - 2] = st[sp - 1]; st[sp - 1] = v; pc++; break; // ROT
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: // binary ops: ( a b -- r ), b is top
        if (sp < 2) return [out, 2];
        b = st[--sp]; a = st[sp - 1];
        if ((op === 0x13 || op === 0x14 || op === 0x15 || op === 0x16) && b === 0) return [out, 4];
        if (op === 0x10) v = (a + b) | 0;
        else if (op === 0x11) v = (a - b) | 0;
        else if (op === 0x12) v = Math.imul(a, b);
        else if (op === 0x13) v = (a / b) | 0; // trunc toward 0; INT_MIN/-1 -> |0 wraps to INT_MIN
        else if (op === 0x14) v = (a % b) | 0; // sign of a; x%-1 -> 0
        else if (op === 0x15) v = ((a >>> 0) / (b >>> 0)) | 0;
        else if (op === 0x16) v = ((a >>> 0) % (b >>> 0)) | 0;
        else if (op === 0x18) v = a & b;
        else if (op === 0x19) v = a | b;
        else if (op === 0x1a) v = a ^ b;
        else if (op === 0x1c) v = a << (b & 31);
        else if (op === 0x1d) v = a >> (b & 31);
        else if (op === 0x1e) v = (a >>> (b & 31)) | 0;
        else if (op === 0x20) v = a === b ? 1 : 0;
        else if (op === 0x21) v = a < b ? 1 : 0;
        else v = (a >>> 0) < (b >>> 0) ? 1 : 0;
        st[sp - 1] = v; pc++; break;
      case 0x17: if (sp < 1) return [out, 2]; st[sp - 1] = (-st[sp - 1]) | 0; pc++; break; // NEG
      case 0x1b: if (sp < 1) return [out, 2]; st[sp - 1] = ~st[sp - 1]; pc++; break; // NOT
      case 0x30: pc = pc + 3 + prog.readInt16LE(pc + 1); break; // JMP
      case 0x31: case 0x32: // JZ / JNZ
        if (sp < 1) return [out, 2];
        v = st[--sp];
        pc = ((op === 0x31 && v === 0) || (op === 0x32 && v !== 0)) ? pc + 3 + prog.readInt16LE(pc + 1) : pc + 3;
        break;
      case 0x33: // CALL
        if (cp >= 64) return [out, 7];
        cs[cp++] = pc + 3; pc = prog.readUInt16LE(pc + 1); break;
      case 0x34: if (cp < 1) return [out, 8]; pc = cs[--cp]; break; // RET
      case 0x40: // LOAD
        if (sp < 1) return [out, 2];
        a = st[sp - 1];
        if (a < 0 || a > 255) return [out, 6];
        st[sp - 1] = mem[a]; pc++; break;
      case 0x41: // STORE ( v addr -- )
        if (sp < 2) return [out, 2];
        a = st[--sp]; v = st[--sp];
        if (a < 0 || a > 255) return [out, 6];
        mem[a] = v; pc++; break;
      case 0x50: // PRINT: decimal ASCII, no newline
        if (sp < 1) return [out, 2];
        v = st[--sp]; { const s = String(v);
        if (out.length + s.length > MAX_OUT) return [out, 11];
        for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i)); }
        pc++; break;
      case 0x51: // PUTC
        if (sp < 1) return [out, 2];
        v = st[--sp];
        if (out.length + 1 > MAX_OUT) return [out, 11];
        out.push(v & 255); pc++; break;
      case 0x52: // IN
        if (sp >= 256) return [out, 3];
        st[sp++] = ip < input.length ? input[ip++] : -1; pc++; break;
      case 0x53: if (sp < 1) return [out, 2]; return [out, st[--sp] & 255]; // EXIT
      default: return [out, 5];
    }
  }
}

for (const id of readdirSync(I, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort()) {
  const [out, code] = run(readFileSync(join(I, id, 'program.bin')), readFileSync(join(I, id, 'input.bin')));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), Buffer.from(out));
  writeFileSync(join(O, id, 'exit.txt'), String(code) + '\n');
}
