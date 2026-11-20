// Procedurally synthesizes a quiet, seamless fire crackle loop (no mic/network).
const fs=require('fs');const sr=22050,sec=6,n=sr*sec;let seed=1234567;const r=()=>((seed=(seed*1103515245+12345)>>>0)/4294967296);
const d=new Float32Array(n);let b=0;
for(let i=0;i<n;i++){b=b*0.985+(r()*2-1)*0.03;d[i]=b*0.6;}
for(let k=0;k<210;k++){const at=Math.floor(r()*(n-800)),len=40+Math.floor(r()*500),amp=0.15+r()*0.55,dec=8+r()*25;
 for(let j=0;j<len;j++){d[at+j]+=(r()*2-1)*amp*Math.exp(-j/dec);}}
const f=600;for(let i=0;i<f;i++){const t=i/f;d[i]=d[i]*t+d[n-f+i]*(1-t);}
const out=n-f;const buf=Buffer.alloc(44+out*2);buf.write('RIFF',0);buf.writeUInt32LE(36+out*2,4);buf.write('WAVEfmt ',8);
buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);buf.writeUInt32LE(sr,24);buf.writeUInt32LE(sr*2,28);buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(out*2,40);
for(let i=0;i<out;i++)buf.writeInt16LE(Math.max(-1,Math.min(1,d[i]*0.8))*32767|0,44+i*2);
fs.writeFileSync(__dirname+'/../assets/sounds/flame-crackle.wav',buf);
