/**
 * INNERVERSE PLUS - Google Apps Script backend
 * GitHub 備份版。真正執行時請把這份貼到 Google Apps Script 的 Code.gs。
 *
 * Script Properties:
 *   OPENAI_API_KEY (必填)
 *   TRIPO_API_KEY  (必填)
 *   OPENAI_MODEL   (選填，預設 gpt-4o-mini)
 *   TRIPO_MODEL_VERSION (選填)
 */

const SPREADSHEET_ID = '1E8XBDwI_J3lQfDcPg80kbcaRfkJAUx7N0vH1McnYnhM';
const SHEET_NAME = 'INNERVERSE_DATA';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const TRIPO_BASE = 'https://api.tripo3d.ai/v2/openapi';

const HEADERS = [
  '建立時間','使用者名稱','生日','出生年','出生月','出生日','星座',
  'O_開放性','C_盡責性','E_外向性','A_親和性','N_神經質',
  '主要人格','人格關鍵字','人格分析',
  '五行','五行音','五行情緒','五行顏色',
  '寵物種類','寵物名稱','星球名稱','星球Prompt','3D模型URL',
  '今日心情','煩惱內容','原始資料JSON','興趣愛好'
];

const STYLE = 'single planet, centered, stylized cute fantasy, glossy dreamy glow, smooth clean shape, no text, no face, no base, no stand, game asset';
const NEGATIVE = 'text, letters, face, eyes, mouth, nose, multiple objects, base, stand, scene, background, character, person';

const TRAIT_PROMPTS = {
  E_hi:'a radiant golden gas giant planet with luminous glowing bands and a soft sun-like corona, ',
  E_lo:'a quiet pale silver-blue icy planet with gentle craters and one small orbiting moon, ',
  A_hi:'a warm rose-pink planet with soft swirling pastel clouds and a faint glowing heart-shaped ocean, ',
  A_lo:'a bold coral and amber rocky planet with sharp crystalline ridges and glowing lava-line cracks, ',
  C_hi:'a precisely banded cyan planet with neat concentric rings and orderly glowing orbit lines, ',
  C_lo:'a lime and mint planet with free-flowing curved cloud streams and a drifting comet moon, ',
  N_hi:'a misty periwinkle-blue planet with thick atmosphere, swirling storm vortices and soft violet aurora, ',
  N_lo:'a calm aqua ocean planet, smooth and glassy, with a serene pearly atmosphere, ',
  O_hi:'an orchid purple and pink nebula-swirled planet with a large tilted crystal ring and a tiny starship moon, ',
  O_lo:'a warm peach and gold rocky planet with steady glowing continents and soft terrain, ',
  BAL:'a harmonious planet with five softly glowing colored bands in perfect balance and a delicate ring, '
};

const ZODIAC = {
  '牡羊座':'glowing ember-like highlights, ','獅子座':'glowing ember-like highlights, ','射手座':'glowing ember-like highlights, ',
  '金牛座':'mossy green and stone-like details, ','處女座':'mossy green and stone-like details, ','摩羯座':'mossy green and stone-like details, ',
  '雙子座':'swirling wind ribbons and floating light dust, ','天秤座':'swirling wind ribbons and floating light dust, ','水瓶座':'swirling wind ribbons and floating light dust, ',
  '巨蟹座':'shimmering water pools, mist and tiny bubbles, ','天蠍座':'shimmering water pools, mist and tiny bubbles, ','雙魚座':'shimmering water pools, mist and tiny bubbles, '
};

const SYSTEM_PROMPT = `你是「INNERVERSE 內在宇宙」的 AI 人格陪伴者，用繁體中文（台灣用語）。
你會收到名字、生日、星座、興趣、最近的煩惱、Big Five 分數、人格類型與寵物。
Big Five 是主要人格依據；生日、星座、興趣與煩惱作為個人化敘事的輔助資訊，不把星座當成科學診斷。
輸出 2～3 小段、約 150～260 個中文字。不要 Markdown、不要心理診斷、不要預測未來、不要說教。
可以自然提到寵物；寵物沒有嘴巴，只用眼睛與光陪伴。
若煩惱涉及自殺、自殘、想死、不想活，改以關心為主並提醒 1925、1995，緊急時 119。`;

// 使用者在網站選擇英文時，附加在 system prompt 後面
const EN_SUFFIX = '\n\nIMPORTANT: The user chose English. Reply entirely in natural, warm English (ignore the Traditional Chinese requirement above). Keep the same structure, length (about 110-190 English words for the reflection; 6-20 words per line for JSON lines) and safety rules. For crisis support mention local emergency services and, in Taiwan, 1925 / 1995 / 119.';
const isEn_ = b => String((b && b.lang) || '').toLowerCase().indexOf('en') === 0;

const WORRY_PROMPT = `你是 INNERVERSE 宇宙寵物背後的陪伴聲音，用繁體中文。
只輸出 JSON：{"lines":["…","…","…"],"keywords":["…"],"care":false}
lines 剛好 3 句，每句 12～40 字：接住感受、肯定使用者、陪伴。
keywords 3～6 個，優先使用使用者原本的詞。
不要說教、不要心理診斷、不要預測未來。
若內容涉及自殺、自殘、想死、不想活，care=true。`;

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || '';
    if (action === 'modelStatus') return modelStatus_(e);
    if (action === 'modelGlb') return modelGlb_(e);
    return json_({
      ok:true,
      message:'INNERVERSE PLUS API is running',
      actions:['saveInnerverse','interpret','worry','modelStart','modelStatus','modelGlb'],
      time:new Date().toISOString()
    });
  } catch (err) {
    return json_({ok:false,error:err.message});
  }
}

function doPost(e) {
  try {
    const body = parseBody_(e);
    const action = ((e && e.parameter && e.parameter.action) || body.action || 'saveInnerverse');
    if (action === 'interpret') return interpret_(body);
    if (action === 'worry') return worry_(body);
    if (action === 'modelStart') return modelStart_(body);
    if (action === 'saveInnerverse') return saveInnerverse_(body);
    return json_({ok:false,error:'Unknown action: ' + action});
  } catch (err) {
    return json_({ok:false,error:err.message});
  }
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try { return JSON.parse(e.postData.contents); } catch (_) { return {}; }
}

function prop_(name) {
  return PropertiesService.getScriptProperties().getProperty(name) || '';
}

function interpret_(b) {
  const big5 = b.big5 || {};
  const trait = b.trait || {};
  const pet = b.pet || {};
  const bd = b.birthday || {};
  const user = [
    '名字：' + str_(b.name,20),
    '生日原始輸入：' + (str_(bd.raw,40) || '未提供'),
    '解析生日：' + [bd.year||'-',bd.month||'-',bd.day||'-'].join('-'),
    '星座：' + (str_(bd.zodiac,10) || '未提供'),
    '興趣：' + (str_(b.hobbies || b.hobby,160) || '未提供'),
    '最近煩惱：' + (str_(b.worry || b.worryText,240) || '未提供'),
    '寵物：' + str_(b.petName || pet.name,20) + '（' + str_(pet.species || pet.type,40) + '）',
    'Big Five：O ' + num_(big5.O) + '、C ' + num_(big5.C) + '、E ' + num_(big5.E) + '、A ' + num_(big5.A) + '、N ' + num_(big5.N),
    '人格類型：' + (str_(trait.label,30) || str_(b.dominantTrait,30) || '未提供'),
    '人格維度：' + (str_(trait.dimension,50) || '未提供')
  ].join('\n');
  return json_({ok:true,reply:callOpenAI_(SYSTEM_PROMPT + (isEn_(b) ? EN_SUFFIX : ''),user,false)});
}

function worry_(b) {
  const worry = str_(b.worry || b.worryText,500).trim();
  if (!worry) return json_({ok:false,error:'empty worry'});
  try {
    const raw = callOpenAI_(WORRY_PROMPT + (isEn_(b) ? EN_SUFFIX : ''),
      '名字：' + (str_(b.name,20)||'你') + '\n寵物：' + (str_(b.petName,20)||'宇宙寵物') + '\n煩惱：' + worry, true);
    const out = JSON.parse(raw);
    const lines = (Array.isArray(out.lines)?out.lines:[]).map(x=>str_(x,100)).filter(Boolean).slice(0,3);
    const keywords = (Array.isArray(out.keywords)?out.keywords:[]).map(x=>str_(x,12)).filter(Boolean).slice(0,6);
    if (lines.length < 3) throw new Error('bad lines');
    return json_({ok:true,lines,keywords:keywords.length?keywords:extractKeywords_(worry),care:out.care===true});
  } catch (_) {
    const care = /自殺|想死|不想活|不想再活|輕生|傷害自己|自殘|活不下去|尋短|suicid|kill myself|end my life|self[- ]?harm|want to die/i.test(worry);
    return json_({
      ok:true,
      lines:isEn_(b)
        ? ['A lot must have been piling up lately.','Holding this so close shows how much you care.','You have been trying hard for a long time. I am right here with you.']
        : ['最近一定累積了很多事情吧。','你會把這些放在心上，也代表你真的很在乎。','你已經努力很久了，我先陪你待在這裡。'],
      keywords:extractKeywords_(worry),care,fallback:true
    });
  }
}

function callOpenAI_(systemPrompt,userPrompt,jsonMode) {
  const key = prop_('OPENAI_API_KEY');
  if (!key) throw new Error('OPENAI_API_KEY 尚未設定');
  const payload = {
    model:prop_('OPENAI_MODEL') || 'gpt-4o-mini',
    temperature:0.75,
    max_tokens:700,
    messages:[{role:'system',content:systemPrompt},{role:'user',content:userPrompt}]
  };
  if (jsonMode) payload.response_format = {type:'json_object'};

  const r = UrlFetchApp.fetch(OPENAI_URL,{
    method:'post',
    contentType:'application/json',
    headers:{Authorization:'Bearer ' + key},
    payload:JSON.stringify(payload),
    muteHttpExceptions:true
  });
  const status = r.getResponseCode();
  const text = r.getContentText();
  if (status < 200 || status >= 300) throw new Error('OpenAI ' + status + ': ' + text.slice(0,400));
  const data = JSON.parse(text);
  const out = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!out) throw new Error('OpenAI 沒有回傳文字');
  return out.trim();
}

function buildPlanetPrompt_(key,body) {
  const sign = str_(body.rising || body.zodiac,10);
  const b = body.big5 || {};
  let extra = '';
  if (Number(b.O) >= 4.5) extra += 'extra swirling nebula patterns, ';
  if (Number(b.E) >= 4.5) extra += 'brighter radiant glow, ';
  if (Number(b.C) >= 4.5) extra += 'precise organized structure, ';
  if (Number(b.A) >= 4.5) extra += 'soft welcoming shapes and warm light, ';
  if (Number(b.N) >= 4.5) extra += 'soft drifting storm clouds and emotional aurora, ';
  return (TRAIT_PROMPTS[key] || TRAIT_PROMPTS.BAL) + (ZODIAC[sign] || '') + extra + STYLE;
}

function modelStart_(body) {
  const key = prop_('TRIPO_API_KEY');
  if (!key) return json_({ok:false,error:'TRIPO_API_KEY 尚未設定'});
  const trait = str_(body.trait,12) || 'BAL';
  const prompt = buildPlanetPrompt_(trait,body);
  const task = {type:'text_to_model',prompt,negative_prompt:NEGATIVE,texture:true,pbr:true};
  const v = prop_('TRIPO_MODEL_VERSION');
  if (v) task.model_version = v;

  const r = UrlFetchApp.fetch(TRIPO_BASE + '/task',{
    method:'post',
    contentType:'application/json',
    headers:{Authorization:'Bearer ' + key},
    payload:JSON.stringify(task),
    muteHttpExceptions:true
  });
  const status = r.getResponseCode();
  const text = r.getContentText();
  let data = {};
  try { data = JSON.parse(text); } catch (_) {}
  if (status < 200 || status >= 300 || data.code !== 0 || !data.data || !data.data.task_id) {
    return json_({ok:false,error:'Tripo 建立任務失敗',detail:text.slice(0,600)});
  }
  return json_({ok:true,taskId:data.data.task_id,prompt});
}

function tripoTask_(id) {
  if (!/^[A-Za-z0-9_-]{8,120}$/.test(id)) throw new Error('task id 格式錯誤');
  const key = prop_('TRIPO_API_KEY');
  if (!key) throw new Error('TRIPO_API_KEY 尚未設定');
  const r = UrlFetchApp.fetch(TRIPO_BASE + '/task/' + encodeURIComponent(id),{
    method:'get',
    headers:{Authorization:'Bearer ' + key},
    muteHttpExceptions:true
  });
  const status = r.getResponseCode();
  const text = r.getContentText();
  if (status < 200 || status >= 300) throw new Error('Tripo status ' + status);
  const data = JSON.parse(text);
  if (data.code !== 0 || !data.data) throw new Error('Tripo task 查詢失敗');
  return data.data;
}

function modelStatus_(e) {
  try {
    const id = str_((e.parameter || {}).id,120);
    const t = tripoTask_(id);
    const out = t.output || {};
    return json_({
      ok:true,
      status:t.status || 'unknown',
      progress:Number(t.progress || 0),
      modelUrl:out.pbr_model || out.model || out.base_model || out.model_url || '',
      errorCode:t.error_code || '',
      errorMessage:t.error_message || ''
    });
  } catch (err) {
    return json_({ok:false,status:'failed',error:err.message});
  }
}

function modelGlb_(e) {
  try {
    const id = str_((e.parameter || {}).id,120);
    const t = tripoTask_(id);
    const out = t.output || {};
    return json_({ok:true,status:t.status || 'unknown',modelUrl:out.pbr_model || out.model || out.base_model || out.model_url || ''});
  } catch (err) {
    return json_({ok:false,error:err.message});
  }
}

function saveInnerverse_(data) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    let sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
    ensureHeaders_(sheet);

    const b5 = data.big5 || data.scores || data.personalityScores || {};
    const wx = data.wuxing || data.fiveElements || data.element || {};
    const pet = data.pet || {};
    const planet = data.planet || {};
    const bd = (data.birthday && typeof data.birthday === 'object') ? data.birthday : {};
    const birthday = typeof data.birthday === 'string' ? data.birthday : (bd.raw || [bd.year,bd.month,bd.day].filter(Boolean).join('-'));

    const row = [
      new Date(),
      first_(data.name,data.userName,data.username),
      birthday,first_(data.birthYear,bd.year),first_(data.birthMonth,bd.month),first_(data.birthDay,bd.day),
      first_(data.zodiac,data.zodiacSign,bd.zodiac),
      obj_(b5,['O','o','openness']),obj_(b5,['C','c','conscientiousness']),obj_(b5,['E','e','extraversion']),obj_(b5,['A','a','agreeableness']),obj_(b5,['N','n','neuroticism']),
      first_(data.dominantTrait,data.primaryTrait),arr_(first_(data.personalityKeywords,data.keywords)),first_(data.personalityAnalysis,data.analysis),
      typeof wx === 'string' ? wx : obj_(wx,['name','element','type']),obj_(wx,['sound','tone']),obj_(wx,['emotion','feeling']),obj_(wx,['color']),
      first_(data.petType,obj_(pet,['type','species','animal'])),first_(data.petName,obj_(pet,['name'])),
      first_(data.planetName,obj_(planet,['name'])),first_(data.planetPrompt,obj_(planet,['prompt'])),first_(data.modelUrl,data.modelURL,obj_(planet,['modelUrl','modelURL','url'])),
      first_(data.mood,data.feeling),first_(data.worry,data.worryText),
      JSON.stringify(data),first_(data.hobbies,data.hobby)
    ];

    sheet.appendRow(row);
    return json_({ok:true,message:'INNERVERSE data saved successfully',row:sheet.getLastRow()});
  } catch (err) {
    return json_({ok:false,error:err.message});
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

function ensureHeaders_(sheet) {
  if (sheet.getMaxColumns() < HEADERS.length) sheet.insertColumnsAfter(sheet.getMaxColumns(),HEADERS.length-sheet.getMaxColumns());
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1,1,1,HEADERS.length).setFontWeight('bold').setBackground('#211B46').setFontColor('#FFFFFF');
    return;
  }
  const existing = sheet.getRange(1,1,1,HEADERS.length).getValues()[0];
  HEADERS.forEach((name,i)=>{ if (!existing[i]) sheet.getRange(1,i+1).setValue(name); });
  sheet.setFrozenRows(1);
}

function first_() {
  for (let i=0;i<arguments.length;i++) {
    const v = arguments[i];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}
function obj_(o,keys) {
  if (!o || typeof o !== 'object') return '';
  for (let i=0;i<keys.length;i++) {
    const v = o[keys[i]];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return '';
}
function arr_(v) { return Array.isArray(v) ? v.join('、') : (v || ''); }
function str_(v,n) { if (v === undefined || v === null) return ''; const s=String(v); return n ? s.slice(0,n) : s; }
function num_(v) { const n=Number(v); return Number.isFinite(n) ? n : '-'; }
function extractKeywords_(text) {
  const seg = String(text||'').split(/[，。、！？,.!?\s；;：:「」『』（）()]+/).map(x=>x.trim()).filter(x=>x.length>=2);
  const out=[]; seg.forEach(x=>{ const k=x.slice(0,6); if (!out.includes(k)) out.push(k); });
  return out.length ? out.slice(0,5) : ['煩惱'];
}
function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

/* 測試 */
function testSave() {
  Logger.log(saveInnerverse_({
    action:'saveInnerverse',
    name:'INNERVERSE 測試',
    birthday:{raw:'2003/09/06',year:2003,month:9,day:6,zodiac:'處女座'},
    hobbies:'設計、音樂、互動網站',
    worry:'最近事情很多，有點忙。',
    big5:{O:4.6,C:4.1,E:3.8,A:4.4,N:3.2},
    dominantTrait:'O 開放性',
    personalityKeywords:['好奇','創意','感性'],
    personalityAnalysis:'INNERVERSE 系統測試',
    pet:{type:'Prism 晶塵靈',name:'Prism'},
    planet:{name:'Inner Planet',prompt:'',modelUrl:''}
  }).getContent());
}

function testOpenAI() {
  Logger.log(interpret_({
    name:'測試使用者',
    birthday:{raw:'2003/09/06',year:2003,month:9,day:6,zodiac:'處女座'},
    hobbies:'設計、音樂、互動網站',
    worry:'最近作業有點多',
    big5:{O:4.7,C:4.2,E:3.9,A:4.5,N:3.1},
    trait:{label:'探索型',dimension:'開放性較高'},
    petName:'Prism',
    pet:{species:'Prism 晶塵靈'}
  }).getContent());
}

function testTripoStart() {
  Logger.log(modelStart_({
    trait:'O_hi',
    zodiac:'處女座',
    big5:{O:4.7,C:4.2,E:3.8,A:4.5,N:3.1}
  }).getContent());
}
