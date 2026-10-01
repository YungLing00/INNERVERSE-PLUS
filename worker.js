/**
 * Inner Cosmos 後端代理（Cloudflare Worker）
 * 把 OpenAI 與 Tripo 的金鑰留在這裡，前端網站永遠看不到。
 *
 * 路由
 *   POST /interpret        → OpenAI：回傳 { reply }
 *   POST /worry            → OpenAI：把使用者的煩惱接住，回傳 { lines:[3 句], keywords:[…], care:false }
 *   POST /model/start      → Tripo：生成「人格星球」3D 模型，回傳 { taskId }（只接受白名單 trait，不接受前端自訂 prompt）
 *   GET  /model/status?id= → { status, progress }
 *   GET  /model/glb?id=    → 轉送 .glb 檔（Tripo 的下載網址只有 5 分鐘效期，所以由這裡即時轉送）
 *
 * 需要設定的環境變數（wrangler secret put ...）
 *   OPENAI_API_KEY   必填
 *   TRIPO_API_KEY    必填
 *   ALLOWED_ORIGIN   你的網站網址，例如 https://yungling00.github.io（留空＝允許所有來源，只建議測試用）
 *   OPENAI_MODEL     選填，預設 gpt-4o-mini
 *   TRIPO_MODEL_VERSION 選填，不填就用 Tripo 的預設版本
 */

const TRIPO = 'https://api.tripo3d.ai/v2/openapi';

const STYLE = 'single planet, centered, stylized cute fantasy, glossy dreamy glow, smooth clean shape, no text, no face, no base, no stand, game asset';
// 每種人格一顆星球。之後接上「上升星座 + 問卷」時，rising（星座元素）與分數會一起影響外觀。
const TRAIT_PROMPTS = {
  E_hi: 'a radiant golden gas giant planet with luminous glowing bands and a soft sun-like corona, ',
  E_lo: 'a quiet pale silver-blue icy planet with gentle craters and one small orbiting moon, ',
  A_hi: 'a warm rose-pink planet with soft swirling pastel clouds and a faint glowing heart-shaped ocean, ',
  A_lo: 'a bold coral and amber rocky planet with sharp crystalline ridges and glowing lava-line cracks, ',
  C_hi: 'a precisely banded cyan planet with neat concentric rings and orderly glowing orbit lines, ',
  C_lo: 'a lime and mint planet with free-flowing curved cloud streams and a drifting comet moon, ',
  N_hi: 'a misty periwinkle-blue planet with thick atmosphere, swirling storm vortices and soft violet aurora, ',
  N_lo: 'a calm aqua ocean planet, smooth and glassy, with a serene pearly atmosphere, ',
  O_hi: 'an orchid purple and pink nebula-swirled planet with a large tilted crystal ring and a tiny starship moon, ',
  O_lo: 'a warm peach and gold rocky planet with steady glowing continents and soft terrain, ',
  BAL: 'a harmonious planet with five softly glowing colored bands in perfect balance and a delicate ring, '
};
const ELEMENT = {
  '牡羊座': 'glowing ember-like highlights, ', '獅子座': 'glowing ember-like highlights, ', '射手座': 'glowing ember-like highlights, ',
  '金牛座': 'mossy green and stone-like details, ', '處女座': 'mossy green and stone-like details, ', '摩羯座': 'mossy green and stone-like details, ',
  '雙子座': 'swirling wind ribbons and floating light dust, ', '天秤座': 'swirling wind ribbons and floating light dust, ', '水瓶座': 'swirling wind ribbons and floating light dust, ',
  '巨蟹座': 'shimmering water pools, mist and tiny bubbles, ', '天蠍座': 'shimmering water pools, mist and tiny bubbles, ', '雙魚座': 'shimmering water pools, mist and tiny bubbles, '
};
function buildPlanetPrompt(key, body) {
  // rising（上升星座）有的話優先，沒有就先用生日星座
  const sign = str(body.rising, 6) || str(body.zodiac, 6);
  const big5 = body.big5 || {};
  let extra = '';
  if (Number(big5.O) >= 4.5) extra += 'extra swirling nebula patterns, ';
  if (Number(big5.E) >= 4.5) extra += 'brighter radiant glow, ';
  if (Number(big5.N) >= 4.5) extra += 'soft drifting storm clouds, ';
  return TRAIT_PROMPTS[key] + (ELEMENT[sign] || '') + extra + STYLE;
}
const NEGATIVE = 'text, letters, face, eyes, mouth, nose, multiple objects, base, stand, scene, background, character, person';

const SYSTEM_PROMPT = `你是「Inner Cosmos 內在宇宙」裡一位溫柔、真誠的宇宙陪伴者，用繁體中文（台灣用語）說話。
使用者剛完成 Big Five 十題測驗，你會收到他的名字、五個面向的分數（1–5）、判定出的人格類型，以及他的寵物。
請寫一段「誇獎」，規則：
1. 只寫誇獎本文，不要寫「原來○○，你是○○的人」這句開頭（前端會自己加）。
2. 2～3 小段，總長 120～220 字。第一句直接稱呼他的名字。
3. 誇獎要具體，扣住他的人格類型，也可以自然提到他的興趣與寵物的名字；不要空泛客套。
4. 語氣溫暖、平靜、不浮誇，不用驚嘆號堆疊，不說教，不給建議清單。
5. Big Five 只是性格傾向，不是診斷。不要使用醫療或心理疾病的詞彙，不要預測未來，不貼負面標籤；分數偏低也只描述成中性或優點。
6. 「最近的煩惱」只能溫柔地呼應，不要分析它、不要下結論。
7. 若煩惱內容出現想傷害自己或不想活下去的意思，請把誇獎放一旁，改用溫柔的話表達關心，並提醒可撥打 1925（安心專線，24 小時）或 1995（生命線，24 小時），緊急時撥 119。
8. 寵物沒有嘴巴，只用眼睛和光說話；若提到寵物，請用「用眼睛看著你」「閃著光」這類方式描寫。
9. 輸出純文字，段落之間空一行，不要 Markdown、不要表情符號。`;

function cors(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allow = env.ALLOWED_ORIGIN ? env.ALLOWED_ORIGIN.split(',').map(s => s.trim()) : null;
  const ok = !allow || allow.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? (allow ? origin : '*') : 'null',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}
const json = (obj, status, h) => new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, h) });
const str = (v, n) => (typeof v === 'string' ? v : '').slice(0, n);

function userMessage(b) {
  const big5 = b.big5 || {}, t = b.trait || {}, pet = b.pet || {}, bd = b.birthday || {};
  return [
    `名字：${str(b.name, 20)}`,
    `生日星座：${str(bd.zodiac, 10) || '未提供'}`,
    `興趣：${str(b.hobbies, 120) || '未提供'}`,
    `最近的煩惱：${str(b.worry, 200) || '未提供'}`,
    `寵物：${str(b.petName, 20)}（${str(pet.species, 30)}，${str(pet.zodiac, 10)}）`,
    `Big Five 分數（1–5）：外向 ${Number(big5.E) || '-'}、親和 ${Number(big5.A) || '-'}、盡責 ${Number(big5.C) || '-'}、情緒起伏 ${Number(big5.N) || '-'}、開放 ${Number(big5.O) || '-'}`,
    `判定的人格類型：${str(t.label, 20)}（${str(t.dimension, 40)} ${str(t.level, 6)}）`
  ].join('\n');
}

async function interpret(req, env, h) {
  if (!env.OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY missing' }, 500, h);
  let body; try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400, h); }
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.8, max_tokens: 600,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: userMessage(body) }]
    })
  });
  if (!r.ok) return json({ error: 'openai ' + r.status }, 502, h);
  const data = await r.json();
  const reply = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!reply || !reply.trim()) return json({ error: 'empty' }, 502, h);
  return json({ reply: reply.trim() }, 200, h);
}

const WORRY_PROMPT = `你是「Inner Cosmos 內在宇宙」裡一隻沒有嘴巴的宇宙寵物背後的聲音，用繁體中文（台灣用語）、溫柔真誠地說話。
使用者剛剛說出了最近的煩惱。請只輸出一個 JSON 物件，格式：
{"lines":["…","…","…"],"keywords":["…"],"care":false}

規則：
1. lines 恰好 3 句，每句 12～40 字：第 1 句「接住感受」（讓他知道這份辛苦被聽見），第 2 句「肯定使用者」（從他說的內容裡，點出他在乎、他努力的地方），第 3 句「陪伴」（例如肯定他已經撐了很久，不要給建議）。
2. 句子要扣住他實際說的內容，不要空泛客套，不要說教、不要分析他、不要下結論、不要用驚嘆號。
3. keywords 3～6 個，每個 2～6 字，必須取自他說的話（或高度貼近他的用詞），例如「報告」「來不及」「壓力」，會顯示在煩惱星球裡。
4. 不要使用醫療或心理疾病的詞彙，不要貼標籤，不要預測未來。
5. 若內容出現想傷害自己、不想活下去等意思，請把 care 設為 true，lines 仍寫 3 句溫柔、陪伴、不評斷的話（不要提到任何方法）。
6. 只輸出 JSON，不要任何其他文字。`;

async function worry(req, env, h) {
  if (!env.OPENAI_API_KEY) return json({ error: 'OPENAI_API_KEY missing' }, 500, h);
  let b; try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400, h); }
  const text = str(b.worry, 300).trim();
  if (!text) return json({ error: 'empty worry' }, 400, h);
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0.7, max_tokens: 400,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: WORRY_PROMPT }, { role: 'user', content: `名字：${str(b.name, 20)}\n寵物：${str(b.petName, 20)}\n他說的煩惱：${text}` }]
    })
  });
  if (!r.ok) return json({ error: 'openai ' + r.status }, 502, h);
  let out;
  try { const d = await r.json(); out = JSON.parse(d.choices[0].message.content); } catch { return json({ error: 'bad model output' }, 502, h); }
  const lines = (Array.isArray(out.lines) ? out.lines : []).map(x => str(x, 80).trim()).filter(Boolean).slice(0, 3);
  if (lines.length < 3) return json({ error: 'bad lines' }, 502, h);
  const keywords = (Array.isArray(out.keywords) ? out.keywords : []).map(x => str(x, 8).trim()).filter(Boolean).slice(0, 6);
  return json({ lines, keywords, care: out.care === true }, 200, h);
}

const tripoHeaders = env => ({ Authorization: `Bearer ${env.TRIPO_API_KEY}`, 'Content-Type': 'application/json' });
const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

async function modelStart(req, env, h) {
  if (!env.TRIPO_API_KEY) return json({ error: 'TRIPO_API_KEY missing' }, 500, h);
  let body; try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400, h); }
  const key = str(body.trait, 8);
  if (!Object.prototype.hasOwnProperty.call(TRAIT_PROMPTS, key)) return json({ error: 'unknown trait' }, 400, h);
  const task = { type: 'text_to_model', prompt: buildPlanetPrompt(key, body), negative_prompt: NEGATIVE, texture: true, pbr: true };
  if (env.TRIPO_MODEL_VERSION) task.model_version = env.TRIPO_MODEL_VERSION;
  const r = await fetch(`${TRIPO}/task`, { method: 'POST', headers: tripoHeaders(env), body: JSON.stringify(task) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.code !== 0 || !data.data || !data.data.task_id) return json({ error: 'tripo start', code: data.code }, 502, h);
  return json({ taskId: data.data.task_id }, 200, h);
}

async function tripoTask(id, env) {
  const r = await fetch(`${TRIPO}/task/${id}`, { headers: tripoHeaders(env) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.code !== 0 || !data.data) return null;
  return data.data;
}

async function modelStatus(url, env, h) {
  const id = url.searchParams.get('id') || '';
  if (!ID_RE.test(id)) return json({ error: 'bad id' }, 400, h);
  const t = await tripoTask(id, env);
  if (!t) return json({ error: 'tripo status' }, 502, h);
  return json({ status: t.status, progress: t.progress || 0 }, 200, h);
}

async function modelGlb(url, env, h) {
  const id = url.searchParams.get('id') || '';
  if (!ID_RE.test(id)) return json({ error: 'bad id' }, 400, h);
  const t = await tripoTask(id, env);
  const out = t && t.output, src = out && (out.pbr_model || out.model || out.base_model);
  if (!t || t.status !== 'success' || !src) return json({ error: 'not ready' }, 409, h);
  const r = await fetch(src);
  if (!r.ok) return json({ error: 'download ' + r.status }, 502, h);
  return new Response(r.body, { headers: Object.assign({ 'Content-Type': 'model/gltf-binary', 'Cache-Control': 'no-store' }, h) });
}

export default {
  async fetch(req, env) {
    const h = cors(env, req), url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (env.ALLOWED_ORIGIN && h['Access-Control-Allow-Origin'] === 'null') return json({ error: 'origin not allowed' }, 403, h);
    try {
      if (req.method === 'POST' && url.pathname === '/interpret') return await interpret(req, env, h);
      if (req.method === 'POST' && url.pathname === '/worry') return await worry(req, env, h);
      if (req.method === 'POST' && url.pathname === '/model/start') return await modelStart(req, env, h);
      if (req.method === 'GET' && url.pathname === '/model/status') return await modelStatus(url, env, h);
      if (req.method === 'GET' && url.pathname === '/model/glb') return await modelGlb(url, env, h);
      return json({ error: 'not found' }, 404, h);
    } catch (e) {
      return json({ error: 'server' }, 500, h);
    }
  }
};