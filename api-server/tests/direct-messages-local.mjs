import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
const tick = () => new Promise(r => setImmediate(r));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
async function compile(path, deps) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const code = (await transform(source, {loader: path.endsWith('.tsx')?'tsx':'ts',format:'cjs',jsx:'transform'})).code;
  const module = {exports:{}};
  new Function('require','module','exports',code)(key => { if (!(key in deps)) throw new Error('Missing test dependency '+key); return deps[key]; },module,module.exports);
  return module.exports;
}
function hooks() {
  const state=[], effects=[]; let cursor=0, work=[];
  const React = {
    createElement:(type,props,...children)=>({type,props:{...props,children}}),
    useState(initial){const i=cursor++;if(!(i in state))state[i]=typeof initial==='function'?initial():initial;return[state[i],v=>{state[i]=typeof v==='function'?v(state[i]):v;}];},
    useRef(initial){const i=cursor++;if(!(i in state))state[i]={current:initial};return state[i];},
    useCallback(fn,deps){const i=cursor++;if(!state[i]||deps.some((x,j)=>x!==state[i].deps[j]))state[i]={fn,deps};return state[i].fn;},
    useEffect(fn,deps){const i=cursor++;if(!effects[i]||deps.some((x,j)=>x!==effects[i].deps[j]))work.push(()=>{effects[i]?.cleanup?.();effects[i]={deps,cleanup:fn()};});},
  };
  return {React,render(fn){cursor=0;work=[];const value=fn();for(const effect of work)effect();return value;},unmount(){for(const effect of effects)effect?.cleanup?.();}};
}
const memory=new Map();let failWrite=false;
const storage={getItem:async k=>memory.get(k)??null,setItem:async(k,v)=>{if(failWrite)throw Error('offline storage');memory.set(k,v);},removeItem:async k=>{if(failWrite)throw Error('offline storage');memory.delete(k);},getAllKeys:async()=>[...memory.keys()]};
const drafts=await compile('../../afilli/lib/chat-drafts.ts',{'@react-native-async-storage/async-storage':storage});
const state=await compile('../../afilli/lib/direct-message-state.ts',{});
const preparedPhotoId=randomUUID();
const photoDeps={prepareChatPhoto:async(_owner,_thread,entry)=>entry.photoId??(entry.photo?preparedPhotoId:null),queueChatPhotoCleanup:async()=>{},drainChatPhotoCleanup:async()=>{},chooseChatPhoto:async()=>null};
const noChanges=async(_id,{after})=>({items:[],nextAfter:after,hasMore:false});
const message=(seq,sender='A',clientId=randomUUID())=>({id:'message-'+seq,threadId:'thread',sender:{id:sender,nickname:sender},body:'Text '+seq,sequence:String(seq),clientId,createdAt:'2026-11-19T00:00:00Z',readAt:null,gif:null,reply:null});
assert.deepEqual(state.mergeMessages([message(10)],[message(9)]).map(m=>m.sequence),['10','9']);
const read=message(11);read.readAt='2026-11-19T01:00:00Z';
assert.equal(state.mergeMessages([read],[{...read,readAt:null}])[0].readAt,read.readAt);
const deletedQuote={...read,reply:{id:null,available:false,sender:null,body:null,gif:null}};
assert.equal(state.mergeMessages([deletedQuote],[{...read,reply:{available:true,body:'Old deleted text'}}])[0].reply.available,false);
assert.equal(state.acknowledged([{...read,sender:{id:'B'}}],'A',read.clientId),false);
const originalMedia={...read,body:'Caption survives',changeSequence:'10',gif:{url:'https://static.klipy.com/original.gif'},photo:null};
const expiredMedia={...originalMedia,changeSequence:'11',gif:null,mediaExpired:true};
const deletedMessage={...expiredMedia,changeSequence:'12',body:'',deletedAt:'2026-11-19T02:00:00Z'};
assert.equal(state.mergeMessages([expiredMedia],[originalMedia])[0].gif,null);
assert.equal(state.mergeMessages([expiredMedia],[originalMedia])[0].body,'Caption survives');
assert.equal(state.mergeMessages([deletedMessage],[originalMedia])[0].body,'');
assert.ok(state.mergeMessages([deletedMessage],[originalMedia])[0].deletedAt);
const events=[],parse=state.eventParser(e=>events.push(e));
for(const fragment of ['da','ta: {"kind":"rea','dy"}\r','\n\r\n','data: {"kind":"message",','"threadId":"thread"}\n','\n'])parse(fragment);
assert.deepEqual(events,[{kind:'ready'},{kind:'message',threadId:'thread'}]);
assert.throws(()=>state.eventParser(()=>{})('x'.repeat(65537)));
const gif={provider:'klipy',id:'hello-hi-662',title:'Hello',url:'https://static.klipy.com/ii/test.gif?keep=unaltered',width:220,height:220,sourceUrl:'https://klipy.com/gifs/hello-hi-662',attribution:'Powered by KLIPY',license:null};
const gifEntry={clientId:randomUUID(),body:'',gif,replyToId:randomUUID()};
await drafts.enqueueOutbox('A','gif',gifEntry,()=>'',()=>({gif:null,replyToId:null}));
assert.deepEqual((await drafts.readChatDraft('A','gif')).outbox,[gifEntry]);
await drafts.saveDraftContent('A','draft',{body:'Next',gif,replyToId:gifEntry.replyToId});
assert.deepEqual((await drafts.readChatDraft('A','draft')).gif,gif);
assert.throws(()=>drafts.parseChatDraft(JSON.stringify({body:'',outbox:[{...gifEntry,gif:{...gif,url:'https://evil.example/test.gif'}}]})));
let owner='A',revision=0,head={items:[message(10)],nextCursor:'s:10'},headWait=null,server=[];
const sends=[],syncs=[],reads=[];
const h=hooks(), guard=()=>owner==='A';
const conversation={id:'thread',peer:{id:'B',nickname:'B'},peerOnline:true};
const api={
  getConversationChanges:noChanges,
  getConversation:async()=>conversation,
  getConversationMessages:async(_id,params)=>params.cursor?{items:[message(2)],nextCursor:null}:headWait?headWait.promise:head,
  syncConversationMessages:async(_id,{after})=>{syncs.push(after);const items=server.filter(m=>state.compareSequence(m.sequence,after)>0).slice(0,100);return {items,nextAfter:items.at(-1)?.sequence??after,hasMore:server.some(m=>state.compareSequence(m.sequence,items.at(-1)?.sequence??after)>0)};},
  sendConversationMessage:(_id,input)=>{const d=deferred();sends.push({...d,input});return d.promise;},
  readConversation:(_id,input)=>{const d=deferred();reads.push({...d,input});return d.promise;},
};
const {useDirectThread}=await compile('../../afilli/lib/useDirectThread.ts',{
  react:h.React,'@workspace/api-client-react':api,'@/context/DirectMessagesContext':{useDirectMessages:()=>({owner,revision,refresh:async()=>{}})},
  '@/components/profile/hooks':{actorRequest:id=>({headers:{'X-Afilli-Actor':id}}),useFocusedForeground:()=>true,useOwnerGuard:()=>guard},
  './chat-drafts':drafts,'./direct-message-state':state,'./chat-photos':photoDeps,'expo-crypto':{randomUUID},
});
let view;
const render=()=>view=h.render(()=>useDirectThread('thread'));
const settle=async()=>{for(let i=0;i<5;i++){await tick();render();}};
render();await settle();assert.deepEqual(view.messages.map(m=>m.sequence),['10']);
// A late head cannot erase a canonical send ACK.
headWait=deferred();revision++;render();await tick();
const entry={clientId:randomUUID(),body:'Canonical acknowledgement'};
await drafts.enqueueOutbox('A','thread',entry,()=>'');view.deliver(entry);view.deliver(entry);await tick();assert.equal(sends.length,1);
const sent=message(11,'A',entry.clientId);sends[0].resolve(sent);await settle();assert.equal(view.messages[0].id,sent.id);
headWait.resolve(head);headWait=null;await settle();assert.ok(view.messages.some(m=>m.id===sent.id));assert.equal(view.pending.length,0);
assert.equal((await drafts.readChatDraft('A','thread')).outbox.length,0);
// Reconnect recovers beyond the newest page without skipping the captured old watermark.
server=Array.from({length:155},(_,i)=>message(i+12));
head={items:server.slice(-30).reverse(),nextCursor:'s:137'};revision++;render();await settle();
assert.ok(syncs.includes('10'));assert.ok(syncs.includes('111'));assert.equal(view.messages.length,157);
view.loadOlder();await settle();assert.equal(view.messages.at(-1).sequence,'2');assert.equal(view.messages[0].sequence,'166');
const retry={clientId:randomUUID(),body:'Same id after failure'};
await drafts.enqueueOutbox('A','thread',retry,()=>'');view.deliver(retry);await tick();sends.at(-1).reject(Error('offline'));await settle();
assert.equal(view.pending[0].status,'failed');assert.equal((await drafts.readChatDraft('A','thread')).outbox[0].clientId,retry.clientId);
view.deliver(view.pending[0]);await tick();assert.equal(sends.at(-1).input.clientId,retry.clientId);sends.at(-1).resolve(message(167,'A',retry.clientId));await settle();
assert.equal(view.pending.length,0);
// A read ACK for the old visible watermark must not mark a newer arrival as read.
server.push(message(168,'B'));head={items:[server.at(-1)],nextCursor:null};revision++;render();await settle();
assert.equal(reads.at(-1).input.throughSequence,'168');
const oldRead=reads.at(-1);server.push(message(169,'B'));head={items:[server.at(-1)],nextCursor:null};revision++;render();await settle();
oldRead.resolve();await settle();assert.equal(view.messages.find(m=>m.sequence==='169').readAt,null);
// A deleted reply is validation, NOT a revoked conversation. Other queued sends survive.
const lostQuote={clientId:randomUUID(),body:'Keep this reply',replyToId:randomUUID()};
const unrelated={clientId:randomUUID(),body:'Keep the other pending message'};
await drafts.enqueueOutbox('A','thread',lostQuote,()=>'');await drafts.enqueueOutbox('A','thread',unrelated,()=>'');
view.deliver(unrelated);await tick();sends.at(-1).reject(Error('offline'));await settle();
view.deliver(lostQuote);await tick();sends.at(-1).reject({status:422,data:{code:'REPLY_UNAVAILABLE'}});await settle();
assert.equal(view.pending.length,2);assert.ok(view.pending.find(p=>p.clientId===lostQuote.clientId).replyUnavailable);
const beforeQuoteError=view.messages.length;
revision++;render();await settle();assert.equal(view.messages.length,beforeQuoteError);assert.equal(view.pending.length,2);assert.ok(view.conv.data);
await view.withoutReply(view.pending.find(p=>p.clientId===lostQuote.clientId));await tick();await settle();
const replacement=sends.at(-1);assert.notEqual(replacement.input.clientId,lostQuote.clientId);assert.equal(replacement.input.replyToId,null);
assert.equal((await drafts.readChatDraft('A','thread')).outbox.length,2);
replacement.resolve(message(170,'A',replacement.input.clientId));await settle();
assert.equal(view.pending.length,1);assert.equal(view.pending[0].clientId,unrelated.clientId);
// The uploaded ID is durable BEFORE posting; retries need no local photo bytes.
const photoEntry={clientId:randomUUID(),body:'',photo:{localId:randomUUID(),size:1024,width:640,height:480}};
await drafts.enqueueOutbox('A','thread',photoEntry,()=>'');view.deliver(photoEntry);await settle();
assert.equal(sends.at(-1).input.photoId,preparedPhotoId);assert.equal('photo' in sends.at(-1).input,false);
assert.equal((await drafts.readChatDraft('A','thread')).outbox.find(p=>p.clientId===photoEntry.clientId).photoId,preparedPhotoId);
sends.at(-1).resolve({...message(171,'A',photoEntry.clientId),photo:{id:preparedPhotoId,width:640,height:480}});await settle();
assert.equal(view.pending.length,1);assert.equal(view.pending[0].clientId,unrelated.clientId);
// A late send response after account switch cannot enter the previous transcript.
const late={clientId:randomUUID(),body:'Owner A only'};await drafts.enqueueOutbox('A','thread',late,()=>'');view.deliver(late);await tick();
const count=view.messages.length;owner='B';sends.at(-1).resolve(message(170,'A',late.clientId));await tick();assert.equal(view.messages.length,count);
h.unmount();owner='A';
// Recovery progress must survive failed pages and must never follow head/ACK jumps.
async function recoveryCase(kind) {
  const local=hooks(),stableGuard=()=>true,refreshList=async()=>{};
  let version=0,rows=[],latest={items:[message(10)],nextCursor:'s:10'},failAt=null,result;
  const requested=[];
  const hook=await compile('../../afilli/lib/useDirectThread.ts',{
    react:local.React,
    '@workspace/api-client-react':{
      getConversationChanges:noChanges,
      getConversation:async()=>conversation,
      getConversationMessages:async()=>latest,
      syncConversationMessages:async(_id,{after})=>{
        requested.push(after);
        if(after===failAt)throw Error('Interrupted recovery');
        const items=rows.filter(m=>state.compareSequence(m.sequence,after)>0).slice(0,100);
        const nextAfter=items.at(-1)?.sequence??after;
        return {items,nextAfter,hasMore:rows.some(m=>state.compareSequence(m.sequence,nextAfter)>0)};
      },
      sendConversationMessage:async(_id,input)=>message(51,'A',input.clientId),
      readConversation:async()=>{},
    },
    '@/context/DirectMessagesContext':{useDirectMessages:()=>({owner:'A',revision:version,refresh:refreshList})},
    '@/components/profile/hooks':{actorRequest:()=>({}),useFocusedForeground:()=>true,useOwnerGuard:()=>stableGuard},
    './chat-drafts':drafts,'./direct-message-state':state,'./chat-photos':photoDeps,'expo-crypto':{randomUUID},
  });
  const draw=()=>result=local.render(()=>hook.useDirectThread('gap-'+kind));
  const flush=async()=>{for(let i=0;i<7;i++){await tick();draw();}};
  draw();await flush();
  if(kind==='ack-before-recovery'){
    rows=Array.from({length:41},(_,i)=>message(i+11));
    const ack={clientId:randomUUID(),body:'ACK ahead of unseen messages'};
    result.deliver(ack);await flush();
    assert.equal(result.messages[0].sequence,'51');
  }else{
    rows=Array.from({length:kind==='between-pages'?250:150},(_,i)=>message(i+11));
    failAt=kind==='between-pages'?'110':'10';
  }
  latest={items:rows.slice(-30).reverse(),nextCursor:'s:history'};
  version++;draw();await flush();
  if(failAt!==null){
    assert.ok(result.error,'interrupted recovery must remain visibly retryable');
    assert.equal(result.messages[0].sequence,rows.at(-1).sequence,'head was merged before sync failure');
    const nextStart=requested.length,expected=failAt;
    failAt=null;version++;draw();await flush();
    assert.equal(requested[nextStart],expected,'retry resumes successful recovery progress, not displayed head');
  }else{
    assert.equal(requested.at(-1),'10','send ACK must not advance recovery progress');
  }
  assert.equal(result.messages.length,rows.length+1);
  assert.ok(result.messages.some(m=>m.sequence==='11'),'earliest missed peer message was recovered');
  assert.equal(new Set(result.messages.map(m=>m.id)).size,result.messages.length);
  assert.equal(result.error,null);
  local.unmount();
}
await recoveryCase('after-head');
await recoveryCase('between-pages');
await recoveryCase('ack-before-recovery');
// Mutations of already-loaded OLD rows have their own recovered watermark.
// A new head must not skip changes, and a failed second page resumes from page 1.
{
  const local=hooks(),guard=()=>true,refreshList=async()=>{};
  let revision=0,result,phase=false,fail=true;
  const rows=Array.from({length:35},(_,i)=>({...message(i+1),changeSequence:String(i+1)})),asked=[];
  const readOld={...rows[0],changeSequence:'36',readAt:'2026-11-19T04:00:00Z'};
  const deletedOld={...rows[1],changeSequence:'37',body:'',deletedAt:'2026-11-19T04:01:00Z'};
  const hook=await compile('../../afilli/lib/useDirectThread.ts',{
    react:local.React,'expo-crypto':{randomUUID},
    '@workspace/api-client-react':{
      getConversation:async()=>conversation,
      getConversationMessages:async(_id,params)=>params?.cursor?{items:rows.slice(0,5).reverse(),nextCursor:null,changeCursor:'999'}:{items:rows.slice(5).reverse(),nextCursor:'older',changeCursor:phase?'999':'35'},
      syncConversationMessages:async(_id,{after})=>({items:[],nextAfter:after,hasMore:false}),
      getConversationChanges:async(_id,{after})=>{
        if(!phase)return {items:[],nextAfter:after,hasMore:false};
        asked.push(after);
        if(after==='35')return {items:[readOld],nextAfter:'36',hasMore:true};
        if(after==='36'&&fail)throw Error('Mutation page interrupted');
        return {items:after==='36'?[deletedOld]:[],nextAfter:'37',hasMore:false};
      },readConversation:async()=>{},
    },
    '@/context/DirectMessagesContext':{useDirectMessages:()=>({owner:'A',revision,refresh:refreshList})},
    '@/components/profile/hooks':{actorRequest:()=>({}),useOwnerGuard:()=>guard,useFocusedForeground:()=>true},
    './chat-drafts':drafts,'./chat-photos':photoDeps,'./direct-message-state':state,
  });
  const draw=()=>{result=local.render(()=>hook.useDirectThread('mutations'));};
  const flush=async()=>{for(let i=0;i<8;i++){await tick();draw();}};
  draw();await flush();await result.loadOlder();await flush();
  assert.equal(result.messages.length,35);
  phase=true;revision++;draw();await flush();
  assert.deepEqual(asked,['35','36']);assert.ok(result.error);
  assert.ok(result.messages.find(m=>m.id===readOld.id).readAt);
  assert.equal(result.messages.find(m=>m.id===deletedOld.id).deletedAt??null,null);
  fail=false;revision++;draw();await flush();
  assert.equal(asked[2],'36');assert.ok(result.messages.find(m=>m.id===deletedOld.id).deletedAt);
  assert.equal(result.messages.find(m=>m.id===deletedOld.id).body,'');assert.equal(result.error,null);
  local.unmount();
}
// Real composer: strict hydration, double-tap, typed-while-saving, failure and unmount safety.
const c=hooks(),posted=[];let enqueueGate=null;
const baseEnqueue=drafts.enqueueOutbox;
const composerDrafts={...drafts,enqueueOutbox:async(...args)=>{if(enqueueGate)await enqueueGate.promise;return baseEnqueue(...args);}};
const {ChatComposer}=await compile('../../afilli/components/profile/ChatComposer.tsx',{
  react:c.React,'react-native':{Pressable:'Pressable',ScrollView:'ScrollView',Text:'Text',TextInput:'TextInput',View:'View',StyleSheet:{create:x=>x,hairlineWidth:1}},
  '@/hooks/useTheme':{useTheme:()=>({magazine:{},social:{}}),makeStyles:()=>()=>({})},'@expo/vector-icons':{Feather:'Feather'},'expo-crypto':{randomUUID},
  '@/lib/chat-drafts':composerDrafts,'@workspace/api-client-react':{useSetConversationTyping:()=>({mutate(){}})},'@/lib/klipy':{notifyGifShared:async()=>{}},
  '@/context/DirectMessagesContext':{useGifPrivacy:()=>({allowed:false,customerId:null})},'@/components/ui':{F:{},tap(){}},
  '@/lib/chat-photos':photoDeps,'./PhotoMessage':{LocalPhotoPreview:'LocalPhotoPreview'},
  './GifPicker':{GifPicker:'GifPicker'},'./GifMessage':{GifMessage:'GifMessage'},'./hooks':{actorRequest:()=>({})},
});
const find=(n,id)=>{if(!n||typeof n!=='object')return null;if(n.props?.testID===id)return n;for(const x of(n.props?.children??[]).flat(Infinity)){const y=find(x,id);if(y)return y;}return null;};
const compose=()=>c.render(()=>ChatComposer({userId:'A',threadId:'compose',onQueued:e=>posted.push(e),replyTo:null,onCancelReply(){},findMessage(){}}));
compose();await tick();compose();
find(compose(),'chat-input').props.onChangeText('Captured');enqueueGate=deferred();const button=find(compose(),'chat-send');button.props.onPress();button.props.onPress();
find(compose(),'chat-input').props.onChangeText('Typed during save');compose();enqueueGate.resolve();enqueueGate=null;await tick();await tick();
assert.equal(posted.length,1);assert.equal(posted[0].body,'Captured');assert.equal(find(compose(),'chat-input').props.value,'Typed during save');
failWrite=true;await find(compose(),'chat-send').props.onPress();assert.equal(posted.length,1);assert.equal(find(compose(),'chat-input').props.value,'Typed during save');failWrite=false;
// Leaving during an enqueue must not restore the already queued body as another new draft.
enqueueGate=deferred();find(compose(),'chat-send').props.onPress();c.unmount();enqueueGate.resolve();enqueueGate=null;await tick();await tick();
const restored=await drafts.readChatDraft('A','compose');assert.equal(restored.body,'');assert.equal(restored.outbox.length,2);
// Provider re-evaluation (Fast Refresh/lazy routes) must reuse the context object.
const contextReact={createContext:value=>({value}),useContext:ctx=>ctx.value};
const authContext=await compile('../../afilli/context/auth-session.ts',{react:contextReact});
const directContext=await compile('../../afilli/context/direct-session.ts',{react:contextReact});
authContext.AuthSessionContext.value={userId:'same-session'};
directContext.DirectSessionContext.value={owner:'same-session'};
const providerDeps=new Proxy({react:contextReact,'react-native':{Platform:{OS:'web'}},
  './auth-session':authContext,'./direct-session':directContext},{has:()=>true,get:(target,key)=>target[key]??{}});
for(let reload=0;reload<2;reload++) {
  const authModule=await compile('../../afilli/context/AuthContext.tsx',providerDeps);
  const dmModule=await compile('../../afilli/context/DirectMessagesContext.tsx',providerDeps);
  assert.equal(authModule.useAuth().userId,'same-session');
  assert.equal(dmModule.useDirectMessages().owner,'same-session');
}
console.log('PASS actual thread/composer: gap and old-mutation recovery, late ACKs, deleted replies preserve unrelated pending sends, durable photo IDs, owner isolation, GIF drafts, double-tap/unmount');
