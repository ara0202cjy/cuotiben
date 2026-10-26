/* =========================================================
 * 错题本工作台 · 错题收集与复习
 * 移动端优先 / 清新淡雅 / 纯前端（localStorage + GitHub Gist 同步）
 * 模块：首页 / 错题本（筛选·勾选·导出·删除）/ 复习（间隔推送·批改）/ 我的（统计·关键词·来源）
 * ========================================================= */
(function () {
  'use strict';
  const DB = window.DB;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  // 兼容旧数据：优先用 images 数组，回退到单个 image
  function imgList(e) {
    if (Array.isArray(e.images) && e.images.length) return e.images;
    if (e.image) return [e.image];
    return [];
  }

  // 全屏看图：点击任意 .zoomable 图片时调用
  function openLightbox(src) {
    const ctx = $('#sheet').hidden ? document : $('#sheetBody');
    const imgs = $$('.zoomable', ctx).filter(img => img.offsetParent !== null);
    if (!imgs.length) return;
    let idx = imgs.findIndex(img => img.src === src);
    if (idx < 0) idx = 0;
    const lb = $('#lightbox'), lbi = $('#lbImg'), prev = $('#lbPrev'), next = $('#lbNext');
    function show(i) {
      idx = (i + imgs.length) % imgs.length;
      lbi.src = imgs[idx].src;
      const multi = imgs.length > 1;
      prev.hidden = !multi; next.hidden = !multi;
    }
    show(idx);
    lb.hidden = false;
    prev.onclick = ev => { ev.stopPropagation(); show(idx - 1); };
    next.onclick = ev => { ev.stopPropagation(); show(idx + 1); };
  }

  const state = { view: 'home', subject: '全部', filter: {}, expanded: {}, mastExpanded: {}, selectMode: false, selected: new Set(), mineFilter: { subject: '全部', kpId: null, srcId: null }, mineStatOpen: true, search: '', sort: 'created', selfTest: true };
  // 练习队列（选题重练）已持久化到账户存储并随云端同步，统一经 DB 读写（不再仅存内存）
  const getPractice = () => DB.getPracticeSession() || [];
  const setPractice = arr => DB.setPracticeSession(arr);
  // 错题重练清单（redo）：首页「错题重练」板块数据，常驻、批改后不清空（仅「移出」时移除）
  const getRedo = () => DB.getRedoList() || [];
  const addRedo = ids => DB.addToRedo(ids);
  const delRedo = id => DB.removeFromRedo(id);

  /* ---------------- 通用 UI ---------------- */
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 1600);
  }
  function openSheet(html) {
    const mask = $('#sheet'), body = $('#sheetBody');
    body.innerHTML = html;
    mask.hidden = false;
    body.querySelector('.close-x')?.addEventListener('click', closeSheet);
    return body;
  }
  function closeSheet() { $('#sheet').hidden = true; $('#sheetBody').innerHTML = ''; $('#lightbox').hidden = true; }
  $('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });
  // 全屏看图：捕获阶段处理，避免触发卡片折叠等冒泡行为
  document.addEventListener('click', e => {
    const z = e.target.closest && e.target.closest('.zoomable');
    if (!z) return;
    e.preventDefault(); e.stopPropagation();
    openLightbox(z.src);
  }, true);
  $('#lightbox').addEventListener('click', e => {
    if (e.target.id === 'lightbox' || e.target.id === 'lbClose') $('#lightbox').hidden = true;
  });

  function subjTag(s) { return `<span class="subj-tag subj-${s}">${s}</span>`; }
  function masteryTag(m) {
    const mm = DB.MASTERY[m] || DB.MASTERY.unknown;
    return `<span class="mastery ${mm.cls}">${mm.label}</span>`;
  }
  // 掌握状态展示（二态）：已掌握（停止推送或手动标记）/ 未掌握（仍在推送）
  function masteryDisplay(e) {
    return DB.isMastered(e)
      ? '<span class="mastery m-known">已掌握</span>'
      : '<span class="mastery m-unknown">未掌握</span>';
  }
  function kwName(id) { const k = DB.getKeywords().find(x => x.id === id); return k ? k.name : ''; }
  // 卡片顶部统一标签：科目 → 知识点 → 来源 → 题型 → 掌握情况
  function metaTagsHTML(e) {
    return subjTag(e.subject)
      + (e.kpId ? `<span class="tag">${esc(kwName(e.kpId))}</span>` : '')
      + (e.srcId ? `<span class="tag">${esc(kwName(e.srcId))}</span>` : '')
      + (e.kpId ? (DB.getRType(e) === 'drill' ? '<span class="tag drill">记忆型</span>' : '<span class="tag stable">稳定型</span>') : '')
      + (e.starred ? '<span class="tag star">★ 重点</span>' : '')
      + masteryDisplay(e);
  }
  function fmtDate(iso) {
    const d = new Date(iso); const p = n => (n < 10 ? '0' : '') + n;
    return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  function fmtDue(ts) {
    const d = new Date(ts); const p = n => (n < 10 ? '0' : '') + n;
    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
  }

  /* ---------------- 路由 ---------------- */
  const views = { home: renderHome, list: renderList, review: renderReview, mine: renderMine };
  function setView(name) {
    state.view = name;
    $('#topbarTitle').textContent = $('.tab[data-view="' + name + '"]')?.dataset.label || '错题本';
    $$('.tab[data-view]').forEach(t => t.classList.toggle('active', t.dataset.view === name));
    (views[name] || renderHome)();
    updateRevBadge();
  }

  // 底部「复习」角标：显示待复习数量
  function updateRevBadge() {
    const badge = document.getElementById('reviewBadge');
    if (!badge) return;
    const n = reviewList().length;
    badge.textContent = n > 99 ? '99+' : n;
    badge.hidden = n === 0;
  }

  // 打开页面时，若有到期复习则发浏览器通知（推送，需用户授权）
  function notifyDueReviews() {
    try {
      if (!('Notification' in window)) return;
      const n = DB.dueReviews().length;
      if (!n) return;
      const fire = () => new Notification('错题本提醒', { body: `你有 ${n} 道错题到时间复习啦 🌿` });
      if (Notification.permission === 'granted') fire();
      else if (Notification.permission !== 'denied') {
        Notification.requestPermission().then(p => { if (p === 'granted') fire(); });
      }
    } catch (e) { /* 通知不可用则忽略 */ }
  }
  $('#fabAdd').addEventListener('click', () => openEntry());
  $('#topbarSettings').addEventListener('click', openSettings);
  $$('.tab[data-view]').forEach(t => t.addEventListener('click', () => setView(t.dataset.view)));

  /* ---------------- 首页（紧凑：标题 + 三统计 + 今日需要复习） ---------------- */
  function renderHome() {
    const errs = DB.getErrors();
    const redoIds = getRedo();
    // 重练题已在「错题重练」专区展示，从「需要复习」里排除，避免两处重复提示
    const due = DB.dueReviews().filter(e => !redoIds.includes(e.id));
    const revCount = due.length;
    const known = errs.filter(e => DB.isMastered(e)).length;
    // 错题重练板块：手动加入即立即可见（不受自然到期限制）；只展示仍在攻克中的题（已掌握的不再需要重练）
    const redoDue = redoIds.map(id => DB.getError(id)).filter(Boolean)
      .filter(e => !DB.isMastered(e));

    $('#view').innerHTML = `
      <div class="hero compact">
        <div class="hero-title">
          <span class="ht-main">错题本</span><span class="ht-sub">（今天也要好好加油哦！）</span>
        </div>
        <div class="stat-row">
          <div class="stat"><div class="num">${errs.length}</div><div class="lab">错题总数</div></div>
          <div class="stat"><div class="num">${revCount}</div><div class="lab">待复习</div></div>
          <div class="stat"><div class="num">${known}</div><div class="lab">已掌握</div></div>
        </div>
      </div>
      <div class="card" style="margin-top:12px;padding:14px 16px">
        <p class="card-h" style="margin-bottom:8px">今日需要复习 <span style="color:var(--ink-2);font-weight:400">（${revCount} 道）</span></p>
        ${revCount
          ? `<div id="homeRevList">
              ${due.map(e => `
                <div class="rev-item">
                  <div class="rev-due">${dueLabel(e)}</div>
                  <div class="rev-card">
                    <div class="item-top">${metaTagsHTML(e)}
                      <button class="item-edit" data-edit="${e.id}" title="编辑 / 删除" aria-label="编辑">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                      </button>
                    </div>
                    ${errorExpandHTML(e, true)}
                  </div>
                </div>`).join('')}
            </div>`
          : '<div class="empty" style="padding:6px 0">今天没有到期要复习的错题，做得真棒 🎉</div>'}
        <button class="btn small ghost" id="goReview" style="width:100%;margin-top:10px">去复习页逐题批改 ›</button>
      </div>
      <div class="card" style="margin-top:12px;padding:14px 16px">
        <p class="card-h" style="margin-bottom:8px">错题重练 <span style="color:var(--ink-2);font-weight:400">（${redoDue.length} 道 · 手动加入集中练）</span></p>
        ${redoDue.length
          ? `<div id="homeRedoList">
              ${redoDue.map(e => `
                <div class="rev-item">
                  <div class="rev-due">${dueLabel(e)}</div>
                  <div class="rev-card">
                    <div class="item-top">${metaTagsHTML(e)}
                      <button class="redo-out" data-del-redo="${e.id}" title="移出重练（不删题库）" aria-label="移出重练">移出</button>
                      <button class="item-edit" data-edit="${e.id}" title="编辑 / 删除" aria-label="编辑">
                        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                      </button>
                    </div>
                    ${errorExpandHTML(e, true)}
                  </div>
                </div>`).join('')}
            </div>
            <button class="btn small ghost" id="goRedoGrade" style="width:100%;margin-top:10px">逐题批改 ›</button>`
          : '<div class="empty" style="padding:6px 0">还没有重练题。去「笔记本」勾选错题点「加入重练」，即可在此集中练习：对的按周期进入下一轮，错的次日再推，直到走完一个完整周期全对。</div>'}
      </div>`;
    $('#goReview')?.addEventListener('click', () => setView('review'));
    if (revCount) {
      $$('#homeRevList .item-edit').forEach(b => b.addEventListener('click', ev => {
        ev.stopPropagation(); openDetail(b.dataset.edit);
      }));
    }
    // 错题重练板块交互：看答案 / 进详情 / 移出（不动题库） / 逐题批改
    if (redoDue.length) {
      $$('#homeRedoList .item-edit').forEach(b => b.addEventListener('click', ev => {
        ev.stopPropagation(); openDetail(b.dataset.edit);
      }));
      $$('#homeRedoList .redo-out').forEach(b => b.addEventListener('click', ev => {
        ev.stopPropagation();
        delRedo(b.dataset.delRedo);
        toast('已移出重练板块（题库与学习记录不变）');
        renderHome();
      }));
      $('#goRedoGrade')?.addEventListener('click', () => renderGrade(redoDue, renderHome, { redo: true }));
    }
  }
  // 统一展开详情块：题目全文 + 图片 + 收录时间 + 做题记录（答案不在卡片展示，仅批改页可见）
  function errorExpandHTML(e, showImg = true) {
    const isP = isDictError(e);
    const qFull = isP ? (e.pinyin || e.text || '') : (e.text || '');
    const ok = e.reviews.filter(r => r.correct).length;
    const bad = e.reviews.length - ok;
    return `
      ${qFull ? `<div class="exp-q">${qFull}</div>` : ''}
      ${showImg ? imgList(e).map(s => `<img class="exp-img zoomable" src="${s}" alt=""/>`).join('') : ''}
      <div class="exp-meta-row"><span>收录于 ${fmtDate(e.createdAt)}</span><span>做题 ${e.reviews.length} 次 · 正确 ${ok} 次 · 错误 ${bad} 次</span></div>`;
  }

  // 复习卡片展开块：在 errorExpandHTML 基础上增加「答案」区（自测模式默认遮住）
  function reviewExpandHTML(e) {
    const isP = isDictError(e);
    const qFull = isP ? (e.pinyin || e.text || '') : (e.text || '');
    const ok = e.reviews.filter(r => r.correct).length;
    const bad = e.reviews.length - ok;
    const ans = (e.answer && String(e.answer).trim()) ? String(e.answer) : '';
    const hide = !!(state.selfTest && ans);
    return `
      ${qFull ? `<div class="exp-q">${qFull}</div>` : ''}
      ${imgList(e).map(s => `<img class="exp-img zoomable" src="${s}" alt=""/>`).join('')}
      ${ans ? `<div class="exp-ans" data-ans-body="${e.id}"${hide ? ' hidden' : ''}><span class="ga-k">答案：</span>${esc(ans)}</div>` : ''}
      ${hide ? `<button class="btn-show-ans" type="button" data-ans-btn="${e.id}">先自测 · 显示答案</button>` : ''}
      <div class="exp-meta-row"><span>收录于 ${fmtDate(e.createdAt)}</span><span>做题 ${e.reviews.length} 次 · 正确 ${ok} 次 · 错误 ${bad} 次</span></div>`;
  }

  function isDictError(e) {
    const kp = DB.getKeywords('kp').find(k => k.id === e.kpId);
    return e.subject === '语文' && kp && DB.isChineseDictKp(kp.name);
  }
  // 题目展示块：文字（字词默写为拼音）在上，图片在下
  function questionBlockHTML(e, isPinyin) {
    const qText = isPinyin ? (e.pinyin || e.text || '') : (e.text || '');
    const imgs = imgList(e);
    let h = '';
    if (qText) h += `<div class="detail-q">${qText}</div>`;
    h += imgs.map(s => `<img class="detail-img zoomable" src="${s}" alt=""/>`).join('');
    return h || '<div class="detail-q">（无内容）</div>';
  }
  function itemHTML(e, withDel, expandable, selectable, selected) {
    const imgs = imgList(e);
    const hasImg = imgs.length > 0;
    const isP = isDictError(e);
    const q = (isP ? (e.pinyin || e.text || '') : (e.text || '')).slice(0, 60);
    return `
      <div class="item${selectable && selected ? ' sel' : ''}" data-id="${e.id}">
        ${withDel ? `<button class="item-star${e.starred ? ' on' : ''}" data-star="${e.id}" title="${e.starred ? '取消重点' : '标为重点'}" aria-label="重点标星">${e.starred ? '★' : '☆'}</button>` : ''}
        ${withDel ? `<button class="item-edit" data-edit="${e.id}" title="编辑 / 删除" aria-label="编辑"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>` : ''}
        <div class="item-top">
          ${selectable ? `<input type="checkbox" class="item-check" data-id="${e.id}" ${selected ? 'checked' : ''} aria-label="选择"/>` : ''}
          ${metaTagsHTML(e)}
        </div>
        ${q ? `<div class="item-q">${q}</div>` : ''}
        ${hasImg ? imgs.map(s => `<img class="item-img zoomable" src="${s}" alt=""/>`).join('') : ''}
        ${expandable ? `<div class="item-exp" hidden>${errorExpandHTML(e, false)}</div>` : `
        <div class="item-when">录入于 ${fmtDate(e.createdAt)}</div>`}
      </div>`;
  }
  function bindItems() {
    $$('.item').forEach(it => {
      const exp = it.querySelector('.item-exp');
      if (exp) it.addEventListener('click', ev => {
        if (ev.target.closest('.item-edit') || ev.target.closest('.item-star')) return;
        exp.hidden = !exp.hidden;
        it.classList.toggle('open', !exp.hidden);
      });
      const edit = it.querySelector('.item-edit');
      if (edit) edit.addEventListener('click', ev => {
        ev.stopPropagation();
        openDetail(edit.dataset.edit);
      });
      // 重点标星：就地切换，不触发卡片展开
      const star = it.querySelector('.item-star');
      if (star) star.addEventListener('click', ev => {
        ev.stopPropagation();
        const id = star.dataset.star;
        const cur = DB.getError(id);
        const on = !(cur && cur.starred);
        DB.setStar(id, on);
        star.textContent = on ? '★' : '☆';
        star.classList.toggle('on', on);
        star.title = on ? '取消重点' : '标为重点';
        toast(on ? '已标为重点 ★' : '已取消重点');
      });
    });
  }

  /* ---------------- 账户登录 ---------------- */
  function injectLoginModal() {
    if (document.getElementById('loginMask')) return;
    const m = document.createElement('div');
    m.id = 'loginMask'; m.className = 'sheet-mask'; m.hidden = true;
    m.innerHTML = '<div class="sheet" id="loginBody"></div>';
    document.body.appendChild(m);
    m.addEventListener('click', e => { if (e.target === m) closeLoginModal(); });
  }
  function loginFormHTML() {
    return `
      <button class="close-x" id="loginClose">✕</button>
      <h3>账户登录</h3>
      <p class="set-tip2">登录后错题按账户隔离保存；开启自动同步的账户会实时备份到云端 Gist。已内置账户 lvcheng / 000000。</p>
      <div class="set-form">
        <label class="set-lbl">账户名</label>
        <input class="set-input" id="loginName" type="text" placeholder="如 lvcheng" autocomplete="username" />
        <label class="set-lbl">密码</label>
        <input class="set-input" id="loginPass" type="password" placeholder="请输入密码" autocomplete="current-password" />
        <div class="set-form-btns">
          <button class="btn small" id="loginBtn">登录</button>
          <button class="btn small ghost" id="regBtn">注册新账户</button>
        </div>
        <p class="cloud-status" id="loginMsg"></p>
        <button class="btn small ghost" id="localBtn" style="width:100%;margin-top:6px">以「本地游客」进入（不同步）</button>
      </div>`;
  }
  function bindLoginForm() {
    const b = document.getElementById('loginBody'); if (!b) return;
    $('#loginClose').addEventListener('click', () => closeLoginModal());
    $('#loginBtn').addEventListener('click', () => {
      const name = $('#loginName').value.trim(), pass = $('#loginPass').value;
      if (!DB.verifyAccount(name, pass)) { $('#loginMsg').textContent = '账户名或密码错误'; return; }
      DB.setCurrentName(name); closeLoginModal(); afterLogin();
    });
    $('#regBtn').addEventListener('click', () => {
      const name = ($('#loginName').value || '').trim();
      const pass = $('#loginPass').value;
      if (!name || !pass) { $('#loginMsg').textContent = '账户名与密码都不能为空'; return; }
      try { DB.registerAccount(name, pass); }
      catch (e) { $('#loginMsg').textContent = e.message; return; }
      DB.setCurrentName(name); closeLoginModal(); toast('账户已创建并登录 ✓'); afterLogin();
    });
    $('#localBtn').addEventListener('click', () => { DB.setCurrentName(null); closeLoginModal(); afterLogin(); });
    $('#loginPass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#loginBtn').click(); });
  }
  function openLoginModal() {
    injectLoginModal();
    document.getElementById('loginBody').innerHTML = loginFormHTML();
    bindLoginForm();
    document.getElementById('loginMask').hidden = false;
  }
  function closeLoginModal() { const m = document.getElementById('loginMask'); if (m) m.hidden = true; }
  function afterLogin() {
    DB.seedIfEmpty();
    const a = DB.getCurrentAccount();
    if (a && !DB.getCloud().token) {
      // 首次登录且本机尚无 Token：弹一次性引导（不在设置里，防止误改）
      openCloudGuide();
    } else {
      const c = DB.getCloud();
      if (c.autoSync && c.token && c.gistId) {
        DB.gistDownload().then(() => { toast('已从云端同步 ✓'); setView(state.view); })
          .catch(e => { toast('云端同步失败：' + e.message); });
      }
    }
    setView(state.view); updateRevBadge(); notifyDueReviews();
    // 注意：不再自动清理「无引用」的知识点 —— 新建但尚未挂错题的知识点会被误删。
  }

  // 登录后一次性云端配置引导（lvcheng 仅填 Token；其余账号填 Token + Gist ID）。不在设置内，杜绝误改。
  function openCloudGuide() {
    const a = DB.getCurrentAccount(); if (!a) return;
    const isLv = a.name === 'lvcheng';
    const c = DB.getCloud();
    openSheet(`
      <button class="close-x">✕</button>
      <h3>配置云端同步</h3>
      <p class="set-tip2">${isLv ? 'lvcheng 账户将自动同步到专属云端数据库。只需粘贴一次 Token，之后每次修改自动备份（Token 仅存本机，不公开）。' : '为该账户配置 GitHub Gist 云端同步，Token 仅存本机。'}<br/>同步内容为<b>本账户全部数据</b>：错题记录、复习 / 做题历史、掌握状态、科目与关键词等，换设备登录即自动拉回。</p>
      <div class="set-form">
        <label class="set-lbl">GitHub Token${isLv ? '（lvcheng 专用）' : ''}</label>
        <input class="set-input" id="guideToken" type="password" placeholder="ghp_ 开头" autocomplete="off" />
        <label class="set-lbl">Gist ID${isLv ? '（lvcheng 专用）' : ''}</label>
        <input class="set-input" id="guideGist" type="text" placeholder="gist 地址里的那串 ID" value="${esc(c.gistId || '')}" />
        <label class="set-chk"><input type="checkbox" id="guideAuto" ${c.autoSync ? 'checked' : ''}/> 自动同步（任何修改实时上传）</label>
        <div class="set-form-btns">
          <button class="btn small" id="guideSave">保存并同步</button>
          ${isLv ? '<button class="btn small ghost" id="guideSkip">稍后（暂不备份）</button>' : ''}
        </div>
        <p class="cloud-status" id="guideStatus"></p>
      </div>`);
    const save = async () => {
      const token = $('#guideToken').value.trim();
      if (!token) { $('#guideStatus').textContent = '请输入 Token'; return; }
      const patch = { token };
      patch.gistId = $('#guideGist').value.trim();
      patch.autoSync = $('#guideAuto').checked;
      DB.setCloud(patch);
      const btn = $('#guideSave'); btn.disabled = true;
      try {
        await DB.gistUpload().catch(() => {}); // 合并云端 + 本地后上传（本地优先，避免多设备后写覆盖丢数据）
        closeSheet(); toast('云端已配置并同步 ✓'); setView(state.view);
      } catch (e) { $('#guideStatus').textContent = '同步失败：' + e.message; btn.disabled = false; }
    };
    $('#guideSave').addEventListener('click', save);
    if (isLv) $('#guideSkip').addEventListener('click', () => closeSheet());
  }

  function openSettings() {
    const body = openSheet(`
      <button class="close-x">✕</button>
      <h3>设置</h3>
      <div class="set-group">
        <p class="set-title">账户</p>
        <div id="accountBox"></div>
      </div>
      <div class="set-group">
        <p class="set-title">数据迁移</p>
        <button class="set-row" id="setExport">
          <span class="set-ico">⬇</span><span class="set-label">导出数据</span>
          <span class="set-val">存为 JSON 文件</span>
        </button>
        <button class="set-row" id="setImport">
          <span class="set-ico">⬆</span><span class="set-label">导入数据</span>
          <span class="set-val">从 JSON 恢复</span>
        </button>
        <input type="file" id="importFile" accept="application/json,.json" hidden />
      </div>
      <div class="set-group">
        <p class="set-title">学科管理</p>
        <div id="setSubjList"></div>
        <button class="set-row" id="setSubjAdd">
          <span class="set-ico">＋</span><span class="set-label">新增学科</span>
          <span class="set-val">新建一个错题本</span>
        </button>
      </div>
      <div class="set-group">
        <p class="set-title">基础</p>
        <button class="set-row" id="setDemo">
          <span class="set-ico">🧪</span><span class="set-label">载入演示复习数据</span>
          <span class="set-val">插入若干待复习示例（不影响现有数据）</span>
        </button>
        <button class="set-row danger" id="setClear">
          <span class="set-ico">🗑</span><span class="set-label">一键清空数据</span>
          <span class="set-val">清空全部错题与关键词</span>
        </button>
      </div>
      <div class="set-group">
        <p class="set-title">云端同步说明</p>
        <p class="set-tip">已登录并开启自动同步的账户，所有修改会实时备份到你自己的 GitHub Gist（私密云端）。<b>同步覆盖本账户的全部数据</b>：</p>
        <ul style="margin:6px 0 2px 18px;color:var(--ink-2);font-size:13px;line-height:1.8">
          <li><b>错题记录</b>：题目、正确答案、图片、拼音、所属科目 / 知识点 / 来源</li>
          <li><b>复习情况</b>：每道题的做题对错历史、掌握状态（未掌握 / 已掌握）、下次复习时间</li>
          <li><b>科目、关键词、来源</b>等全部设置项</li>
        </ul>
        <p class="set-tip" style="margin-top:6px">换手机 / 清缓存后，用同一账户登录即可自动拉回全部数据，不会丢失。账户密码与 Token 只存本机，<b>不会</b>上传云端。</p>
      </div>`);

    $('#setExport').addEventListener('click', () => {
      try {
        const data = DB.exportData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = '错题本数据_' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('已导出数据文件 ✓');
      } catch (err) { toast('导出失败'); }
    });
    $('#setImport').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      const r = new FileReader();
      r.onload = ev => {
        try {
          const data = JSON.parse(ev.target.result);
          DB.importData(data);
          closeSheet(); toast('数据已导入 ✓');
          setView(state.view);
        } catch (err) { toast('导入失败：' + (err.message || '文件格式错误')); }
      };
      r.readAsText(file);
      e.target.value = '';
    });
    $('#setClear').addEventListener('click', () => {
      if (confirm('确定清空全部错题、关键词与科目？此操作不可恢复。')) {
        DB.clearAll(); closeSheet(); toast('已清空全部数据'); setView('home');
      }
    });
    $('#setDemo').addEventListener('click', () => {
      const n = DB.seedReviewDemo(true);
      closeSheet();
      toast('已载入 ' + n + ' 道演示错题（含几日前数据），去「复习」看看 ✓');
      setView('review');
    });

    // 云端同步已移至「登录后一次性引导」，设置内不再暴露可改的配置（防止误改）

    function renderAccountBox() {
      const box = document.getElementById('accountBox'); if (!box) return;
      const cur = DB.getCurrentAccount();
      if (cur) {
        const cl = DB.getCloud() || {};
        let syncTxt = '未配置（下次登录会再提示）';
        if (cl.token) {
          syncTxt = cl.autoSync
            ? ('已开启 · 自动备份' + (cl.lastSync ? '（上次 ' + fmtDate(cl.lastSync) + '）' : ''))
            : '已配置 · 未开启自动备份';
        }
        box.innerHTML = `
          <div class="set-row" style="cursor:default">
            <span class="set-ico">👤</span><span class="set-label">当前账户</span><span class="set-val">${esc(cur.name)}</span>
          </div>
          <div class="set-row" id="accSyncRow" style="cursor:pointer" title="点击立即同步一次（配置不可修改）">
            <span class="set-ico">☁</span><span class="set-label">云端同步</span><span class="set-val">${esc(syncTxt)}</span>
          </div>
          <button class="set-row" id="accLogout"><span class="set-ico">⏏</span><span class="set-label">退出登录</span><span class="set-val">切到本地 / 其他账户</span></button>
          <button class="set-row" id="accSwitch"><span class="set-ico">🔁</span><span class="set-label">切换 / 登录其他账户</span><span class="set-val">打开登录窗口</span></button>`;
        $('#accLogout').addEventListener('click', () => { DB.logout(); closeSheet(); openLoginModal(); });
        $('#accSwitch').addEventListener('click', () => { closeSheet(); openLoginModal(); });
        // 点击状态行 = 立即同步一次（只读展示之外不暴露任何可改配置）
        const sr = document.getElementById('accSyncRow');
        if (sr) sr.addEventListener('click', async () => {
          if (await cloudSyncNow()) { toast('已同步 ✓'); renderAccountBox(); }
        });
      } else {
        box.innerHTML = `
          <div class="set-row" style="cursor:default">
            <span class="set-ico">🧭</span><span class="set-label">当前模式</span><span class="set-val">本地游客（不同步）</span>
          </div>
          <button class="set-row" id="accLogin"><span class="set-ico">🔐</span><span class="set-label">登录 / 注册账户</span><span class="set-val">开启按账户隔离与云端同步</span></button>`;
        $('#accLogin').addEventListener('click', () => { closeSheet(); openLoginModal(); });
      }
    }

    // 学科管理：在设置内增 / 删 / 改，笔记本页实时同步
    function renderSetSubjList() {
      const el = document.getElementById('setSubjList'); if (!el) return;
      const subs = DB.getSubjects();
      el.innerHTML = subs.map(s => `
        <div class="set-subj">
          <span class="set-label" style="flex:1">${esc(s)}</span>
          <span class="tag">${DB.getErrors({ subject: s }).length} 道</span>
          <button class="opt" data-edit="${esc(s)}">改</button>
          <button class="opt" data-del="${esc(s)}" style="color:var(--bad)">删</button>
        </div>`).join('');
      el.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
        const old = b.dataset.edit, n = prompt('修改为：', old);
        if (n && n.trim()) {
          if (DB.renameSubject(old, n)) { toast('已改名 ✓'); renderSetSubjList(); if (state.view === 'list') renderList(); }
          else toast('改名失败：名称已存在或无效');
        }
      }));
      el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
        const s = b.dataset.del;
        if (DB.getSubjects().length <= 1) { toast('至少保留一个学科'); return; }
        if (confirm(`删除「${s}」？该科错题与关键词会一并清除。`)) {
          DB.deleteSubject(s); renderSetSubjList(); if (state.view === 'list') renderList();
        }
      }));
    }
    $('#setSubjAdd').addEventListener('click', () => {
      const n = prompt('输入新学科名称（如：物理）：'); if (n && n.trim()) {
        if (DB.addSubject(n)) { renderSetSubjList(); if (state.view === 'list') renderList(); }
        else toast('该学科已存在');
      }
    });
    renderSetSubjList();
    renderAccountBox();
  }

  /* ---------------- 错题本（折叠错题本 + 预览/筛选） ---------------- */
  // 全库搜索：匹配 题目 / 答案 / 拼音 / 知识点 / 来源
  function searchMatch(e) {
    const q = (state.search || '').trim().toLowerCase();
    if (!q) return true;
    const hay = [e.text, e.answer, e.pinyin, kwName(e.kpId), kwName(e.srcId)]
      .filter(Boolean).join(' ').toLowerCase();
    return hay.indexOf(q) !== -1;
  }
  // 列表排序：录入时间（默认，新→旧）/ 错题次数（多→少）/ 下次推送（近→远）/ 重点优先
  function sortErrs(list) {
    const arr = list.slice();
    const t = x => new Date(x.createdAt || 0).getTime() || 0;
    const k = state.sort || 'created';
    if (k === 'wrong') arr.sort((a, b) => wrongCount(b) - wrongCount(a) || t(b) - t(a));
    else if (k === 'due') arr.sort((a, b) => {
      const da = DB.nextDueDate(a), db2 = DB.nextDueDate(b);
      const va = da === Infinity ? Number.MAX_SAFE_INTEGER : da;
      const vb = db2 === Infinity ? Number.MAX_SAFE_INTEGER : db2;
      return va - vb || t(b) - t(a);
    });
    else if (k === 'star') arr.sort((a, b) => (b.starred ? 1 : 0) - (a.starred ? 1 : 0) || t(b) - t(a));
    else arr.sort((a, b) => t(b) - t(a));
    return arr;
  }
  // 某学科在当前「筛选 + 搜索」下的可见错题
  function visibleSubjectErrs(s) {
    return sortErrs(listSubjectErrs(s).filter(searchMatch));
  }
  function renderList() {
    const subjects = DB.getSubjects();
    const expanded = state.expanded || {};
    const f = state.filter;
    const hasFilter = !!(f.kpId || f.srcId || f.mastery || f.wrong || f.from || f.to || (state.subject && state.subject !== '全部') || (state.search && state.search.trim()));
    const total = DB.getErrors().length;
    const allOpen = subjects.length > 0 && subjects.every(s => expanded[s]);

    // 筛选 / 搜索模式下，只展示「有符合筛选错题」的学科笔记本，保持界面紧凑
    const showSubjects = hasFilter ? subjects.filter(s => visibleSubjectErrs(s).length > 0) : subjects;

    $('#view').innerHTML = `
      <div class="nb-search">
        <input id="nbSearch" type="search" placeholder="搜索题目 / 答案 / 拼音 / 知识点…" value="${esc(state.search || '')}" />
      </div>
      <div class="nb-tools nb-row1">
        <button class="btn ghost" id="openFilter">筛选${filterLabel()}</button>
        <button class="btn ghost" id="toggleSelect">${state.selectMode ? '完成' : '勾选'}</button>
        <button class="btn ghost" id="selectAll">全选</button>
        <button class="btn ghost" id="toggleAll">${allOpen ? '收起' : '展开'}</button>
      </div>
      <div class="nb-sort">
        <span class="sort-lab">排序</span>
        <select id="nbSort" class="sort-select" aria-label="错题排序">
          <option value="created" ${state.sort === 'created' ? 'selected' : ''}>录入时间（新→旧）</option>
          <option value="wrong" ${state.sort === 'wrong' ? 'selected' : ''}>错题次数（多→少）</option>
          <option value="due" ${state.sort === 'due' ? 'selected' : ''}>下次推送（近→远）</option>
          <option value="star" ${state.sort === 'star' ? 'selected' : ''}>重点优先</option>
        </select>
      </div>
      ${state.selectMode ? `
      <p class="nb-selcnt">已选 ${state.selected.size} 道</p>
      <div class="nb-tools nb-act">
        <button class="btn" id="repSel">加入重练</button>
        <button class="btn" id="expSel">导出PDF</button>
        <button class="btn ghost nb-danger" id="delSel">删除选中</button>
      </div>
      <div class="nb-tools nb-act" style="margin-top:8px">
        <button class="btn ghost" id="batchEdit">批量改属性</button>
        <button class="btn ghost" id="selNone">清空选择</button>
      </div>` : ''}
      <p class="list-hint">点开任一错题本可预览内容 · 共 ${total} 道 · 点 ✕ 可删减${hasFilter ? '（已按筛选隐藏无匹配学科）' : ''}</p>
      ${showSubjects.length ? showSubjects.map(s => {
        const errsAll = DB.getErrors({ subject: s });
        const errs = visibleSubjectErrs(s);
        const isOpen = !!expanded[s];
        const allSel = errs.length > 0 && errs.every(e => state.selected.has(e.id));
        // 已掌握题单独折叠：仅在「未显式只看已掌握」时，将已掌握题收进折叠卡片，避免与待练题混在一起
        const showAllErrs = f.mastery === 'known';
        const unmastered = showAllErrs ? [] : errs.filter(e => !DB.isMastered(e));
        const mastered = errs.filter(e => DB.isMastered(e));
        const mainErrs = showAllErrs ? errs : unmastered;
        const showMastCard = !showAllErrs && mastered.length > 0;
        let mainInner;
        if (mainErrs.length) mainInner = mainErrs.map(e => itemHTML(e, true, true, state.selectMode, state.selected.has(e.id))).join('');
        else if (mastered.length && !showAllErrs) mainInner = `<div class="book-empty">本本暂无未掌握错题，已掌握题已折叠在下方 ✓</div>`;
        else mainInner = `<div class="book-empty">${hasFilter ? '该本无符合筛选的错题' : '本错题本还是空的，点 ＋ 录入吧'}</div>`;
        return `
        <div class="book">
          <div class="book-head" data-s="${s}">
            ${state.selectMode ? `<input type="checkbox" class="book-check" data-s="${s}" ${allSel ? 'checked' : ''} aria-label="全选本本"/>` : ''}
            ${subjTag(s)}
            <span class="book-cnt">${errsAll.length} 道</span>
            <span class="book-chev">${isOpen ? '▾' : '▸'}</span>
          </div>
          <div class="book-body" id="book-${s}" ${isOpen ? '' : 'hidden'}>
            ${mainInner}
          </div>
          ${showMastCard ? `
          <div class="mast-card">
            <div class="mast-head" data-ms="${s}">
              <span class="mast-label">已掌握 ${mastered.length} 题</span>
              <span class="mast-chev">${state.mastExpanded[s] ? '▾' : '▸'}</span>
            </div>
            <div class="mast-body" id="mast-${s}" ${state.mastExpanded[s] ? '' : 'hidden'}>
              ${mastered.map(e => itemHTML(e, true, true, state.selectMode, state.selected.has(e.id))).join('')}
            </div>
          </div>` : ''}
        </div>`;
      }).join('') : `<div class="empty">没有符合当前筛选的错题</div>`}`;

    $('#openFilter').addEventListener('click', () => openFilter());
    // 排序切换：只改展示顺序，不动数据
    $('#nbSort')?.addEventListener('change', e => { state.sort = e.target.value; renderList(); });
    $('#toggleSelect').addEventListener('click', () => {
      state.selectMode = !state.selectMode;
      if (!state.selectMode) state.selected.clear();
      renderList();
    });
    $('#selectAll').addEventListener('click', () => {
      state.selectMode = true;
      const ids = [];
      showSubjects.forEach(s => visibleSubjectErrs(s).forEach(e => ids.push(e.id)));
      state.selected = new Set(ids);
      renderList();
    });
    $('#toggleAll').addEventListener('click', () => {
      const all = subjects.every(s => state.expanded[s]);
      subjects.forEach(s => (state.expanded[s] = !all));
      renderList();
    });
    // 全库搜索：输入即筛选（重渲染后保持焦点与光标位置）
    const sb = $('#nbSearch');
    if (sb) sb.addEventListener('input', () => {
      state.search = sb.value;
      renderList();
      const ns = $('#nbSearch'); if (ns) { const v = ns.value; ns.focus(); ns.value = ''; ns.value = v; }
    });
    if (state.selectMode) {
      $('#repSel').addEventListener('click', () => {
        const ids = Array.from(state.selected);
        if (!ids.length) { toast('请先勾选要重练的错题'); return; }
        const errs = ids.map(id => DB.getError(id)).filter(Boolean);
        if (!errs.length) { toast('没有可重练的错题'); return; }
        // 选中题加入首页「错题重练」板块（常驻重练清单；不动题库，仅加入重练池）
        addRedo(ids);
        setView('home');
        toast(`已加入错题重练 ${ids.length} 道 · 在首页「错题重练」板块集中练习`);
      });
      $('#delSel').addEventListener('click', () => {
        const ids = Array.from(state.selected);
        if (!ids.length) { toast('请先勾选要删除的错题'); return; }
        if (!confirm(`确定删除选中的 ${ids.length} 道错题？此操作不可恢复`)) return;
        ids.forEach(id => DB.deleteError(id));
        state.selected.clear();
        renderList();
        toast('已删除 ' + ids.length + ' 道错题');
      });
      $('#expSel').addEventListener('click', () => openExportSelect(Array.from(state.selected)));
      $('#batchEdit')?.addEventListener('click', () => openBatchEdit(Array.from(state.selected)));
      $('#selNone').addEventListener('click', () => { state.selected.clear(); renderList(); });
    }
    $$('.book-head').forEach(h => h.addEventListener('click', () => {
      const s = h.dataset.s; state.expanded[s] = !state.expanded[s];
      const body = document.getElementById('book-' + s);
      if (body) body.hidden = !state.expanded[s];
      const chev = h.querySelector('.book-chev'); if (chev) chev.textContent = state.expanded[s] ? '▾' : '▸';
    }));
    // 「已掌握」折叠卡片：默认收起，点击标题展开/收起
    $$('.mast-head').forEach(h => h.addEventListener('click', () => {
      const s = h.dataset.ms; state.mastExpanded[s] = !state.mastExpanded[s];
      const body = document.getElementById('mast-' + s);
      if (body) body.hidden = !state.mastExpanded[s];
      const chev = h.querySelector('.mast-chev'); if (chev) chev.textContent = state.mastExpanded[s] ? '▾' : '▸';
    }));
    bindItems();
    bindItemChecks();
    bindBookChecks();
  }
  // 勾选模式：卡片复选框切换选中状态
  function bindItemChecks() {
    $$('.item-check').forEach(c => c.addEventListener('click', e => {
      e.stopPropagation();
      const id = c.dataset.id;
      if (c.checked) state.selected.add(id); else state.selected.delete(id);
      c.closest('.item')?.classList.toggle('sel', c.checked);
      const cnt = document.querySelector('.nb-selcnt'); if (cnt) cnt.textContent = '已选 ' + state.selected.size + ' 道';
    }));
  }
  // 勾选模式：每个笔记本前的复选框，一键全选/取消本本错题
  function bindBookChecks() {
    $$('.book-check').forEach(c => {
      const s = c.dataset.s;
      const errs = visibleSubjectErrs(s);
      const sel = errs.filter(e => state.selected.has(e.id)).length;
      c.indeterminate = sel > 0 && sel < errs.length;
      c.addEventListener('click', e => {
        e.stopPropagation();
        if (c.checked) errs.forEach(e => state.selected.add(e.id));
        else errs.forEach(e => state.selected.delete(e.id));
        renderList();
      });
    });
  }
  /* ---------------- 批量改属性 ---------------- */
  // 对勾选的多道错题统一修改：掌握状态 / 学科 / 知识点 / 来源 / 重点标星
  function openBatchEdit(ids) {
    ids = (ids || []).filter(Boolean);
    if (!ids.length) { toast('请先勾选要修改的错题'); return; }
    const subs = DB.getSubjects();
    let masterySel = '', subjSel = '', kpSel = '', srcSel = '', starSel = '';
    const body = openSheet(`
      <button class="close-x">✕</button>
      <h3>批量改属性（${ids.length} 道）</h3>
      <p class="set-tip2">只应用你选中的项；「不改」表示保持原样。改学科会清空原知识点 / 来源（可在下方一并重选）。</p>
      <div class="field"><label>掌握状态</label><div class="kw-box" id="bM">
        <span class="kw active" data-v="">不改</span>
        <span class="kw" data-v="unknown">未掌握</span>
        <span class="kw" data-v="known">已掌握</span>
      </div></div>
      <div class="field"><label>学科</label><div class="kw-box" id="bS">
        <span class="kw active" data-v="">不改</span>
        ${subs.map(s => `<span class="kw" data-v="${esc(s)}">${esc(s)}</span>`).join('')}
      </div></div>
      <div class="field"><label>知识点</label><div class="kw-box" id="bK"></div></div>
      <div class="field"><label>来源</label><div class="kw-box" id="bR"></div></div>
      <div class="field"><label>重点标星</label><div class="kw-box" id="bT">
        <span class="kw active" data-v="">不改</span>
        <span class="kw" data-v="1">标为重点 ★</span>
        <span class="kw" data-v="0">取消重点</span>
      </div></div>
      <button class="btn" id="bApply">应用到 ${ids.length} 道</button>`);

    function bindSingle(boxId, onPick) {
      const box = document.getElementById(boxId);
      box.querySelectorAll('.kw').forEach(w => w.addEventListener('click', () => {
        box.querySelectorAll('.kw').forEach(x => x.classList.remove('active'));
        w.classList.add('active');
        onPick(w.dataset.v || '');
      }));
    }
    function kwListHTML(type, subject) {
      const list = DB.getKeywords(type).filter(k => !subject || k.subject === subject);
      return `<span class="kw active" data-v="">不改</span><span class="kw" data-v="__none">清空</span>`
        + list.map(k => `<span class="kw" data-v="${k.id}">${esc(k.name)}</span>`).join('');
    }
    function renderLists() {
      const bk = document.getElementById('bK'), br = document.getElementById('bR');
      bk.innerHTML = kwListHTML('kp', subjSel);
      br.innerHTML = kwListHTML('src', subjSel);
      bindSingle('bK', v => { kpSel = v; });
      bindSingle('bR', v => { srcSel = v; });
    }
    bindSingle('bM', v => { masterySel = v; });
    bindSingle('bS', v => { subjSel = v; kpSel = ''; srcSel = ''; renderLists(); });
    bindSingle('bT', v => { starSel = v; });
    renderLists();

    $('#bApply').addEventListener('click', () => {
      if (!masterySel && !subjSel && kpSel === '' && srcSel === '' && starSel === '') {
        toast('请至少选择一项要修改的属性'); return;
      }
      const kpObj = (kpSel && kpSel !== '__none') ? DB.getKeywords('kp').find(k => k.id === kpSel) : null;
      const srcObj = (srcSel && srcSel !== '__none') ? DB.getKeywords('src').find(k => k.id === srcSel) : null;
      const stamp = new Date().toISOString();
      let n = 0;
      ids.forEach(id => {
        const e = DB.getError(id); if (!e) return;
        const patch = {};
        const targetSubj = (kpObj && kpObj.subject) || (srcObj && srcObj.subject) || subjSel || '';
        if (masterySel) patch.mastery = masterySel;
        if (targetSubj) patch.subject = targetSubj;
        // 学科变化且未显式重选知识点/来源 → 清空，避免跨科错挂
        if (targetSubj && targetSubj !== e.subject) {
          if (kpSel === '' && !kpObj) patch.kpId = null;
          if (srcSel === '' && !srcObj) patch.srcId = null;
        }
        if (kpSel === '__none') patch.kpId = null;
        else if (kpObj) patch.kpId = kpSel;
        if (srcSel === '__none') patch.srcId = null;
        else if (srcObj) patch.srcId = srcSel;
        if (starSel === '1') { patch.starred = true; patch.starAt = stamp; }
        else if (starSel === '0') { patch.starred = false; patch.starAt = stamp; }
        if (Object.keys(patch).length) { DB.updateError(id, patch); n++; }
      });
      state.selected.clear();
      closeSheet();
      renderList();
      toast(`已批量修改 ${n} 道 ✓`);
    });
  }
  // 错题次数 = 该错题在复习中被判错的次数（reviews 中 correct 为 false 的条数）
  function wrongCount(e) { return (e.reviews || []).filter(r => !r.correct).length; }
  // 按「错题次数」筛选：0 / 1 / 2 / ≥3
  function applyWrongFilter(list, f) {
    if (!f || !f.wrong) return list;
    return list.filter(e => {
      const w = wrongCount(e);
      if (f.wrong === '0') return w === 0;
      if (f.wrong === '1') return w === 1;
      if (f.wrong === '2') return w === 2;
      if (f.wrong === '3p') return w >= 3;
      return true;
    });
  }
  function filterLabel() {
    const f = state.filter; let n = 0;
    if (state.subject && state.subject !== '全部') n++;
    if (f.kpId) n++; if (f.srcId) n++; if (f.mastery) n++;
    if (f.wrong) n++;
    if (f.from || f.to) n++;
    return n ? `（${n}）` : '';
  }
  // 取某学科在当前筛选下匹配的错题（笔记本渲染与勾选共用）
  function listSubjectErrs(s) {
    const f = state.filter;
    const hasFilter = !!(f.kpId || f.srcId || f.mastery || f.wrong || f.from || f.to || (state.subject && state.subject !== '全部'));
    let list = DB.getErrors(Object.assign({ subject: s }, (f.kpId || f.srcId || f.mastery) ? f : {}));
    // 起止时间筛选：按录入日期 createdAt 的 YYYY-MM-DD 比较，含边界（from/to 为空表示不限）
    if (f.from || f.to) {
      list = list.filter(e => {
        const day = (e.createdAt || '').slice(0, 10);
        if (f.from && day < f.from) return false;
        if (f.to && day > f.to) return false;
        return true;
      });
    }
    // 错题次数筛选：0 / 1 / 2 / ≥3
    list = applyWrongFilter(list, f);
    return list;
  }

  /* ---------------- 高频词：按错题中的使用次数排序，取前 N 个 ---------------- */
  function topKeywords(type, lockSubject, currentId, limit) {
    const cnt = new Map();
    DB.getErrors().forEach(e => {
      const id = type === 'kp' ? e.kpId : e.srcId;
      if (!id) return;
      if (lockSubject && e.subject !== lockSubject) return;
      cnt.set(id, (cnt.get(id) || 0) + 1);
    });
    const list = DB.getKeywords(type)
      .filter(k => (!lockSubject || k.subject === lockSubject) && (cnt.get(k.id) || 0) > 0)
      .sort((a, b) => (cnt.get(b.id) || 0) - (cnt.get(a.id) || 0));
    const top = list.slice(0, limit || 6).map(k => ({ id: k.id, name: k.name, count: cnt.get(k.id) || 0 }));
    // 当前已选中的词若不在高频内也要保留，避免选中项“消失”
    if (currentId && !top.some(k => k.id === currentId)) {
      const cur = DB.getKeywords(type).find(k => k.id === currentId);
      if (cur) top.push({ id: cur.id, name: cur.name, count: cnt.get(cur.id) || 0 });
    }
    return top;
  }

  /* ---------------- 筛选（可锁定某一错题本） ---------------- */
  function openFilter(lockSubject) {
    const f = state.filter;
    const subjects = lockSubject ? [lockSubject] : ['全部', ...DB.getSubjects()];
    let selSubj = lockSubject || state.subject || '全部';
    // 知识点/来源跟随所选学科（二级联动）：全部=不按学科过滤；显示全部已定义项（无错题的会被自动清理）
    const kpTop = topKeywords('kp', selSubj === '全部' ? null : selSubj, f.kpId, 9999);
    const srcTop = topKeywords('src', selSubj === '全部' ? null : selSubj, f.srcId, 9999);
    const body = openSheet(`
      <button class="close-x">✕</button>
      <h3>${lockSubject ? '筛选「' + lockSubject + '」本内容' : '筛选错题'}</h3>
      <div class="f-row">
        ${lockSubject ? '' : `<div class="f-group"><label>学科</label><div class="kw-box" id="fSubj">
          ${subjects.map(s => `<span class="kw ${state.subject === s ? 'active' : ''}" data-subj="${esc(s)}">${esc(s)}</span>`).join('')}
        </div></div>`}
        <div class="f-group"><label>知识点</label><div class="kw-box" id="fKp">
          <span class="kw ${!f.kpId ? 'active' : ''}" data-kp="">不限</span>
          ${kpTop.map(k => `<span class="kw ${f.kpId === k.id ? 'active' : ''}" data-kp="${k.id}">${esc(k.name)}<span class="cnt">${k.count}</span></span>`).join('')}
        </div></div>
        <div class="f-group"><label>来源</label><div class="kw-box" id="fSrc">
          <span class="kw ${!f.srcId ? 'active' : ''}" data-src="">不限</span>
          ${srcTop.map(k => `<span class="kw ${f.srcId === k.id ? 'active' : ''}" data-src="${k.id}">${esc(k.name)}<span class="cnt">${k.count}</span></span>`).join('')}
        </div></div>
        <div class="f-group"><label>掌握</label><div class="kw-box" id="fM">
          <span class="kw ${!f.mastery ? 'active' : ''}" data-m="">不限</span>
          ${Object.values(DB.MASTERY).map(m => `<span class="kw ${f.mastery === m.key ? 'active' : ''}" data-m="${m.key}">${m.label}</span>`).join('')}
        </div></div>
        <div class="f-group"><label>错题次数</label><div class="kw-box" id="fW">
          <span class="kw ${!f.wrong ? 'active' : ''}" data-w="">不限</span>
          <span class="kw ${f.wrong === '0' ? 'active' : ''}" data-w="0">0 次</span>
          <span class="kw ${f.wrong === '1' ? 'active' : ''}" data-w="1">1 次</span>
          <span class="kw ${f.wrong === '2' ? 'active' : ''}" data-w="2">2 次</span>
          <span class="kw ${f.wrong === '3p' ? 'active' : ''}" data-w="3p">≥3 次</span>
        </div></div>
        <div class="f-group f-date"><label>起止时间（按录入日期）</label>
          <div class="date-row">
            <input type="date" id="fFrom" class="date-input" value="${esc(f.from || '')}" />
            <span class="date-sep">至</span>
            <input type="date" id="fTo" class="date-input" value="${esc(f.to || '')}" />
          </div>
        </div>
      </div>
      <div class="btn-row">
        <button class="btn ghost" id="fReset">重置</button>
        <button class="btn" id="fApply">应用</button>
      </div>`);
    if (!lockSubject) {
      // 按所选学科重新填充知识点/来源（二级联动），并清空已选的 KP/来源
      const fillKp = (subj, keepId) => {
        const top = topKeywords('kp', subj === '全部' ? null : subj, keepId || null, 9999);
        const box = document.getElementById('fKp');
        box.innerHTML = `<span class="kw ${!keepId ? 'active' : ''}" data-kp="">不限</span>`
          + top.map(k => `<span class="kw ${keepId === k.id ? 'active' : ''}" data-kp="${k.id}">${esc(k.name)}<span class="cnt">${k.count}</span></span>`).join('');
        box.querySelectorAll('.kw').forEach(w => w.addEventListener('click', () => {
          box.querySelectorAll('.kw').forEach(y => y.classList.remove('active')); w.classList.add('active');
        }));
      };
      const fillSrc = (subj, keepId) => {
        const top = topKeywords('src', subj === '全部' ? null : subj, keepId || null, 9999);
        const box = document.getElementById('fSrc');
        box.innerHTML = `<span class="kw ${!keepId ? 'active' : ''}" data-src="">不限</span>`
          + top.map(k => `<span class="kw ${keepId === k.id ? 'active' : ''}" data-src="${k.id}">${esc(k.name)}<span class="cnt">${k.count}</span></span>`).join('');
        box.querySelectorAll('.kw').forEach(w => w.addEventListener('click', () => {
          box.querySelectorAll('.kw').forEach(y => y.classList.remove('active')); w.classList.add('active');
        }));
      };
      body.querySelectorAll('#fSubj .kw').forEach(x => x.addEventListener('click', () => {
        body.querySelectorAll('#fSubj .kw').forEach(y => y.classList.remove('active'));
        x.classList.add('active');
        selSubj = x.dataset.subj;
        fillKp(selSubj, null); fillSrc(selSubj, null);
      }));
    }
    body.querySelectorAll('#fKp .kw').forEach(x => x.addEventListener('click', () => {
      body.querySelectorAll('#fKp .kw').forEach(y => y.classList.remove('active'));
      x.classList.add('active');
    }));
    body.querySelectorAll('#fSrc .kw').forEach(x => x.addEventListener('click', () => {
      body.querySelectorAll('#fSrc .kw').forEach(y => y.classList.remove('active'));
      x.classList.add('active');
    }));
    body.querySelectorAll('#fM .kw').forEach(x => x.addEventListener('click', () => {
      body.querySelectorAll('#fM .kw').forEach(y => y.classList.remove('active'));
      x.classList.add('active');
    }));
    body.querySelectorAll('#fW .kw').forEach(x => x.addEventListener('click', () => {
      body.querySelectorAll('#fW .kw').forEach(y => y.classList.remove('active'));
      x.classList.add('active');
    }));
    $('#fReset').addEventListener('click', () => {
      state.subject = lockSubject || '全部'; state.filter = {};
      if (lockSubject) state.expanded[lockSubject] = true;
      closeSheet(); renderList();
    });
    $('#fApply').addEventListener('click', () => {
      const subj = lockSubject || (body.querySelector('#fSubj .active')?.dataset.subj || '全部');
      const kp = body.querySelector('#fKp .active')?.dataset.kp || '';
      const src = body.querySelector('#fSrc .active')?.dataset.src || '';
      const m = body.querySelector('#fM .active')?.dataset.m || '';
      const w = body.querySelector('#fW .active')?.dataset.w || '';
      const from = body.querySelector('#fFrom')?.value || '';
      const to = body.querySelector('#fTo')?.value || '';
      state.subject = subj;
      state.filter = { kpId: kp || null, srcId: src || null, mastery: m || null, wrong: w || null, from: from || null, to: to || null };
      if (lockSubject) state.expanded[lockSubject] = true;
      closeSheet(); renderList();
    });
  }

  /* ---------------- 相似题查重（保存前提示，避免重复录入） ---------------- */
  function normText(s) {
    return String(s || '').toLowerCase()
      .replace(/[\s\u3000]/g, '')
      .replace(/[，。！？；：、“”‘’（）《》【】「」,.!?;:"'()\[\]<>·…—\-_=+*/\\|~`@#$%^&]/g, '');
  }
  function bigramsOf(s) {
    const set = new Set();
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2));
    return set;
  }
  // 相似度：字符二元组 Dice 系数 + 「一方完整包含另一方」加成
  function similarity(a, b) {
    const A = normText(a), B = normText(b);
    if (!A || !B) return 0;
    if (A === B) return 1;
    let score = 0;
    const ga = bigramsOf(A), gb = bigramsOf(B);
    if (ga.size && gb.size) {
      let inter = 0;
      ga.forEach(g => { if (gb.has(g)) inter++; });
      score = 2 * inter / (ga.size + gb.size);
    }
    const short = A.length <= B.length ? A : B;
    const long = A.length <= B.length ? B : A;
    if (short.length >= 6 && long.indexOf(short) !== -1) score = Math.max(score, 0.88);
    return score;
  }
  // 在同科错题里找相似题（阈値 0.62，最多 3 道）
  function findSimilar(subject, text, excludeId) {
    const nt = normText(text);
    if (!nt || nt.length < 6) return [];
    return DB.getErrors({ subject })
      .filter(e => e.id !== excludeId)
      .map(e => ({ e, score: similarity(text, e.text || e.pinyin || '') }))
      .filter(x => x.score >= 0.62)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
  }

  /* ---------------- 语音输入（Web Speech API，纯前端） ---------------- */
  function startVoice(targetId) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('当前浏览器不支持语音输入，请用 Chrome / Edge，或手动输入'); return; }
    let rec = null;
    try { rec = new SR(); } catch (e) { toast('无法启动语音识别'); return; }
    rec.lang = 'zh-CN';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 1;
    rec.onresult = ev => {
      let txt = '';
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) txt += ev.results[i][0].transcript;
      }
      txt = txt.trim();
      const ta = document.getElementById(targetId);
      if (ta && txt) {
        const cur = ta.value;
        ta.value = cur ? (cur.replace(/\s+$/, '') + ' ' + txt) : txt;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
      }
      toast(txt ? '语音已转成文字 ✓' : '没听清，请再说一次');
    };
    rec.onerror = ev => {
      if (ev && ev.error === 'not-allowed') toast('麦克风权限被拒绝，请在浏览器设置里允许');
      else toast('语音识别失败，请重试或手动输入');
    };
    rec.onend = () => { rec = null; };
    try { rec.start(); toast('正在聆听…请说话'); }
    catch (e) { toast('无法启动麦克风，请检查权限'); }
  }

  /* ---------------- 录入错题 ---------------- */
  function openEntry(err) {
    const subjects = DB.getSubjects();
    const isEdit = !!err;
    const editId = err ? err.id : null;
    const dictOf = e => e && e.subject === '语文'
      && DB.isChineseDictKp(DB.getKeywords('kp').find(k => k.id === e.kpId)?.name);
    // 录入 / 编辑两用：文字 + 图片 并存（每道题可填文字、并可从相册添加图片，图片可裁剪）
    const form = {
      subject: err ? err.subject : (subjects.includes('数学') ? '数学' : subjects[0]),
      text: err ? (dictOf(err) ? (err.answer || err.text || '') : (err.text || '')) : '',
      images: err ? imgList(err) : [],
      kpId: err ? (err.kpId || null) : null,
      srcId: err ? (err.srcId || null) : null,
      mastery: err ? (err.mastery || 'unknown') : 'unknown',
      answer: err ? (err.answer || '') : '',
      pinyin: err ? (err.pinyin || '') : '',
    };
    // 录入方式：单题 / 批量（批量仅在新建时出现，编辑始终单题）
    let entryMode = 'single', batchType = 'text';
    const modeSection = isEdit ? '' : `
      <div class="field"><label>录入方式</label>
        <div class="seg" id="entryMode">
          <button class="chip active" data-m="single">单题输入</button>
          <button class="chip" data-m="batch">批量输入</button>
        </div>
      </div>
      <div class="field" id="batchTypeField" style="display:none"><label>批量类型</label>
        <div class="seg" id="entryBatchType">
          <button class="chip active" data-bt="text">文字（分号分隔）</button>
          <button class="chip" data-bt="image">图片（一题一图）</button>
        </div>
      </div>`;

    function kpOptions() {
      const list = DB.getKeywords('kp').filter(k => k.subject === form.subject);
      return `<span class="kw ${!form.kpId ? 'active' : ''}" data-kp="">不选</span>
        ${list.map(k => `<span class="kw ${form.kpId === k.id ? 'active' : ''}" data-kp="${k.id}">${k.name}</span>`).join('')}
        <span class="kw kw-add" id="addKp">＋ 新增知识点</span>`;
    }
    function srcOptions() {
      const list = DB.getKeywords('src').filter(k => k.subject === form.subject);
      return `<span class="kw ${!form.srcId ? 'active' : ''}" data-src="">不选</span>
        ${list.map(k => `<span class="kw ${form.srcId === k.id ? 'active' : ''}" data-src="${k.id}">${k.name}</span>`).join('')}
        <span class="kw kw-add" id="addSrc">＋ 新增来源</span>`;
    }
    function refresh() {
      $('#entryKp').innerHTML = kpOptions();
      $('#entrySrc').innerHTML = srcOptions();
      bindKw();
      // 语文字词默写 -> 中文转拼音题目，中文作为正确答案，隐藏"正确答案"输入框
      const kp = DB.getKeywords('kp').find(k => k.id === form.kpId);
      const isDict = form.subject === '语文' && kp && DB.isChineseDictKp(kp.name);
      const inBatch = entryMode === 'batch';
      // 字词标签：单题与批量均展示拼音预览；批量文字下不展示"正确答案"输入框（交批改判）
      $('#pinyinWrap').style.display = isDict ? 'block' : 'none';
      $('#entryAnsField').style.display = inBatch ? 'none' : 'block';
      if (inBatch && batchType === 'text') {
        $('#entryQLabel').textContent = isDict
          ? '批量字词（用 ; 或 ；分隔，每道自动转拼音题）'
          : '批量文字题目（用英文 ; 或中文 ；分隔不同题目，每道自动成为一道错题）';
      } else {
        $('#entryQLabel').textContent = isDict ? '字词内容（输入中文，将自动转为拼音题目）' : '题干 / 错题内容';
      }
      if (isDict) {
        if (inBatch && batchType === 'text') {
          // 批量文字：逐段预览拼音
          const segs = (form.text || '').split(/[;；]/).map(s => s.trim()).filter(Boolean);
          $('#pinyinVal').textContent = segs.length
            ? segs.map(s => DB.toPinyin(s) || s).join(' ｜ ') : '（输入后将自动显示拼音）';
        } else {
          const py = DB.toPinyin(form.text);
          if (py) { form.pinyin = py; $('#pinyinVal').textContent = py; }
        }
      } else {
        form.pinyin = '';
      }
    }
    function bindKw() {
      $$('#entryKp .kw[data-kp]').forEach(x => x.addEventListener('click', () => { form.kpId = x.dataset.kp || null; refresh(); }));
      $$('#entrySrc .kw[data-src]').forEach(x => x.addEventListener('click', () => { form.srcId = x.dataset.src || null; refresh(); }));
      $('#addKp')?.addEventListener('click', () => {
        const n = prompt('输入新知识点名称：'); if (n && n.trim()) { const k = DB.addKeyword('kp', n, form.subject); form.kpId = k.id; refresh(); }
      });
      $('#addSrc')?.addEventListener('click', () => {
        const n = prompt('输入新来源名称（如：单元测试/作业）：'); if (n && n.trim()) { const k = DB.addKeyword('src', n, form.subject); form.srcId = k.id; refresh(); }
      });
    }
    // 根据录入方式 / 批量类型显隐字段并设置提示
    function applyMode() {
      if (!document.getElementById('entryMode')) return; // 编辑模式无切换
      const isBatch = entryMode === 'batch';
      $('#batchTypeField').style.display = isBatch ? 'block' : 'none';
      $('#imgField').style.display = (!isBatch || batchType === 'image') ? 'block' : 'none';
      $('#entryQField').style.display = (!isBatch || batchType === 'text') ? 'block' : 'none';
      $('#entryText').placeholder = (isBatch && batchType === 'text')
        ? '例如：3+5=?; 小明有2个苹果又买3个共几个？; 求x的值' : '输入或粘贴题目内容…';
      refresh();
    }

    const body = openSheet(`
      <button class="close-x">✕</button>
      <h3>${isEdit ? '编辑错题' : '录入错题'}</h3>
      <div class="field"><label>科目（自动归入该科错题本）</label>
        <div class="seg" id="entrySubj">
          ${subjects.map(s => `<button class="chip ${s === form.subject ? 'active' : ''}" data-s="${s}">${s}</button>`).join('')}
        </div>
      </div>
      ${modeSection}
      <div class="field" id="entryQField">
        <label id="entryQLabel">题干 / 错题内容</label>
        <div class="ta-wrap">
          <textarea class="textarea" id="entryText" placeholder="输入或粘贴题目内容…">${form.text}</textarea>
          <button class="mic-btn" id="micQ" type="button" title="语音输入（口述题目）" aria-label="语音输入">🎤</button>
        </div>
        <p class="mic-tip">点 🎤 可语音口述题目（浏览器需支持语音识别，Chrome / Edge 体验最佳）</p>
      </div>
      <div class="field" id="imgField"><label>图片（可一次添加多张，从相册选择，可裁剪 / 删除）</label>
        <button class="btn ghost" id="imgDrop" style="width:100%">🖼 从相册添加图片（可多选）</button>
        <input type="file" id="imgInput" accept="image/*" multiple hidden />
        <div id="imgPreview"></div>
      </div>
      <div class="field" id="pinyinWrap" style="display:none">
        <label>题目将自动转为拼音（复习时显示拼音，中文作正确答案不展示）</label>
        <div class="pinyin-line" id="pinyinVal">${form.pinyin}</div>
      </div>
      <div class="field"><label>知识点</label><div class="kw-box" id="entryKp">${kpOptions()}</div>
        <button class="btn ghost sm" id="renameKp" style="margin-top:8px">✎ 重命名所选知识点</button></div>
      <div class="field"><label>来源</label><div class="kw-box" id="entrySrc">${srcOptions()}</div>
        <button class="btn ghost sm" id="renameSrc" style="margin-top:8px">✎ 重命名所选来源</button></div>
      <div class="field" id="entryAnsField">
        <label>正确答案</label>
        <div class="ta-wrap">
          <textarea class="textarea" id="entryAnswer" placeholder="填写正确答案与解析…">${form.answer}</textarea>
          <button class="mic-btn" id="micA" type="button" title="语音输入答案" aria-label="语音输入答案">🎤</button>
        </div>
      </div>
      <button class="btn" id="saveErr">${isEdit ? '保存修改' : '保存错题'}</button>`);

    bindKw();

    // 科目切换：重置该科专属的知识点/来源
    $$('#entrySubj .chip').forEach(c => c.addEventListener('click', () => {
      form.subject = c.dataset.s;
      $$('#entrySubj .chip').forEach(x => x.classList.toggle('active', x === c));
      form.kpId = null; form.srcId = null;
      refresh();
    }));
    // 录入方式 / 批量类型切换
    $$('#entryMode .chip').forEach(c => c.addEventListener('click', () => {
      entryMode = c.dataset.m;
      $$('#entryMode .chip').forEach(x => x.classList.toggle('active', x === c));
      applyMode();
    }));
    $$('#entryBatchType .chip').forEach(c => c.addEventListener('click', () => {
      batchType = c.dataset.bt;
      $$('#entryBatchType .chip').forEach(x => x.classList.toggle('active', x === c));
      applyMode();
    }));
    $('#entryText').addEventListener('input', e => { form.text = e.target.value; refresh(); });
    $('#entryAnswer').addEventListener('input', e => (form.answer = e.target.value));
    // 语音输入：把识别出的文字追加到对应输入框
    $('#micQ')?.addEventListener('click', () => startVoice('entryText'));
    $('#micA')?.addEventListener('click', () => startVoice('entryAnswer'));
    // 重命名知识点/来源：按 id 关联，所有使用它的错题会同步更新
    $('#renameKp').addEventListener('click', () => {
      if (!form.kpId) { toast('请先选择一个知识点再重命名'); return; }
      const cur = DB.getKeywords('kp').find(k => k.id === form.kpId);
      const n = prompt('重命名知识点（将同步更新所有使用它的错题）：', cur ? cur.name : '');
      if (n && n.trim() && n.trim() !== (cur && cur.name)) {
        DB.updateKeyword(form.kpId, n.trim()); refresh(); toast('已重命名，相关错题同步更新 ✓');
      }
    });
    $('#renameSrc').addEventListener('click', () => {
      if (!form.srcId) { toast('请先选择一个来源再重命名'); return; }
      const cur = DB.getKeywords('src').find(k => k.id === form.srcId);
      const n = prompt('重命名来源（将同步更新所有使用它的错题）：', cur ? cur.name : '');
      if (n && n.trim() && n.trim() !== (cur && cur.name)) {
        DB.updateKeyword(form.srcId, n.trim()); refresh(); toast('已重命名，相关错题同步更新 ✓');
      }
    });
    // 渲染图片预览 + 裁剪按钮（图片可矩形裁剪，不做识别）
    function renderImgPreview() {
      const wrap = $('#imgPreview');
      if (!form.images.length) { wrap.innerHTML = ''; return; }
      wrap.innerHTML = form.images.map((src, i) => `
        <div class="img-prev"><img src="${src}" />
          <div class="img-tools">
            <button class="crop-btn" data-i="${i}">✂ 裁剪</button>
            <button class="crop-btn del" data-del="${i}">🗑 删除</button>
          </div>
        </div>`).join('');
      wrap.querySelectorAll('.crop-btn[data-i]').forEach(b => b.addEventListener('click', () => {
        const i = +b.dataset.i;
        openCropper(form.images[i], cropped => {
          form.images[i] = cropped; renderImgPreview(); refresh(); toast('已裁剪 ✓');
        });
      }));
      wrap.querySelectorAll('.crop-btn.del').forEach(b => b.addEventListener('click', () => {
        const i = +b.dataset.del; form.images.splice(i, 1); renderImgPreview(); refresh();
      }));
    }
    // 从相册添加图片
    $('#imgDrop').addEventListener('click', () => $('#imgInput').click());
    $('#imgInput').addEventListener('change', e => {
      const files = Array.from(e.target.files || []); if (!files.length) return;
      let done = 0;
      const finish = src => {
        form.images.push(src);
        if (++done === files.length) { renderImgPreview(); refresh(); }
      };
      files.forEach(file => {
        compressImage(file)
          .then(finish)
          .catch(() => {
            // 压缩失败兜底：原样读取，避免无法添加图片
            const r = new FileReader();
            r.onload = ev => finish(ev.target.result);
            r.onerror = () => finish('');   // 极端失败也不阻塞计数
            r.readAsDataURL(file);
          });
      });
      e.target.value = '';
    });
    // 保存：文字 + 图片 并存；字词默写则将中文转为拼音题目、中文存为正确答案
    $('#saveErr').addEventListener('click', () => {
      // 批量输入：文字按分号拆分 / 图片一题一图，各成独立错题
      if (entryMode === 'batch') {
        if (batchType === 'text') {
          const segs = (form.text || '').split(/[;；]/).map(s => s.trim()).filter(Boolean);
          if (!segs.length) { toast('请用 ; 或 ； 分隔，至少输入一道题目'); return; }
          const isDict = form.subject === '语文'
            && DB.isChineseDictKp(DB.getKeywords('kp').find(k => k.id === form.kpId)?.name);
          segs.forEach(seg => {
            if (isDict) {
              const py = DB.toPinyin(seg);
              DB.addError({
                subject: form.subject, mode: 'text', text: py || seg, image: null, images: [],
                kpId: form.kpId, srcId: form.srcId, mastery: form.mastery, answer: seg, pinyin: py
              });
            } else {
              DB.addError({
                subject: form.subject, mode: 'text', text: seg, image: null, images: [],
                kpId: form.kpId, srcId: form.srcId, mastery: form.mastery, answer: '', pinyin: ''
              });
            }
          });
          toast('已批量保存 ' + segs.length + ' 道文字题 ✓');
        } else {
          if (!form.images.length) { toast('请至少添加一张图片'); return; }
          form.images.forEach(img => DB.addError({
            subject: form.subject, mode: 'image', text: '', image: img, images: [img],
            kpId: form.kpId, srcId: form.srcId, mastery: form.mastery, answer: '', pinyin: ''
          }));
          toast('已批量保存 ' + form.images.length + ' 道图片题 ✓');
        }
        closeSheet(); state.subject = form.subject; state.expanded[form.subject] = true; setView('list');
        return;
      }
      const hasText = !!form.text.trim();
      const hasImg = form.images.length > 0;
      if (!hasText && !hasImg) { toast('请填写文字或从相册添加图片'); return; }
      const isDict = form.subject === '语文'
        && DB.isChineseDictKp(DB.getKeywords('kp').find(k => k.id === form.kpId)?.name);
      const mode = (hasText && hasImg) ? 'mixed' : hasImg ? 'image' : 'text';
      let payload = {
        subject: form.subject, mode,
        text: form.text, image: form.images[0] || null, images: form.images,
        kpId: form.kpId, srcId: form.srcId, mastery: form.mastery, answer: form.answer,
        pinyin: '',
      };
      if (isDict) {
        const py = DB.toPinyin(form.text);
        payload.text = py || form.text;     // 题目显示为拼音
        payload.answer = form.text;        // 中文作为正确答案（不展示）
        payload.pinyin = py;
      }
      // 新建时先查重：同科已有高度相似的题，弹提示让用户决定是否仍要添加
      if (!isEdit) {
        const cmp = payload.text || payload.pinyin || '';
        const sims = findSimilar(form.subject, cmp, null);
        if (sims.length) {
          const top = sims[0];
          const q = (top.e.text || top.e.pinyin || '').replace(/\s+/g, ' ').slice(0, 50);
          const pct = Math.round(top.score * 100);
          const more = sims.length > 1 ? `\n（另有 ${sims.length - 1} 道相似题）` : '';
          const go = confirm(`发现相似题（相似度约 ${pct}%）：\n「${q}」${more}\n\n仍要继续添加吗？\n点「取消」可返回检查，避免重复录入。`);
          if (!go) { toast('已暂停保存，请先核对是否重复'); return; }
        }
      }
      if (isEdit) {
        DB.updateError(editId, payload);
        toast('已保存修改 ✓'); closeSheet();
        if (state.view === 'list') renderList();
        else if (state.view === 'review') renderReview();
        else renderHome();
      } else {
        DB.addError(payload);
        toast('已保存到「' + form.subject + '」错题本 ✓'); closeSheet();
        state.subject = form.subject;            // 自动跳到对应学科错题本
        state.expanded[form.subject] = true;    // 并展开该错题本
        setView('list');
      }
    });
    refresh();
    applyMode();
    renderImgPreview();
  }

  /* ---------------- 错题详情 ---------------- */
  function openDetail(id) {
    const e = DB.getError(id); if (!e) return;
    const isPinyin = isDictError(e);
    const po = e.practiceOnce;
    const whenText = (po && po.due)
      ? '🔁 加练中 · 下次推送：' + fmtDue(po.due)
      : (DB.isMastered(e) ? '🟢 已掌握 · 已停止推送' : '🔔 下次推送：' + fmtDue(DB.nextDueDate(e)));
    const body = openSheet(`
      <div class="detail-head">
        <h3>错题详情</h3>
        <div class="detail-head-actions">
          <button class="icon-btn-sm star${e.starred ? ' on' : ''}" id="starErr" title="${e.starred ? '取消重点' : '标为重点'}" aria-label="重点标星">${e.starred ? '★' : '☆'}</button>
          <button class="icon-btn-sm" id="editErr" title="编辑" aria-label="编辑">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
          <button class="icon-btn-sm danger" id="delErr" title="删除" aria-label="删除">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/></svg>
          </button>
          <button class="close-x" title="关闭" aria-label="关闭">✕</button>
        </div>
      </div>
      <div class="item-meta">${metaTagsHTML(e)}</div>
      ${questionBlockHTML(e, isPinyin)}
      ${(e.answer && String(e.answer).trim()) ? `<div class="detail-ans">
        <button class="btn-show-ans" id="showAnsBtn" type="button">先自测 · 显示答案</button>
        <div class="detail-ans-body" id="ansBody" hidden><span class="ga-k">答案：</span>${esc(e.answer)}</div>
      </div>` : ''}
      <div class="item-when" style="margin-top:8px">${whenText}</div>
      ${e.reviews.length ? `<div class="records"><p class="card-h" style="margin-top:14px">复习记录（已答对 ${e.reviews.filter(r => r.correct).length} / 共 ${e.reviews.length} 次）</p>
        ${e.reviews.map(r => `<div class="rec"><span class="${r.correct ? 'r-ok' : 'r-bad'}">${r.correct ? '✓ 答对' : '✗ 答错'}</span>
        <span>${fmtDate(r.date)}</span></div>`).join('')}</div>` : ''}
      <div class="detail-actions">
        <button class="act" id="redoEarly">提前重练</button>
        <button class="act" id="practiceOnce">加练一次</button>
        <button class="act ${DB.isMastered(e) ? 'act-on' : ''}" id="markMastered">${DB.isMastered(e) ? '取消已掌握' : '标记已掌握'}</button>
      </div>`);
    $('#delErr').addEventListener('click', () => {
      if (confirm('确定删除这道错题？')) { DB.deleteError(id); closeSheet(); toast('已删除'); setView(state.view); }
    });
    $('#editErr').addEventListener('click', () => { closeSheet(); openEntry(e); });
    // 重点标星：就地切换
    $('#starErr')?.addEventListener('click', () => {
      const on = !DB.getError(id).starred;
      DB.setStar(id, on);
      const btn = $('#starErr');
      btn.textContent = on ? '★' : '☆';
      btn.classList.toggle('on', on);
      btn.title = on ? '取消重点' : '标为重点';
      toast(on ? '已标为重点 ★' : '已取消重点');
    });
    // 详情页答案默认遮住，先自测再显示
    $('#showAnsBtn')?.addEventListener('click', () => {
      const b = $('#ansBody'); if (b) b.hidden = false;
      $('#showAnsBtn').style.display = 'none';
    });
    // 提前重练：在更早的日期做一次练习，仅把这次推送提前，其余节点推送日期不变（排期锚点不变）
    $('#redoEarly')?.addEventListener('click', () => {
      closeSheet();
      renderGrade([e], () => openDetail(id), {});
    });
    // 加练一次：按题型在 +30(记忆型)/+60(稳定型) 天后额外推送一次，独立于正常周期
    $('#practiceOnce')?.addEventListener('click', () => {
      const days = DB.practiceOnceDays(e);
      DB.addPracticeOnce(e.id, days);
      closeSheet();
      toast(`已安排加练：${DB.getRType(e) === 'drill' ? '记忆型 +30 天' : '稳定型 +60 天'}后推送一次`);
      setView(state.view);
    });
    // 提前标识已掌握（停止推送）/ 取消已掌握（恢复未掌握）
    $('#markMastered')?.addEventListener('click', () => {
      const on = !DB.isMastered(DB.getError(e.id));
      DB.setMasteredFlag(e.id, on);
      closeSheet();
      toast(on ? '已标记「已掌握」，不再推送' : '已恢复为「未掌握」，将按周期继续推送');
      setView(state.view);
    });
  }
  // 待复习推送标签：应复习日期 / 逾期天数
  function dueLabel(e) {
    const due = DB.nextDueDate(e);
    const diff = Date.now() - due;
    if (diff <= 0) return '应于 ' + fmtDue(due) + ' 复习';
    const days = Math.floor(diff / 86400000);
    return '已逾期 ' + (days < 1 ? '今天' : days + ' 天') + ' · 建议尽快复习';
  }

  /* ---------------- 复习（间隔推送） ---------------- */
  // 复习页的完整题集 = 到期应复习 + 本次「练习选中」被推送到复习页的题（去重）
  function reviewList() {
    const due = DB.dueReviews();
    const ids = new Set(due.map(e => e.id));
    const extra = getPractice()
      .map(id => DB.getError(id))
      .filter(e => e && !ids.has(e.id));
    return due.concat(extra);
  }

  function renderReview() {
    const due = reviewList();
    const mastered = DB.getErrors().filter(e => DB.isMastered(e));
    $('#view').innerHTML = `
      <div class="card" style="padding:14px 16px">
        <p class="card-h" style="margin-bottom:6px">复习推送计划</p>
        <p style="font-size:12.5px;color:var(--ink-2);margin:0;line-height:1.6"><b>记忆型</b>（如字词、单词）：按 +5 / +10 / +20 / +40 / +80 / +160 天推送，共 6 次全对即掌握；<b>稳定型</b>（如概念、公式）：按 +5 / +60 / +150 天推送，共 3 次全对即掌握。中途答错则周期从头开始（+5 天重试），直到走完一个完整周期且全对。已掌握不再自动推送；在详情页可对单题「加练一次」（记忆型 +30 天 / 稳定型 +60 天额外推一次）或「标记已掌握」提前停推，也可「提前重练」提前练习。</p>
      </div>
      ${due.length === 0
        ? '<div class="empty"><span class="em-ico">🌱</span>今天没有需要复习的错题，继续保持！</div>'
        : `
        <div class="rev-toolbar">
          <div class="rev-count">🔔 今日待复习 <b>${due.length}</b> 道</div>
          <div class="rev-actions">
            <button class="btn small ghost" id="selfTestBtn">${state.selfTest ? '自测模式：开' : '自测模式：关'}</button>
            <button class="btn small" id="toGrade">批改</button>
          </div>
        </div>
        <p class="rev-tip">${state.selfTest
          ? '自测模式已开启：答案默认遮住，先自己回想，点「显示答案」核对，再进批改记录对错。'
          : '自测模式已关闭：答案直接显示，适合快速核对。'}</p>
        <div id="revList">
          ${due.map(e => `
            <div class="rev-item">
              <div class="rev-due">${dueLabel(e)}</div>
              <div class="rev-card">
                <div class="item-top">${metaTagsHTML(e)}
                  <button class="item-edit" data-edit="${e.id}" title="编辑 / 删除" aria-label="编辑">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  </button>
                </div>
                ${reviewExpandHTML(e)}
              </div>
            </div>`).join('')}
        </div>`}
      ${mastered.length ? `<div class="card" style="margin-top:14px;padding:14px 16px">
        <p class="card-h" style="margin-bottom:6px">已掌握（已停止推送）</p>
        <p style="font-size:12.5px;color:var(--ink-2);margin:0;line-height:1.6">共 ${mastered.length} 道已实现稳定掌握，不再推送；可在错题本中按需删减。</p>
        <div class="mastered-list">
          ${mastered.slice(0, 8).map(e => `<span class="tag">${esc(e.subject)} · ${esc(kwName(e.kpId)) || '错题'}</span>`).join('')}
        </div>
      </div>` : ''}
    `;
    $$('#revList .item-edit').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation(); openDetail(b.dataset.edit);
    }));
    // 自测模式开关：控制答案是否默认遮住
    $('#selfTestBtn')?.addEventListener('click', () => { state.selfTest = !state.selfTest; renderReview(); });
    // 单题「显示答案」：只展开当前题
    $$('#revList [data-ans-btn]').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation();
      const body = document.querySelector('[data-ans-body="' + b.dataset.ansBtn + '"]');
      if (body) body.hidden = false;
      b.style.display = 'none';
    }));
    $('#toGrade')?.addEventListener('click', () => renderGrade(reviewList(), renderReview));
    updateRevBadge();
  }

  // 批改 / 重练模式：题目折叠展示、答案全部显示，逐题勾选「对 / 错」后统一记录。
  // list 可传入任意错题集合（如笔记本勾选的题目）；不传则默认使用「待复习」集合。
  // back 为保存后回退函数（默认返回复习页）。
  // 图片压缩：上传前把原图压到最大边 1200px、JPEG 0.7，体积可降 10–20 倍，避免 base64 原图撑爆 localStorage 配额
  function compressImage(file, maxDim, quality) {
    maxDim = maxDim || 1200; quality = (quality == null ? 0.7 : quality);
    return new Promise((resolve, reject) => {
      if (!file || !file.type || !file.type.startsWith('image/')) {
        const r = new FileReader();
        r.onload = ev => resolve(ev.target.result);
        r.onerror = () => reject(new Error('读取失败'));
        r.readAsDataURL(file); return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          const scale = Math.min(maxDim / w, maxDim / h);
          w = Math.max(1, Math.round(w * scale)); h = Math.max(1, Math.round(h * scale));
        }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        try { resolve(cv.toDataURL('image/jpeg', quality)); }
        catch (e) { reject(e); }
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片解码失败')); };
      img.src = url;
    });
  }
  function renderGrade(list, back, opts) {
    const due = (list && list.length) ? list : DB.dueReviews();
    const backFn = back || (() => renderReview());
    if (!due.length) { backFn(); toast('没有可重练的错题'); return; }
    const gTitle = (opts && opts.redo) ? '重练批改' : (back === renderList ? '重练模式' : '批改模式');
    $('#view').innerHTML = `
      <div class="grade-bar">
        <button class="btn ghost small" id="gradeBack">‹ 返回</button>
        <span class="grade-title">${gTitle} · 共 ${due.length} 道</span>
        <button class="btn small" id="gradeSave">保存批改</button>
      </div>
      <p class="grade-tip">先凭记忆自测，需要核对时点「显示答案」，再勾选「对 / 错」；点「未练习」表示本次不练习，该错题仍保留在复习栏（不记录、不推送）。</p>
      <div id="gradeList">
        ${due.map(gradeItemHTML).join('')}
      </div>`;
    const sel = {};
    $$('#gradeList .grade-item').forEach(card => {
      const id = card.dataset.id;
      card.querySelectorAll('.pick').forEach(b => b.addEventListener('click', () => {
        const v = b.dataset.v;
        if (sel[id] === v) { delete sel[id]; b.classList.remove('on'); return; }
        sel[id] = v;
        card.querySelectorAll('.pick').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
      }));
    });
    $$('#gradeList .btn-show-ans').forEach(b => b.addEventListener('click', () => {
      const card = b.closest('.grade-item');
      const ans = card && card.querySelector('.grade-ans');
      if (ans) ans.style.display = 'block';
      b.style.display = 'none';
    }));
    $('#gradeBack').addEventListener('click', backFn);
    $('#gradeSave').addEventListener('click', () => {
      let ok = 0, bad = 0, skip = 0, none = 0;
      due.forEach(e => {
        if (!(e.id in sel)) { none++; return; }
        const v = sel[e.id];
        if (v === 'skip') { skip++; return; }   // 未练习：视为未做，保留在复习栏，不记录不推送（与「未选择」一致）
        DB.recordReview(e.id, v === 'ok');
        if (opts && opts.redo && v === 'ok') {
          // 答对即移出重练板块，回归正常周期推送流（不删题库、不丢学习记录；其余节点推送日期不变）
          delRedo(e.id);
        }
        if (v === 'ok') ok++; else bad++;
      });
      if (!(opts && opts.redo)) setPractice([]);   // 非重练模式：练习队列随批改清空；重练模式保留 redolist，错的题次日仍留在板块
      backFn();
      toast(`已批改 ${ok + bad} 道（对 ${ok} / 错 ${bad}${(skip || none) ? ` · 未练习 ${skip} 道、未选 ${none} 道 保留在复习栏` : ''}）· 推送周期已更新`);
    });
  }
  // 单题批改卡片：折叠题面 + 显示答案 + 对/错选择
  function gradeItemHTML(e) {
    const isP = isDictError(e);
    const imgs = imgList(e);
    const q = (isP ? (e.pinyin || e.text || '') : (e.text || '')).slice(0, 120);
    const hasAns = !!(e.answer && String(e.answer).trim());
    return `
      <div class="grade-item" data-id="${e.id}">
        <div class="grade-top">${metaTagsHTML(e)}</div>
        ${q ? `<div class="grade-q">${q}</div>` : ''}
        ${imgs.map(s => `<img class="grade-img zoomable" src="${s}" alt=""/>`).join('')}
        <div class="grade-ans"${hasAns ? ' style="display:none"' : ''}><span class="ga-k">答案：</span>${e.answer || '（未填写答案）'}</div>
        ${hasAns ? '<button class="btn-show-ans" type="button">显示答案</button>' : ''}
        <div class="grade-pick">
          <button class="pick ok" type="button" data-v="ok">✓ 对</button>
          <button class="pick bad" type="button" data-v="bad">✗ 错</button>
          <button class="pick skip" type="button" data-v="skip">– 未练习</button>
        </div>
      </div>`;
  }
  function esc(s) { return (s || '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }

  /* ---------------- 我的 ---------------- */
  function renderMine() {
    const kps = DB.getKeywords('kp').length, srcs = DB.getKeywords('src').length;
    $('#view').innerHTML = `
      <div class="card" style="text-align:center;padding:22px">
        <div style="font-size:40px">🌿</div>
        <p style="margin:6px 0 0;font-weight:700">我的错题本</p>
        <p style="margin:2px 0 0;color:var(--ink-2);font-size:13px">数据保存在本设备，可按学科管理错题本与关键词</p>
      </div>
      <div class="ms-panel" id="msPanel">
        <div class="ms-head" id="msToggle">
          <span>掌握情况统计</span>
          <span class="ms-chev">${state.mineStatOpen ? '▾' : '▸'}</span>
        </div>
        <div class="ms-body" id="msBody" ${state.mineStatOpen ? '' : 'hidden'}>${mineStatHTML()}</div>
      </div>
      <div class="menu">
        <div class="row" id="mKp"><span class="mi">🏷</span><span class="mt">知识点管理</span><span class="mr">${kps} 个 ›</span></div>
        <div class="row" id="mSrc"><span class="mi">📌</span><span class="mt">来源管理</span><span class="mr">${srcs} 个 ›</span></div>
      </div>`;
    $('#mKp').addEventListener('click', () => openKwManage('kp'));
    $('#mSrc').addEventListener('click', () => openKwManage('src'));
    $('#msToggle').addEventListener('click', () => { state.mineStatOpen = !state.mineStatOpen; renderMine(); });
    bindMineStat();
  }
  // 连续打卡天数：从今天/昨天起，逐日回溯有复习记录的最长连续天数
  function computeStreak(allErrs) {
    const days = new Set();
    allErrs.forEach(e => (e.reviews || []).forEach(r => {
      const dt = new Date(r.date); if (!isNaN(dt)) days.add(dt.toDateString());
    }));
    if (!days.size) return 0;
    const d = new Date(); d.setHours(0, 0, 0, 0);
    if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1); // 今天还没练也允许从昨天起算
    let streak = 0;
    while (days.has(d.toDateString())) { streak++; d.setDate(d.getDate() - 1); }
    return streak;
  }
  // 「我的」页内联掌握统计：仪表盘 + 筛选（学科/知识点/来源）+ 对错情况 + 掌握情况
  function mineStatHTML() {
    const f = state.mineFilter;
    const subs = DB.getSubjects();
    const kps = DB.getKeywords('kp').filter(k => f.subject === '全部' || k.subject === f.subject);
    const srcs = DB.getKeywords('src').filter(k => f.subject === '全部' || k.subject === f.subject);
    const filt = {};
    if (f.subject !== '全部') filt.subject = f.subject;
    if (f.kpId) filt.kpId = f.kpId;
    if (f.srcId) filt.srcId = f.srcId;
    const errs = DB.getErrors(filt);
    let revTotal = 0, revOk = 0, revBad = 0;
    errs.forEach(e => (e.reviews || []).forEach(r => { revTotal++; if (r.correct) revOk++; else revBad++; }));
    const known = errs.filter(e => DB.isMastered(e)).length;
    const unknown = errs.length - known;
    const pct = n => errs.length ? Math.round(n / errs.length * 100) : 0;
    const wrongBuckets = [0, 0, 0, 0, 0, 0];
    errs.forEach(e => { const w = (e.reviews || []).filter(r => !r.correct).length; wrongBuckets[w >= 5 ? 5 : w]++; });
    const maxW = Math.max(1, ...wrongBuckets);
    const wrongLabels = ['0次', '1次', '2次', '3次', '4次', '5次以上'];
    const wrongHTML = wrongLabels.map((lb, i) => `<div class="ms-mrow"><span>${lb}</span><div class="bar"><i style="width:${Math.round(wrongBuckets[i] / maxW * 100)}%;background:var(--bad)"></i></div><b>${wrongBuckets[i]}</b></div>`).join('');
    const subChips = ['全部', ...subs].map(s => `<button class="chip ${s === f.subject ? 'active' : ''}" data-sub="${esc(s)}">${esc(s)}</button>`).join('');
    const kpChips = kps.length ? kps.map(k => `<button class="chip ${k.id === f.kpId ? 'active' : ''}" data-kp="${k.id}">${esc(k.name)}</button>`).join('') : '<span class="ms-empty">暂无知识点</span>';
    const srcChips = srcs.length ? srcs.map(k => `<button class="chip ${k.id === f.srcId ? 'active' : ''}" data-src="${k.id}">${esc(k.name)}</button>`).join('') : '<span class="ms-empty">暂无来源</span>';
    // 仪表盘：已掌握率环形 + 连续打卡 + 学科分布（基于全量数据）
    const knownPct = errs.length ? Math.round(known / errs.length * 100) : 0;
    const drillCount = errs.filter(e => DB.getRType(e) === 'drill').length;
    const streak = computeStreak(DB.getErrors());
    const subjDist = DB.getSubjects().map(s => {
      const es = DB.getErrors({ subject: s });
      return { s, total: es.length, known: es.filter(e => DB.isMastered(e)).length, drill: es.filter(e => DB.getRType(e) === 'drill').length };
    });
    const maxSubj = Math.max(1, ...subjDist.map(x => x.total));
    const subjDistHTML = subjDist.map(x => `
      <div class="ms-mrow"><span>${esc(x.s)}</span><div class="bar"><i style="width:${Math.round(x.total / maxSubj * 100)}%;background:#5f9c78"></i></div><b>${x.total}${x.drill ? ` <span class="drill-n">记${x.drill}</span>` : ''}</b></div>`).join('');
    // 各知识点掌握率：按知识点聚合（仅统计挂了该知识点的错题），按掌握率高→低排序
    const kpStats = DB.getKeywords('kp').map(k => {
      const es = errs.filter(e => e.kpId === k.id);
      const total = es.length;
      const knownN = es.filter(e => DB.isMastered(e)).length;
      return { id: k.id, name: k.name, total, known: knownN, pct: total ? Math.round(knownN / total * 100) : 0 };
    }).filter(x => x.total > 0).sort((a, b) => (b.pct - a.pct) || (b.total - a.total));
    const kpMasteryHTML = kpStats.length
      ? kpStats.map(x => `<div class="ms-mrow ms-kprow"><span title="${esc(x.name)}">${esc(x.name)}</span><div class="bar"><i style="width:${x.pct}%;background:${x.pct >= 60 ? '#5f9c78' : '#d9a441'}"></i></div><b>${x.known}/${x.total}</b></div>`).join('')
      : '<p class="ms-empty">暂无挂知识点的错题</p>';
    return `
      <div class="ms-stat">
        <div class="ms-block dash">
          <div class="donut" style="background:conic-gradient(#5f9c78 ${knownPct}%, #e3ece6 ${knownPct}% 100%)">
            <div class="donut-hole"><b>${knownPct}%</b><span>已掌握率</span></div>
          </div>
          <div class="dash-stats">
            <div class="ds"><div class="num">${streak}</div><div class="lab">连续打卡(天)</div></div>
            <div class="ds"><div class="num">${errs.length}</div><div class="lab">错题总数</div></div>
            <div class="ds"><div class="num">${drillCount}</div><div class="lab">记忆型</div></div>
          </div>
        </div>
        <div class="ms-block" style="margin-top:14px">
          <p class="card-h">学科分布</p>
          <div class="ms-mast">${subjDistHTML}</div>
        </div>
        <div class="ms-block" style="margin-top:14px">
          <p class="card-h">筛选</p>
          <div class="ms-filters">
            <div class="ms-frow"><span class="ms-fl">学科</span><div class="kw-box">${subChips}</div></div>
            <div class="ms-frow"><span class="ms-fl">知识点</span><div class="kw-box">${kpChips}</div></div>
            <div class="ms-frow"><span class="ms-fl">来源</span><div class="kw-box">${srcChips}</div></div>
          </div>
        </div>
        <div class="ms-block" style="margin-top:14px">
          <p class="card-h">对错情况</p>
          <div class="stat-row">
            <div class="stat"><div class="num">${revTotal}</div><div class="lab">总复习</div></div>
            <div class="stat"><div class="num" style="color:var(--ok)">${revOk}</div><div class="lab">答对</div></div>
            <div class="stat"><div class="num" style="color:var(--bad)">${revBad}</div><div class="lab">答错</div></div>
          </div>
        </div>
        <div class="ms-block" style="margin-top:14px">
          <p class="card-h">掌握情况（${errs.length} 道）</p>
          <div class="ms-mast">
            <div class="ms-mrow"><span>未掌握</span><div class="bar"><i style="width:${pct(unknown)}%;background:#d17878"></i></div><b>${unknown}</b></div>
            <div class="ms-mrow"><span>已掌握</span><div class="bar"><i style="width:${pct(known)}%;background:#5f9c78"></i></div><b>${known}</b></div>
          </div>
        </div>
        <div class="ms-block" style="margin-top:14px">
          <p class="card-h">各知识点掌握率</p>
          <div class="ms-mast">${kpMasteryHTML}</div>
        </div>
        <div class="ms-block" style="margin-top:14px">
          <p class="card-h">错误次数分布</p>
          <div class="ms-mast ms-wrong">${wrongHTML}</div>
        </div>
      </div>`;
  }
  function paintMineStat() {
    const body = document.getElementById('msBody');
    if (!body) return;
    body.innerHTML = mineStatHTML();
    bindMineStat();
  }
  function bindMineStat() {
    $$('#msBody [data-sub]').forEach(c => c.addEventListener('click', () => {
      state.mineFilter.subject = c.dataset.sub; state.mineFilter.kpId = null; state.mineFilter.srcId = null; paintMineStat();
    }));
    $$('#msBody [data-kp]').forEach(c => c.addEventListener('click', () => {
      state.mineFilter.kpId = (state.mineFilter.kpId === c.dataset.kp) ? null : c.dataset.kp; paintMineStat();
    }));
    $$('#msBody [data-src]').forEach(c => c.addEventListener('click', () => {
      state.mineFilter.srcId = (state.mineFilter.srcId === c.dataset.src) ? null : c.dataset.src; paintMineStat();
    }));
  }

  function openKwManage(type) {
    const subjects = DB.getSubjects();
    let sel = subjects[0];
    let selRType = 'stable';   // 新增知识点时一并选题型（稳定型 / 记忆型）
    let editingId = null;      // 正在行内编辑的知识点 id
    let editRType = 'stable';  // 编辑态中临时选中的题型
    function listHTML() {
      const list = DB.getKeywords(type).filter(k => k.subject === sel);
      const errsAll = DB.getErrors();
      return list.length ? list.map(k => {
        const cnt = errsAll.filter(e => e.kpId === k.id || e.srcId === k.id).length;
        // 编辑态：名称输入框 + 题型选择（仅知识点有题型），可保存 / 取消
        if (k.id === editingId) {
          const seg = (type === 'kp')
            ? `<div class="seg" style="margin:10px 0 0">
                 <span class="seg-lab">题型</span>
                 <button type="button" class="chip ${editRType === 'stable' ? 'active' : ''}" data-edit-rt="stable">稳定型</button>
                 <button type="button" class="chip ${editRType === 'drill' ? 'active' : ''}" data-edit-rt="drill">记忆型</button>
               </div>` : '';
          return `
          <div class="item kw-edit" style="cursor:default">
            <input class="input" id="kwEditName" value="${esc(k.name)}" placeholder="名称" />
            ${seg}
            <div style="display:flex;gap:10px;margin-top:10px;justify-content:flex-end">
              <button class="btn small ghost" data-edit-cancel="${k.id}">取消</button>
              <button class="btn small" data-edit-save="${k.id}">保存</button>
            </div>
          </div>`;
        }
        const rTag = (type === 'kp')
          ? `<button class="opt rt ${k.rType === 'drill' ? 'on' : ''}" data-rt-toggle="${k.id}">${k.rType === 'drill' ? '记忆型' : '稳定型'}</button>`
          : '';
        return `
        <div class="item" style="display:flex;align-items:center;gap:10px;cursor:default">
          <div style="flex:1">${esc(k.name)}${cnt ? `<span class="kw-cnt">${cnt} 道</span>` : ''}</div>
          ${rTag}
          <button class="opt" data-edit="${k.id}">编辑</button>
          <button class="opt" data-del="${k.id}" style="color:var(--bad)">删</button>
        </div>`;
      }).join('') : '<div class="empty">该科目下暂无，点击下方新增</div>';
    }
    function sheetHTML() {
      const rTypeSeg = (type === 'kp')
        ? `<div class="seg" id="kwRType" style="margin-top:10px">
             <span class="seg-lab">题型</span>
             <button class="chip ${selRType === 'stable' ? 'active' : ''}" data-rt-sel="stable">稳定型</button>
             <button class="chip ${selRType === 'drill' ? 'active' : ''}" data-rt-sel="drill">记忆型</button>
           </div>` : '';
      return `
        <button class="close-x">✕</button>
        <h3>${type === 'kp' ? '知识点' : '来源'}管理</h3>
        <div class="seg" id="kwSubj">
          ${subjects.map(s => `<button class="chip ${s === sel ? 'active' : ''}" data-s="${s}">${s}</button>`).join('')}
        </div>
        ${rTypeSeg}
        <div id="kwList" style="margin-top:8px">${listHTML()}</div>
        <button class="btn" id="kwAdd" style="margin-top:12px">＋ 新增${type === 'kp' ? '知识点' : '来源'}（${sel}）</button>`;
    }
    const body = openSheet(sheetHTML());
    function rebind() {
      body.innerHTML = sheetHTML();
      body.querySelector('.close-x').addEventListener('click', closeSheet);
      body.querySelectorAll('#kwSubj .chip').forEach(c => c.addEventListener('click', () => { sel = c.dataset.s; rebind(); }));
      body.querySelectorAll('#kwRType .chip').forEach(c => c.addEventListener('click', () => { selRType = c.dataset.rtSel; rebind(); }));
      body.querySelectorAll('[data-rt-toggle]').forEach(b => b.addEventListener('click', () => {
        const k = DB.getKeywords('kp').find(x => x.id === b.dataset.rtToggle);
        if (k) { DB.setKeywordRType(k.id, k.rType === 'drill' ? 'stable' : 'drill'); rebind(); }
      }));
      // 进入行内编辑（名称 + 题型一起改）
      body.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
        const k = DB.getKeywords(type).find(x => x.id === b.dataset.edit);
        if (!k) return;
        editingId = k.id; editRType = k.rType || 'stable';
        rebind();
        const inp = body.querySelector('#kwEditName');
        if (inp) { inp.focus(); inp.select(); }
      }));
      // 编辑态内切换题型：只切高亮，不重绘，避免输入框里已改的名称丢失
      body.querySelectorAll('[data-edit-rt]').forEach(c => c.addEventListener('click', () => {
        editRType = c.dataset.editRt;
        body.querySelectorAll('[data-edit-rt]').forEach(x => x.classList.toggle('active', x === c));
      }));
      // 取消编辑
      body.querySelectorAll('[data-edit-cancel]').forEach(b => b.addEventListener('click', () => {
        editingId = null; rebind();
      }));
      // 保存：名称与题型一并写入（改名 / 改题型都会推进版本号，跨端按新版本生效）
      body.querySelectorAll('[data-edit-save]').forEach(b => b.addEventListener('click', () => {
        const id = b.dataset.editSave;
        const inp = body.querySelector('#kwEditName');
        const name = ((inp && inp.value) || '').trim();
        if (!name) { toast('名称不能为空'); if (inp) inp.focus(); return; }
        DB.updateKeyword(id, name);
        if (type === 'kp') DB.setKeywordRType(id, editRType);
        editingId = null; rebind(); toast('已保存 ✓');
      }));
      // 编辑框内回车保存、Esc 取消
      const editInput = body.querySelector('#kwEditName');
      if (editInput) editInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); const s = body.querySelector('[data-edit-save]'); if (s) s.click(); }
        if (e.key === 'Escape') { editingId = null; rebind(); }
      });
      body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
        const used = DB.getErrors().filter(e => e.kpId === b.dataset.del || e.srcId === b.dataset.del).length;
        if (used > 0) { toast('该' + (type === 'kp' ? '知识点' : '来源') + '下还有 ' + used + ' 道错题，暂不可删除（请先处理相关错题）'); return; }
        if (confirm('删除该' + (type === 'kp' ? '知识点' : '来源') + '？')) { DB.deleteKeyword(b.dataset.del); rebind(); }
      }));
      body.querySelector('#kwAdd').addEventListener('click', () => {
        const n = prompt('输入名称：'); if (n && n.trim()) { DB.addKeyword(type, n, sel, selRType); rebind(); }
      });
    }
    rebind();
  }

  /* ---------------- 图片裁剪（矩形框，可拖动/缩放） ---------------- */
  function openCropper(src, cb) {
    const mask = $('#cropper'), panel = $('#cropPanel');
    panel.innerHTML = `
      <button class="close-x" id="cropClose">✕</button>
      <h3>裁剪图片</h3>
      <p class="crop-tip">拖动选框选择要保留的区域，可移动或缩放，裁掉多余部分。</p>
      <div class="crop-stage" id="cropStage">
        <img id="cropImg" src="${src}" />
        <div class="crop-rect" id="cropRect">
          <span class="rh rh-nw" data-h="nw"></span>
          <span class="rh rh-ne" data-h="ne"></span>
          <span class="rh rh-sw" data-h="sw"></span>
          <span class="rh rh-se" data-h="se"></span>
        </div>
      </div>
      <div class="btn-row" style="margin-top:14px">
        <button class="btn ghost" id="cropReset">重置</button>
        <button class="btn" id="cropOk">确定裁剪</button>
      </div>`;
    mask.hidden = false;
    const img = $('#cropImg'), stage = $('#cropStage'), rect = $('#cropRect');
    let natW = 0, natH = 0;

    function initBox() {
      const iw = img.clientWidth, ih = img.clientHeight;
      if (!iw || !ih) return;
      const w = iw * 0.8, h = ih * 0.8;
      rect.style.left = (iw - w) / 2 + 'px';
      rect.style.top = (ih - h) / 2 + 'px';
      rect.style.width = w + 'px';
      rect.style.height = h + 'px';
    }
    if (img.complete) setTimeout(initBox, 0);
    img.onload = initBox;

    let drag = null;
    function onDown(e, mode) {
      e.preventDefault(); e.stopPropagation();
      drag = { mode, sx: e.clientX, sy: e.clientY, o: { l: rect.offsetLeft, t: rect.offsetTop, w: rect.offsetWidth, h: rect.offsetHeight } };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    }
    function onMove(e) {
      if (!drag) return;
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      const iw = img.clientWidth, ih = img.clientHeight, MIN = 30;
      let l = drag.o.l, t = drag.o.t, w = drag.o.w, h = drag.o.h;
      const m = drag.mode;
      if (m === 'move') { l += dx; t += dy; }
      else {
        if (m.includes('e')) w = drag.o.w + dx;
        if (m.includes('w')) { w = drag.o.w - dx; l = drag.o.l + (drag.o.w - w); }
        if (m.includes('s')) h = drag.o.h + dy;
        if (m.includes('n')) { h = drag.o.h - dy; t = drag.o.t + (drag.o.h - h); }
      }
      w = Math.max(MIN, w); h = Math.max(MIN, h);
      if (l < 0) { w += l; l = 0; }
      if (t < 0) { h += t; t = 0; }
      if (l + w > iw) w = iw - l;
      if (t + h > ih) h = ih - t;
      w = Math.max(MIN, w); h = Math.max(MIN, h);
      rect.style.left = l + 'px'; rect.style.top = t + 'px';
      rect.style.width = w + 'px'; rect.style.height = h + 'px';
    }
    function onUp() { drag = null; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); }
    rect.addEventListener('pointerdown', e => onDown(e, 'move'));
    $$('.rh', rect).forEach(h => h.addEventListener('pointerdown', e => onDown(e, h.dataset.h)));

    $('#cropReset').addEventListener('click', initBox);
    $('#cropClose').addEventListener('click', () => { mask.hidden = true; panel.innerHTML = ''; });
    $('#cropOk').addEventListener('click', () => {
      const iw = img.clientWidth, ih = img.clientHeight;
      if (!iw || !ih) { toast('图片还在加载，请稍候再点确定'); return; }
      // 点击时实时读取自然尺寸（避免图片未加载完导致 0 宽高）
      const nW = img.naturalWidth || natW, nH = img.naturalHeight || natH;
      const scale = (nW && nH) ? nW / iw : 1; // 显示坐标 -> 原始分辨率
      const sx = rect.offsetLeft * scale;
      const sy = rect.offsetTop * scale;
      let sw = rect.offsetWidth * scale;
      let sh = rect.offsetHeight * scale;
      if (sw <= 0 || sh <= 0) { toast('裁剪区域无效，请重新调整选框'); return; }
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(sw)); c.height = Math.max(1, Math.round(sh));
      const ctx = c.getContext('2d');
      try {
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      } catch (err) {
        toast('裁剪失败，请重试'); return;
      }
      mask.hidden = true; panel.innerHTML = '';
      cb(c.toDataURL('image/jpeg', 0.92));
    });
    const setNat = () => { natW = img.naturalWidth; natH = img.naturalHeight; };
    if (img.complete) setNat(); img.onload = () => { setNat(); initBox(); };
  }

  /* ---------------- 导出 PDF（先筛选勾选，再生成 A4） ---------------- */
  // 语文、英语不预留作答区域，其余科目预留
  function needWrite(e) { return e.subject !== '语文' && e.subject !== '英语'; }

  // 第一步：在当前筛选结果（或指定 id 集合）中勾选要导出的题目
  function openExportSelect(ids) {
    let list;
    if (ids && ids.length) {
      const all = DB.getErrors();
      list = all.filter(e => ids.includes(e.id));
    } else {
      list = DB.getErrors(Object.assign(
        {}, state.subject !== '全部' ? { subject: state.subject } : {}, state.filter
      ));
      list = applyWrongFilter(list, state.filter);   // 错题次数筛选（DB.getErrors 不识别该字段，单独后置）
    }
    if (!list.length) { toast('当前没有可导出的错题'); return; }
    const body = openSheet(`
      <button class="close-x">✕</button>
      <h3>选择要导出的错题</h3>
      <p style="font-size:12px;color:var(--ink-2);margin:-4px 0 12px">已按当前筛选列出共 ${list.length} 道，勾选需要的题目后导出为 A4 PDF（默认全选）。</p>
      <div class="btn-row" style="margin-bottom:10px">
        <button class="btn ghost" id="expAll">全选</button>
        <button class="btn ghost" id="expNone">全不选</button>
      </div>
      <div id="expList" style="max-height:46vh;overflow:auto">
        ${list.map(e => {
          const q = (isDictError(e) ? (e.pinyin || e.text || '') : (e.text || '')).slice(0, 40);
          return `
          <label class="exp-row">
            <input type="checkbox" class="exp-chk" data-id="${e.id}" checked/>
            <span class="exp-info">${subjTag(e.subject)}<span class="exp-q">${q}</span></span>
          </label>`;
        }).join('')}
      </div>
      <button class="btn" id="expGo" style="margin-top:14px">导出选中（<span id="expCnt">${list.length}</span>）</button>`);
    const syncCnt = () => { $('#expCnt').textContent = body.querySelectorAll('.exp-chk:checked').length; };
    body.querySelectorAll('.exp-chk').forEach(c => c.addEventListener('change', syncCnt));
    $('#expAll').addEventListener('click', () => { body.querySelectorAll('.exp-chk').forEach(c => (c.checked = true)); syncCnt(); });
    $('#expNone').addEventListener('click', () => { body.querySelectorAll('.exp-chk').forEach(c => (c.checked = false)); syncCnt(); });
    $('#expGo').addEventListener('click', () => {
      const ids = Array.from(body.querySelectorAll('.exp-chk:checked')).map(c => c.dataset.id);
      if (!ids.length) { toast('请至少勾选一道题'); return; }
      const sel = list.filter(e => ids.includes(e.id));
      closeSheet();
      exportPDF(sel);
    });
  }

  // 第二步：生成 A4 打印区（语文/英语不预留作答位；基本 2 题/页，长题 1 题/页）
  function exportPDF(list) {
    if (!list.length) { toast('没有可导出的错题'); return; }
    const pf = $('#printArea');
    pf.innerHTML = `
      <div class="pf-doc">
        <div class="pf-head">
          <h1 class="pf-title">错题练习卷</h1>
          <p class="pf-sub">共 ${list.length} 道 · 生成于 ${new Date().toLocaleString('zh-CN')}</p>
        </div>
        ${list.map((e, i) => {
          const isP = isDictError(e);
          const q = isP ? (e.pinyin || e.text || '') : (e.text || '');
          const reserve = needWrite(e);
          return `
          <div class="pf-item">
            <div class="pf-meta">
              <span class="pf-no">第 ${i + 1} 题</span>
              ${subjTag(e.subject)}
              ${e.kpId ? `<span class="tag">知识点 · ${kwName(e.kpId)}</span>` : ''}
              ${e.srcId ? `<span class="tag">来源 · ${kwName(e.srcId)}</span>` : ''}
            </div>
            ${q ? `<div class="pf-q">${q}</div>` : ''}
            ${imgList(e).map(s => `<img class="pf-img zoomable" src="${s}" alt=""/>`).join('')}
            ${reserve ? `<div class="pf-write"><span>作答区域</span></div>` : ''}
          </div>`;
        }).join('')}
      </div>`;
    // 触发浏览器打印 / 另存为 PDF（A4 样式由 @media print 控制）
    setTimeout(() => window.print(), 60);
  }

  // 立即同步一次：先拉取云端最新，若云端无数据 / 拉取失败则改为上传本地
  async function cloudSyncNow() {
    const a = DB.getCurrentAccount();
    const c = DB.getCloud() || {};
    if (!a) { toast('请先登录账户后再同步'); return false; }
    if (!c.token || !c.gistId) { toast('本机未配置云端：请退出登录后重新登录，按提示填一次 Token'); return false; }
    try {
      await DB.gistUpload().catch(() => {}); // 合并云端 + 本地后上传（双向同步，避免覆盖）
      setView(state.view); updateRevBadge();
      return true;
    } catch (e) { toast('同步失败：' + e.message); return false; }
  }

  /* ---------------- 下拉同步：页面顶部下拉即同步（手机 / iPad 触屏） ---------------- */
  function initPullToSync() {
    const THRESHOLD = 62, MAX = 110;
    // 指示器样式随组件注入，保持与逻辑内聚
    if (!document.getElementById('pullStyle')) {
      const st = document.createElement('style');
      st.id = 'pullStyle';
      st.textContent = '.pull-ind{position:fixed;left:50%;transform:translateX(-50%);top:8px;z-index:9999;height:0;overflow:hidden;opacity:0;display:flex;align-items:center;justify-content:center;min-width:132px;padding:0 14px;background:rgba(122,189,154,.94);color:#fff;border-radius:16px;font-size:13px;font-weight:700;box-shadow:0 4px 14px rgba(0,0,0,.14);pointer-events:none;transition:height .12s ease,opacity .12s ease;}.pull-ind.ready{background:rgba(83,163,124,.96);}';
      document.head.appendChild(st);
    }
    let ind = document.getElementById('pullInd');
    if (!ind) { ind = document.createElement('div'); ind.id = 'pullInd'; ind.className = 'pull-ind'; document.body.appendChild(ind); }
    let startY = 0, pulling = false, dy = 0, busy = false;

    function scrollTopNow() {
      const v = document.getElementById('view');
      if (v) {
        const cs = getComputedStyle(v);
        if ((cs.overflowY === 'auto' || cs.overflowY === 'scroll') && v.scrollHeight > v.clientHeight + 2) return v.scrollTop;
      }
      return (document.scrollingElement || document.documentElement).scrollTop || window.scrollY || 0;
    }
    function setInd(text, h) { ind.textContent = text; ind.style.height = (h || 0) + 'px'; ind.style.opacity = h ? 1 : 0; }
    function reset() { pulling = false; dy = 0; setInd('', 0); ind.classList.remove('ready'); }
    function onStart(y) {
      if (busy) return;
      if (scrollTopNow() > 2) return;              // 仅在页面顶部才允许下拉，避免与滚动冲突
      startY = y; pulling = true; dy = 0;
    }
    function onMove(y, ev) {
      if (!pulling || busy) return;
      dy = y - startY;
      if (dy <= 0 || scrollTopNow() > 2) { reset(); return; }
      if (ev && ev.cancelable) ev.preventDefault();
      const ready = dy >= THRESHOLD;
      ind.classList.toggle('ready', ready);
      setInd(ready ? '↓ 松手同步' : '↓ 下拉同步', Math.min(MAX, dy * 0.5));
    }
    async function onEnd() {
      if (!pulling || busy) return;
      const ok = dy >= THRESHOLD;
      pulling = false;
      if (!ok) { reset(); return; }
      busy = true;
      setInd('同步中…', 38);
      const done = await cloudSyncNow();
      setInd(done ? '同步完成 ✓' : '同步失败', 38);
      if (done) toast('已同步 ✓');
      dy = 0;
      setTimeout(() => { busy = false; reset(); }, 900);
    }

    document.addEventListener('touchstart', e => { if (e.touches.length === 1) onStart(e.touches[0].clientY); }, { passive: true });
    document.addEventListener('touchmove', e => { if (e.touches.length === 1) onMove(e.touches[0].clientY, e); }, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
  }

  /* ---------------- 启动 ---------------- */
  DB.migrateLegacy();
  DB.seedAccounts();
  initPullToSync();
  if (DB.getCurrentName()) afterLogin(); else openLoginModal();
})();
