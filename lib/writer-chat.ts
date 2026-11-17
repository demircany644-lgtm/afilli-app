import colors from '@/constants/colors';

// User-supplied public room. No Afilli login token or profile is passed to Minnit.
export const WRITER_CHAT_URL = 'https://organizations.minnit.chat/289650212190374/c/Main?embed&app';
export const WRITER_CHAT_SCRIPT = 'https://minnit.chat/js/embed.js?c=1793238146';

// The official script handles the parent/iframe handshake and provider login
// persistence. The app-owned footer label is separate from Minnit's own UI.
export const WRITER_CHAT_HTML = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>html,body{height:100%;width:100%;margin:0}body{display:flex;flex-direction:column}
main{position:relative;flex:1;min-height:0;overflow:hidden;line-height:0}p{margin:0;padding:5px;font:13px sans-serif;color:${colors.light.writerChatLabel};text-align:center}</style>
<script src="${WRITER_CHAT_SCRIPT}" defer></script></head><body>
<main><span style="display:none" class="minnit-chat-sembed" data-chatname="${WRITER_CHAT_URL}" data-style="position:absolute;inset:0;display:block;width:100%;height:100%;" data-version="1.56">Chat</span></main>
<p>afilli chat</p>
</body></html>`;
