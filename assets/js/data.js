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
  const LVCHENG = { name: 'lvcheng', pass: '000000', gistId: 'f133c0baa8e6259ff36df4e584679544' };

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
    // 同步清理该科的关键词与错题引用
    let list = read(K('keywords'), []);
    const removed = list.filter(k => k.subject === name).map(k => k.id);
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
    list.forEach(k => { if (k.subject === oldName) k.subject = newName; });
    write(K('keywords'), list);
    const errs = read(K('errors'), []);
    errs.forEach(e => { if (e.subject === oldName) e.subject = newName; });
    write(K('errors'), errs);
    autoSyncTick();
    return true;
  }
  const MASTERY = {
    unknown: { key: 'unknown', label: '未掌握', cls: 'm-unknown' },
    fuzzy:   { key: 'fuzzy',   label: '部分掌握', cls: 'm-fuzzy' },
    known:   { key: 'known',   label: '已掌握', cls: 'm-known' },
  };
  // 语文专属：字词默写（录入后自动注音）
  const CHINESE_DICT_KP = '字词默写';

  const STORE = {
    errors: 'cb_errors_v1',
    keywords: 'cb_keywords_v1',
  };

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
  function addKeyword(type, name, subject) {
    const list = read(K('keywords'), []);
    const kw = { id: uid(), type, name: name.trim(), subject: subject || null };
    list.push(kw); write(K('keywords'), list); autoSyncTick(); return kw;
  }
  function updateKeyword(id, name) {
    const list = read(K('keywords'), []);
    const k = list.find(x => x.id === id); if (k) k.name = name.trim();
    write(K('keywords'), list); autoSyncTick(); return k;
  }
  function deleteKeyword(id) {
    let list = read(K('keywords'), []);
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

  /* ---------- 错题 ---------- */
  /**
   * error: {
   *   id, subject, mode:'text'|'image'|'mixed',
   *   text, image(dataURL), pinyin,
   *   kpId, srcId, mastery:'unknown'|'fuzzy'|'known',
   *   answer, createdAt,
   *   reviews: [{ date, correct:true|false }]
   * }
   * 已掌握判定：连续答对 3 次 或 累计答对 5 次（手动标 known 也算）。
   */
  function getErrors(filter) {
    let list = read(K('errors'), []);
    if (filter && filter.subject && filter.subject !== '全部') {
      list = list.filter(e => e.subject === filter.subject);
    }
    if (filter && filter.kpId) list = list.filter(e => e.kpId === filter.kpId);
    if (filter && filter.srcId) list = list.filter(e => e.srcId === filter.srcId);
    if (filter && filter.mastery) {
      if (filter.mastery === 'known') list = list.filter(e => isMastered(e));
      else list = list.filter(e => e.mastery === filter.mastery);
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
      text: '', image: null, pinyin: '',
      kpId: null, srcId: null, mastery: 'unknown',
      answer: '', reviews: [],
    }, data, { createdAt: (data && data.createdAt) ? data.createdAt : created });
    list.push(err); write(K('errors'), list); autoSyncTick(); return err;
  }

  function updateError(id, patch) {
    const list = read(K('errors'), []);
    const e = list.find(x => x.id === id);
    if (e) Object.assign(e, patch);
    write(K('errors'), list); autoSyncTick(); return e;
  }

  function deleteError(id) {
    let list = read(K('errors'), []);
    list = list.filter(x => x.id !== id);
    write(K('errors'), list); autoSyncTick();
  }

  /* ---------- 复习计划（间隔推送 + 掌握判定） ---------- */
  // 第 n 次复习的间隔天数（基于错题创建时间）：
  //   未掌握（unknown）：+2、+10、+30、+60、+90 …（之后每 30 天）
  //   部分掌握（fuzzy）：+30、+60、+90 …（之后每 30 天）
  function dueDaysForReview(n, mastery) {
    if (mastery === 'fuzzy') return 30 * (n + 1);   // 30, 60, 90, 120 ...
    if (n === 0) return 2;                          // 未掌握：2
    if (n === 1) return 10;                         // 未掌握：10
    return 30 * (n - 1);                            // 未掌握：30, 60, 90 ...
  }
  // 下一次应复习时间 = 创建时间 + 间隔
  function nextDueDate(e) {
    const n = (e.reviews || []).length;
    return new Date(e.createdAt).getTime() + dueDaysForReview(n, e.mastery) * DAY;
  }
  // 从 startIdx 起往回数，末尾「连续答对」的次数
  function tailCorrect(reviews, startIdx) {
    let c = 0;
    for (let i = reviews.length - 1; i >= startIdx; i--) {
      const r = reviews[i];
      const ok = r.correct !== undefined ? r.correct : (r.result === 'ok');
      if (ok) c++; else break;
    }
    return c;
  }
  // 是否已掌握（达成后即停止推送）：
  //   未掌握：除首次（+2 天）外，连续答对 2 次
  //   部分掌握：连续答对 2 次
  //   手动标记 known：直接算已掌握
  function isMastered(e) {
    if (e.mastery === 'known') return true;
    const rv = e.reviews || [];
    if (e.mastery === 'fuzzy') return tailCorrect(rv, 0) >= 2;
    return tailCorrect(rv, 1) >= 2;   // 未掌握：跳过首次 +2 天那次
  }
  // 待复习列表（未掌握且已到推送时间），按到期先后排序
  function dueReviews() {
    const nowT = Date.now();
    const list = read(K('errors'), []);
    const due = list.filter(e => !isMastered(e) && nextDueDate(e) <= nowT);
    return due.sort((a, b) => nextDueDate(a) - nextDueDate(b));
  }
  // 记录一次复习结果（correct: true/false）；达成条件后自动归类「已掌握」
  function recordReview(id, correct) {
    const e = getError(id);
    if (!e) return;
    e.reviews = e.reviews || [];
    e.reviews.push({ date: now(), correct: !!correct });
    if (isMastered(e)) e.mastery = 'known';   // 达成条件 → 归类已掌握，之后不再推送
    updateError(id, e);
    autoSyncTick();
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
      kpId: kp[2].id, srcId: src[1].id, mastery: 'fuzzy',
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
      id: uid(), subject: '数学', mode: 'text', text: '', image: null, pinyin: '',
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
        text: '默写：窈窕淑女，君子好逑。', kpId: kpOf('字词默写', '语文'), srcId: srcOf('作业', '语文'), mastery: 'fuzzy',
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
      errors: read(K('errors'), []),
    };
  }
  function exportData() { return snapshot(); }
  function importData(data) {
    if (!data || typeof data !== 'object') throw new Error('文件不是有效数据');
    if (!Array.isArray(data.errors) || !Array.isArray(data.keywords)) throw new Error('缺少错题或关键词数据');
    write(K('subjects'), (Array.isArray(data.subjects) && data.subjects.length) ? data.subjects : DEFAULT_SUBJECTS.slice());
    write(K('keywords'), data.keywords);
    write(K('errors'), data.errors);
    autoSyncTick();
  }
  function clearAll() {
    [K('subjects'), K('errors'), K('keywords')].forEach(k => { try { localStorage.removeItem(k); } catch (e) {} });
    getSubjects(); // 重建默认科目，保证应用仍可正常使用
  }

  /* ---------- 云端同步（GitHub Gist，纯前端，无需后端） ---------- */
  // 配置存本地：{ token, gistId, lastSync, lastResult }
  const GIST_FILE = 'cuotiben.json';
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
  // 上传：把当前完整快照写入 Gist（PATCH），并清理非标准残留文件
  async function gistUpload() {
    const cfg = getCloud();
    if (!cfg.token || !cfg.gistId) throw new Error('请先在设置里填写并保存 Token 与 Gist ID');
    const gistId = normGistId(cfg.gistId);
    if (!gistId) throw new Error('请先在设置里填写并保存 Token 与 Gist ID');
    // 先取现有文件名，把非 cuotiben.json 的杂散文件在 PATCH 时一并删除
    let existing = [];
    try {
      const g0 = await fetch('https://api.github.com/gists/' + gistId, { headers: gistHeaders() });
      if (g0.ok) { const j = await g0.json(); existing = Object.keys(j.files || {}); }
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
    try { importData(JSON.parse(f.content)); }
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
  let _autoTimer = null, _importing = false;
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
    getSubjects, addSubject, deleteSubject, renameSubject, MASTERY, CHINESE_DICT_KP,
    getKeywords, addKeyword, updateKeyword, deleteKeyword,
    getErrors, getError, addError, updateError, deleteError,
    dueDaysForReview, nextDueDate, isMastered, dueReviews, recordReview,
    toPinyin, seedIfEmpty, seedReviewDemo,
    exportData, importData, clearAll, snapshot,
    gistUpload, gistDownload, gistTest,
    _raw: () => ({ errors: read(K('errors'), []), keywords: read(K('keywords'), []) }),
  };
})(window);
