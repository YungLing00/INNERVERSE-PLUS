/**
 * INNERVERSE PLUS - Google Apps Script backend
 * GitHub 備份版。真正執行時請把這份貼到 Google Apps Script 的 Code.gs。
 *
 * Script Properties:
 *   OPENAI_API_KEY (必填)
 *   TRIPO_API_KEY  (必填)
 *   OPENAI_MODEL   (選填，預設 gpt-4o-mini)
 *   TRIPO_MODEL_VERSION (選填)
 *   TRIPO_TEXTURE_QUALITY (選填，預設 detailed＝高清貼圖；填 standard 生成較快、較省額度)
 *   TRIPO_CACHE (選填，預設開啟：相同描述的星球共用同一個任務，秒出；填 off 則每次都重新生成)
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

// ================================================================
// Tripo 星球生成指令：夢幻、細緻、像動畫電影裡的童話星球一樣華麗
// 組成：人格主題（TRAIT）＋星座元素點綴（ZODIAC）＋五行光彩（WUXING）＋高分特質加料＋共同風格（STYLE）
// ================================================================
const STYLE = 'a single enchanted miniature planet floating alone, centered, round silhouette, lavish fairytale animated-film style, '
  + 'magical storybook aesthetic, opulent ornate details, delicate gold filigree accents, tiny sparkling crystals and glowing gems, '
  + 'soft iridescent pearlescent surface, luminous rim light, dreamy pastel glow, gentle bloom, whimsical and elegant, '
  + 'highly detailed hand-painted stylized textures, smooth clean sculpted shapes, premium collectible figurine quality, '
  + 'no text, no face, no characters, no base, no stand, isolated game asset';
// Tripo 的 negative_prompt 最多 255 個字元，超過整個任務會被拒絕（之前星球生不出來的原因）
const NEGATIVE = 'text, logo, watermark, face, eyes, person, character, animal, multiple objects, base, stand, pedestal, '
  + 'ground plane, background scene, gloomy, horror, dirty, rusty, noisy texture, low poly, blurry, flat shading, broken mesh';
const TRIPO_PROMPT_MAX = 1000, TRIPO_NEG_MAX = 255;

const TRAIT_PROMPTS = {
  E_hi:'a radiant golden sun-kissed planet wrapped in shimmering ribbons of light, swirling amber and honey cloud bands, a sparkling halo ring of tiny stars, little floating lanterns orbiting like fireflies, ',
  E_lo:'a serene moonlit planet of pale silver-blue ice and frosted crystal spires, softly glowing snow-dust, one tiny companion moon on a delicate silver orbit, a hush of starlight, ',
  A_hi:'a tender rose-pink blossom planet covered in pastel petal clouds and blooming flower meadows, a glowing heart-shaped lagoon, garlands of tiny pearls and ribbon-like auroras, ',
  A_lo:'a bold coral and molten-amber crystal planet with elegant faceted ridges, glowing lava-gold veins like jewelry, sharp gem clusters and a proud flaring ring of embers, ',
  C_hi:'an exquisitely ordered cyan and pearl planet with perfectly concentric jeweled rings, symmetrical star-map engravings, tiny clockwork orbit arcs and glowing constellation lines, ',
  C_lo:'a playful mint and lime dream planet with free-flowing candy-swirl cloud streams, bubbly floating islands, a mischievous little comet moon trailing glitter, ',
  N_hi:'a misty periwinkle planet veiled in soft lavender atmosphere, gentle swirling storm spirals like brushstrokes, shimmering violet aurora curtains, tiny raindrop crystals catching the light, ',
  N_lo:'a calm aqua ocean planet, glassy and luminous, with pearly mist, soft reflections, gentle wave patterns and a serene halo of floating bubbles, ',
  O_hi:'an orchid and rose nebula planet swirling with cosmic watercolor clouds, a grand tilted crystal ring, tiny floating islands, a miniature starship moon and scattered wish-stars, ',
  O_lo:'a warm peach and gold storybook planet with cozy glowing continents, rolling candy-colored hills, soft lantern lights and a gentle golden ring, ',
  BAL:'a harmonious rainbow-pastel planet with five softly glowing color bands in perfect balance, a delicate double ring of crystal and gold, gentle sparkles weaving between them, '
};

const ZODIAC = {
  '牡羊座':'tiny ember sparks and flickering phoenix-feather flames, ','獅子座':'a regal golden sun-crown halo and glowing ember jewels, ','射手座':'shooting-star arrows of light streaking around it, ',
  '金牛座':'lush mossy gardens, tiny blooming flowers and smooth river stones, ','處女座':'delicate wheat-gold vines and crystal dewdrops, ','摩羯座':'majestic crystal mountain peaks dusted with starlight, ',
  '雙子座':'twin swirling wind ribbons and floating sparkle dust, ','天秤座':'graceful balanced rings and drifting feather-light clouds, ','水瓶座':'flowing streams of stardust water pouring around it, ',
  '巨蟹座':'moonlit tide pools, pearls and tiny shimmering bubbles, ','天蠍座':'deep jewel-toned waters with glowing bioluminescent swirls, ','雙魚座':'dreamy ocean mist, sea-glass and two softly glowing currents circling, '
};

// 五行：給星球一層對應的光彩（前端有傳五行時才加）
const WUXING_PROMPTS = {
  wood:'touches of jade-green leaves and growing crystal sprouts, ',
  fire:'warm rose-gold flame light and glowing embers, ',
  earth:'honey-gold sand ripples and smooth amber stone, ',
  metal:'polished silver and white-gold engraved ornaments, ',
  water:'deep sapphire ripples and flowing silver waves, '
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
    if (action === 'modelBin') return modelBin_(e);
    if (action === 'tripoCheck') return tripoCheck_(e);
    if (action === 'inbox') return inbox_(e);
    if (action === 'event') return event_(e);
    return json_({
      ok:true,
      message:'INNERVERSE PLUS API is running',
      actions:['saveInnerverse','interpret','worry','modelStart','modelStatus','modelGlb','modelBin','tripoCheck','checkName','publish','universe','starlight','visits','lookup','invite','inbox','respond','friendAct','note','ack','event','eventGive'],
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
    if (action === 'lookup') return lookup_(body);
    if (action === 'invite') return invite_(body);
    if (action === 'respond') return respond_(body);
    if (action === 'friendAct') return friendAct_(body);
    if (action === 'note') return note_(body);
    if (action === 'ack') return ack_(body);
    if (action === 'eventGive') return eventGive_(body);
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
  const wx = String((body.wuxing && (body.wuxing.element || body.wuxing)) || body.element || '').toLowerCase();
  let extra = '';
  if (Number(b.O) >= 4.2) extra += 'extra swirling nebula patterns and floating dream islands, ';
  if (Number(b.E) >= 4.2) extra += 'brighter radiant glow and a sparkling corona, ';
  if (Number(b.C) >= 4.2) extra += 'precise symmetrical ornament engravings, ';
  if (Number(b.A) >= 4.2) extra += 'soft welcoming rounded shapes and warm heartlight, ';
  if (Number(b.N) >= 4.2) extra += 'gentle drifting aurora and soft protective mist, ';
  const trait = TRAIT_PROMPTS[key] || TRAIT_PROMPTS.BAL;
  // Tripo 的指令有長度上限：人格主題與共同風格一定保留，超出時只修剪後面的點綴
  let deco = (ZODIAC[sign] || '') + (WUXING_PROMPTS[wx] || '') + extra;
  const room = 1000 - trait.length - STYLE.length;
  if (deco.length > room) { deco = deco.slice(0, Math.max(0, room)); deco = deco.slice(0, deco.lastIndexOf(', ') + 2); }
  return trait + deco + STYLE;
}

function modelStart_(body) {
  const key = prop_('TRIPO_API_KEY');
  if (!key) return json_({ok:false,error:'TRIPO_API_KEY 尚未設定'});
  const trait = str_(body.trait,12) || 'BAL';
  const prompt = buildPlanetPrompt_(trait,body);
  const tq0 = prop_('TRIPO_TEXTURE_QUALITY') || 'detailed';
  // ⚡ 加速：一模一樣的星球描述以前生成過（或正在生成）→ 直接共用同一個 Tripo 任務，不用重等、也不多花額度
  const cacheOn = prop_('TRIPO_CACHE') !== 'off';
  const hash = promptHash_(prompt + '|' + tq0 + '|' + (prop_('TRIPO_MODEL_VERSION') || ''));
  if (cacheOn) {
    const csh = sheet_(MODEL_CACHE_SHEET, MODEL_CACHE_HEADERS), hit = rows_(csh).filter(r => r.hash === hash).pop();
    if (hit) {
      try {
        const t = tripoTask_(String(hit.taskId));
        if (['success', 'queued', 'running'].indexOf(t.status) >= 0) {
          csh.getRange(hit._row, 5).setValue((Number(hit.hits) || 0) + 1);
          return json_({ok:true, taskId:String(hit.taskId), prompt, cached:true, status:t.status});
        }
      } catch (_) { /* 舊任務查不到就重新生成 */ }
    }
  }
  const neg = NEGATIVE.length > TRIPO_NEG_MAX ? NEGATIVE.slice(0, NEGATIVE.lastIndexOf(', ', TRIPO_NEG_MAX)) : NEGATIVE;
  const task = {type:'text_to_model',prompt:prompt.slice(0, TRIPO_PROMPT_MAX),negative_prompt:neg,texture:true,pbr:true};
  const v = prop_('TRIPO_MODEL_VERSION');
  if (v) task.model_version = v;
  // 高清：預設用 Tripo 的「detailed」貼圖品質，不限制面數
  if (tq0 !== 'standard') task.texture_quality = tq0;   // 想更快：指令碼屬性 TRIPO_TEXTURE_QUALITY 填 standard

  const send = t => UrlFetchApp.fetch(TRIPO_BASE + '/task',{
    method:'post',
    contentType:'application/json',
    headers:{Authorization:'Bearer ' + key},
    payload:JSON.stringify(t),
    muteHttpExceptions:true
  });
  let status = 0, text = '', data = {};
  const tryOnce = t => { const r = send(t); status = r.getResponseCode(); text = r.getContentText(); data = {}; try { data = JSON.parse(text); } catch (_) {} return status >= 200 && status < 300 && data.code === 0; };
  // 送不成功時一步一步退回比較保守的設定，至少讓星球生得出來：
  // ① 完整設定 → ② 拿掉高清貼圖參數 → ③ 再拿掉 negative_prompt 和 PBR
  // 額度不足（HTTP 403 / code 2010）或金鑰錯誤（401）就不用重試了
  const fatal = () => status === 401 || status === 403 || data.code === 2010 || data.code === 1002;
  if (!tryOnce(task) && !fatal() && task.texture_quality) { delete task.texture_quality; tryOnce(task); }
  if ((status < 200 || status >= 300 || data.code !== 0) && !fatal()) { delete task.negative_prompt; delete task.pbr; tryOnce(task); }
  if (status < 200 || status >= 300 || data.code !== 0 || !data.data || !data.data.task_id) {
    return json_({ok:false,error:'Tripo 建立任務失敗（HTTP ' + status + '）：' + ((data && data.message) || text.slice(0,300)),detail:text.slice(0,600)});
  }
  if (cacheOn) sheet_(MODEL_CACHE_SHEET, MODEL_CACHE_HEADERS).appendRow([hash, data.data.task_id, prompt.slice(0, 500), new Date(), 0]);
  return json_({ok:true,taskId:data.data.task_id,prompt});
}
const MODEL_CACHE_SHEET = 'MODEL_CACHE', MODEL_CACHE_HEADERS = ['hash','taskId','prompt','createdAt','hits'];
function promptHash_(p) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, p, Utilities.Charset.UTF_8).map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
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

// 有些瀏覽器不能直接讀 Tripo 的模型網址（跨網域），改由後端代抓，以 base64 傳回
function modelBin_(e) {
  try {
    const id = str_((e.parameter || {}).id,120);
    const t = tripoTask_(id), out = t.output || {};
    const url = out.pbr_model || out.model || out.base_model || out.model_url || '';
    if (!url) return json_({ok:false,error:'模型還沒完成（' + (t.status || 'unknown') + '）'});
    const r = UrlFetchApp.fetch(url,{muteHttpExceptions:true});
    if (r.getResponseCode() !== 200) return json_({ok:false,error:'下載模型失敗 HTTP ' + r.getResponseCode()});
    const bytes = r.getContent();
    if (bytes.length > 30 * 1024 * 1024) return json_({ok:false,error:'模型太大（' + Math.round(bytes.length / 1048576) + 'MB），瀏覽器會改用直接下載'});
    return json_({ok:true,size:bytes.length,b64:Utilities.base64Encode(bytes)});
  } catch (err) {
    return json_({ok:false,error:err.message});
  }
}

// 診斷用：確認 Tripo 金鑰可用、還剩多少額度（不會花額度）
function tripoCheck_(e) {
  const key = prop_('TRIPO_API_KEY');
  if (!key) return json_({ok:false,error:'TRIPO_API_KEY 尚未設定'});
  const r = UrlFetchApp.fetch(TRIPO_BASE + '/user/balance',{method:'get',headers:{Authorization:'Bearer ' + key},muteHttpExceptions:true});
  const text = r.getContentText();
  let data = {};
  try { data = JSON.parse(text); } catch (_) {}
  if (r.getResponseCode() !== 200 || data.code !== 0) return json_({ok:false,error:'Tripo 金鑰檢查失敗（HTTP ' + r.getResponseCode() + '）：' + ((data && data.message) || text.slice(0,200))});
  return json_({ok:true,balance:(data.data || {}).balance,frozen:(data.data || {}).frozen});
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
    // 同時更新「旅人總表」：同一個人（名字＋生日）只會有一列
    try { upsertTraveler_(data, birthday); } catch (e) { console.error('upsertTraveler_: ' + e.message); }
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
const UNIVERSE_HEADERS = ['uid','pid','name','nameKey','planetName','typeKey','petIdx','petSign','petName','element','O','C','E','A','N','weather','lang','createdAt','updatedAt','modelTask','img'];
const STARLIGHT_HEADERS = ['time','toPid','kind','fromPid'];
const WEATHERS = ['sunny','rain','fog','rainbow','night'];
const ELEMENTS = ['earth','metal','wood','fire','water'];
const GIFT_KINDS = ['star','leaf','drop','light','heart'];

function sheet_(name, headers) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) { sh.appendRow(headers); sh.setFrozenRows(1); }
  else {
    // 舊表格缺少新欄位時，自動補在最右邊
    const lastCol = sh.getLastColumn(), head = sh.getRange(1, 1, 1, lastCol).getValues()[0];
    const miss = headers.filter(h => head.indexOf(h) < 0);
    if (miss.length) sh.getRange(1, lastCol + 1, 1, miss.length).setValues([miss]);
  }
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
    // 生成的 3D 星球：Tripo 任務 id ＋ 一張小縮圖（data URL，限制大小以免超過儲存格上限）
    const task = /^[A-Za-z0-9_-]{8,120}$/.test(String(b.modelTask || '')) ? String(b.modelTask) : (mine ? mine.modelTask : '');
    const img = /^data:image\/(webp|png|jpeg);base64,[A-Za-z0-9+\/=]+$/.test(String(b.img || '')) && String(b.img).length <= 45000 ? String(b.img) : (mine ? mine.img : '');
    const val = {
      uid, pid, name, nameKey:key, planetName:str_(b.planetName, 30), typeKey:str_(b.typeKey, 8) || 'BAL', petIdx:Number(b.petIdx) || 0, petSign:str_(b.petSign, 12), petName:str_(b.petName, 20),
      element:ELEMENTS.indexOf(b.element) >= 0 ? b.element : 'wood',
      O:num_(big5.O), C:num_(big5.C), E:num_(big5.E), A:num_(big5.A), N:num_(big5.N),
      weather:WEATHERS.indexOf(b.weather) >= 0 ? b.weather : 'sunny', lang:str_(b.lang, 4), createdAt:mine ? mine.createdAt : now, updatedAt:now,
      modelTask:task || '', img:img || ''
    };
    const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const row = head.map(h => val[h] !== undefined ? val[h] : (mine && mine[h] !== undefined ? mine[h] : ''));
    if (mine) sh.getRange(mine._row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
    return json_({ok:true, pid});
  } finally { lock.releaseLock(); }
}

function universe_(e) {
  const lights = {};
  rows_(sheet_(STARLIGHT_SHEET, STARLIGHT_HEADERS)).forEach(r => { lights[r.toPid] = (lights[r.toPid] || 0) + 1; });
  let imgs = 0;
  const planets = rows_(sheet_(UNIVERSE_SHEET, UNIVERSE_HEADERS))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 600)
    .map(r => ({
      model: r.modelTask || '', img: r.img && imgs++ < 80 ? r.img : '',   // 縮圖只給最近 80 顆，避免一次下載太多
      pid: r.pid, name: r.name, planetName: r.planetName, typeKey: r.typeKey, petIdx: Number(r.petIdx) || 0, petSign: r.petSign, petName: r.petName,
      element: r.element, weather: r.weather, lights: lights[r.pid] || 0,
      big5: { O: Number(r.O) || 3, C: Number(r.C) || 3, E: Number(r.E) || 3, A: Number(r.A) || 3, N: Number(r.N) || 3 }
    }));
  const friends = rows_(sheet_(FRIEND_SHEET, FRIEND_HEADERS)).slice(-3000).map(f => [f.pidA, f.pidB, Number(f.level) || 1]);
  return json_({ok:true, planets, friends});
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


/* ================================================================
 * 旅人總表：每個人一列，方便搜尋
 *  - INNERVERSE_DATA：每一次測驗的完整紀錄（歷史）
 *  - 旅人總表        ：同一個人（名字＋生日）只保留最新一列，並記錄測驗次數
 *  - 🔍 搜尋         ：在 B1 輸入名字／生日／星座／人格，下面就會列出符合的旅人
 * 第一次使用：在 Apps Script 編輯器選擇 setupDatabase 執行一次（會把舊資料整理進總表）
 * ================================================================ */
const TRAVELER_SHEET = '旅人總表';
const SEARCH_SHEET = '🔍 搜尋';
const TRAVELER_COLS = [
  ['uid','旅人編號'],['name','名字'],['birthday','生日'],['zodiac','星座'],['element','五行'],
  ['O','O 開放性'],['C','C 盡責性'],['E','E 外向性'],['A','A 親和性'],['N','N 情緒敏感度'],
  ['trait','人格類型'],['planet','人格星球'],['pet','宇宙寵物'],['petName','寵物名字'],
  ['hobbies','興趣愛好'],['worry','最近的煩惱'],['lang','語言'],['count','測驗次數'],
  ['firstAt','第一次來訪'],['updatedAt','最後更新'],['key','搜尋鍵'],['restore','還原資料（程式用）']
];

function travelerKey_(name, y, m, d) {
  const n = nameKey_(name);
  if (!n || !m || !d) return '';
  const p = v => ('0' + Number(v)).slice(-2);
  return n + '|' + (y ? Number(y) : '') + '-' + p(m) + '-' + p(d);
}

function travelerSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(TRAVELER_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TRAVELER_SHEET, 0);
    sh.getRange(1, 1, 1, TRAVELER_COLS.length).setValues([TRAVELER_COLS.map(c => c[1])])
      .setFontWeight('bold').setBackground('#211B46').setFontColor('#FFFFFF');
    sh.setFrozenRows(1); sh.setFrozenColumns(2);
    sh.setColumnWidth(2, 120); sh.setColumnWidth(16, 260); sh.setColumnWidth(22, 60);
    sh.hideColumns(21, 2);   // 搜尋鍵、還原資料：程式用，平常不用看
  }
  return sh;
}

function travelerRows_() {
  const sh = travelerSheet_(), last = sh.getLastRow();
  if (last < 2) return { sh, rows: [] };
  const vals = sh.getRange(2, 1, last - 1, TRAVELER_COLS.length).getValues();
  return { sh, rows: vals.map((r, i) => { const o = { _row: i + 2 }; TRAVELER_COLS.forEach((c, k) => { o[c[0]] = r[k]; }); return o; }) };
}

function upsertTraveler_(data, birthdayText) {
  const bd = (data.birthday && typeof data.birthday === 'object') ? data.birthday : {};
  const y = first_(data.birthYear, bd.year), m = first_(data.birthMonth, bd.month), d = first_(data.birthDay, bd.day);
  const name = cleanName_(first_(data.name, data.userName));
  const key = travelerKey_(name, y, m, d);
  if (!key) return;
  const b5 = data.big5 || {}, wx = data.wuxing || {}, pet = data.pet || {}, planet = data.planet || {};
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const t = travelerRows_(), mine = t.rows.find(r => r.key === key), now = new Date();
    const restore = {
      year: Number(y) || '', month: Number(m), day: Number(d), zodiac: str_(first_(data.zodiac, bd.zodiac), 10),
      big5: { O: Number(b5.O), C: Number(b5.C), E: Number(b5.E), A: Number(b5.A), N: Number(b5.N) },
      typeKey: str_(data.typeKey, 8), petIdx: data.petIdx === undefined || data.petIdx === '' ? '' : Number(data.petIdx), petName: str_(obj_(pet, ['name']), 20), lang: str_(data.lang, 4)
    };
    const val = {
      uid: str_(data.uid, 60) || (mine ? mine.uid : ''), name, birthday: birthdayText || [y, m, d].filter(Boolean).join('-'),
      zodiac: restore.zodiac, element: typeof wx === 'string' ? wx : obj_(wx, ['name', 'element']),
      O: num_(b5.O), C: num_(b5.C), E: num_(b5.E), A: num_(b5.A), N: num_(b5.N),
      trait: str_(data.dominantTrait, 40), planet: str_(obj_(planet, ['name']), 30), pet: str_(obj_(pet, ['type']), 30), petName: restore.petName,
      hobbies: str_(first_(data.hobbies, data.hobby), 300), worry: str_(first_(data.worry, data.worryText), 500), lang: restore.lang,
      count: (mine ? Number(mine.count) || 1 : 0) + 1, firstAt: mine ? mine.firstAt : now, updatedAt: now, key, restore: JSON.stringify(restore)
    };
    const row = TRAVELER_COLS.map(c => val[c[0]]);
    if (mine) t.sh.getRange(mine._row, 1, 1, row.length).setValues([row]); else t.sh.appendRow(row);
  } finally { lock.releaseLock(); }
}

// 前端：輸入名字＋生日後查詢「宇宙裡有沒有這個人」。只回傳還原需要的資料（不回傳煩惱、興趣）
function lookup_(b) {
  const bd = b.birthday || {};
  const key = travelerKey_(b.name, bd.year, bd.month, bd.day);
  if (!key) return json_({ok:true, found:false});
  let hit = travelerRows_().rows.filter(r => r.key === key).pop();
  // 旅人總表還沒有：到原始測驗紀錄（INNERVERSE_DATA）找，找到就順便整理進總表
  if (!hit) hit = legacyTraveler_(b.name, bd, key);
  if (!hit) return json_({ok:true, found:false, nameTaken: isNameTaken_(b.name, str_(b.uid, 60))});
  // 名字＋生日都對得上＝本人：沒有記錄旅人編號的話，認領宇宙裡同名的那顆星球
  if (!hit.uid) {
    const u = rows_(sheet_(UNIVERSE_SHEET, UNIVERSE_HEADERS)).find(r => r.nameKey === nameKey_(b.name));
    if (u) { hit.uid = u.uid; travelerSheet_().getRange(hit._row, 1).setValue(u.uid); }
  }
  let restore = {};
  try { restore = JSON.parse(hit.restore || '{}'); } catch (_) {}
  const uni = hit.uid ? rows_(sheet_(UNIVERSE_SHEET, UNIVERSE_HEADERS)).find(r => r.uid === hit.uid) : null;
  return json_({
    ok:true, found:true,
    profile: Object.assign({}, restore, {
      uid: hit.uid, name: hit.name, count: Number(hit.count) || 1, updatedAt: hit.updatedAt,
      planetName: hit.planet, petName: (uni && uni.petName) || restore.petName || '',
      petIdx: uni && uni.petIdx !== '' ? Number(uni.petIdx) : restore.petIdx, typeKey: (uni && uni.typeKey) || restore.typeKey || '',
      modelTask: (uni && uni.modelTask) || '', weather: (uni && uni.weather) || '', pid: (uni && uni.pid) || ''
    })
  });
}
function legacyTraveler_(name, bd, key) {
  const log = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!log || log.getLastRow() < 2) return null;
  const vals = log.getRange(2, 1, log.getLastRow() - 1, Math.max(HEADERS.length, log.getLastColumn())).getValues();
  const jsonCol = HEADERS.indexOf('原始資料JSON'), nk = nameKey_(name);
  for (let i = vals.length - 1; i >= 0; i--) {
    const r = vals[i];
    if (nameKey_(r[1]) !== nk || Number(r[4]) !== Number(bd.month) || Number(r[5]) !== Number(bd.day)) continue;
    if (bd.year && r[3] && Number(r[3]) !== Number(bd.year)) continue;
    let d = {}; try { d = JSON.parse(r[jsonCol] || '{}'); } catch (_) {}
    if (!d.name) d.name = r[1];
    d.birthYear = d.birthYear || r[3] || bd.year; d.birthMonth = d.birthMonth || r[4]; d.birthDay = d.birthDay || r[5];
    try { upsertTraveler_(d, String(r[2] || '')); } catch (e) { console.warn('legacy upsert: ' + e.message); }
    // 舊紀錄的年份可能不同（例如當時沒填年份），用實際寫入的 key 再找一次
    const rows = travelerRows_().rows;
    return rows.filter(x => x.key === key).pop() || rows.filter(x => x.key === travelerKey_(d.name, d.birthYear, d.birthMonth, d.birthDay)).pop() || null;
  }
  return null;
}
function isNameTaken_(name, uid) {
  const key = nameKey_(name);
  return !!rows_(sheet_(UNIVERSE_SHEET, UNIVERSE_HEADERS)).find(r => r.nameKey === key && r.uid !== uid);
}

/** 在 Apps Script 編輯器執行一次：建立「旅人總表」「🔍 搜尋」，並把舊紀錄整理進總表 */
function setupDatabase() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const t = travelerSheet_();
  // 1) 舊紀錄 → 旅人總表（同一人只留最新一列，次數累加）
  const log = ss.getSheetByName(SHEET_NAME);
  if (log && log.getLastRow() > 1 && t.getLastRow() < 2) {
    const vals = log.getRange(2, 1, log.getLastRow() - 1, log.getLastColumn()).getValues();
    const jsonCol = HEADERS.indexOf('原始資料JSON');
    vals.forEach(r => {
      let d = {};
      try { d = JSON.parse(r[jsonCol] || '{}'); } catch (_) {}
      if (!d.name) d.name = r[1];
      if (!d.birthYear && !(d.birthday && d.birthday.year)) { d.birthYear = r[3]; d.birthMonth = r[4]; d.birthDay = r[5]; }
      try { upsertTraveler_(d, String(r[2] || '')); } catch (e) { console.warn(e.message); }
    });
  }
  // 2) 搜尋頁
  let s = ss.getSheetByName(SEARCH_SHEET);
  if (!s) s = ss.insertSheet(SEARCH_SHEET, 0);
  s.clear();
  s.getRange('A1').setValue('輸入名字、生日、星座或人格：').setFontWeight('bold');
  s.getRange('B1').setBackground('#FFF4C2').setBorder(true, true, true, true, false, false);
  s.getRange('C1').setValue('← 在這格輸入，下面會自動列出符合的旅人（不分大小寫，可只打一部分）').setFontColor('#888888');
  const n = TRAVELER_COLS.length - 2;   // 不顯示搜尋鍵、還原資料
  s.getRange(3, 1, 1, n).setValues([TRAVELER_COLS.slice(0, n).map(c => c[1])]).setFontWeight('bold').setBackground('#211B46').setFontColor('#FFFFFF');
  const last = String.fromCharCode(64 + n), q = "'" + TRAVELER_SHEET + "'!";
  s.getRange('A4').setFormula('=IF(LEN($B$1)=0,"（在 B1 輸入要找的人）",IFERROR(FILTER(' + q + 'A2:' + last + ',ISNUMBER(SEARCH($B$1,' + q + 'B2:B&" "&' + q + 'C2:C&" "&' + q + 'D2:D&" "&' + q + 'K2:K&" "&' + q + 'L2:L&" "&' + q + 'A2:A))),"找不到符合的旅人"))');
  s.setFrozenRows(3); s.setColumnWidth(1, 200); s.setColumnWidth(2, 160);
  ss.setActiveSheet(s);
  return '完成：' + (t.getLastRow() - 1) + ' 位旅人';
}


/* ================================================================
 * 💫 Dance Invitation｜共舞邀請 —— INNERVERSE 的交朋友方式
 * In INNERVERSE, friendship begins with a dance.
 * 在 INNERVERSE，每一段友情，都從一支舞開始。
 *
 * INVITES ：共舞邀請（pending → accepted / mutual / later）。對方不在線也能收到，下次登入時處理
 * FRIENDS ：友情（每一對只有一列）。一起跳舞、看流星、旅行會讓關係往前走
 * NOTES   ：留在別人星球上的一句話（只有星球主人看得到）
 * 身分一律用 uid（只存在後端與本人裝置）換成公開的 pid，不會把 uid 回傳給別人
 * ================================================================ */
const INVITE_SHEET = 'INVITES', INVITE_HEADERS = ['id','fromPid','toPid','status','createdAt','decidedAt','notifiedFrom'];
const FRIEND_SHEET = 'FRIENDS', FRIEND_HEADERS = ['key','pidA','pidB','danceCount','meteor','travel','level','firstDanceAt','lastAt'];
const NOTE_SHEET = 'NOTES', NOTE_HEADERS = ['id','time','toPid','fromPid','text','read'];
const FRIEND_LEVELS = ['', 'Friend', 'Close Friend', 'Shared Memory', 'Best Friend', 'Soul Constellation'];

function meByUid_(uid) { uid = str_(uid, 60); return uid ? rows_(sheet_(UNIVERSE_SHEET, UNIVERSE_HEADERS)).find(r => r.uid === uid) : null; }
function pubByPid_(pid) { return rows_(sheet_(UNIVERSE_SHEET, UNIVERSE_HEADERS)).find(r => r.pid === pid) || null; }
function pub_(r) { return r ? { pid: r.pid, name: r.name, petIdx: Number(r.petIdx) || 0, petSign: r.petSign, petName: r.petName, planetName: r.planetName, element: r.element, typeKey: r.typeKey } : null; }
function fkey_(a, b) { return [a, b].sort().join('|'); }
function friendLevel_(f) {
  const d = Number(f.danceCount) || 0; let l = 1;
  if (d >= 3) l = 2;                       // 一起跳 3 次舞 → Close Friend
  if (l >= 2 && f.meteor) l = 3;           // 一起看流星 → Shared Memory
  if (l >= 3 && f.travel) l = 4;           // 一起旅行 → Best Friend
  if (l >= 4 && d >= 10) l = 5;            // 長期互動 → Soul Constellation
  return l;
}
function friendOut_(f) { return f ? { level: Number(f.level) || 1, levelName: FRIEND_LEVELS[Number(f.level) || 1], danceCount: Number(f.danceCount) || 0, meteor: !!f.meteor, travel: !!f.travel, firstDanceAt: f.firstDanceAt } : null; }
// 建立或更新一段友情：dance 次數＋1，或打上「看流星／旅行」的回憶
function bumpFriend_(a, b, o) {
  const sh = sheet_(FRIEND_SHEET, FRIEND_HEADERS), key = fkey_(a, b), now = new Date();
  const f = rows_(sh).find(r => r.key === key);
  const v = f ? Object.assign({}, f) : { key, pidA: [a, b].sort()[0], pidB: [a, b].sort()[1], danceCount: 0, meteor: '', travel: '', level: 1, firstDanceAt: now };
  if (o.dance) v.danceCount = (Number(v.danceCount) || 0) + 1;
  if (o.meteor) v.meteor = v.meteor || now;
  if (o.travel) v.travel = v.travel || now;
  v.lastAt = now; v.level = friendLevel_(v);
  const row = FRIEND_HEADERS.map(h => v[h] === undefined ? '' : v[h]);
  if (f) sh.getRange(f._row, 1, 1, row.length).setValues([row]); else sh.appendRow(row);
  return Object.assign(v, { isNew: !f });
}
function findFriend_(a, b) { const key = fkey_(a, b); return rows_(sheet_(FRIEND_SHEET, FRIEND_HEADERS)).find(r => r.key === key) || null; }

// 發出共舞邀請：會先檢查是不是「彼此都邀請了對方」
function invite_(b) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const me = meByUid_(b.uid); if (!me) return json_({ok:false, error:'no_planet'});
    const to = str_(b.to, 20), target = pubByPid_(to);
    if (!target || to === me.pid) return json_({ok:false, error:'no_target'});
    const partner = pub_(target);
    // 已經是朋友：「找牠玩」＝再一起跳一支舞
    if (findFriend_(me.pid, to)) { const f = bumpFriend_(me.pid, to, { dance: true }); return json_({ok:true, kind:'again', partner, friend: friendOut_(f)}); }
    const sh = sheet_(INVITE_SHEET, INVITE_HEADERS), all = rows_(sh), now = new Date();
    const rev = all.find(r => r.fromPid === to && r.toPid === me.pid && r.status === 'pending');
    if (rev) {   // A → B 還在等，B 又邀請 A：直接變成 Mutual Invitation，不用任何一方再按接受
      sh.getRange(rev._row, 4, 1, 2).setValues([['mutual', now]]);
      const f = bumpFriend_(me.pid, to, { dance: true });
      return json_({ok:true, kind:'mutual', partner, friend: friendOut_(f)});
    }
    if (all.find(r => r.fromPid === me.pid && r.toPid === to && r.status === 'pending')) return json_({ok:true, kind:'pending', partner});
    sh.appendRow([Utilities.getUuid().slice(0, 12), me.pid, to, 'pending', now, '', '']);
    return json_({ok:true, kind:'sent', partner});
  } finally { lock.releaseLock(); }
}

// 信箱：收到的邀請、寄出邀請的結果、別人留的話、我的朋友
// 讀信箱不會把信標成已讀：要等用戶真的打開、收下（ack）才算，避免信還沒看到就消失
function inbox_(e) {
  const me = meByUid_((e.parameter || {}).uid); if (!me) return json_({ok:true, invites:[], outcomes:[], notes:[], friends:[]});
  const ish = sheet_(INVITE_SHEET, INVITE_HEADERS), inv = rows_(ish);
  // peek：只看有幾封，不標記已讀（在其他畫面提醒用）
  if ((e.parameter || {}).peek) {
    return json_({ok:true, peek:true,
      invites: inv.filter(r => r.toPid === me.pid && r.status === 'pending').length,
      outcomes: inv.filter(r => r.fromPid === me.pid && r.status !== 'pending' && !r.notifiedFrom).length,
      notes: rows_(sheet_(NOTE_SHEET, NOTE_HEADERS)).filter(r => r.toPid === me.pid && !r.read).length});
  }
  const invites = inv.filter(r => r.toPid === me.pid && r.status === 'pending')
    .map(r => ({ id: r.id, createdAt: r.createdAt, from: pub_(pubByPid_(r.fromPid)) })).filter(x => x.from);
  const outcomes = [];
  inv.filter(r => r.fromPid === me.pid && r.status !== 'pending' && !r.notifiedFrom).forEach(r => {
    const p = pub_(pubByPid_(r.toPid));
    if (p) outcomes.push({ id: r.id, status: r.status, partner: p, friend: friendOut_(findFriend_(me.pid, r.toPid)) });
  });
  const nsh = sheet_(NOTE_SHEET, NOTE_HEADERS), notes = [];
  rows_(nsh).filter(r => r.toPid === me.pid && !r.read).slice(-20).forEach(r => {
    notes.push({ id: r.id, time: r.time, text: r.text, from: pub_(pubByPid_(r.fromPid)) });
  });
  const friends = rows_(sheet_(FRIEND_SHEET, FRIEND_HEADERS)).filter(f => f.pidA === me.pid || f.pidB === me.pid)
    .map(f => Object.assign({ partner: pub_(pubByPid_(f.pidA === me.pid ? f.pidB : f.pidA)) }, friendOut_(f))).filter(x => x.partner);
  return json_({ok:true, invites, outcomes, notes, friends});
}

// 用戶打開、收下信件之後才標成已讀：notes＝留言 id、outcomes＝寄出邀請的結果 id
function ack_(b) {
  const me = meByUid_(b.uid); if (!me) return json_({ok:false, error:'no_planet'});
  const ids = v => (Array.isArray(v) ? v : []).slice(0, 50).map(x => str_(x, 20)).filter(Boolean);
  const nIds = ids(b.notes), oIds = ids(b.outcomes), now = new Date();
  if (nIds.length) { const sh = sheet_(NOTE_SHEET, NOTE_HEADERS); rows_(sh).forEach(r => { if (r.toPid === me.pid && !r.read && nIds.includes(r.id)) sh.getRange(r._row, 6).setValue(now); }); }
  if (oIds.length) { const sh = sheet_(INVITE_SHEET, INVITE_HEADERS); rows_(sh).forEach(r => { if (r.fromPid === me.pid && !r.notifiedFrom && oIds.includes(r.id)) sh.getRange(r._row, 7).setValue(now); }); }
  return json_({ok:true});
}

// 回覆邀請：接受，或「現在還不想跳舞」（不做拒絕，對方只會看到「也許下一次」）
function respond_(b) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const me = meByUid_(b.uid); if (!me) return json_({ok:false, error:'no_planet'});
    const sh = sheet_(INVITE_SHEET, INVITE_HEADERS), r = rows_(sh).find(x => x.id === str_(b.id, 20) && x.toPid === me.pid);
    if (!r) return json_({ok:false, error:'no_invite'});
    const partner = pub_(pubByPid_(r.fromPid));
    if (r.status !== 'pending') return json_({ok:true, status: r.status, partner, friend: friendOut_(findFriend_(me.pid, r.fromPid))});
    const st = b.choice === 'accept' ? 'accepted' : 'later';
    sh.getRange(r._row, 4, 1, 2).setValues([[st, new Date()]]);
    const f = st === 'accepted' ? bumpFriend_(me.pid, r.fromPid, { dance: true }) : null;
    return json_({ok:true, status: st, partner, friend: friendOut_(f)});
  } finally { lock.releaseLock(); }
}

// 朋友之間的回憶：一起看流星、一起旅行
function friendAct_(b) {
  const me = meByUid_(b.uid); if (!me) return json_({ok:false, error:'no_planet'});
  const to = str_(b.to, 20); if (!findFriend_(me.pid, to)) return json_({ok:false, error:'not_friends'});
  const f = bumpFriend_(me.pid, to, { meteor: b.act === 'meteor', travel: b.act === 'travel', dance: b.act === 'dance' });
  return json_({ok:true, friend: friendOut_(f)});
}

// 在別人的星球留下一句話（最多 60 字，只有主人看得到）
function note_(b) {
  const me = meByUid_(b.uid); if (!me) return json_({ok:false, error:'no_planet'});
  const to = str_(b.to, 20), text = str_(b.text, 60).replace(/[\u0000-\u001f]/g, ' ').trim();
  if (!text || !pubByPid_(to) || to === me.pid) return json_({ok:false, error:'bad_note'});
  const safe = /^[=+\-@]/.test(text) ? "'" + text : text;   // 避免被試算表當成公式
  sheet_(NOTE_SHEET, NOTE_HEADERS).appendRow([Utilities.getUuid().slice(0, 12), new Date(), to, me.pid, safe, '']);
  return json_({ok:true});
}


/* ================================================================
 * 🌎 LIGHT THE UNIVERSE｜全宇宙事件「THE LOST STAR」
 * 每小時整點開始 20 分鐘（台灣時間）：一顆巨大的星星失去光，所有在線的人一起收集光之碎片點亮它。
 * 進度放在 CacheService（快、可多人同時寫入），完成時另記一筆到 EVENTS 表。
 * 指令碼屬性 EVENT_MODE：hourly（預設）／always（測試用，一直開著）／off（關閉）
 * ================================================================ */
const EVENT_SHEET = 'EVENTS', EVENT_HEADERS = ['id','doneAt','participants','fragments','goal','mixO','mixC','mixE','mixA','mixN'];
const EVENT_MIN = 20;
function eventWindow_() {
  const mode = prop_('EVENT_MODE') || 'hourly', now = new Date();
  const tz = 'Asia/Taipei', min = Number(Utilities.formatDate(now, tz, 'm'));
  if (mode === 'off') return { active: false, off: true };
  if (mode === 'always') { const id = 'A' + Utilities.formatDate(now, tz, 'yyyyMMdd'); return { active: true, id, endsAt: now.getTime() + 3600e3 }; }
  const id = Utilities.formatDate(now, tz, 'yyyyMMddHH');
  const start = now.getTime() - (min * 60 + now.getSeconds()) * 1000;
  return min < EVENT_MIN ? { active: true, id, endsAt: start + EVENT_MIN * 60e3 } : { active: false, nextAt: start + 3600e3 };
}
function evGet_(id) { const v = CacheService.getScriptCache().get('ev_' + id); return v ? JSON.parse(v) : { id, progress: 0, done: false, parts: {} }; }
function evPut_(ev) { CacheService.getScriptCache().put('ev_' + ev.id, JSON.stringify(ev), 21600); }
// 旅人資料快取 6 小時，避免每次輪詢都讀試算表
function evMe_(uid) {
  uid = str_(uid, 60); if (!uid) return null;
  const c = CacheService.getScriptCache(), k = 'u_' + uid, hit = c.get(k);
  if (hit) return JSON.parse(hit);
  const r = meByUid_(uid); if (!r) return null;
  const me = { pid: r.pid, petIdx: Number(r.petIdx) || 0, petName: r.petName, b: ['O','C','E','A','N'].map(x => Number(r[x]) || 3) };
  c.put(k, JSON.stringify(me), 21600); return me;
}
const evGoal_ = n => Math.min(1500, 25 + 15 * Math.max(0, n - 1));
function evOut_(w, ev, me) {
  const now = Date.now(), parts = Object.keys(ev.parts).map(k => Object.assign({ pid: k }, ev.parts[k]));
  const mix = [0, 0, 0, 0, 0]; parts.forEach(p => p.b.forEach((v, i) => { mix[i] += v; }));
  return { ok: true, active: true, id: ev.id, endsAt: w.endsAt, progress: ev.progress, goal: evGoal_(parts.length), done: ev.done, doneAt: ev.doneAt || 0,
    online: parts.filter(p => now - p.seen < 25000).length, joined: parts.length,
    pets: parts.sort((a, b) => b.seen - a.seen).slice(0, 60).map(p => ({ pid: p.pid, petIdx: p.petIdx, petName: p.petName, n: p.n })),
    mix: mix.map(v => parts.length ? Math.round(v / parts.length * 10) / 10 : 3), mine: me && ev.parts[me.pid] ? ev.parts[me.pid].n : 0 };
}
function event_(e) {
  const w = eventWindow_(); if (!w.active) return json_({ ok: true, active: false, nextAt: w.nextAt || 0, off: !!w.off });
  const me = evMe_((e.parameter || {}).uid);
  if (me && (e.parameter || {}).join) {   // 在宇宙裡＝出席（顯示在大家的畫面上）
    const lock = LockService.getScriptLock(); lock.waitLock(5000);
    try { const ev = evGet_(w.id), p = ev.parts[me.pid] || { n: 0, last: 0 }; ev.parts[me.pid] = Object.assign(p, { petIdx: me.petIdx, petName: me.petName, b: me.b, seen: Date.now() }); evPut_(ev); return json_(evOut_(w, ev, me)); }
    finally { lock.releaseLock(); }
  }
  return json_(evOut_(w, evGet_(w.id), me));
}
// 送進光之碎片：每次最多 5 顆、每 2 秒最多一次
function eventGive_(b) {
  const w = eventWindow_(); if (!w.active) return json_({ ok: false, error: 'no_event' });
  const me = evMe_(b.uid); if (!me) return json_({ ok: false, error: 'no_planet' });
  const n = Math.max(0, Math.min(5, Math.floor(Number(b.n) || 0)));
  const lock = LockService.getScriptLock(); lock.waitLock(8000);
  try {
    const ev = evGet_(w.id), now = Date.now(), p = ev.parts[me.pid] || { n: 0, last: 0 };
    ev.parts[me.pid] = Object.assign(p, { petIdx: me.petIdx, petName: me.petName, b: me.b, seen: now });
    if (n && now - (p.last || 0) > 2000 && !ev.done) {
      p.n += n; p.last = now; ev.progress += n;
      const goal = evGoal_(Object.keys(ev.parts).length);
      if (ev.progress >= goal) {
        ev.done = true; ev.doneAt = now; ev.progress = goal;
        const out = evOut_(w, ev, me);
        try { sheet_(EVENT_SHEET, EVENT_HEADERS).appendRow([ev.id, new Date(now), out.joined, ev.progress, goal].concat(out.mix)); } catch (_) {}
      }
    }
    evPut_(ev);
    return json_(evOut_(w, ev, me));
  } finally { lock.releaseLock(); }
}
