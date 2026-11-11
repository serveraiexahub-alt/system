#!/bin/bash
# รันชุดทดสอบ obfuscator ทั้งหมด
cd "$(dirname "$0")/.."
fail=0
for f in tests/*.test.js; do
  printf '%-24s ' "$(basename "$f")"
  if node "$f" 2>&1 | tail -1; then :; else fail=1; fi
done
exit $fail
