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

await env.cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
