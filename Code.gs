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

const SYSTEM_PROMPT = `你是「INNERVERSE PLUS 內在宇宙」的 AI 人格陪伴者，預設用繁體中文（台灣用語）。
你會收到一份「旅人資料」：名字、生日與星座、五行（元素與五音）、興趣、最近的煩惱、Big Five 分數、人格類型、宇宙寵物。
寫法：
- Big Five 是主要依據：說出這個人最明顯的一兩個特質，具體、溫暖地肯定；不要逐項列分數，也不要提「Big Five」「神經質」等術語。
- 星座、五行只當成溫柔的比喻或意象（例如「像木一樣舒展」），不當成科學或命運的判斷。
- 有興趣就自然帶到一個可以照顧自己的小建議；有煩惱就先接住感受，不急著解決。
- 可以提到寵物的名字；寵物沒有嘴巴，只用眼睛與光陪伴。
- 輸出 2～3 小段、約 150～260 個中文字，段落之間空一行。不要 Markdown、不要條列、不要心理診斷、不要預測未來、不要說教。
- 若煩惱涉及自殺、自殘、想死、不想活，改以關心為主並提醒 1925、1995，緊急時 119。`;

// 使用者在網站選擇的語言：中文以外，在 system prompt 後面要求改用該語言回覆
const LANG_NAMES = { en: 'English', ja: 'Japanese', ko: 'Korean', vi: 'Vietnamese' };
function langSuffix_(b) {
  const code = String((b && b.lang) || '').toLowerCase().slice(0, 2), name = LANG_NAMES[code];
  if (!name) return '';
  return '\n\nIMPORTANT: The user chose ' + name + '. Reply entirely in natural, warm ' + name + ' (ignore the Traditional Chinese requirement above). Keep the same structure, similar length and the same safety rules. For crisis support mention local emergency services and, in Taiwan, 1925 / 1995 / 119.';
}
const isEn_ = b => !!langSuffix_(b);

const WORRY_PROMPT = `你是 INNERVERSE PLUS 宇宙寵物背後的陪伴聲音，預設用繁體中文（台灣用語）。
你會收到旅人資料（人格、五行、寵物）與這次說出的煩惱。只回應煩惱本身，人格與五行只用來調整語氣（例如敏感的人更溫柔、外向的人更有活力）。
只輸出 JSON：{"lines":["…","…","…"],"keywords":["…"],"care":false}
- lines 剛好 3 句，每句 12～40 字：第 1 句接住感受、第 2 句肯定使用者、第 3 句陪伴。
- keywords 3～6 個，盡量直接取自使用者原本的詞，每個 2～6 個字。
- 不要說教、不要心理診斷、不要預測未來、不要給一長串建議。
- 若內容涉及自殺、自殘、想死、不想活，care=true。`;

function doGet(e) {
  try {
    const action = (e && e.parameter && e.parameter.action) || '';
    if (action === 'modelStatus') return modelStatus_(e);
    if (action === 'modelGlb') return modelGlb_(e);
    if (action === 'checkName') return checkName_(e);
    if (action === 'universe') return universe_(e);
    if (action === 'visits') return visits_(e);
    return json_({
      ok:true,
      message:'INNERVERSE PLUS API is running',
      actions:['saveInnerverse','interpret','worry','modelStart','modelStatus','modelGlb','checkName','publish','universe','starlight','visits'],
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
    if (action === 'publish') return publish_(body);
    if (action === 'starlight') return starlight_(body);
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

// 把前端送來的資料整理成給 AI 看的「旅人資料」（每個欄位都限制長度）
function profileText_(b) {
  const big5 = b.big5 || {}, pct = b.big5Pct || {}, trait = b.trait || {}, pet = b.pet || {}, bd = b.birthday || {}, wx = b.wuxing || {};
  const b5 = k => num_(big5[k]) + (pct[k] !== undefined && pct[k] !== null ? '（' + num_(pct[k]) + '%）' : '');
  return [
    '【旅人資料】',
    '名字：' + (str_(b.name,20) || '未提供'),
    '介面語言：' + (str_(b.lang,4) || 'zh'),
    '生日：' + (str_(bd.raw,40) || '未提供') + '（解析：' + [bd.year||'-',bd.month||'-',bd.day||'-'].join('-') + '）',
    '星座：' + (str_(bd.zodiac,10) || '未提供'),
    '五行：' + (wx.zh ? str_(wx.zh,2) + '（五音「' + str_(wx.tone,2) + '」，對應情緒「' + str_(wx.emotion,2) + '」）' : '未提供'),
    '興趣：' + (str_(b.hobbies || b.hobby,300) || '未提供'),
    '最近煩惱：' + (str_(b.worry || b.worryText,500) || '未提供'),
    'Big Five（1–5 分）：開放性 ' + b5('O') + '、盡責性 ' + b5('C') + '、外向性 ' + b5('E') + '、親和性 ' + b5('A') + '、情緒敏感度 ' + b5('N'),
    '人格類型：' + (str_(trait.label,40) || str_(b.dominantTrait,40) || '未提供') + (trait.tag ? '（' + str_(trait.tag,40) + '）' : ''),
    '主要維度：' + (str_(trait.dimension,50) || '未提供') + (trait.level ? '，' + str_(trait.level,10) : ''),
    '人格星球：' + (str_(trait.planet,30) || '未提供'),
    '宇宙寵物：' + (str_(b.petName,20) || '未命名') + '（' + [str_(pet.zodiac,6), str_(pet.species,20), str_(pet.title,30)].filter(Boolean).join('・') + '）'
  ].join('\n');
}

function interpret_(b) {
  const user = profileText_(b) + '\n\n請根據以上資料，寫一段給這位旅人的話。';
  return json_({ok:true,reply:callOpenAI_(SYSTEM_PROMPT + langSuffix_(b),user,false)});
}

function worry_(b) {
  const worry = str_(b.worry || b.worryText,500).trim();
  if (!worry) return json_({ok:false,error:'empty worry'});
  try {
    const raw = callOpenAI_(WORRY_PROMPT + langSuffix_(b),
      profileText_(b) + '\n\n【這次說出的煩惱】\n' + worry, true);
    const out = JSON.parse(raw);
    const lines = (Array.isArray(out.lines)?out.lines:[]).map(x=>str_(x,100)).filter(Boolean).slice(0,3);
    const keywords = (Array.isArray(out.keywords)?out.keywords:[]).map(x=>str_(x,12)).filter(Boolean).slice(0,6);
    if (lines.length < 3) throw new Error('bad lines');
    return json_({ok:true,lines,keywords:keywords.length?keywords:extractKeywords_(worry),care:out.care===true});
  } catch (err) {
    console.error('worry_: ' + (err && err.message));
    const care = /自殺|想死|不想活|不想再活|輕生|傷害自己|自殘|活不下去|尋短|suicid|kill myself|end my life|self[- ]?harm|want to die|死にたい|消えたい|自傷|죽고 ?싶|자살|자해|muốn chết|tự tử|tự sát|tự hại/i.test(worry);
    return json_({
      ok:true,
      lines:({
        en:['A lot must have been piling up lately.','Holding this so close shows how much you care.','You have been trying hard for a long time. I am right here with you.'],
        ja:['最近、いろいろなことが積み重なっていたんだね。','それを心にとめているのは、本当に大切に思っているから。','ずっとがんばってきたね。今はそばにいるよ。'],
        ko:['요즘 많은 일이 쌓여 있었겠어요.','그걸 마음에 두는 건 정말 아끼기 때문이에요.','오랫동안 애써 왔어요. 지금은 내가 곁에 있을게요.'],
        vi:['Dạo này chắc hẳn nhiều chuyện đã dồn lại.','Việc bạn để tâm như vậy cho thấy bạn thật sự quan tâm.','Bạn đã cố gắng rất lâu rồi. Giờ mình ở đây với bạn.']
      })[String(b.lang || '').slice(0, 2)] || ['最近一定累積了很多事情吧。','你會把這些放在心上，也代表你真的很在乎。','你已經努力很久了，我先陪你待在這裡。'],
      keywords:extractKeywords_(worry),care,fallback:true,error:String((err && err.message) || err).slice(0,300)
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

// 在編輯器選這個函式按「執行」，看「執行記錄」：成功會出現一段 AI 寫的話
function testOpenAI() {
  Logger.log(interpret_(testTraveler_()).getContent());
}

// 測試寵物「接住煩惱」：成功會出現 3 句話與關鍵字
function testWorry() {
  Logger.log(worry_(Object.assign(testTraveler_(), {task:'worry'})).getContent());
}

// 測試多人宇宙：寫入一顆測試星球，再讀出整個宇宙
function testUniverse() {
  Logger.log(publish_({uid:'test-uid', name:'INNERVERSE 測試', planetName:'奇想星', typeKey:'O_hi', petIdx:5, petSign:'VIRGO', petName:'Prism', element:'water', big5:{O:4.6,C:3.4,E:3,A:4.2,N:3.1}, weather:'sunny', lang:'zh'}).getContent());
  Logger.log(universe_({parameter:{}}).getContent());
}

function testTraveler_() {
  return {
    lang:'zh', name:'測試使用者',
    birthday:{raw:'2003/09/06',year:2003,month:9,day:6,zodiac:'處女座'},
    hobbies:'設計、音樂、互動網站',
    worry:'最近作業有點多，怕做不完',
    big5:{O:4.7,C:4.2,E:3.9,A:4.5,N:3.1}, big5Pct:{O:93,C:80,E:73,A:88,N:53},
    trait:{key:'O_hi',label:'好奇開放型',tag:'愛探索與想像的人',dimension:'Openness 開放性',level:'偏高',planet:'奇想星'},
    pet:{sign:'VIRGO',zodiac:'處女座',species:'Prism',title:'晶塵靈'}, petName:'Prism',
    wuxing:{element:'water',zh:'水',tone:'羽',emotion:'恐',color:'黑'}
  };
}

function testTripoStart() {
  Logger.log(modelStart_({
    trait:'O_hi',
    zodiac:'處女座',
    big5:{O:4.7,C:4.2,E:3.8,A:4.5,N:3.1}
  }).getContent());
}


/* ================================================================
 * OUR UNIVERSE：多人星球宇宙
 * 只保存「公開」資料：名字、星球、寵物、五行、人格分數、抽象的星球天氣。
 * 煩惱原文、生日、興趣都不會寫進這兩張表，也不會回傳給其他人。
 *
 * UNIVERSE  ：每位旅人一列（uid 只存在後端，公開時只給 pid）
 * STARLIGHT ：別人留下的星光
 * ================================================================ */
const UNIVERSE_SHEET = 'UNIVERSE';
const STARLIGHT_SHEET = 'STARLIGHT';
const UNIVERSE_HEADERS = ['uid','pid','name','nameKey','planetName','typeKey','petIdx','petSign','petName','element','O','C','E','A','N','weather','lang','createdAt','updatedAt'];
const STARLIGHT_HEADERS = ['time','toPid','kind','fromPid'];
const WEATHERS = ['sunny','rain','fog','rainbow','night'];
const ELEMENTS = ['earth','metal','wood','fire','water'];
const GIFT_KINDS = ['star','leaf','drop','light','heart'];

function sheet_(name, headers) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.appendRow(headers); sh.setFrozenRows(1); }
  return sh;
}
function rows_(sh) {
  const last = sh.getLastRow();
  if (last < 2) return [];
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return sh.getRange(2, 1, last - 1, head.length).getValues().map((r, i) => {
    const o = { _row: i + 2 }; head.forEach((h, k) => { o[h] = r[k]; }); return o;
  });
}
// 名字比對：忽略大小寫與前後空白
function nameKey_(n) { return String(n || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
function cleanName_(n) { return String(n || '').trim().replace(/\s+/g, ' ').slice(0, 20); }

function checkName_(e) {
  const p = e.parameter || {}, key = nameKey_(p.name), uid = str_(p.uid, 60);
  if (!key) return json_({ok:true, available:false});
  const hit = rows_(sheet_(UNIVERSE_SHEET, UNIVERSE_HEADERS)).find(r => r.nameKey === key);
  return json_({ok:true, available: !hit || hit.uid === uid});
}

function publish_(b) {
  const uid = str_(b.uid, 60), name = cleanName_(b.name);
  if (!uid || !name) return json_({ok:false, error:'missing uid or name'});
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = sheet_(UNIVERSE_SHEET, UNIVERSE_HEADERS), all = rows_(sh), key = nameKey_(name);
    const taken = all.find(r => r.nameKey === key && r.uid !== uid);
    if (taken) return json_({ok:false, error:'name_taken'});
    const big5 = b.big5 || {}, now = new Date();
    const mine = all.find(r => r.uid === uid);
    const pid = mine ? mine.pid : Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    const row = [
      uid, pid, name, key, str_(b.planetName, 30), str_(b.typeKey, 8) || 'BAL', Number(b.petIdx) || 0, str_(b.petSign, 12), str_(b.petName, 20),
      ELEMENTS.indexOf(b.element) >= 0 ? b.element : 'wood',
      num_(big5.O), num_(big5.C), num_(big5.E), num_(big5.A), num_(big5.N),
      WEATHERS.indexOf(b.weather) >= 0 ? b.weather : 'sunny', str_(b.lang, 4), mine ? mine.createdAt : now, now
    ];
    if (mine) sh.getRange(mine._row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
    return json_({ok:true, pid});
  } finally { lock.releaseLock(); }
}

function universe_(e) {
  const lights = {};
  rows_(sheet_(STARLIGHT_SHEET, STARLIGHT_HEADERS)).forEach(r => { lights[r.toPid] = (lights[r.toPid] || 0) + 1; });
  const planets = rows_(sheet_(UNIVERSE_SHEET, UNIVERSE_HEADERS))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 600)
    .map(r => ({
      pid: r.pid, name: r.name, planetName: r.planetName, typeKey: r.typeKey, petIdx: Number(r.petIdx) || 0, petSign: r.petSign, petName: r.petName,
      element: r.element, weather: r.weather, lights: lights[r.pid] || 0,
      big5: { O: Number(r.O) || 3, C: Number(r.C) || 3, E: Number(r.E) || 3, A: Number(r.A) || 3, N: Number(r.N) || 3 }
    }));
  return json_({ok:true, planets});
}

function starlight_(b) {
  const to = str_(b.to, 20), kind = GIFT_KINDS.indexOf(b.kind) >= 0 ? b.kind : 'star';
  if (!to) return json_({ok:false, error:'missing target'});
  sheet_(STARLIGHT_SHEET, STARLIGHT_HEADERS).appendRow([new Date(), to, kind, str_(b.from, 20)]);
  return json_({ok:true});
}

// 「昨晚，有 3 位旅人經過你的星球」：since 之後收到的星光
function visits_(e) {
  const p = e.parameter || {}, uid = str_(p.uid, 60), since = Number(p.since) || 0;
  const me = rows_(sheet_(UNIVERSE_SHEET, UNIVERSE_HEADERS)).find(r => r.uid === uid);
  if (!me) return json_({ok:true, count:0, travelers:0, kinds:{}});
  const got = rows_(sheet_(STARLIGHT_SHEET, STARLIGHT_HEADERS)).filter(r => r.toPid === me.pid && new Date(r.time).getTime() > since);
  const kinds = {}, from = {};
  got.forEach(r => { kinds[r.kind] = (kinds[r.kind] || 0) + 1; from[r.fromPid || ('anon' + r._row)] = 1; });
  return json_({ok:true, count: got.length, travelers: Object.keys(from).length, kinds});
}
