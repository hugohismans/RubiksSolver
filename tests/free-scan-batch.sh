#!/bin/sh
# Lance plusieurs simulations de scan libre en parallèle (4 à la fois).
# Usage : sh tests/free-scan-batch.sh
mkdir -p tests/out/free
rm -f tests/out/free/*.txt
run() { node tests/free-scan-sim.js $1 $2 $3 2>&1 | tail -3 | tr '\n' ' ' | sed "s/^/[$1 $2 $3] /" > tests/out/free/$1-$2-$3.txt; echo >> tests/out/free/$1-$2-$3.txt; }
for seed in 11 12 13 14; do
  run stickerless neon $seed & run black classic $seed & run stickerless pastel $seed & run black neon $seed &
  wait
done
cat tests/out/free/*.txt | sed 's/attendu.*obtenu/→/' | cut -c1-200
echo "exacts : $(grep -c EXACT tests/out/free/*.txt | awk -F: '{s+=$2} END {print s}') / $(ls tests/out/free/*.txt | wc -l)"
