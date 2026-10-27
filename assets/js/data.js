/* =========================================================
 * 数据层：错题 / 关键词 模型 + localStorage 持久化
 * 纯前端，无需后端，可直接本地预览。后续可替换为云端同步。
 *
 * 2026-09-09 新增：账户体系
 *  - 每个账户拥有独立的数据命名空间（错题 / 关键词 / 科目）
 *  - 每个账户独立保存云端配置（token / gistId / autoSync）
 *  - 开启 autoSync 后，数据增删改自动上传到该账户的 Gist
 *  - 内置账户 lvcheng / 000000：已开启自动同步到匹配 Gist
 * ========================================================= */
(function (global) {
  'use strict';

  /* ---------- 账户系统 ---------- */
  const ACCOUNTS_KEY = 'cb_accounts_v1';
  const CLOUD_KEY = 'cb_cloud_v1';            // 本地游客模式下的云端配置
  // 注意：token 不写进源码（GitHub Pages 为公开仓库，硬编码凭证会被 secret scanning 拦截且会泄露）。
  // 用户登录 lvcheng 后，在「设置 → 云端同步」里填一次即可，存浏览器本地，之后全自动同步。
  // 内置 lvcheng 仅为作者演示账户；其 Gist ID 不再硬编码于源码（避免开源/分享泄漏账户关联）。
  // 首次登录该账户时，「配置云端同步」引导会提示填写 Gist ID（仅存本机）。已在本机登录过的设备仍沿用本地已保存的配置。
  const LVCHENG = { name: 'lvcheng', pass: '000000', gistId: '' };

  // 简单的密码混淆（避免明文，非高强度加密；本机个人工具足够）
  function hashPwd(s) {
    let h = 2166136261; s = String(s || '');
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 'h' + (h >>> 0).toString(16);
  }
  function getAccStore() { return read(ACCOUNTS_KEY, { list: [], current: null }); }
  function setAccStore(o) { write(ACCOUNTS_KEY, o); }
  function getAccounts() { return getAccStore().list.slice(); }
  function getAccount(name) { return getAccStore().list.find(a => a.name === name) || null; }
  function getCurrentName() { return getAccStore().current || null; }
  function getCurrentAccount() { const n = getCurrentName(); return n ? getAccount(n) : null; }
  function updateAccount(a) { const s = getAccStore(); const i = s.list.findIndex(x => x.name === a.name); if (i >= 0) { s.list[i] = a; setAccStore(s); } }
  function setCurrentName(name) { const s = getAccStore(); s.current = name || null; setAccStore(s); }
  function registerAccount(name, pass) {
    name = (name || '').trim(); pass = (pass || '');
    if (!name) throw new Error('账户名不能为空');
    if (getAccount(name)) throw new Error('账户「' + name + '」已存在');
    const a = { name, pass: hashPwd(pass), cloud: { token: '', gistId: '', autoSync: false }, createdAt: now() };
    const s = getAccStore(); s.list.push(a); setAccStore(s); return a;
  }
  function verifyAccount(name, pass) {
    const a = getAccount(name); if (!a) return false;
    return a.pass === hashPwd(pass);
  }
  function setAccountCloud(name, patch) {
    const a = getAccount(name); if (!a) return;
    a.cloud = Object.assign({}, a.cloud || {}, patch); updateAccount(a);
  }
  function logout() { setCurrentName(null); }

  // 云端配置：有当前账户则用该账户，否则用本地游客配置
  function getCloud() { const a = getCurrentAccount(); if (a) return a.cloud || {}; return read(CLOUD_KEY, {}); }
  function setCloud(patch) {
    const a = getCurrentAccount();
    if (a) { a.cloud = Object.assign({}, a.cloud || {}, patch); updateAccount(a); }
    else write(CLOUD_KEY, Object.assign({}, getCloud(), patch));
  }

  // 预置内置账户 lvcheng / 000000：已开启自动同步、已预填 Gist ID；token 由用户登录后在「设置 → 云端同步」填写（仅存本机）
  function seedAccounts() {
    const s = getAccStore();
    if (!s.list.some(a => a.name === LVCHENG.name)) {
      s.list.push({
        name: LVCHENG.name, pass: hashPwd(LVCHENG.pass),
        cloud: { token: '', gistId: LVCHENG.gistId, autoSync: true }, createdAt: now(),
      });
      setAccStore(s);
    }
  }
  // 旧版（未登录）数据迁移到「本地游客」命名空间，避免丢失
  function migrateLegacy() {
    const s = getAccStore();
    if (s.list.length > 0) return; // 已有账户，不再迁移
    const hasLegacy = localStorage.getItem('cb_errors_v1') || localStorage.getItem('cb_keywords_v1') || localStorage.getItem('cb_subjects_v1');
    if (!hasLegacy) return;
    const move = (oldK, newK) => { const v = localStorage.getItem(oldK); if (v !== null) { localStorage.setItem(newK, v); localStorage.removeItem(oldK); } };
    move('cb_errors_v1', K('errors'));
    move('cb_keywords_v1', K('keywords'));
    move('cb_subjects_v1', K('subjects'));
  }

  /* ---------- 当前命名空间下的存储键 ---------- */
  // 账户模式：a_<账户名>；本地游客：local
  function curNs() { const a = getCurrentAccount(); return a ? 'a_' + a.name : 'local'; }
  function K(which) { return 'cb_' + curNs() + '_' + which + '_v1'; }

  const DEFAULT_SUBJECTS = ['语文', '数学', '英语', '其他'];
  // 科目动态管理：自动建立语数英三科错题本，可按需增删科目
  function getSubjects() {
    let s = read(K('subjects'), null);
    if (!s) { s = DEFAULT_SUBJECTS.slice(); write(K('subjects'), s); }
    return s;
  }
  function addSubject(name) {
    const s = getSubjects();
    name = (name || '').trim();
    if (!name || s.includes(name)) return null;
    s.push(name); write(K('subjects'), s); autoSyncTick(); return name;
  }
  function deleteSubject(name) {
    const s = getSubjects().filter(x => x !== name);
    write(K('subjects'), s);
    // 同步清理该科的关键词与错题引用（删除的知识点写墓碑，防止云端旧副本并回来）
    let list = read(K('keywords'), []);
    const dead = list.filter(k => k.subject === name);
    const removed = dead.map(k => k.id);
    if (dead.length) {
      const del = getKwDelRaw();
      dead.forEach(k => { del[k.id] = { rev: (k.rev || 0) + 1 }; });
      write(K('kwdel'), del);
    }
    list = list.filter(k => k.subject !== name);
    write(K('keywords'), list);
    const errs = read(K('errors'), []);
    errs.forEach(e => { if (removed.includes(e.kpId)) e.kpId = null; if (removed.includes(e.srcId)) e.srcId = null; });
    write(K('errors'), errs);
    autoSyncTick();
  }
  // 重命名科目：同步更新错题、关键词的 subject 引用
  function renameSubject(oldName, newName) {
    newName = (newName || '').trim();
    if (!newName || newName === oldName) return false;
    const s = getSubjects();
    if (s.includes(newName)) return false; // 新名已存在
    const idx = s.indexOf(oldName);
    if (idx === -1) return false;
    s[idx] = newName; write(K('subjects'), s);
    const list = read(K('keywords'), []);
    list.forEach(k => { if (k.subject === oldName) { k.subject = newName; touchKw(k); } });
    write(K('keywords'), list);
    const errs = read(K('errors'), []);
    errs.forEach(e => { if (e.subject === oldName) e.subject = newName; });
    write(K('errors'), errs);
    autoSyncTick();
    return true;
  }
  const MASTERY = {
    unknown: { key: 'unknown', label: '未掌握', cls: 'm-unknown' },
    known:   { key: 'known',   label: '已掌握', cls: 'm-known' },
  };
  // 语文专属：字词默写 / 字词（录入后自动注音）
  const CHINESE_DICT_KPS = ['字词默写', '字词'];
  function isChineseDictKp(name) { return CHINESE_DICT_KPS.includes(name); }

  /* ---------- 工具 ---------- */
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const now = () => new Date().toISOString();
  const DAY = 86400000;

  function read(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function write(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  /* ---------- 关键词（知识点 / 来源） ---------- */
  /**
   * keyword: { id, type:'kp'|'src', subject, name }
   *  type 'kp' = 知识点；'src' = 错题来源
   */
  function getKeywords(type) {
    const list = read(K('keywords'), []);
    return type ? list.filter(k => k.type === type) : list;
  }
  // 知识点的跨端合并依据：rev 为「本地修改次数」的单调递增计数（新增/改名/改题型/删除 均 +1），
  // 与设备时钟无关；updatedAt 仅在 rev 相同时作为次级比较（两端各自独立修改的兜底）。
  function touchKw(k) {
    k.rev = (k.rev || 0) + 1;
    k.updatedAt = now();
  }
  function addKeyword(type, name, subject, rType) {
    const list = read(K('keywords'), []);
    const kw = { id: uid(), type, name: name.trim(), subject: subject || null, rev: 1, updatedAt: now() };
    if (type === 'kp') kw.rType = rType || 'stable';   // 题型仅知识点需要，默认稳定型
    list.push(kw); write(K('keywords'), list); autoSyncTick(); return kw;
  }
  // 修改知识点的题型（稳定型 / 记忆型）；仅对 kp 生效
  function setKeywordRType(id, rType) {
    const list = read(K('keywords'), []);
    const k = list.find(x => x.id === id);
    if (k && k.type === 'kp') { k.rType = rType; touchKw(k); write(K('keywords'), list); autoSyncTick(); }
    return k;
  }
  function updateKeyword(id, name) {
    const list = read(K('keywords'), []);
    const k = list.find(x => x.id === id);
    if (k) { k.name = name.trim(); touchKw(k); }
    write(K('keywords'), list); autoSyncTick(); return k;
  }
  // 删除墓碑：{ [id]: { rev } }。删除视为一次版本 +1，跨端合并时与知识点的 rev 比大小，
  // 墓碑版本更高 → 该知识点不进本地，从而「删除」也能同步到其他设备（否则云端旧副本会把删掉的又并回来）。
  function getKwDelRaw() {
    const x = read(K('kwdel'), {});
    if (!x || typeof x !== 'object' || Array.isArray(x)) return {};
    const m = {};
    Object.keys(x).forEach(id => { const v = x[id]; m[id] = { rev: (v && v.rev) || 0 }; });
    return m;
  }
  function deleteKeyword(id) {
    let list = read(K('keywords'), []);
    const k = list.find(x => x.id === id);
    const del = getKwDelRaw();
    del[id] = { rev: ((k && k.rev) || 0) + 1 };   // 删除 = 版本号再 +1
    write(K('kwdel'), del);
    list = list.filter(x => x.id !== id);
    write(K('keywords'), list);
    // 同时清理错题中对该关键词的引用
    const errs = read(K('errors'), []);
    errs.forEach(e => {
      if (e.kpId === id) e.kpId = null;
      if (e.srcId === id) e.srcId = null;
    });
    write(K('errors'), errs);
    autoSyncTick();
  }
  // 清理「没有任何错题引用」的知识点 / 来源。
  // 注意：知识点现在由用户在「知识点管理」里显式维护（含题型），新建后可能暂时不挂任何错题，
  // 因此**不再自动调用**（否则刚建好的知识点会在下次启动/同步时被当成垃圾删掉）。
  // 保留该函数仅供显式手动整理；删除时写墓碑，避免被云端旧副本并回来。
  function pruneUnusedKeywords() {
    const used = new Set();
    read(K('errors'), []).forEach(e => { if (e.kpId) used.add(e.kpId); if (e.srcId) used.add(e.srcId); });
    const list = read(K('keywords'), []);
    const dead = list.filter(k => !used.has(k.id));
    if (!dead.length) return;
    const del = getKwDelRaw();
    dead.forEach(k => { del[k.id] = { rev: (k.rev || 0) + 1 }; });
    write(K('kwdel'), del);
    write(K('keywords'), list.filter(k => used.has(k.id)));
    autoSyncTick();
  }

  /* ---------- 错题 ---------- */
  /**
   * error: {
   *   id, subject, mode:'text'|'image'|'mixed',
   *   text, images:[dataURL], image(首个,兼容旧数据), pinyin,
   *   kpId, srcId, mastery:'unknown'|'known', starred, starAt,
   *   answer, createdAt,
   *   reviews: [{ date, correct:true|false }]
   * }
   * 已掌握判定：走完当前题型（记忆型/稳定型）的完整推送周期且全对，或手动标 known。
   */
  function getErrors(filter) {
    let list = read(K('errors'), []);
    if (filter && filter.subject && filter.subject !== '全部') {
      list = list.filter(e => e.subject === filter.subject);
    }
    if (filter && filter.kpId) list = list.filter(e => e.kpId === filter.kpId);
    if (filter && filter.srcId) list = list.filter(e => e.srcId === filter.srcId);
    if (filter && filter.mastery) {
      // 二态筛选：已掌握（停止推送）/ 未掌握（仍在推送）
      list = list.filter(e => (filter.mastery === 'known') ? isMastered(e) : !isMastered(e));
    }
    // 默认按创建时间倒序
    return list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  function getError(id) {
    return read(K('errors'), []).find(e => e.id === id);
  }

  function addError(data) {
    const list = read(K('errors'), []);
    const created = now();
    const err = Object.assign({
      id: uid(),
      subject: '数学',
      mode: 'text',
      text: '', image: null, images: [], pinyin: '',
      kpId: null, srcId: null, mastery: 'unknown',
      starred: false, starAt: '',
      answer: '', reviews: [],
    }, data, { createdAt: (data && data.createdAt) ? data.createdAt : created });
    list.push(err); write(K('errors'), list); autoSyncTick(); return err;
  }

  function updateError(id, patch) {
    const list = read(K('errors'), []);
    const e = list.find(x => x.id === id);
    if (e) Object.assign(e, patch);
    write(K('errors'), list);
    autoSyncTick(); return e;
  }

  // 错题删除墓碑：{ [id]: { rev } }。删除视为一次 rev +1；跨端合并时该 id 不进本地，
  // 从而「删除」也能同步到其他设备（否则云端旧副本会把删掉的题并回来，正是此前"删了又还原"的根因）。
  function getErrDelRaw() {
    const x = read(K('errdel'), {});
    if (!x || typeof x !== 'object' || Array.isArray(x)) return {};
    const m = {};
    Object.keys(x).forEach(id => { const v = x[id]; m[id] = { rev: (v && v.rev) || 0 }; });
    return m;
  }
  function deleteError(id) {
    let list = read(K('errors'), []);
    list = list.filter(x => x.id !== id);
    write(K('errors'), list);
    // 写删除墓碑：记录被删错题 id，跨端合并时该 id 不进本地，避免被云端旧副本并回来
    const del = getErrDelRaw();
    del[id] = { rev: ((del[id] && del[id].rev) || 0) + 1 };
    write(K('errdel'), del);
    autoSyncTick();
  }

  /* ---------- 复习计划（周期推送 + 掌握判定，方案：两类题型） ---------- */
  // 两类题型的推送周期（间隔单位：天）。走完整个周期且全对 → 标记已掌握，停止推送。
  //   记忆型 drill：+3 / +20 / +40 / +80 / +160（共 5 次，最长 160 封顶）
  //   稳定型 stable：+3 / +60 / +150（共 3 次）
  const DRILL_IV = [3, 20, 40, 80, 160];
  const STABLE_IV = [3, 60, 150];
  // 题型挂在「知识点」上：知识点设 rType，错题通过 kpId 继承；无知识点默认稳定型。
  function getRType(e) {
    if (e && e.kpId) {
      const k = getKeywords('kp').find(x => x.id === e.kpId);
      if (k && k.rType) return k.rType;
    }
    return 'stable';
  }
  function intervalsFor(e) { return getRType(e) === 'drill' ? DRILL_IV : STABLE_IV; }
  // 累计间隔：C[k] = 第 k 次复习应距锚点的天数（k 从 0 起）
  function cum(iv) { const c = [iv[0]]; for (let i = 1; i < iv.length; i++) c.push(c[i - 1] + iv[i]); return c; }
  // 排期推导（纯函数，由 reviews 实时算出，避免多端同步漂移）：
  //   anchor = 创建日；其间若有一次判错，anchor 重置为该错日、步数归零（周期从头开始）。
  //   pos = 自上次判错以来连续「对」的次数；下次推送 = anchor + 累计间隔[pos]。
  //   提前重练 = 在更早的日期记录一次练习（correct），但 anchor 不变 → 其余节点推送日期保持不变。
  function schedule(e) {
    const iv = intervalsFor(e);
    const C = cum(iv);
    let anchor = new Date(e.createdAt).getTime();
    let pos = 0;
    (e.reviews || []).forEach(r => {
      const bad = r.correct === false || r.result === 'bad';
      if (bad) { anchor = new Date(r.date).getTime(); pos = 0; }
      else pos++;
    });
    const mastered = pos >= iv.length;
    const nextDue = mastered ? Infinity : anchor + C[pos] * DAY;
    return { iv, C, anchor, pos, mastered, nextDue };
  }
  // 下一次应复习时间；已掌握或周期已完成返回 Infinity（不再推送）。未练习顺延：不早于 snoozedUntil。
  function nextDueDate(e) {
    const s = schedule(e);
    let due = (e.mastery === 'known' || s.mastered) ? Infinity : s.nextDue;
    const po = e.practiceOnce;                      // 加练一次：独立追加的额外推送
    if (po && po.due) due = Math.min(due, po.due);  // 取更早（或本次加练）的推送日期
    const snooze = e.snoozedUntil || 0;             // 未练习顺延：下次到期不早于该时间戳
    return Math.max(due, snooze);
  }
  // 是否已掌握：手动标 known 直接算；否则看是否走完整个周期且全对。
  function isMastered(e) {
    if (e.mastery === 'known') return true;
    return schedule(e).mastered;
  }
  // 待复习列表（未掌握且已到推送时间），按到期先后排序
  function dueReviews() {
    const nowT = Date.now();
    const list = read(K('errors'), []);
    const due = list.filter(e => {
      // 加练一次已到/逾期（含对「已掌握」题的加练）也列入待复习
      if (e.practiceOnce && e.practiceOnce.due && e.practiceOnce.due <= nowT) return true;
      return !isMastered(e) && nextDueDate(e) <= nowT;
    });
    return due.sort((a, b) => nextDueDate(a) - nextDueDate(b));
  }
  // 记录一次复习结果（correct: true/false）；走完整个周期全对后自动归类「已掌握」
  function recordReview(id, correct) {
    const e = getError(id);
    if (!e) return;
    e.reviews = e.reviews || [];
    e.reviews.push({ date: now(), correct: !!correct });
    // 已掌握题重练：无论对错都不自动推送（保持 known）；其余题按周期判定是否归为已掌握
    if (e.mastery !== 'known' && isMastered(e)) e.mastery = 'known';
    if (e.practiceOnce) e.practiceOnce = null;   // 本次练习即落实「加练一次」，清除标记回归原周期/已掌握（置 null 以便随 Object.assign 持久化）
    updateError(id, e);
    autoSyncTick();
  }

  // 加练一次：在 days 天后额外推送一次（独立于正常周期；批改后回到原周期，不重置、不延长、不计入掌握所需连续答对次数）
  function practiceOnceDays(e) { return getRType(e) === 'drill' ? 30 : 60; }
  function addPracticeOnce(id, days) {
    const e = getError(id); if (!e) return;
    e.practiceOnce = { due: Date.now() + (days || practiceOnceDays(e)) * DAY };
    updateError(id, e); autoSyncTick();
  }
  // 提前标识已掌握（不再推送）/ 取消已掌握（恢复未掌握）：写入/清除 mastery='known'
  function setMasteredFlag(id, on) {
    const e = getError(id); if (!e) return;
    e.mastery = on ? 'known' : 'unknown';
    updateError(id, e); autoSyncTick();
  }
  // 重点标星：starAt 记录最近一次切换时间，供跨端合并时按「较晚操作」裁决
  function setStar(id, on) {
    const e = getError(id); if (!e) return;
    e.starred = !!on;
    e.starAt = now();
    updateError(id, e); autoSyncTick();
  }

  /* ---------- 种子数据（首次打开时填充，方便预览框架） ---------- */
  function seedIfEmpty() {
    getSubjects(); // 自动建立语数英三科错题本（按当前命名空间）
    // 账户模式下保持干净，不预置示例错题；仅本地游客首次打开时预置 2 条示例
    if (getCurrentAccount()) return;
    if (localStorage.getItem(K('errors')) || localStorage.getItem(K('keywords'))) return;
    const kp = [
      addKeyword('kp', '二次函数', '数学'),
      addKeyword('kp', '阅读理解', '语文'),
      addKeyword('kp', '字词默写', '语文'),
      addKeyword('kp', '字词', '语文'),
      addKeyword('kp', '时态', '英语'),
    ];
    const src = [
      addKeyword('src', '单元测试', '数学'),
      addKeyword('src', '作业', '语文'),
      addKeyword('src', '期中试卷', '英语'),
    ];
    const t0 = Date.now() - 2 * DAY;
    addError({
      subject: '数学', mode: 'text',
      text: '已知二次函数 y = ax² + bx + c 过点 (1,0) 和 (-1,2)，求 a 的值。',
      kpId: kp[0].id, srcId: src[2].id, mastery: 'unknown',
      answer: '由 (1,0) 得 a+b+c=0；由 (-1,2) 得 a-b+c=2；两式相减得 2b=-2 → b=-1，代入得 a+c=1，需补充条件求 a。',
      createdAt: new Date(t0).toISOString(),
    });
    addError({
      subject: '语文', mode: 'text',
      text: '默写：窈窕淑女，君子好逑。',
      kpId: kp[2].id, srcId: src[1].id, mastery: 'unknown',
      answer: '窈窕淑女，君子好逑。', pinyin: 'yǎo tiǎo shū nǚ，jūn zǐ hǎo qiú。',
      createdAt: new Date(t0 - DAY).toISOString(),
    });
  }

  // 演示数据：插入若干「几日前」的错题，覆盖复习的三个阶段（+2 / +7 / +30 天），
  // 便于预览复习 / 批改效果。
  //   force=false：已存在 demo_ 前缀数据时跳过（可重复点击不重复插入）
  //   force=true ：先清掉旧的 demo 数据再插入（不碰用户真实数据），方便反复测试
  function seedReviewDemo(force) {
    const day = DAY, nowT = Date.now();
    if (force) {
      const keep = read(K('errors'), []).filter(e => (e.id || '').indexOf('demo_') !== 0);
      write(K('errors'), keep);
    } else {
      const list = read(K('errors'), []);
      if (list.some(e => (e.id || '').indexOf('demo_') === 0)) return false;
    }
    const ago = d => new Date(nowT - d * day).toISOString();
    const kpOf = (name, subject) => {
      const ex = read(K('keywords'), []).find(k => k.type === 'kp' && k.name === name && k.subject === subject);
      return ex ? ex.id : addKeyword('kp', name, subject).id;
    };
    const srcOf = (name, subject) => {
      const ex = read(K('keywords'), []).find(k => k.type === 'src' && k.name === name && k.subject === subject);
      return ex ? ex.id : addKeyword('src', name, subject).id;
    };
    const mk = o => Object.assign({
      id: uid(), subject: '数学', mode: 'text', text: '', image: null, images: [], pinyin: '',
      kpId: null, srcId: null, mastery: 'unknown', answer: '', reviews: [], createdAt: now(),
    }, o);
    const items = [
      // —— 第 1 阶段（+2 天）：刚收录 2~5 天，从未复习，今天起陆续到期 ——
      mk({ id: 'demo_math1', subject: '数学',
        text: '已知二次函数 y=ax²+bx+c 过点 (1,0) 与 (-1,2)，求 a 的值。',
        kpId: kpOf('二次函数', '数学'), srcId: srcOf('单元测试', '数学'), mastery: 'unknown',
        answer: '由 (1,0) 得 a+b+c=0；由 (-1,2) 得 a-b+c=2；两式相减得 2b=-2 → b=-1，代入可得 a+c=1。',
        createdAt: ago(2) }),
      mk({ id: 'demo_chi1', subject: '语文',
        text: '默写：窈窕淑女，君子好逑。', kpId: kpOf('字词默写', '语文'), srcId: srcOf('作业', '语文'), mastery: 'unknown',
        answer: '窈窕淑女，君子好逑。', pinyin: 'yǎo tiǎo shū nǚ，jūn zǐ hǎo qiú。',
        createdAt: ago(3) }),
      mk({ id: 'demo_eng1', subject: '英语',
        text: '请用现在完成时改写：He finished his homework an hour ago.',
        kpId: kpOf('时态', '英语'), srcId: srcOf('期中试卷', '英语'), mastery: 'unknown',
        answer: 'He has finished his homework.',
        createdAt: ago(5) }),
      // —— 第 2 阶段（+7 天）：已复习 1 次，到下一间隔 ——
      mk({ id: 'demo_eng2', subject: '英语',
        text: '翻译：Where there is a will, there is a way.', kpId: kpOf('翻译', '英语'), srcId: srcOf('作业', '英语'), mastery: 'unknown',
        answer: '有志者事竟成。',
        createdAt: ago(11), reviews: [{ date: ago(2), correct: true }] }),
      mk({ id: 'demo_math2', subject: '数学',
        text: '证明：等腰三角形两底角相等。', kpId: kpOf('几何', '数学'), srcId: srcOf('单元测试', '数学'), mastery: 'unknown',
        answer: '作顶角平分线，由 SAS 证两三角形全等，故两底角相等。',
        createdAt: ago(12), reviews: [{ date: ago(5), correct: true }] }),
      // —— 第 3 阶段（+30 天）：已复习 2 次 ——
      mk({ id: 'demo_chi2', subject: '语文',
        text: '背诵并默写《静夜思》前两句。', kpId: kpOf('古诗', '语文'), srcId: srcOf('作业', '语文'), mastery: 'unknown',
        answer: '床前明月光，疑是地上霜。', pinyin: 'chuáng qián míng yuè guāng，yí shì dì shàng shuāng。',
        createdAt: ago(35), reviews: [{ date: ago(33), correct: true }, { date: ago(28), correct: true }] }),
      // —— 已掌握示例：连续答对 3 次（不出现在待复习列表）——
      mk({ id: 'demo_mas', subject: '数学',
        text: '计算：12 × 13 = ?', kpId: kpOf('计算', '数学'), srcId: srcOf('单元测试', '数学'), mastery: 'unknown',
        answer: '156',
        createdAt: ago(40),
        reviews: [{ date: ago(38), correct: true }, { date: ago(33), correct: true }, { date: ago(28), correct: true }] }),
    ];
    const list = read(K('errors'), []);
    list.push(...items);
    write(K('errors'), list);
    autoSyncTick();
    return items.length;
  }

  /* ---------- 拼音（语文字词默写自动注音） ---------- */
  function toPinyin(text) {
    try {
      if (global.pinyinPro && typeof global.pinyinPro.pinyin === 'function') {
        return global.pinyinPro.pinyin(text, { toneType: 'symbol', type: 'array' }).join(' ');
      }
    } catch (e) { /* 降级 */ }
    return ''; // 离线/库未加载时返回空，提示手动输入
  }

  /* ---------- 数据迁移（导出 / 导入 / 清空，为云端同步预留端口） ---------- */
  // 导出完整快照，供设备间迁移；未来云端同步亦复用此结构
  function snapshot() {
    return {
      app: 'cuotiben',
      version: 1,
      exportedAt: now(),
      account: getCurrentName(),
      subjects: getSubjects(),
      keywords: read(K('keywords'), []),
      kwDel: getKwDelRaw(),          // 知识点删除墓碑（跨端传播删除）
      errors: read(K('errors'), []),
      errDel: getErrDelRaw(),        // 错题删除墓碑（跨端传播删除）
      practiceSession: getPracticeSession(),
      redoList: getRedoRaw(),
    };
  }
  function exportData() { return snapshot(); }
  function importData(data) {
    if (!data || typeof data !== 'object') throw new Error('文件不是有效数据');
    if (!Array.isArray(data.errors) || !Array.isArray(data.keywords)) throw new Error('缺少错题或关键词数据');
    write(K('subjects'), (Array.isArray(data.subjects) && data.subjects.length) ? data.subjects : DEFAULT_SUBJECTS.slice());
    write(K('keywords'), data.keywords);
    write(K('kwdel'), (data.kwDel && typeof data.kwDel === 'object') ? data.kwDel : {});
    write(K('errdel'), (data.errDel && typeof data.errDel === 'object') ? data.errDel : {});
    write(K('errors'), data.errors);
    autoSyncTick();
  }
  function clearAll() {
    [K('subjects'), K('errors'), K('keywords'), K('kwdel'), K('errdel'), K('practice'), K('redo')].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    getSubjects(); // 重建默认科目，保证应用仍可正常使用
  }
  // 练习队列（选题重练）：持久化到本账户存储，并随快照同步到云端（多设备可延续 / 远程管理）
  function getPracticeSession() { return read(K('practice'), []); }
  function setPracticeSession(arr) {
    write(K('practice'), Array.isArray(arr) ? arr : []);
    autoSyncTick();   // 同步到云端，使其他设备也能看到 / 继续该练习队列
  }
  // 错题重练清单（redo）：用户在笔记本勾选「加入重练」后进入首页「错题重练」板块，
  // 与练习队列(practiceSession)不同——它是常驻清单：逐题批改后**不会清空**，错的题次日仍留在板块，
  // 直到答对固定锚点后再按原复习逻辑推送；从板块「移出」仅移除清单引用，不动题库与复习记录。
  // 存储为带时间戳的映射 { [id]: { ts, deleted } }：删除写入「墓碑」(deleted:true)。
  // 合并时按每题最新时间戳裁决，使「加入 / 移出」都能跨端正确传播——并集只能加不能删，故用墓碑机制（方案 B）。
  function normalizeRedoMap(x) {
    if (!x || typeof x !== 'object') return {};
    if (Array.isArray(x)) {            // 兼容旧版纯 id 数组
      const m = {}; x.forEach(id => { if (id) m[id] = { ts: 0, seq: 0, deleted: false }; }); return m;
    }
    const m = {};
    Object.keys(x).forEach(id => {
      const v = x[id];
      if (v && typeof v === 'object') m[id] = { ts: v.ts || 0, seq: v.seq || 0, deleted: !!v.deleted };
      else if (v) m[id] = { ts: 0, seq: 0, deleted: false };   // 兼容裸 id 值
    });
    return m;
  }
  function getRedoRaw() { return normalizeRedoMap(read(K('redo'), {})); }
  // 返回当前「有效」重练题 id（未删除），按操作序号升序（序号 = 加入/移出顺序，不受设备时钟偏差影响）
  function getRedoList() {
    const raw = getRedoRaw();
    return Object.keys(raw).filter(id => raw[id] && !raw[id].deleted)
      .sort((a, b) => ((raw[a].seq || 0) - (raw[b].seq || 0)) || ((raw[a].ts || 0) - (raw[b].ts || 0)));
  }
  // 加入重练：写入/刷新为「有效」状态（序号 +1，以便跨端按操作先后裁决，避免时钟偏差）
  function addToRedo(ids) {
    if (!Array.isArray(ids)) ids = ids ? [ids] : [];
    const raw = getRedoRaw(); const t = now();
    ids.forEach(id => { if (id) { const p = raw[id] || {}; raw[id] = { ts: t, seq: (p.seq || 0) + 1, deleted: false }; } });
    write(K('redo'), raw);
    autoSyncTick();   // 同步到云端，多设备可延续同一份重练清单
  }
  // 移出重练：写入「墓碑」(deleted:true)，序号 +1 使其后于任何旧的「未删除」记录，跨端合并必获胜
  function removeFromRedo(id) {
    if (!id) return;
    const raw = getRedoRaw();
    const p = raw[id] || {};
    raw[id] = { ts: now(), seq: (p.seq || 0) + 1, deleted: true };
    write(K('redo'), raw);
    autoSyncTick();
  }
  // 未练习：顺延到明天再推送（不记录对错，仅延后下次到期时间）
  function snooze(id) {
    const e = getError(id); if (!e) return;
    e.snoozedUntil = Date.now() + DAY;
    updateError(id, e); autoSyncTick();
  }

  /* ---------- 云端同步（GitHub Gist，纯前端，无需后端） ---------- */
  // 配置存本地：{ token, gistId, lastSync, lastResult }
  const GIST_FILE = 'cuotiben.json';
  // 同步状态标记（提前声明，供 mergeIntoLocal 使用）
  let _importing = false, _autoTimer = null;
  function gistHeaders() {
    const cfg = getCloud();
    const t = (cfg.token || '').trim();
    // classic Token（ghp_ 开头）用 "token" 前缀；fine-grained Token（github_pat_ 开头）用 "Bearer"
    const auth = t.indexOf('github_pat_') === 0 ? 'Bearer ' + t : 'token ' + t;
    return {
      'Authorization': auth,
      'Content-Type': 'application/json',
      'Accept': 'application/vnd.github+json',
    };
  }
  // 把 Gist ID 容错处理：去掉首尾空格，支持直接粘贴整段 gist 链接（取最后一段）
  function normGistId(raw) { return (raw || '').trim().split('/').pop() || ''; }
  // 统一把 GitHub 的 HTTP 错误翻译成中文友好提示
  function errMsg(status, msg, act) {
    if (status === 401 || status === 403) return act + '失败：Token 无效或权限不足（请在 GitHub 生成「仅勾 gist 权限」的 Token）';
    if (status === 404) return act + '失败：私密 Gist 返回 404，多半是 Token 无效/无 gist 权限，或 Gist ID 填错（点「测试连接」可一步定位）';
    return act + '失败（HTTP ' + status + (msg ? '：' + msg : '') + '）';
  }
  // 把云端数据合并进本地：云端独有 id 直接加入；已存在 id 合并复习记录（按日期去重），其余字段本地优先。
  // 这样多设备/多标签页各自编辑后，先合并再上传，互不覆盖、不静默丢数据。
  function mergeIntoLocal(content) {
    let cloud;
    try { cloud = JSON.parse(content); } catch (e) { return; }
    if (!cloud || !Array.isArray(cloud.errors)) return;
    const local = snapshot();
    // 错题删除墓碑：合并本地与云端（取更大 rev），最终据此剔除已删除的错题
    const lEDel = local.errDel || {}, cEDel = (cloud.errDel && typeof cloud.errDel === 'object') ? cloud.errDel : {};
    const errDel = {};
    new Set([...Object.keys(lEDel), ...Object.keys(cEDel)]).forEach(id => {
      const lr = (lEDel[id] && lEDel[id].rev) || 0, cr = (cEDel[id] && cEDel[id].rev) || 0;
      errDel[id] = { rev: Math.max(lr, cr) };
    });
    const map = new Map(local.errors.map(e => [e.id, e]));
    cloud.errors.forEach(ce => {
      if (!ce || !ce.id) return;
      if (errDel[ce.id]) return;   // 已在删除墓碑中 → 跳过，不把已删的题并回来
      const le = map.get(ce.id);
      if (!le) { map.set(ce.id, ce); return; }
      // 已存在：合并云端有而本地没有的复习记录（按 date 去重），保证复习历史不丢
      const dates = new Set((le.reviews || []).map(r => r.date));
      (ce.reviews || []).forEach(r => { if (r && r.date && !dates.has(r.date)) { le.reviews.push(r); dates.add(r.date); } });
      (le.reviews || []).sort((a, b) => new Date(a.date) - new Date(b.date));
      // 其余字段本地优先（本地为空才用云端，避免覆盖刚刚的本地编辑）
      ['text','answer','subject','mastery','kpId','srcId','mode','pinyin','createdAt','practiceOnce'].forEach(k => {
        if (le[k] === undefined || le[k] === null || le[k] === '') le[k] = ce[k];
      });
      // 星标：按 starAt 取较晚的一次切换（避免另一端旧值把刚打的星覆盖掉）
      const lt = Date.parse(le.starAt || 0) || 0, ct = Date.parse(ce.starAt || 0) || 0;
      if (ct > lt) { le.starred = !!ce.starred; le.starAt = ce.starAt || ''; }
      else if (le.starred === undefined) le.starred = !!ce.starred;
    });
    // 最终剔除被删除的错题（本地或云端墓碑命中者均不进本地）
    Object.keys(errDel).forEach(id => map.delete(id));
    local.errDel = errDel;
    local.errors = Array.from(map.values());
    local.subjects = Array.from(new Set([...(local.subjects || []), ...(cloud.subjects || [])]));
    // 知识点：按 id 合并，取「版本号(rev)」更大者。rev 是本地修改次数（新增/改名/改题型/删除均 +1），
    // 与设备时钟无关；rev 相同再比 updatedAt，仍相同则保留本地。
    // 旧逻辑是 [...local, ...cloud] 直接 Map.set，导致云端永远覆盖本地 —— 手机上的改名/改题型会被打回。
    const kwMap = new Map();
    const pickKw = (k) => {
      if (!k || !k.id) return;
      const cur = kwMap.get(k.id);
      if (!cur) { kwMap.set(k.id, Object.assign({}, k)); return; }
      const kr = k.rev || 0, cr = cur.rev || 0;
      if (kr > cr) kwMap.set(k.id, Object.assign({}, k));
      else if (kr === cr && (k.updatedAt || '') > (cur.updatedAt || '')) kwMap.set(k.id, Object.assign({}, k));
    };
    (local.keywords || []).forEach(pickKw);    // 先放本地：完全同版本时本地优先
    (cloud.keywords || []).forEach(pickKw);
    // 删除墓碑合并：同一 id 取更大的 rev；墓碑 rev 高于知识点 rev → 该知识点视为已删除
    const lDel = local.kwDel || {}, cDel = (cloud.kwDel && typeof cloud.kwDel === 'object') ? cloud.kwDel : {};
    const delMap = {};
    new Set([...Object.keys(lDel), ...Object.keys(cDel)]).forEach(id => {
      const lr = (lDel[id] && lDel[id].rev) || 0, cr = (cDel[id] && cDel[id].rev) || 0;
      delMap[id] = { rev: Math.max(lr, cr) };
    });
    Array.from(kwMap.keys()).forEach(id => {
      const d = delMap[id], k = kwMap.get(id);
      if (d && d.rev > ((k && k.rev) || 0)) kwMap.delete(id);
    });
    local.keywords = Array.from(kwMap.values());
    local.kwDel = delMap;
    // 练习队列取并集（多设备各自添加的题都保留，避免一方覆盖另一方）
    const ps = new Set([...(local.practiceSession || []), ...(cloud.practiceSession || [])]);
    local.practiceSession = Array.from(ps);
    // 错题重练清单：按 id 合并，每条取操作序号更大者（seq 单调递增、与设备时钟无关，
    // 故「后发生的加入/移出」必获胜，避免两端系统时间不一致导致旧记录反被采纳）
    const lRedo = normalizeRedoMap(local.redoList), cRedo = normalizeRedoMap(cloud.redoList);
    const mRedo = {};
    new Set([...Object.keys(lRedo), ...Object.keys(cRedo)]).forEach(id => {
      const L = lRedo[id], C = cRedo[id];
      mRedo[id] = (L && C) ? ((L.seq || 0) >= (C.seq || 0) ? L : C) : (L || C);
    });
    local.redoList = mRedo;
    write(K('practice'), local.practiceSession);
    write(K('redo'), local.redoList);
    _importing = true;            // 合并期间抑制自动回传，避免无意义上传/递归
    try { importData(local); }
    finally { _importing = false; }
  }
  // 上传：把当前完整快照写入 Gist（PATCH），并清理非标准残留文件。
  // 上传前复用「取文件列表」的 GET 拉取云端，把云端独有/更新的复习记录合并进本地，避免多设备后写覆盖静默丢数据。
  async function gistUpload() {
    const cfg = getCloud();
    if (!cfg.token || !cfg.gistId) throw new Error('请先在设置里填写并保存 Token 与 Gist ID');
    const gistId = normGistId(cfg.gistId);
    if (!gistId) throw new Error('请先在设置里填写并保存 Token 与 Gist ID');
    // 拉取云端：① 取现有文件名（清理残留）② 合并云端到本地（本地优先，复习记录并集）
    let existing = [];
    try {
      const g0 = await fetch('https://api.github.com/gists/' + gistId, { headers: gistHeaders() });
      if (g0.ok) {
        const j = await g0.json();
        existing = Object.keys(j.files || {});
        const f = j.files && j.files[GIST_FILE];
        if (f && f.content) mergeIntoLocal(f.content);
      }
    } catch (e) { /* 忽略，直接尝试上传 */ }
    const files = { [GIST_FILE]: { content: JSON.stringify(snapshot(), null, 2) } };
    existing.forEach(name => { if (name !== GIST_FILE) files[name] = null; }); // 删除残留文件
    const payload = { description: '错题本数据同步 (cuotiben)', files };
    const r = await fetch('https://api.github.com/gists/' + gistId, {
      method: 'PATCH', headers: gistHeaders(), body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(errMsg(r.status, j.message, '上传'));
    }
    setCloud({ lastSync: now(), lastResult: 'up' });
    return await r.json();
  }
  // 下载：从 Gist 读回数据并导入（换设备时用）
  async function gistDownload() {
    const cfg = getCloud();
    if (!cfg.token || !cfg.gistId) throw new Error('请先在设置里填写并保存 Token 与 Gist ID');
    const gistId = normGistId(cfg.gistId);
    if (!gistId) throw new Error('请先在设置里填写并保存 Token 与 Gist ID');
    const r = await fetch('https://api.github.com/gists/' + gistId, { headers: gistHeaders() });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(errMsg(r.status, j.message, '下载'));
    }
    const g = await r.json();
    const f = g.files && g.files[GIST_FILE];
    if (!f || !f.content) throw new Error('Gist 中没有找到 ' + GIST_FILE);
    _importing = true;            // 拉取期间不触发自动回传，避免无意义上传
    // 合并而非整包覆盖：本地较新的修改（如刚改的知识点名称/题型）不会被云端旧副本冲掉，
    // 云端独有的内容仍会补进来（等价于双向补齐）。
    try { mergeIntoLocal(f.content); }
    finally { _importing = false; }
    setCloud({ lastSync: now(), lastResult: 'down' });
    return g;
  }
  // 连接测试：用当前 Token 验证有效性 + Gist 是否可见（不改动任何数据）
  async function gistTest() {
    const cfg = getCloud();
    if (!cfg.token) throw new Error('请先在上方填写 GitHub Token');
    if (!cfg.gistId) throw new Error('请先在上方填写 Gist ID');
    const gistId = normGistId(cfg.gistId);
    // 1) 验证 Token 本身
    const u = await fetch('https://api.github.com/user', { headers: gistHeaders() });
    if (!u.ok) {
      const j = await u.json().catch(() => ({}));
      throw new Error('Token 无效或权限不足（' + (j.message || ('HTTP ' + u.status)) + '）；请确认是「仅勾 gist 权限」的 Token');
    }
    const me = await u.json();
    // 2) 验证目标 Gist 是否对该 Token 可见
    const g = await fetch('https://api.github.com/gists/' + gistId, { headers: gistHeaders() });
    let gistMsg;
    if (g.ok) gistMsg = 'Gist 可访问 ✓';
    else if (g.status === 404) gistMsg = 'Gist 不可见：该 Token 无权访问，或 Gist ID 填错';
    else gistMsg = 'Gist 检测返回 HTTP ' + g.status;
    return { login: me.login, gist: gistMsg };
  }

  /* ---------- 自动同步（账户开启 autoSync 后，数据变更自动上传） ---------- */
  // _importing / _autoTimer 已在云端同步区顶部声明（见 GIST_FILE 之后）
  function scheduleAutoSync() {
    const a = getCurrentAccount();
    if (!a || !a.cloud || !a.cloud.autoSync) return;
    if (!a.cloud.token || !a.cloud.gistId) return;
    if (_autoTimer) clearTimeout(_autoTimer);
    _autoTimer = setTimeout(async () => {
      _autoTimer = null;
      try { await gistUpload(); }
      catch (e) { /* 自动同步失败静默处理，手动可点上传排查 */ }
    }, 1200);
  }
  function autoSyncTick() { if (!_importing) scheduleAutoSync(); }

  /* ---------- 导出 API ---------- */
  global.DB = {
    // 账户
    getAccounts, getAccount, getCurrentName, getCurrentAccount,
    registerAccount, verifyAccount, setCurrentName, logout,
    setAccountCloud, getCloud, setCloud, seedAccounts, migrateLegacy,
    // 业务
    getSubjects, addSubject, deleteSubject, renameSubject, MASTERY, isChineseDictKp,
    getKeywords, addKeyword, updateKeyword, deleteKeyword, pruneUnusedKeywords,
    getErrors, getError, addError, updateError, deleteError,
    nextDueDate, isMastered, dueReviews, recordReview, getRType, setKeywordRType,
    practiceOnceDays, addPracticeOnce, setMasteredFlag, setStar,
    snooze, getPracticeSession, setPracticeSession,
    getRedoList, addToRedo, removeFromRedo,
    toPinyin, seedIfEmpty, seedReviewDemo,
    exportData, importData, clearAll, snapshot,
    gistUpload, gistDownload, gistTest,
    _raw: () => ({ errors: read(K('errors'), []), keywords: read(K('keywords'), []) }),
  };
})(window);
