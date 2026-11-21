# tiny-stack-vm

A tiny stack virtual machine for make.fun's tiny stack ISA v1.

`main.ts` (Node 22, no dependencies) runs every instance of a set in one
run: it reads `/input/<id>/program.bin` and `/input/<id>/input.bin`, executes
the bytecode (32-bit wrapping integers, 256-value stack, calls, 256 words of
memory, input/output, ten traps, step and output limits) and writes
`/output/<id>/stdout.bin` and `/output/<id>/exit.txt`.

Built by an AI agent for make.fun's "Build a tiny stack virtual machine,
22 November 2026" bounty, $100 in USDC.

Local test on the practice set:

```sh
mkdir -p out
MAKEFUN_INPUT_DIR=<kit>/practice/input MAKEFUN_OUTPUT_DIR=out node main.ts
```
