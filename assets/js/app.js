/* =========================================================
 * 错题本工作台 · 框架原型
 * 移动端优先 / 清新淡雅 / 纯前端（localStorage）
 * 本文件搭建四大模块的可点击框架，功能为骨架，供确认方向。
 * ========================================================= */
(function () {
  'use strict';
  const DB = window.DB;
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const state = { view: 'home', subject: '全部', filter: {}, expanded: {}, selectMode: false, selected: new Set(), mineFilter: { subject: '全部', kpId: null, srcId: null }, mineStatOpen: true };

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
  function closeSheet() { $('#sheet').hidden = true; $('#sheetBody').innerHTML = ''; }
  $('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });

  function subjTag(s) { return `<span class="subj-tag subj-${s}">${s}</span>`; }
  function masteryTag(m) {
    const mm = DB.MASTERY[m] || DB.MASTERY.unknown;
    return `<span class="mastery ${mm.cls}">${mm.label}</span>`;
  }
  // 掌握状态展示：自动判定的已掌握也显示为“已掌握”
  function masteryDisplay(e) {
    return DB.isMastered(e) ? masteryTag('known') : masteryTag(e.mastery || 'unknown');
  }
  function kwName(id) { const k = DB.getKeywords().find(x => x.id === id); return k ? k.name : ''; }
  // 卡片顶部统一标签（高频词方式）：科目 → 知识点 → 来源 → 掌握情况
  function metaTagsHTML(e) {
    return subjTag(e.subject)
      + (e.kpId ? `<span class="tag">${esc(kwName(e.kpId))}</span>` : '')
      + (e.srcId ? `<span class="tag">${esc(kwName(e.srcId))}</span>` : '')
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
    const n = DB.dueReviews().length;
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

  /* ---------------- 首页（紧凑：标题 + 三卡片 + 最近错题） ---------------- */
  function renderHome() {
    const errs = DB.getErrors();
    const due = DB.dueReviews();
    const revCount = due.length;
    const known = errs.filter(e => DB.isMastered(e)).length;
    const recent = errs.slice(0, 5); // getErrors 默认按创建时间倒序，取最近 5 道

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
      ${revCount ? `
      <div class="card" style="margin-top:12px;padding:14px 16px">
        <p class="card-h" style="margin-bottom:8px">今日需要复习 <span style="color:var(--ink-2);font-weight:400">（${revCount} 道）</span></p>
        <div id="homeRevList">
          ${due.map(e => `
            <div class="rev-item">
              <div class="rev-due">${dueLabel(e)}</div>
              <div class="rev-card">
                <div class="item-top">${metaTagsHTML(e)}
                  <button class="item-edit" data-edit="${e.id}" title="编辑 / 删除" aria-label="编辑">
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  </button>
                </div>
                ${errorExpandHTML(e)}
              </div>
            </div>`).join('')}
        </div>
        <button class="btn small ghost" id="goReview" style="width:100%;margin-top:10px">去复习页逐题批改 ›</button>
      </div>` : ''}
      <div class="card">
        <p class="card-h">最近错题</p>
        ${recent.length
          ? `<div class="recent-grid">${recent.map(recentHTML).join('')}</div>`
          : '<div class="empty">还没有错题，点下方 ＋ 录入吧</div>'}
      </div>`;
    $('#goReview')?.addEventListener('click', () => setView('review'));
    if (revCount) {
      bindAnsToggle($('#homeRevList') || document);
      $$('#homeRevList .item-edit').forEach(b => b.addEventListener('click', ev => {
        ev.stopPropagation(); openDetail(b.dataset.edit);
      }));
    }
    bindRecent();
  }
  function fmtDateShort(iso) { const d = new Date(iso); return `${d.getMonth() + 1}月${d.getDate()}日`; }
  // 统一展开详情块：知识点 + 题目全文 + 正确答案(点击查看) + 收录时间 + 做题记录
  function errorExpandHTML(e) {
    const isP = isDictError(e);
    const qFull = isP ? (e.pinyin || e.text || '') : (e.text || '');
    const ok = e.reviews.filter(r => r.correct).length;
    const bad = e.reviews.length - ok;
    return `
      <div class="exp-q">${qFull || (e.image ? '［含图片错题］' : '（未填写题干）')}</div>
      ${e.image ? `<img class="exp-img" src="${e.image}" alt=""/>` : ''}
      <div class="ans-wrap">
        <button class="link-btn" type="button">显示正确答案</button>
        <div class="exp-ans" hidden>${e.answer || '（未填写）'}</div>
      </div>
      <div class="exp-meta-row"><span>收录于 ${fmtDate(e.createdAt)}</span><span>做题 ${e.reviews.length} 次 · 正确 ${ok} 次 · 错误 ${bad} 次</span></div>`;
  }
  function expRow(k, v) {
    return `<div class="exp-row"><span class="exp-k">${k}</span><span class="exp-v">${v}</span></div>`;
  }
  function recentHTML(e) {
    const isP = isDictError(e);
    const q = (isP ? (e.pinyin || e.text || '') : (e.text || '')).slice(0, 140)
      || (e.image ? '［含图片错题］' : '（未填写题干）');
    return `
      <div class="recent-item" data-id="${e.id}">
        <div class="recent-top">
          ${metaTagsHTML(e)}
          <button class="item-edit" data-edit="${e.id}" title="编辑 / 删除" aria-label="编辑">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
        </div>
        <div class="recent-body">
          ${e.image ? `<img class="recent-thumb" src="${e.image}" alt=""/>` : ''}
          <div class="recent-q">${q}</div>
        </div>
        <div class="recent-exp" hidden>${errorExpandHTML(e)}</div>
      </div>`;
  }
  function bindRecent() {
    $$('.recent-item').forEach(it => {
      const exp = it.querySelector('.recent-exp');
      if (exp) it.addEventListener('click', () => {
        exp.hidden = !exp.hidden;
        it.classList.toggle('open', !exp.hidden);
      });
      const edit = it.querySelector('.item-edit');
      if (edit) edit.addEventListener('click', ev => { ev.stopPropagation(); openDetail(edit.dataset.edit); });
      bindAnsToggle(it);
    });
  }
  // 绑定「显示正确答案」按钮（点击展开/收起答案，不触发外层折叠）
  function bindAnsToggle(scope) {
    scope.querySelectorAll('.ans-wrap .link-btn').forEach(btn => {
      btn.addEventListener('click', ev => {
        ev.stopPropagation();
        const box = btn.parentElement.querySelector('.exp-ans');
        box.hidden = !box.hidden;
        btn.textContent = box.hidden ? '显示正确答案' : '隐藏正确答案';
      });
    });
  }

  function isDictError(e) {
    const kp = DB.getKeywords('kp').find(k => k.id === e.kpId);
    return e.subject === '语文' && kp && DB.isChineseDictKp(kp.name);
  }
  // 题目展示块：文字（字词默写为拼音）在上，图片在下
  function questionBlockHTML(e, isPinyin) {
    const qText = isPinyin ? (e.pinyin || e.text || '') : (e.text || '');
    let h = '';
    if (qText) h += `<div class="detail-q">${qText}</div>`;
    if (e.image) h += `<img class="detail-img" src="${e.image}"/>`;
    return h || '<div class="detail-q">（无内容）</div>';
  }
  function itemHTML(e, withDel, expandable, selectable, selected) {
    const hasImg = !!e.image;
    const isP = isDictError(e);
    const q = (isP ? (e.pinyin || e.text || '') : (e.text || '')).slice(0, 60) || (hasImg ? '［含图片错题］' : '（未填写题干）');
    return `
      <div class="item${selectable && selected ? ' sel' : ''}" data-id="${e.id}">
        ${withDel ? `<button class="item-edit" data-edit="${e.id}" title="编辑 / 删除" aria-label="编辑"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button>` : ''}
        <div class="item-top">
          ${selectable ? `<input type="checkbox" class="item-check" data-id="${e.id}" ${selected ? 'checked' : ''} aria-label="选择"/>` : ''}
          ${metaTagsHTML(e)}
        </div>
        <div class="item-q">${q}</div>
        ${expandable ? `<div class="item-exp" hidden>${errorExpandHTML(e)}</div>` : `
        <div class="item-when">录入于 ${fmtDate(e.createdAt)}</div>`}
      </div>`;
  }
  function bindItems() {
    $$('.item').forEach(it => {
      const exp = it.querySelector('.item-exp');
      if (exp) it.addEventListener('click', ev => {
        if (ev.target.closest('.item-edit')) return;
        exp.hidden = !exp.hidden;
        it.classList.toggle('open', !exp.hidden);
      });
      bindAnsToggle(it);
      const edit = it.querySelector('.item-edit');
      if (edit) edit.addEventListener('click', ev => {
        ev.stopPropagation();
        openDetail(edit.dataset.edit);
      });
    });
  }

  /* ---------------- 设置（数据迁移 / 清空 / 云端同步预留） ---------------- */
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
  }

  // 登录后一次性云端配置引导（lvcheng 仅填 Token；其余账号填 Token + Gist ID）。不在设置内，杜绝误改。
  function openCloudGuide() {
    const a = DB.getCurrentAccount(); if (!a) return;
    const isLv = a.name === 'lvcheng';
    const c = DB.getCloud();
    openSheet(`
      <button class="close-x">✕</button>
      <h3>配置云端同步</h3>
      <p class="set-tip2">${isLv ? 'lvcheng 账户将自动同步到专属云端数据库。只需粘贴一次 Token，之后每次修改自动备份（Token 仅存本机，不公开）。' : '为该账户配置 GitHub Gist 云端同步，Token 仅存本机。'}</p>
      <div class="set-form">
        <label class="set-lbl">GitHub Token${isLv ? '（lvcheng 专用）' : ''}</label>
        <input class="set-input" id="guideToken" type="password" placeholder="ghp_ 开头" autocomplete="off" />
        ${isLv ? '' : `
        <label class="set-lbl">Gist ID</label>
        <input class="set-input" id="guideGist" type="text" placeholder="gist 地址里的那串 ID" value="${esc(c.gistId || '')}" />
        <label class="set-chk"><input type="checkbox" id="guideAuto" ${c.autoSync ? 'checked' : ''}/> 自动同步（任何修改实时上传）</label>`}
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
      if (!isLv) { patch.gistId = $('#guideGist').value.trim(); patch.autoSync = $('#guideAuto').checked; }
      DB.setCloud(patch);
      const btn = $('#guideSave'); btn.disabled = true;
      try {
        await DB.gistDownload().catch(() => DB.gistUpload()); // 先拉取已有数据，失败（如首次）则上传当前
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
      <p class="set-tip">数据保存在本设备浏览器中。换手机 / 清缓存前，请先「导出数据」备份；已登录账户会自动云端同步。</p>`);

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
  function renderList() {
    const subjects = DB.getSubjects();
    const expanded = state.expanded || {};
    const f = state.filter;
    const hasFilter = !!(f.kpId || f.srcId || f.mastery || (state.subject && state.subject !== '全部'));
    const total = DB.getErrors().length;
    const allOpen = subjects.length > 0 && subjects.every(s => expanded[s]);

    // 筛选模式下，只展示「有符合筛选错题」的学科笔记本，保持界面紧凑
    const showSubjects = hasFilter ? subjects.filter(s => listSubjectErrs(s).length > 0) : subjects;

    $('#view').innerHTML = `
      <div class="nb-tools nb-row1">
        <button class="btn ghost" id="openFilter">筛选${filterLabel()}</button>
        <button class="btn ghost" id="toggleSelect">${state.selectMode ? '完成' : '勾选'}</button>
        <button class="btn ghost" id="selectAll">全选</button>
        <button class="btn ghost" id="toggleAll">${allOpen ? '收起' : '展开'}</button>
      </div>
      ${state.selectMode ? `
      <p class="nb-selcnt">已选 ${state.selected.size} 道</p>
      <div class="nb-tools nb-act">
        <button class="btn ghost nb-danger" id="delSel">删除选中</button>
        <button class="btn" id="expSel">导出PDF</button>
        <button class="btn ghost" id="selNone">清空选择</button>
      </div>` : ''}
      <p class="list-hint">点开任一错题本可预览内容 · 共 ${total} 道 · 点 ✕ 可删减${hasFilter ? '（已按筛选隐藏无匹配学科）' : ''}</p>
      ${showSubjects.length ? showSubjects.map(s => {
        const errsAll = DB.getErrors({ subject: s });
        const errs = listSubjectErrs(s);
        const isOpen = !!expanded[s];
        const allSel = errs.length > 0 && errs.every(e => state.selected.has(e.id));
        return `
        <div class="book">
          <div class="book-head" data-s="${s}">
            ${state.selectMode ? `<input type="checkbox" class="book-check" data-s="${s}" ${allSel ? 'checked' : ''} aria-label="全选本本"/>` : ''}
            ${subjTag(s)}
            <span class="book-cnt">${errsAll.length} 道</span>
            <span class="book-chev">${isOpen ? '▾' : '▸'}</span>
          </div>
          <div class="book-body" id="book-${s}" ${isOpen ? '' : 'hidden'}>
            ${errs.length
              ? errs.map(e => itemHTML(e, true, true, state.selectMode, state.selected.has(e.id))).join('')
              : `<div class="book-empty">${hasFilter ? '该本无符合筛选的错题' : '本错题本还是空的，点 ＋ 录入吧'}</div>`}
          </div>
        </div>`;
      }).join('') : `<div class="empty">没有符合当前筛选的错题</div>`}`;

    $('#openFilter').addEventListener('click', () => openFilter());
    $('#toggleSelect').addEventListener('click', () => {
      state.selectMode = !state.selectMode;
      if (!state.selectMode) state.selected.clear();
      renderList();
    });
    $('#selectAll').addEventListener('click', () => {
      state.selectMode = true;
      const ids = [];
      showSubjects.forEach(s => listSubjectErrs(s).forEach(e => ids.push(e.id)));
      state.selected = new Set(ids);
      renderList();
    });
    $('#toggleAll').addEventListener('click', () => {
      const all = subjects.every(s => state.expanded[s]);
      subjects.forEach(s => (state.expanded[s] = !all));
      renderList();
    });
    if (state.selectMode) {
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
      $('#selNone').addEventListener('click', () => { state.selected.clear(); renderList(); });
    }
    $$('.book-head').forEach(h => h.addEventListener('click', () => {
      const s = h.dataset.s; state.expanded[s] = !state.expanded[s];
      const body = document.getElementById('book-' + s);
      if (body) body.hidden = !state.expanded[s];
      const chev = h.querySelector('.book-chev'); if (chev) chev.textContent = state.expanded[s] ? '▾' : '▸';
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
      const errs = listSubjectErrs(s);
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
  function filterLabel() {
    const f = state.filter; let n = 0;
    if (state.subject && state.subject !== '全部') n++;
    if (f.kpId) n++; if (f.srcId) n++; if (f.mastery) n++;
    return n ? `（${n}）` : '';
  }
  // 取某学科在当前筛选下匹配的错题（笔记本渲染与勾选共用）
  function listSubjectErrs(s) {
    const f = state.filter;
    const hasFilter = !!(f.kpId || f.srcId || f.mastery || (state.subject && state.subject !== '全部'));
    return DB.getErrors(Object.assign({ subject: s }, hasFilter ? f : {}));
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
    const kpTop = topKeywords('kp', lockSubject, f.kpId, 6);
    const srcTop = topKeywords('src', lockSubject, f.srcId, 6);
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
      </div>
      <div class="btn-row">
        <button class="btn ghost" id="fReset">重置</button>
        <button class="btn" id="fApply">应用</button>
      </div>`);
    if (!lockSubject) body.querySelectorAll('#fSubj .kw').forEach(x => x.addEventListener('click', () => {
      body.querySelectorAll('#fSubj .kw').forEach(y => y.classList.remove('active'));
      x.classList.add('active');
    }));
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
      state.subject = subj;
      state.filter = { kpId: kp || null, srcId: src || null, mastery: m || null };
      if (lockSubject) state.expanded[lockSubject] = true;
      closeSheet(); renderList();
    });
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
      image: err ? (err.image || null) : null,
      kpId: err ? (err.kpId || null) : null,
      srcId: err ? (err.srcId || null) : null,
      mastery: err ? (err.mastery || 'unknown') : 'unknown',
      answer: err ? (err.answer || '') : '',
      pinyin: err ? (err.pinyin || '') : '',
    };

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
      $('#pinyinWrap').style.display = isDict ? 'block' : 'none';
      $('#entryAnsField').style.display = isDict ? 'none' : 'block';
      $('#entryQLabel').textContent = isDict ? '字词内容（输入中文，将自动转为拼音题目）' : '题干 / 错题内容';
      if (isDict) {
        const py = DB.toPinyin(form.text);
        if (py) { form.pinyin = py; $('#pinyinVal').textContent = py; }
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

    const body = openSheet(`
      <button class="close-x">✕</button>
      <h3>${isEdit ? '编辑错题' : '录入错题'}</h3>
      <div class="field"><label>科目（自动归入该科错题本）</label>
        <div class="seg" id="entrySubj">
          ${subjects.map(s => `<button class="chip ${s === form.subject ? 'active' : ''}" data-s="${s}">${s}</button>`).join('')}
        </div>
      </div>
      <div class="field" id="entryQField">
        <label id="entryQLabel">题干 / 错题内容</label>
        <textarea class="textarea" id="entryText" placeholder="输入或粘贴题目内容…">${form.text}</textarea>
      </div>
      <div class="field"><label>图片（从相册添加，可裁剪）</label>
        <button class="btn ghost" id="imgDrop" style="width:100%">🖼 从相册添加图片</button>
        <input type="file" id="imgInput" accept="image/*" hidden />
        <div id="imgPreview"></div>
      </div>
      <div class="field" id="pinyinWrap" style="display:none">
        <label>题目将自动转为拼音（复习时显示拼音，中文作正确答案不展示）</label>
        <div class="pinyin-line" id="pinyinVal">${form.pinyin}</div>
      </div>
      <div class="field"><label>知识点</label><div class="kw-box" id="entryKp">${kpOptions()}</div></div>
      <div class="field"><label>来源</label><div class="kw-box" id="entrySrc">${srcOptions()}</div></div>
      <div class="field"><label>掌握情况</label>
        <div class="opt-row" id="entryMastery">
          ${Object.values(DB.MASTERY).map(m => `<span class="opt ${form.mastery === m.key ? 'active' : ''}" data-m="${m.key}">${m.label}</span>`).join('')}
        </div>
      </div>
      <div class="field" id="entryAnsField">
        <label>正确答案</label>
        <textarea class="textarea" id="entryAnswer" placeholder="填写正确答案与解析…">${form.answer}</textarea>
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
    $('#entryText').addEventListener('input', e => { form.text = e.target.value; refresh(); });
    $('#entryAnswer').addEventListener('input', e => (form.answer = e.target.value));
    $$('#entryMastery .opt').forEach(o => o.addEventListener('click', () => {
      form.mastery = o.dataset.m;
      $$('#entryMastery .opt').forEach(x => x.classList.toggle('active', x === o));
    }));
    // 渲染图片预览 + 裁剪按钮（图片可矩形裁剪，不做识别）
    function renderImgPreview() {
      if (!form.image) { $('#imgPreview').innerHTML = ''; return; }
      $('#imgPreview').innerHTML = `
        <div class="img-prev"><img src="${form.image}" />
          <div class="img-tools">
            <button class="crop-btn" id="cropBtn">✂ 裁剪</button>
          </div>
          <p class="img-note">拖动选框选择要保留的部分，可移动或缩放，裁掉多余区域。</p>
        </div>`;
      $('#cropBtn').addEventListener('click', () => openCropper(form.image, cropped => {
        form.image = cropped; renderImgPreview(); refresh(); toast('已裁剪 ✓');
      }));
    }
    // 从相册添加图片
    $('#imgDrop').addEventListener('click', () => $('#imgInput').click());
    $('#imgInput').addEventListener('change', e => {
      const file = e.target.files[0]; if (!file) return;
      const r = new FileReader();
      r.onload = ev => { form.image = ev.target.result; renderImgPreview(); refresh(); };
      r.readAsDataURL(file);
    });
    // 保存：文字 + 图片 并存；字词默写则将中文转为拼音题目、中文存为正确答案
    $('#saveErr').addEventListener('click', () => {
      const hasText = !!form.text.trim();
      const hasImg = !!form.image;
      if (!hasText && !hasImg) { toast('请填写文字或从相册添加图片'); return; }
      const isDict = form.subject === '语文'
        && DB.isChineseDictKp(DB.getKeywords('kp').find(k => k.id === form.kpId)?.name);
      const mode = (hasText && hasImg) ? 'mixed' : hasImg ? 'image' : 'text';
      let payload = {
        subject: form.subject, mode,
        text: form.text, image: form.image,
        kpId: form.kpId, srcId: form.srcId, mastery: form.mastery, answer: form.answer,
        pinyin: '',
      };
      if (isDict) {
        const py = DB.toPinyin(form.text);
        payload.text = py || form.text;     // 题目显示为拼音
        payload.answer = form.text;        // 中文作为正确答案（不展示）
        payload.pinyin = py;
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
    renderImgPreview();
  }

  /* ---------------- 错题详情 ---------------- */
  function openDetail(id) {
    const e = DB.getError(id); if (!e) return;
    const isPinyin = isDictError(e);
    const body = openSheet(`
      <button class="close-x">✕</button>
      <h3>错题详情</h3>
      <div class="item-meta">${metaTagsHTML(e)}</div>
      ${questionBlockHTML(e, isPinyin)}
      <div class="ans-wrap" style="margin-top:10px">
        <button class="btn ghost" id="showAnsBtn">显示正确答案</button>
        <div class="detail-a" id="ansBox" style="display:none">${e.answer || '（未填写）'}</div>
      </div>
      <div class="item-when" style="margin-top:8px">
        ${DB.isMastered(e) ? '🟢 已掌握 · 已停止推送' : '🔔 下次推送：' + fmtDue(DB.nextDueDate(e))}
      </div>
      ${e.reviews.length ? `<div class="records"><p class="card-h" style="margin-top:14px">复习记录（已答对 ${e.reviews.filter(r => r.correct).length} / 共 ${e.reviews.length} 次）</p>
        ${e.reviews.map(r => `<div class="rec"><span class="${r.correct ? 'r-ok' : 'r-bad'}">${r.correct ? '✓ 答对' : '✗ 答错'}</span>
        <span>${fmtDate(r.date)}</span></div>`).join('')}</div>` : ''}
      <div class="btn-row" style="margin-top:16px">
        <button class="btn ghost" id="delErr">删除</button>
        <button class="btn" id="editErr">编辑</button>
      </div>`);
    $('#showAnsBtn').addEventListener('click', () => {
      $('#ansBox').style.display = 'block';
      $('#showAnsBtn').style.display = 'none';
    });
    $('#delErr').addEventListener('click', () => {
      if (confirm('确定删除这道错题？')) { DB.deleteError(id); closeSheet(); toast('已删除'); setView(state.view); }
    });
    $('#editErr').addEventListener('click', () => { closeSheet(); openEntry(e); });
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
  function renderReview() {
    const due = DB.dueReviews();
    const mastered = DB.getErrors().filter(e => DB.isMastered(e));
    $('#view').innerHTML = `
      <div class="card" style="padding:14px 16px">
        <p class="card-h" style="margin-bottom:6px">复习推送计划</p>
        <p style="font-size:12.5px;color:var(--ink-2);margin:0;line-height:1.6"><b>未掌握</b>：按 +2 / +10 / +30 / +60 / +90 …天推送，除首次外连续答对 2 次即归为已掌握；<b>部分掌握</b>：按 +30 / +60 / +90 …天推送，连续答对 2 次即归为已掌握。已掌握不再推送。</p>
      </div>
      ${due.length === 0
        ? '<div class="empty"><span class="em-ico">🌱</span>今天没有需要复习的错题，继续保持！</div>'
        : `
        <div class="rev-toolbar">
          <div class="rev-count">🔔 今日待复习 <b>${due.length}</b> 道</div>
          <button class="btn small" id="toGrade">批改</button>
        </div>
        <p class="rev-tip">以下为全部待复习内容（已展开）；自测后可点右上「批改」逐题勾选对错并记录。</p>
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
                ${errorExpandHTML(e)}
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
    bindAnsToggle($('#revList') || document);
    $$('#revList .item-edit').forEach(b => b.addEventListener('click', ev => {
      ev.stopPropagation(); openDetail(b.dataset.edit);
    }));
    $('#toGrade')?.addEventListener('click', renderGrade);
    updateRevBadge();
  }

  // 批改模式：题目折叠展示、答案全部显示，逐题勾选「对 / 错」后统一记录
  function renderGrade() {
    const due = DB.dueReviews();
    if (!due.length) { renderReview(); return; }
    $('#view').innerHTML = `
      <div class="grade-bar">
        <button class="btn ghost small" id="gradeBack">‹ 返回</button>
        <span class="grade-title">批改模式 · 共 ${due.length} 道</span>
        <button class="btn small" id="gradeSave">保存批改</button>
      </div>
      <p class="grade-tip">题目以折叠形式展示，答案已全部显示；逐题勾选「对 / 错」，完成后点「保存批改」记录。</p>
      <div id="gradeList">
        ${due.map(gradeItemHTML).join('')}
      </div>`;
    const sel = {};
    $$('#gradeList .grade-item').forEach(card => {
      const id = card.dataset.id;
      card.querySelectorAll('.pick').forEach(b => b.addEventListener('click', () => {
        const v = b.dataset.v === 'true';
        if (sel[id] === v) { delete sel[id]; b.classList.remove('on'); return; }
        sel[id] = v;
        card.querySelectorAll('.pick').forEach(x => x.classList.remove('on'));
        b.classList.add('on');
      }));
    });
    $('#gradeBack').addEventListener('click', renderReview);
    $('#gradeSave').addEventListener('click', () => {
      let ok = 0, bad = 0, none = 0;
      due.forEach(e => {
        if (!(e.id in sel)) { none++; return; }
        DB.recordReview(e.id, sel[e.id]);
        if (sel[e.id]) ok++; else bad++;
      });
      renderReview();
      toast(`已记录 ${ok + bad} 道（对 ${ok} / 错 ${bad}${none ? ` · 跳过 ${none}` : ''}）`);
    });
  }
  // 单题批改卡片：折叠题面 + 显示答案 + 对/错选择
  function gradeItemHTML(e) {
    const isP = isDictError(e);
    const q = (isP ? (e.pinyin || e.text || '') : (e.text || '')).slice(0, 120)
      || (e.image ? '［含图片错题］' : '（未填写题干）');
    return `
      <div class="grade-item" data-id="${e.id}">
        <div class="grade-top">${metaTagsHTML(e)}</div>
        <div class="grade-q">${q}</div>
        ${e.image ? `<img class="grade-img" src="${e.image}" alt=""/>` : ''}
        <div class="grade-ans"><span class="ga-k">答案：</span>${e.answer || '（未填写答案）'}</div>
        <div class="grade-pick">
          <button class="pick ok" type="button" data-v="true">✓ 对</button>
          <button class="pick bad" type="button" data-v="false">✗ 错</button>
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
  // 「我的」页内联掌握统计：筛选（学科/知识点/来源）+ 对错情况 + 掌握情况
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
    const fuzzy = errs.filter(e => !DB.isMastered(e) && (e.mastery || 'unknown') === 'fuzzy').length;
    const unknown = errs.length - known - fuzzy;
    const pct = n => errs.length ? Math.round(n / errs.length * 100) : 0;
    const wrongBuckets = [0, 0, 0, 0, 0, 0];
    errs.forEach(e => { const w = (e.reviews || []).filter(r => !r.correct).length; wrongBuckets[w >= 5 ? 5 : w]++; });
    const maxW = Math.max(1, ...wrongBuckets);
    const wrongLabels = ['0次', '1次', '2次', '3次', '4次', '5次以上'];
    const wrongHTML = wrongLabels.map((lb, i) => `<div class="ms-mrow"><span>${lb}</span><div class="bar"><i style="width:${Math.round(wrongBuckets[i] / maxW * 100)}%;background:var(--bad)"></i></div><b>${wrongBuckets[i]}</b></div>`).join('');
    const subChips = ['全部', ...subs].map(s => `<button class="chip ${s === f.subject ? 'active' : ''}" data-sub="${esc(s)}">${esc(s)}</button>`).join('');
    const kpChips = kps.length ? kps.map(k => `<button class="chip ${k.id === f.kpId ? 'active' : ''}" data-kp="${k.id}">${esc(k.name)}</button>`).join('') : '<span class="ms-empty">暂无知识点</span>';
    const srcChips = srcs.length ? srcs.map(k => `<button class="chip ${k.id === f.srcId ? 'active' : ''}" data-src="${k.id}">${esc(k.name)}</button>`).join('') : '<span class="ms-empty">暂无来源</span>';
    return `
      <div class="ms-filters">
        <div class="ms-frow"><span class="ms-fl">学科</span><div class="kw-box">${subChips}</div></div>
        <div class="ms-frow"><span class="ms-fl">知识点</span><div class="kw-box">${kpChips}</div></div>
        <div class="ms-frow"><span class="ms-fl">来源</span><div class="kw-box">${srcChips}</div></div>
      </div>
      <div class="ms-stat">
        <div class="ms-block">
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
            <div class="ms-mrow"><span>部分掌握</span><div class="bar"><i style="width:${pct(fuzzy)}%;background:#c08f2e"></i></div><b>${fuzzy}</b></div>
            <div class="ms-mrow"><span>已掌握</span><div class="bar"><i style="width:${pct(known)}%;background:#5f9c78"></i></div><b>${known}</b></div>
          </div>
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
    function listHTML() {
      const list = DB.getKeywords(type).filter(k => k.subject === sel);
      const errsAll = DB.getErrors();
      return list.length ? list.map(k => {
        const cnt = errsAll.filter(e => e.kpId === k.id || e.srcId === k.id).length;
        return `
        <div class="item" style="display:flex;align-items:center;gap:10px;cursor:default">
          <div style="flex:1">${esc(k.name)}${cnt ? `<span class="kw-cnt">${cnt} 道</span>` : ''}</div>
          <button class="opt" data-edit="${k.id}">改</button>
          <button class="opt" data-del="${k.id}" style="color:var(--bad)">删</button>
        </div>`;
      }).join('') : '<div class="empty">该科目下暂无，点击下方新增</div>';
    }
    function sheetHTML() {
      return `
        <button class="close-x">✕</button>
        <h3>${type === 'kp' ? '知识点' : '来源'}管理</h3>
        <div class="seg" id="kwSubj">
          ${subjects.map(s => `<button class="chip ${s === sel ? 'active' : ''}" data-s="${s}">${s}</button>`).join('')}
        </div>
        <div id="kwList" style="margin-top:8px">${listHTML()}</div>
        <button class="btn" id="kwAdd" style="margin-top:12px">＋ 新增${type === 'kp' ? '知识点' : '来源'}（${sel}）</button>`;
    }
    const body = openSheet(sheetHTML());
    function rebind() {
      body.innerHTML = sheetHTML();
      body.querySelector('.close-x').addEventListener('click', closeSheet);
      body.querySelectorAll('#kwSubj .chip').forEach(c => c.addEventListener('click', () => { sel = c.dataset.s; rebind(); }));
      body.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => {
        const k = DB.getKeywords(type).find(x => x.id === b.dataset.edit);
        const n = prompt('修改为：', k.name); if (n && n.trim()) { DB.updateKeyword(k.id, n); rebind(); }
      }));
      body.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
        const used = DB.getErrors().filter(e => e.kpId === b.dataset.del || e.srcId === b.dataset.del).length;
        if (used > 0) { toast('该' + (type === 'kp' ? '知识点' : '来源') + '下还有 ' + used + ' 道错题，暂不可删除（请先处理相关错题）'); return; }
        if (confirm('删除该' + (type === 'kp' ? '知识点' : '来源') + '？')) { DB.deleteKeyword(b.dataset.del); rebind(); }
      }));
      body.querySelector('#kwAdd').addEventListener('click', () => {
        const n = prompt('输入名称：'); if (n && n.trim()) { DB.addKeyword(type, n, sel); rebind(); }
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
          const q = (isDictError(e) ? (e.pinyin || e.text || '') : (e.text || '')).slice(0, 40)
            || (e.image ? '［含图片错题］' : '（未填写题干）');
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
            ${e.image ? `<img class="pf-img" src="${e.image}"/>` : ''}
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
      await DB.gistDownload().catch(() => DB.gistUpload());
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
