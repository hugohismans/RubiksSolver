#!/bin/sh
# Évaluation parallèle : sh tests/eval-par.sh N [options...]
N=${1:-400}; shift
Q=$((N/4))
for k in 0 1 2 3; do node tests/eval-synth.js $Q $((1+k*Q)) "$@" > tests/out/par-$k.txt & done
wait
cat tests/out/par-*.txt | node -e '
const t=require("fs").readFileSync(0,"utf8"); let fp=0,d=0,n=0,tp=0,c=0,ct=0; const f={};
for (const m of t.matchAll(/faux positifs: (\d+)/g)) fp+=+m[1];
for (const m of t.matchAll(/détectée: (\d+)\/(\d+).*en tête: (\d+).*cases correctes: (\d+)\/(\d+)/g)){d+=+m[1];n+=+m[2];tp+=+m[3];c+=+m[4];ct+=+m[5];}
for (const m of t.matchAll(/  (\S+): ratés (\d+)\/(\d+)/g)){f[m[1]]=f[m[1]]||[0,0];f[m[1]][0]+=+m[2];f[m[1]][1]+=+m[3];}
console.log(`FP ${fp}, détectée ${d}/${n} (${(100*d/n).toFixed(1)}%), en tête ${tp}, cases ${c}/${ct} (${(100*c/ct).toFixed(1)}%)`); for (const k in f) console.log(" ",k,"ratés",f[k][0]+"/"+f[k][1]);'
