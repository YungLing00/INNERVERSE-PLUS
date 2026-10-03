// 規則測試：npm i -D firebase-tools @firebase/rules-unit-testing firebase
// 然後執行：npx firebase emulators:exec --only database --project demo-iv "node firebase/rules.test.mjs"
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, set, get, update, remove, serverTimestamp as ts, increment } from 'firebase/database';
import fs from 'fs';

const env = await initializeTestEnvironment({
  projectId: 'demo-iv',
  database: { rules: fs.readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8'), host: '127.0.0.1', port: 9000 },
});
const anon = uid => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).database();
const google = uid => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'google.com' } }).database();
const nobody = env.unauthenticatedContext().database();
const A = anon('alice'), B = anon('bob'), C = anon('carol');
let pass = 0, fail = 0;
async function t(name, p) { try { await p; pass++; console.log('ok  ', name); } catch (e) { fail++; console.log('FAIL', name, e.message.split('\n')[0]); } }
const planet = name => ({ name, nameKey: name.toLowerCase(), updatedAt: ts(), createdAt: ts(), element: 'fire', weather: 'rain', petIdx: 2, petName: 'Mo', big5: { O: 3, C: 4, E: 2, A: 5, N: 1 } });
const publish = (db, uid, name) => update(ref(db), { [`names/${name.toLowerCase()}`]: uid, [`planets/${uid}`]: planet(name) });

// planets + names
await t('alice publishes planet with name claim', assertSucceeds(publish(A, 'alice', 'Alice')));
await t('bob publishes', assertSucceeds(publish(B, 'bob', 'Bob')));
await t('carol publishes', assertSucceeds(publish(C, 'carol', 'Carol')));
await t('bob cannot steal name Alice', assertFails(publish(B, 'bob', 'alice')));
await t('planet without name claim rejected', assertFails(set(ref(C, 'planets/carol'), planet('Zed'))));
await t('bob cannot write alice planet', assertFails(set(ref(B, 'planets/alice/petName'), 'x')));
await t('unknown field rejected', assertFails(update(ref(A, 'planets/alice'), { hacker: 1, updatedAt: ts() })));
await t('bad element rejected', assertFails(update(ref(A, 'planets/alice'), { element: 'lava', updatedAt: ts() })));
await t('owner writes own lights count', assertSucceeds(update(ref(A, 'planets/alice'), { lights: 12, updatedAt: ts() })));
await t('negative lights rejected', assertFails(update(ref(A, 'planets/alice'), { lights: -1, updatedAt: ts() })));
await t('anon can read planets', assertSucceeds(get(ref(B, 'planets'))));
await t('unauthenticated cannot read', assertFails(get(ref(nobody, 'planets'))));
await t('non-anonymous provider cannot read', assertFails(get(ref(google('g'), 'planets'))));
await t('nobody can read root', assertFails(get(ref(A))));

// invites / friends / outcomes
await t('alice invites bob', assertSucceeds(set(ref(A, 'inbox/bob/invites/alice'), { createdAt: ts() })));
await t('alice cannot forge invite from carol', assertFails(set(ref(A, 'inbox/bob/invites/carol'), { createdAt: ts() })));
await t('carol cannot read bob inbox', assertFails(get(ref(C, 'inbox/bob'))));
await t('alice reads her sent invite', assertSucceeds(get(ref(A, 'inbox/bob/invites/alice'))));
await t('carol cannot befriend bob uninvited', assertFails(set(ref(C, 'friends/carol/bob'), { level: 1, danceCount: 1, lastAt: ts() })));
await t('carol cannot write bob friend list', assertFails(set(ref(C, 'friends/bob/carol'), { level: 1, danceCount: 1, lastAt: ts() })));
await t('bob accepts: both friend rows + outcome + delete invite', assertSucceeds(update(ref(B), {
  'friends/bob/alice': { level: 1, danceCount: 1, lastAt: ts() },
  'friends/alice/bob': { level: 1, danceCount: 1, lastAt: ts() },
  'inbox/alice/outcomes/bob': { status: 'accepted', at: ts() },
  'inbox/bob/invites/alice': null,
})));
await t('alice updates her friendship row', assertSucceeds(update(ref(A, 'friends/alice/bob'), { danceCount: 2, lastAt: ts() })));
await t('danceCount cannot go down', assertFails(update(ref(A, 'friends/alice/bob'), { danceCount: 0, lastAt: ts() })));
await t('bob cannot edit alice row after creation', assertFails(update(ref(B, 'friends/alice/bob'), { danceCount: 9, lastAt: ts() })));
await t('alice clears her outcome', assertSucceeds(remove(ref(A, 'inbox/alice/outcomes/bob'))));

// notes + starlight
await t('alice sends note to bob', assertSucceeds(set(ref(A, 'inbox/bob/notes/n1'), { from: 'alice', text: 'hi', time: ts() })));
await t('note with forged from rejected', assertFails(set(ref(A, 'inbox/bob/notes/n2'), { from: 'carol', text: 'hi', time: ts() })));
await t('note over 60 chars rejected', assertFails(set(ref(A, 'inbox/bob/notes/n3'), { from: 'alice', text: 'x'.repeat(61), time: ts() })));
await t('carol cannot overwrite note', assertFails(set(ref(C, 'inbox/bob/notes/n1'), { from: 'carol', text: 'mine', time: ts() })));
await t('carol cannot delete bob note', assertFails(remove(ref(C, 'inbox/bob/notes/n1'))));
await t('bob deletes note', assertSucceeds(remove(ref(B, 'inbox/bob/notes/n1'))));
await t('carol gives starlight to bob', assertSucceeds(set(ref(C, 'inbox/bob/starlight/s1'), { kind: 'heart', from: 'carol', time: ts() })));
await t('bad gift kind rejected', assertFails(set(ref(C, 'inbox/bob/starlight/s2'), { kind: 'bomb', time: ts() })));

// event
const give = (db, uid, from, n) => update(ref(db, 'events/2026100217'), { progress: increment(n), [`parts/${uid}/n`]: increment(n), [`parts/${uid}/last`]: ts(), [`parts/${uid}/seen`]: ts(), [`parts/${uid}/petIdx`]: 1 });
await t('alice gives 5 fragments', assertSucceeds(give(A, 'alice', 0, 5)));
await t('bob gives 3', assertSucceeds(give(B, 'bob', 0, 3)));
await t('alice giving again within 2s rejected', assertFails(give(A, 'alice', 5, 1)));
await t('more than 5 at once rejected', assertFails(give(C, 'carol', 0, 6)));
await t('progress without own parts rejected', assertFails(set(ref(C, 'events/2026100217/progress'), 100)));
await t('carol cannot write alice parts', assertFails(set(ref(C, 'events/2026100217/parts/alice'), { n: 0, seen: ts() })));
const p = await get(ref(A, 'events/2026100217/progress'));
await t('progress is 8', p.val() === 8 ? Promise.resolve() : Promise.reject(new Error('got ' + p.val())));
await t('mark done', assertSucceeds(set(ref(B, 'events/2026100217/done'), ts())));
await t('no giving after done', assertFails(give(C, 'carol', 0, 1)));
await t('bad event id rejected', assertFails(set(ref(A, 'events/hack/parts/alice'), { n: 0, seen: ts() })));

// rooms（3V3 STAR BALL／SAVE THE PLANET）
const R = 'rooms/ABCDE/';
const create = (db, uid, extra = {}) => update(ref(db), Object.assign({ [R + 'host']: uid, [R + 'createdAt']: ts(), [R + 'mode']: 'save', [R + 'seed']: 7, [R + 'state']: 'wait', [R + 'open']: 'save',
  [R + 'slots/0']: uid, [R + 'p/' + uid]: { slot: '0', petIdx: 3, petName: 'Mo', name: 'Alice', at: ts(), b: { 0: 3, 1: 4, 2: 2, 3: 5, 4: 1 } } }, extra));
await t('alice creates a room', assertSucceeds(create(A, 'alice')));
await t('bad room code rejected', assertFails(update(ref(B), { 'rooms/abc/host': 'bob' })));
await t('bob cannot take over an existing room as stranger', assertFails(set(ref(B, R + 'host'), 'bob')));
await t('bob cannot claim alice slot', assertFails(set(ref(B, R + 'slots/0'), 'bob')));
await t('bob claims slot 3', assertSucceeds(set(ref(B, R + 'slots/3'), 'bob')));
await t('bob joins on slot 3', assertSucceeds(set(ref(B, R + 'p/bob'), { slot: '3', petIdx: 1, at: ts() })));
await t('carol cannot join on bob slot', assertFails(set(ref(C, R + 'p/carol'), { slot: '3', petIdx: 1, at: ts() })));
await t('carol cannot write bob state', assertFails(set(ref(C, R + 's/bob'), { x: 1, y: 1, t: 1 })));
await t('bob writes his position', assertSucceeds(set(ref(B, R + 's/bob'), { x: 100, y: 200, vx: 10, vy: -5, ab: 0, c: '012', kn: 1, kx: 300, ky: 0, t: 123 })));
await t('position out of field rejected', assertFails(set(ref(B, R + 's/bob'), { x: 99999, y: 200, t: 1 })));
await t('non-member carol cannot write state', assertFails(set(ref(C, R + 's/carol'), { x: 1, y: 1, t: 1 })));
await t('bob (not host) cannot write world', assertFails(set(ref(B, R + 'w'), { t: 1 })));
await t('host alice writes world', assertSucceeds(set(ref(A, R + 'w'), { t: 1, b: { x: 800, y: 500, vx: 0, vy: 0 }, sc: { 0: 1, 1: 0 } })));
await t('host starts the game', assertSucceeds(update(ref(A), { [R + 'state']: 'play', [R + 'startAt']: Date.now() + 3000 })));
await t('bob cannot set startAt', assertFails(set(ref(B, R + 'startAt'), Date.now())));
await t('bob claims item 4', assertSucceeds(set(ref(B, R + 'items/4'), 'bob')));
await t('alice cannot reclaim item 4', assertFails(set(ref(A, R + 'items/4'), 'alice')));
await t('bob cannot claim for a bot', assertFails(set(ref(B, R + 'items/5'), 'b1')));
await t('host claims item for a bot', assertSucceeds(set(ref(A, R + 'items/5'), 'b1')));
await t('bob delivers 3', assertSucceeds(set(ref(B, R + 'del/bob'), { n: 3, tm: '1' })));
await t('bob cannot deliver 4 at once', assertFails(set(ref(B, R + 'del/bob'), { n: 7, tm: '1' })));
await t('bob cannot lower his count', assertFails(set(ref(B, R + 'del/bob'), { n: 1, tm: '1' })));
await t('bob takes over as host', assertSucceeds(set(ref(B, R + 'host'), 'bob')));
await t('bob cannot make carol host', assertFails(set(ref(B, R + 'host'), 'carol')));
await t('mode cannot change', assertFails(set(ref(B, R + 'mode'), 'ball')));
await t('alice leaves (slot + p + s)', assertSucceeds(update(ref(A), { [R + 'slots/0']: null, [R + 'p/alice']: null, [R + 's/alice']: null })));
await t('carol takes the free slot', assertSucceeds(set(ref(C, R + 'slots/0'), 'carol')));
await t('carol cannot delete the running room', assertFails(remove(ref(C, 'rooms/ABCDE'))));
await t('host ends the game', assertSucceeds(set(ref(B, R + 'state'), 'end')));
await t('host deletes the finished room', assertSucceeds(remove(ref(B, 'rooms/ABCDE'))));
await t('anon can query open rooms', assertSucceeds(get(ref(C, 'rooms'))));

// 新玩法：流星接接樂、星空塗鴉、舞蹈對決；表情 em 和舞蹈 dn
const R2 = 'rooms/FGHJK/';
await t('dance room can be created', assertSucceeds(update(ref(A), { [R2 + 'host']: 'alice', [R2 + 'createdAt']: ts(), [R2 + 'mode']: 'dance', [R2 + 'seed']: 3, [R2 + 'state']: 'wait', [R2 + 'open']: 'dance', [R2 + 'slots/0']: 'alice', [R2 + 'p/alice']: { slot: '0', petIdx: 2, at: ts() } })));
await t('unknown mode rejected', assertFails(update(ref(B), { 'rooms/LMNPQ/host': 'bob', 'rooms/LMNPQ/createdAt': ts(), 'rooms/LMNPQ/mode': 'golf' })));
await t('player sends emote and dance hits', assertSucceeds(set(ref(A, R2 + 's/alice'), { x: 600, y: 500, t: 1, em: 31, dn: 12 })));
await t('negative emote rejected', assertFails(set(ref(A, R2 + 's/alice'), { x: 600, y: 500, t: 1, em: -1 })));
await t('score +3 accepted', assertSucceeds(set(ref(A, R2 + 'del/alice'), { n: 3, tm: '0' })));
await t('score +4 at once rejected', assertFails(set(ref(A, R2 + 'del/alice'), { n: 7, tm: '0' })));

// 獎勵生態：送禮、星球家園、稱號
await t('alice gives bob a flower', assertSucceeds(set(ref(A, 'inbox/bob/gifts/g1'), { from: 'alice', k: 'rose', at: ts() })));
await t('cannot fake the sender of a gift', assertFails(set(ref(A, 'inbox/bob/gifts/g2'), { from: 'carol', k: 'rose', at: ts() })));
await t('cannot overwrite a gift', assertFails(set(ref(C, 'inbox/bob/gifts/g1'), { from: 'carol', k: 'tulip', at: ts() })));
await t('gift item key must be plain letters', assertFails(set(ref(A, 'inbox/bob/gifts/g3'), { from: 'alice', k: 'rose<script>', at: ts() })));
await t('cannot gift yourself', assertFails(set(ref(A, 'inbox/alice/gifts/g4'), { from: 'alice', k: 'rose', at: ts() })));
await t('carol cannot read bob gifts', assertFails(get(ref(C, 'inbox/bob/gifts'))));
await t('bob reads and removes his gift', assertSucceeds(get(ref(B, 'inbox/bob/gifts')).then(() => remove(ref(B, 'inbox/bob/gifts/g1')))));
await t('alice saves her home', assertSucceeds(set(ref(A, 'homes/alice'), { p: '[]', th: 'pHome', t: '✦ New Traveler', at: ts() })));
await t('bob can visit alice home', assertSucceeds(get(ref(B, 'homes/alice'))));
await t('bob cannot edit alice home', assertFails(set(ref(B, 'homes/alice'), { p: '[]', at: ts() })));
await t('home too large rejected', assertFails(set(ref(A, 'homes/alice'), { p: 'x'.repeat(8001), at: ts() })));
await t('alice sets her title', assertSucceeds(set(ref(A, 'planets/alice/title'), '🌱 Star Gardener')));

await env.cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
