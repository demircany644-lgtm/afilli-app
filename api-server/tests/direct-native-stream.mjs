// Executes installed Expo native fetch/FetchResponse JS with a controlled native
// bridge, not a physical device. No network calls, credentials or provider quota.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { build, transform } from 'esbuild';
const require=createRequire(import.meta.url),requests=[];
class NativeResponse extends EventEmitter {
  get status(){return 200;}
  get statusText(){return 'OK';}
  get _rawHeaders(){return [['content-type','text/event-stream']];}
  get url(){return 'https://afilli.invalid/api/message-events';}
  get redirected(){return false;}
  async startStreaming(){return null;} // Native request is deliberately still open.
  cancelStreaming(){}
}
class NativeRequest {
  constructor(response){this.response=response;this.cancelled=0;requests.push(this);}
  async start(url,init,body){Object.assign(this,{url,init,body});}
  cancel(){this.cancelled++;}
}
const evaluate=code=>{const mod={exports:{}};new Function('require','module','exports',code)(require,mod,mod.exports);return mod.exports;};
const previousFetch=globalThis.fetch;
globalThis.__afilliNativeBridgeForTest={NativeResponse,NativeRequest};
try {
  const bundled=await build({
    entryPoints:[fileURLToPath(new URL('../../node_modules/expo/src/winter/fetch/fetch.ts',import.meta.url))],
    bundle:true,write:false,format:'cjs',platform:'node',external:['react-native','react-native/*'],
    plugins:[{name:'controlled-native-bridge',setup(builder){
      builder.onResolve({filter:/^\.\/ExpoFetchModule$/},()=>({path:'bridge',namespace:'test-bridge'}));
      builder.onLoad({filter:/.*/,namespace:'test-bridge'},()=>({contents:'export const ExpoFetchModule=globalThis.__afilliNativeBridgeForTest;',loader:'js'}));
    }}],
  });
  const nativeFetch=evaluate(bundled.outputFiles[0].text).fetch;
  const customSource=await readFile(new URL('../../api-client-react/src/custom-fetch.ts',import.meta.url),'utf8');
  const api=evaluate((await transform(customSource,{loader:'ts',format:'cjs'})).code);
  api.setBaseUrl('https://afilli.invalid');
  api.setAuthTokenGetter(()=>'synthetic-test-token');
  globalThis.fetch=()=>{throw Error('Non-streaming global fetch must not be used');};
  const abort=new AbortController();
  const response=await api.customFetch('/api/message-events',{
    signal:abort.signal,responseType:'response',headers:{'X-Afilli-Actor':'synthetic-owner',Accept:'text/event-stream'},
    fetcher:(input,init)=>{assert.ok(!('fetcher' in init));return nativeFetch(input,init);},
  });
  const request=requests.at(-1),headers=new Headers(request.init.headers);
  assert.equal(request.url,'https://afilli.invalid/api/message-events');
  assert.equal(headers.get('authorization'),'Bearer synthetic-test-token');
  assert.equal(headers.get('x-afilli-actor'),'synthetic-owner');
  assert.equal(headers.get('accept'),'text/event-stream');
  assert.equal(request.init.credentials,'include');
  assert.equal(request.init.method,'GET');
  assert.equal(request.body,null);
  const reader=response.body.getReader();
  const first=reader.read();
  request.response.emit('didReceiveResponseData',new TextEncoder().encode('data: {"kind":"message"}\n\n'));
  const packet=await Promise.race([first,new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('Buffered instead of streaming')),1000);timer.unref();})]);
  assert.equal(packet.done,false);
  assert.match(new TextDecoder().decode(packet.value),/"kind":"message"/);
  // Receive before didComplete, then cancel the real SDK signal path and drop late native chunks.
  const waiting=reader.read();abort.abort(new Error('Account changed'));
  await assert.rejects(waiting,/Account changed/);
  assert.equal(request.cancelled,1);
  assert.doesNotThrow(()=>request.response.emit('didReceiveResponseData',new Uint8Array([65])));
  reader.releaseLock();
  console.log('PASS installed Expo native fetch JS: open-stream receipt, authenticated base URL, cancellation and late native-event safety (controlled bridge; not a device test)');
} finally {
  globalThis.fetch=previousFetch;
  delete globalThis.__afilliNativeBridgeForTest;
}
