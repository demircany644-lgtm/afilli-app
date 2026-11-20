import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../../afilli/lib/writer-editor-html.ts', import.meta.url), 'utf8');
const listeners = {}, commands = [];
let undo = 0, redo = 0;
const ed = { addEventListener: (name, fn) => { listeners[name] = fn; } };
const docListeners = {};
const document = { addEventListener: (name, fn) => { docListeners[name] = fn; }, execCommand: (...args) => commands.push(args) };
const context = { ed, document, window: {}, undo: () => undo++, redo: () => redo++ };
for (const name of ['copy', 'cut', 'contextmenu']) {
  const line = source.split('\n').find(l => l.startsWith(`document.addEventListener('${name}'`));
  assert.ok(line); vm.runInNewContext(line, context);
}
for (const name of ['beforeinput', 'keydown', 'paste']) {
  const line = source.split('\n').find(l => l.startsWith(`ed.addEventListener('${name}'`));
  assert.ok(line); vm.runInNewContext(line, context);
}
function event(fields = {}) { return { prevented: false, preventDefault() { this.prevented = true; }, ...fields }; }
for (const name of ['copy', 'cut', 'contextmenu']) {
  const e = event(); docListeners[name](e); assert.ok(e.prevented);
}
for (const key of ['c', 'x']) {
  const e = event({ ctrlKey: true, key }); listeners.keydown(e); assert.ok(e.prevented);
}
const cut = event({ inputType: 'deleteByCut' }); listeners.beforeinput(cut); assert.ok(cut.prevented);
const text = 'Yapıştırılan güvenli metin';
const paste = event({ clipboardData: { getData: kind => { assert.equal(kind, 'text/plain'); return text; } } });
listeners.paste(paste); assert.ok(paste.prevented); assert.deepEqual(commands, [['insertText', false, text]]);
listeners.keydown(event({ ctrlKey: true, key: 'z' })); listeners.keydown(event({ ctrlKey: true, key: 'y' }));
assert.equal(undo, 1); assert.equal(redo, 1);
console.log('PASS clipboard restrictions preserve paste, undo and redo while blocking export and cut deletion.');
