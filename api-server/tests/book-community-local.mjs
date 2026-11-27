import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
async function compile(file, extra, modules) {
  const source = await readFile(new URL(file, import.meta.url), 'utf8');
  const built = await build({ stdin: { contents: source + '\n' + extra, loader: 'tsx', resolveDir: process.cwd() }, bundle: true,
    platform: 'node', format: 'cjs', write: false, logLevel: 'silent', jsx: 'transform', jsxFactory: 'React.createElement',
    tsconfigRaw: { compilerOptions: { jsx: 'react' } },
    plugins: [{ name: 'isolated-real-component', setup(b) {
      b.onResolve({ filter: /.*/ }, args => {
        if (!(args.path in modules)) throw new Error('Missing test dependency ' + args.path);
        return { path: args.path, namespace: 'test-module' };
      });
      b.onLoad({ filter: /.*/, namespace: 'test-module' }, args => ({ contents: `module.exports=globalThis.__afilliBookTest[${JSON.stringify(args.path)}];` }));
    } }] });
  globalThis.__afilliBookTest = modules;
  const module = { exports: {} };
  try { new Function('module', 'exports', built.outputFiles[0].text)(module, module.exports); return module.exports; }
  finally { delete globalThis.__afilliBookTest; }
}
let state = [], cursor = 0, owner = 'reader', posted = [], invalidations = 0, calls = [];
const React = {
  createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  useState(initial) { const i=cursor++; if (!(i in state)) state[i] = typeof initial === 'function' ? initial() : initial;
    return [state[i], value => { state[i] = typeof value === 'function' ? value(state[i]) : value; }]; },
  useRef(initial) { const i=cursor++; if (!(i in state)) state[i]={current:initial}; return state[i]; },
  useEffect(fn, deps) {
    const i = cursor++, before = state[i];
    if (!before || deps.some((dep, j) => dep !== before.deps[j])) {
      before?.cleanup?.();
      state[i] = { effect: true, deps, cleanup: fn() };
    }
  },
  useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
  createContext: value => ({ Provider: 'Provider', value }), useContext: ctx => ctx.value,
};
const actorRequest = id => ({ headers: { 'X-Afilli-Actor': id } });
const common = { apiError: e => e.message, goSignIn() {}, Btn: 'Btn', Avatar: 'Avatar' };
const modules = {
  react: React, 'react-native': { View:'View',Text:'Text',TextInput:'TextInput',Pressable:'Pressable',StyleSheet:{create:x=>x},
    KeyboardAvoidingView:'KeyboardAvoidingView',Modal:'Modal',Platform:{OS:'ios'},ScrollView:'ScrollView' },
  '@expo/vector-icons': { Feather:'Feather' }, '@/hooks/useTheme': { makeStyles: () => () => ({}) },
  'react-native-keyboard-controller': { KeyboardAvoidingView: 'KeyboardAvoidingView' },
  '@tanstack/react-query': { useInfiniteQuery(){},useQueryClient:()=>({invalidateQueries:()=>{invalidations++;return Promise.resolve();}}) },
  'expo-crypto': { randomUUID },
  '@workspace/api-client-react': {
    addAuthoredBookComment: (book,input,opts) => { const d=deferred();calls.push({book,input:structuredClone(input),opts,...d});return d.promise; },
    getGetBookCommentThreadsQueryKey:id=>['/api/authored-books/'+id+'/comment-threads'],
    reportWriterComment: async () => ({}),
  },
  '@/components/ui': { F:{},tap(){} }, '@/components/bulletins/common': common,
  '@/components/profile/hooks': { actorRequest, scoped:(key,id)=>[...key,{as:id??'guest'}], useOwnerGuard:id=>()=>owner===id },
  '@/context/CommunityContext': { useCommunity:()=>({userId:owner,ready:true}) },
  '@/components/writer/parts': { useWriterPalette:()=>({}),writerPalette:()=>({}),Skeleton:'Skeleton' },
  './CommentOwnerActions': { CommentOwnerActions: 'CommentOwnerActions' },
};
const { Composer } = await compile('../../components/writer/BookComments.tsx','export {Composer};',modules);
const parent = { id:randomUUID(),chapterId:randomUUID(),author:{id:'other',nickname:'Other'} };
function render() { cursor=0;return Composer({bookId:'book',parent,context:{scope:'chapter',chapterId:'wrong-reader-chapter'},onCount(){},
  placeholder:'Reply',testID:'reply',onPosted:keep=>posted.push(keep)}); }
function find(node,id) {
  if (!node || typeof node!=='object') return null;
  if (node.props?.testID===id) return node;
  for(const child of (node.props?.children??[]).flat(Infinity)){const hit=find(child,id);if(hit)return hit;}
  return null;
}
function type(text) { find(render(),'reply-input').props.onChangeText(text); render(); }
function send() { find(render(),'reply-send').props.onPress(); }
// Failed response keeps the same immutable payload/id, even when a new draft
// is typed. Acknowledging the old payload must not close/discard that new draft.
type('İlk yanıt');send();assert.equal(calls.length,1);
assert.equal(calls[0].input.chapterId,parent.chapterId);assert.equal(calls[0].input.paragraphId,null);assert.equal(calls[0].input.parentId,parent.id);
calls[0].reject(new Error('offline'));await tick();assert.equal(find(render(),'reply-input').props.value,'İlk yanıt');
type('Sonraki metin');send();assert.equal(calls.length,2);
assert.deepEqual(calls[0].input,calls[1].input);
calls[1].resolve({});await tick();assert.equal(find(render(),'reply-input').props.value,'Sonraki metin');
assert.deepEqual(posted,[true]);
send();assert.equal(calls.length,3);assert.notEqual(calls[2].input.clientId,calls[0].input.clientId);
assert.equal(calls[2].input.body,'Sonraki metin');
calls[2].resolve({});await tick();assert.equal(find(render(),'reply-input').props.value,'');assert.deepEqual(posted,[true,false]);
// Double taps cannot issue a second post. New input during successful in-flight
// sending also survives; only the acknowledged text may be cleared.
type('Gönderiliyor');const oldButton=find(render(),'reply-send');oldButton.props.onPress();oldButton.props.onPress();
assert.equal(calls.length,4);type('Gönderilirken yazılan yeni metin');calls[3].resolve({});await tick();
assert.equal(find(render(),'reply-input').props.value,'Gönderilirken yazılan yeni metin');assert.equal(posted.at(-1),true);
const before=invalidations, postsBefore=posted.length;send();owner='another-account';calls.at(-1).resolve({});await tick();
assert.equal(invalidations,before);assert.equal(posted.length,postsBefore);
assert.equal(calls.at(-1).opts.headers['X-Afilli-Actor'],'reader');
console.log('PASS actual reply composer: immutable retry, correct parent/chapter, double-tap lock, in-flight text and account isolation.');

function unmount() { for (const slot of state) if (slot?.effect) slot.cleanup?.(); state = []; }
owner = 'reader'; unmount(); parent.id = randomUUID();
type('Kapanmadan önce gönderilen'); send(); const closedRequest = calls.at(-1), oldPosts = posted.length;
unmount(); render(); type('Tekrar açılınca yazılan yeni taslak');
closedRequest.resolve({}); await tick();
assert.equal(find(render(), 'reply-input').props.value, 'Tekrar açılınca yazılan yeni taslak');
assert.equal(posted.length, oldPosts, 'closed instance cannot close its replacement');
unmount(); render();
assert.equal(find(render(), 'reply-input').props.value, 'Tekrar açılınca yazılan yeni taslak', 'late acknowledgement cannot overwrite saved replacement draft');
send(); assert.deepEqual(calls.at(-1).input, closedRequest.input);
calls.at(-1).resolve({}); await tick();
assert.equal(find(render(), 'reply-input').props.value, 'Tekrar açılınca yazılan yeni taslak');
send(); calls.at(-1).resolve({}); await tick();
assert.equal(find(render(), 'reply-input').props.value, '');
type('Kapalı alanda tamamlanan'); send(); const closedOnly = calls.at(-1);
unmount(); closedOnly.resolve({}); await tick(); render();
assert.equal(find(render(), 'reply-input').props.value, '', 'acknowledged closed draft clears safely when no replacement exists');
console.log('PASS collapsed/remounted composer: late acknowledgements preserve replacement drafts, exact retry and closed-only completion.');

const queueCalls=[], gate=deferred(), ids=Array.from({length:102},()=>randomUUID());
let fail=true;
const queue = await compile('../../lib/book-subscriptions.ts','',{
  react:React,
  '@workspace/api-client-react': {
    async subscribeSavedBooks(input,opts) {
      const who=opts.headers['X-Afilli-Actor'];queueCalls.push({who,op:'merge',ids:input.bookIds});
      if(who==='A' && queueCalls.filter(x=>x.who==='A').length===1)await gate.promise;
      if(who==='C' && fail){fail=false;throw new Error('offline');}
    },
    async setBookSubscription(id,input,opts){queueCalls.push({who:opts.headers['X-Afilli-Actor'],op:'set',id,saved:input.saved});},
  },
  '@/components/profile/hooks':modules['@/components/profile/hooks'],
  '@/components/bulletins/common':common,
  '@/context/CommunityContext':modules['@/context/CommunityContext'],
  '@/context/AppContext':{},
});
const migration=queue.migrateSavedBooks('A',[...ids,'sample-book']);
const removal=queue.setBookSaved('A',ids[0],false,ids);
await tick();assert.deepEqual(queueCalls.map(x=>x.op),['merge']);
await queue.setBookSaved('B',ids[1],true,[ids[1]]); // another owner isn't blocked
assert.deepEqual(queueCalls.filter(x=>x.who==='B').map(x=>x.op),['merge','set']);
gate.resolve();await Promise.all([migration,removal]);
const aCalls=queueCalls.filter(x=>x.who==='A');
assert.deepEqual(aCalls.map(x=>x.op),['merge','merge','set']);
assert.deepEqual(aCalls.filter(x=>x.op==='merge').map(x=>x.ids.length),[100,2]);
assert.equal(aCalls.at(-1).saved,false);
await queue.migrateSavedBooks('A',ids);assert.equal(queueCalls.filter(x=>x.who==='A').length,3);
await assert.rejects(queue.migrateSavedBooks('C',[ids[0]]),/offline/);
assert.equal(queue.useMigrationStatus('C').done,false);assert.equal(queue.useMigrationStatus('C').error,'offline');
await queue.setBookSaved('C',ids[0],false,[ids[0]]);
assert.equal(queue.useMigrationStatus('C').done,true);assert.equal(queue.useMigrationStatus('C').error,null);
assert.equal(queueCalls.filter(x=>x.who==='C').at(-1).saved,false);
console.log('PASS actual subscription coordinator: ordered merge/remove, independent accounts, UUID filtering, chunking and failure retry.');
