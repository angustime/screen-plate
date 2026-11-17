(() => {
  const $ = id => document.getElementById(id);
  const TOKEN_KEY = 'sp_token', CACHE_KEY = 'sp_cache';
  const EDITORS = ['owner', 'manager1', 'manager2', 'manager3'];
  const size = 20;
  const numberFormat = new Intl.NumberFormat('zh-TW');
  const normalize = v => v.normalize('NFKC').toLocaleLowerCase('zh-TW');
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 忽略 */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* 忽略 */ } },
  };

  let token = store.get(TOKEN_KEY);
  let role = '';
  let data = { records: [], next: {} };
  let indexed = [];
  let page = 1;
  let lastSync = 0;
  const isEditor = () => EDITORS.includes(role);

  /* ───── API ───── */
  async function api(action, payload = {}) {
    if (!window.API_URL) throw new Error('尚未設定後端網址（config.js）。');
    let response;
    try {
      response = await fetch(window.API_URL, { method: 'POST', body: JSON.stringify({ action, token, ...payload }) });
    } catch (e) {
      throw new Error('連線失敗，請確認網路後再試。');
    }
    let value;
    try { value = await response.json(); } catch (e) { throw new Error('伺服器回應異常，請稍後再試。'); }
    if (!value.ok) {
      if (value.code === 'auth') { signOut(value.error); }
      const err = new Error(value.error || '操作失敗。');
      err.code = value.code;
      throw err;
    }
    return value;
  }

  /* ───── 登入 ───── */
  function showLogin(message) {
    $('app-view').hidden = true;
    $('header-tools').hidden = true;
    $('login-view').hidden = false;
    $('login-error').hidden = !message;
    $('login-error').textContent = message || '';
    $('login-password').value = '';
    $('login-password').focus();
  }

  function signOut(message) {
    token = null;
    role = '';
    store.del(TOKEN_KEY);
    store.del(CACHE_KEY);
    for (const d of document.querySelectorAll('dialog[open]')) d.close();
    showLogin(message);
  }

  $('login-form').addEventListener('submit', async event => {
    event.preventDefault();
    const button = $('login-submit');
    button.disabled = true;
    button.textContent = '登入中…';
    $('login-error').hidden = true;
    try {
      const res = await api('login', { password: $('login-password').value });
      token = res.token;
      store.set(TOKEN_KEY, token);
      applyRole(res.role, res.label);
      showApp();
      await refresh();
    } catch (problem) {
      $('login-error').textContent = problem.message;
      $('login-error').hidden = false;
    } finally {
      button.disabled = false;
      button.textContent = '登入';
    }
  });

  $('logout').addEventListener('click', async () => {
    if (!confirm('確定登出？登出後需重新輸入密碼。')) return;
    const old = token;
    signOut();
    try { token = old; await api('logout'); } catch (e) { /* 忽略 */ } finally { token = null; }
  });

  function applyRole(newRole, label) {
    role = newRole;
    $('who').textContent = label || '';
    $('open-new').hidden = !isEditor();
    $('download').hidden = !isEditor();
    $('show-deleted-wrap').hidden = !isEditor();
    $('open-accounts').hidden = role !== 'owner';
  }

  function showApp() {
    $('login-view').hidden = true;
    $('app-view').hidden = false;
    $('header-tools').hidden = false;
  }

  /* ───── 資料同步 ───── */
  function setData(value, target) {
    data = { records: value.records, next: value.next };
    indexed = data.records.map(r => ({ ...r, searchNames: r.names.map(normalize) }));
    store.set(CACHE_KEY, JSON.stringify({ role, label: $('who').textContent, records: data.records, next: data.next }));
    if (target) {
      $('search').value = target;
      document.querySelectorAll('.filter input[value=""]').forEach(i => { i.checked = true; });
      page = 1;
    }
    render();
  }

  async function refresh(silent) {
    const note = $('sync-note');
    if (!silent) note.textContent = '正在讀取最新資料…';
    try {
      const res = await api('records');
      applyRole(res.role, res.label);
      lastSync = Date.now();
      setData(res);
      note.textContent = `資料已是最新（${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })} 更新）`;
    } catch (problem) {
      if (problem.code !== 'auth') note.textContent = `無法更新：${problem.message}（目前顯示上次讀到的資料）`;
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && token && Date.now() - lastSync > 30000) refresh(true);
  });

  /* ───── 查詢列表 ───── */
  function rank(record, term, number) {
    if (!term) return 0;
    const code = normalize(record.number);
    if (code === term || (number && (!number[1] || number[1] === record.series) && Number(number[2]) === record.sort)) return 0;
    if (code.startsWith(term)) return 1;
    if (code.includes(term) || record.searchNames.some(n => n.includes(term))) return 2;
    return -1;
  }

  function cell(row, value, className) {
    const td = row.insertCell();
    if (className) td.className = className;
    if (value) td.textContent = value;
    return td;
  }

  function renderRows(results) {
    const fragment = document.createDocumentFragment();
    for (const { record } of results) {
      const row = document.createElement('tr');
      const editable = isEditor() && !record.archived && record.status !== '空號待新建';
      const code = cell(row, editable ? '' : record.number, 'code');
      if (editable) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'plate-action';
        button.textContent = record.number;
        button.setAttribute('aria-label', `${record.number} 編輯網版`);
        code.append(button);
        row.classList.add('can-edit');
        row.addEventListener('click', () => openEditor('edit', record.number));
      }
      const label = document.createElement('span');
      label.className = 'series-label';
      label.textContent = record.series === '一般' ? '一般版' : `${record.series}版`;
      code.append(label);
      const names = cell(row);
      if (record.names.length) {
        const list = document.createElement('ul');
        list.className = 'names-list';
        for (const name of record.names) {
          const li = document.createElement('li');
          li.textContent = name;
          list.append(li);
        }
        names.append(list);
      } else {
        names.className = 'no-name';
        names.textContent = '—';
      }
      cell(row, record.count === null ? '待核對' : `${record.count} 個`, 'name-count');
      const statusCell = cell(row);
      const badge = document.createElement('span');
      if (record.archived) {
        badge.className = 'status deleted';
        badge.textContent = '已刪除';
        statusCell.append(badge);
        const undo = document.createElement('button');
        undo.type = 'button';
        undo.className = 'restore-btn';
        undo.textContent = '復原';
        undo.addEventListener('click', event => { event.stopPropagation(); restore(record.number, undo); });
        statusCell.append(undo);
        row.classList.add('is-deleted');
      } else {
        badge.className = 'status' + (record.status === '待核對' ? ' pending' : record.status === '已登錄' ? '' : ' vacant');
        badge.textContent = record.status;
        statusCell.append(badge);
      }
      fragment.append(row);
    }
    $('rows').replaceChildren(fragment);
  }

  function render() {
    const term = normalize($('search').value.trim());
    const series = document.querySelector('input[name=series]:checked').value;
    const count = document.querySelector('input[name=count]:checked').value;
    const showDeleted = $('show-deleted').checked;
    const number = /^([中大]?)([0-9]+)$/.exec(term);
    const results = indexed.flatMap(record => {
      if (record.archived !== undefined && record.archived && !showDeleted) return [];
      if ((series && series !== record.series) || (count && Number(count) !== record.count)) return [];
      const priority = rank(record, term, number);
      return priority >= 0 ? [{ record, priority }] : [];
    });
    results.sort((a, b) => a.priority - b.priority);
    const pages = Math.max(1, Math.ceil(results.length / size));
    page = Math.max(1, Math.min(page, pages));
    const start = (page - 1) * size;
    const end = Math.min(start + size, results.length);
    $('matches').textContent = results.length ? `${numberFormat.format(results.length)} 筆 · 顯示 ${start + 1}–${end}` : '0 筆';
    $('result-table').hidden = !results.length;
    $('empty').hidden = !!results.length;
    $('page-info').textContent = `${page} / ${pages} 頁`;
    $('prev').disabled = page === 1;
    $('next').disabled = page === pages;
    $('reset').disabled = !($('search').value || series || count);
    renderRows(results.slice(start, end));
  }

  const filtersChanged = () => { page = 1; render(); };
  $('search').addEventListener('input', filtersChanged);
  document.querySelectorAll('.filter').forEach(f => f.addEventListener('change', filtersChanged));
  $('show-deleted').addEventListener('change', filtersChanged);
  $('reset').addEventListener('click', () => {
    $('search').value = '';
    document.querySelectorAll('.filter input[value=""]').forEach(i => { i.checked = true; });
    filtersChanged();
    $('search').focus();
  });
  $('prev').addEventListener('click', () => { page -= 1; render(); window.scrollTo({ top: 0 }); });
  $('next').addEventListener('click', () => { page += 1; render(); window.scrollTo({ top: 0 }); });

  /* ───── 提示訊息 ───── */
  function feedback(message, removed) {
    const box = $('feedback');
    box.textContent = message;
    box.hidden = false;
    if (!removed) return;
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.textContent = '復原';
    undo.addEventListener('click', () => restore(removed, undo));
    box.append(undo);
  }

  async function restore(number, button) {
    button.disabled = true;
    try {
      setData(await api('restore', { number }), number);
      feedback(`${number} 已復原。`);
    } catch (problem) {
      feedback(problem.message);
      button.disabled = false;
    }
  }

  /* ───── 新增／編輯視窗 ───── */
  const dialog = $('edit-dialog');
  let mode = 'new', selected = null, busy = false;
  const draft = () => Array.from($('edit-names').querySelectorAll('textarea'), i => i.value);
  const blocked = () => selected?.status === '原表空白';

  function showEditError(message) {
    $('edit-error').textContent = message;
    $('edit-error').hidden = !message;
  }

  function choices() {
    const series = $('edit-series').value;
    const next = data.next[series];
    const reserved = data.records.filter(r => r.series === series && r.status === '空號待新建' && !r.archived);
    $('edit-number').replaceChildren(new Option(`${next}（下一個新號）`, next),
      ...reserved.map(r => new Option(`${r.number}（已核准空號）`, r.number)));
  }

  function renderNames(names, focusIndex) {
    $('edit-names').replaceChildren(...names.map((text, index) => {
      const row = document.createElement('div');
      row.className = 'name-row';
      const input = document.createElement('textarea');
      input.rows = text.includes('\n') ? 2 : 1;
      input.maxLength = 200;
      input.value = text;
      input.placeholder = `名稱 ${index + 1}`;
      input.setAttribute('aria-label', `名稱 ${index + 1}`);
      input.addEventListener('input', update);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '刪除';
      remove.setAttribute('aria-label', `刪除名稱 ${index + 1}`);
      remove.addEventListener('click', () => {
        const current = input.value.trim();
        if (current && !confirm(`確定刪除名稱「${current}」？\n（按「儲存」後才會真正寫入雲端）`)) return;
        const rest = draft();
        rest.splice(index, 1);
        renderNames(rest, Math.min(index, rest.length - 1));
      });
      row.append(input, remove);
      return row;
    }));
    $('name-limit').textContent = `${names.length} / 3`;
    $('add-name').disabled = names.length >= 3 || blocked();
    if (focusIndex !== undefined) ($('edit-names').querySelectorAll('textarea')[focusIndex] || $('add-name')).focus();
    update();
  }

  function valid(names) {
    if (names.length > 3 || names.some(n => !n.trim())) return false;
    if (blocked() && names.length) return false;
    return mode === 'new' ? names.length > 0 : JSON.stringify(names.map(n => n.trim())) !== JSON.stringify(selected.names);
  }

  function update() {
    const names = draft();
    showEditError(names.length > 3 ? '每片最多三個名稱，請刪除多出的名稱。' : '');
    const ok = !busy && valid(names);
    $('edit-save').disabled = !ok;
    const fits = ok ? PlateLayout.preview(names.map(n => n.trim())) : [];
    $('print-preview').hidden = !fits.length;
    $('print-grid').replaceChildren(...fits.map(c => {
      const span = document.createElement('span');
      span.textContent = c.text;
      span.style.gridColumn = `span ${c.span}`;
      span.style.fontSize = `${c.size}pt`;
      return span;
    }));
    $('size-warning').hidden = !fits.some(c => c.size < 10);
  }

  function openEditor(action, target = '') {
    if (dialog.open || !isEditor()) return;
    selected = action === 'edit' ? data.records.find(r => r.number === target && !r.archived) : null;
    if (action === 'edit' && !selected) return;
    mode = action;
    $('edit-title').textContent = mode === 'new' ? '新增網版' : '編輯網版';
    $('edit-new').hidden = mode !== 'new';
    $('edit-existing').hidden = mode !== 'edit';
    $('edit-delete').hidden = mode !== 'edit';
    $('empty-note').hidden = !blocked();
    $('delete-confirm').hidden = true;
    $('edit-code').value = target;
    showEditError('');
    choices();
    dialog.showModal();
    renderNames(mode === 'new' ? [''] : selected.names.slice(), mode === 'edit' ? 0 : undefined);
    if (mode === 'new') $('edit-series').focus();
  }

  async function persist(action) {
    if (busy) return;
    busy = true;
    $('edit-save').disabled = true;
    $('edit-save').textContent = '儲存中…';
    $('edit-cancel').disabled = true;
    $('delete-apply').disabled = true;
    const target = action === 'new' ? $('edit-number').value : selected.number;
    try {
      const res = await api(action, { number: target, series: $('edit-series').value, before: selected?.names, names: draft().map(n => n.trim()) });
      dialog.close();
      setData(res, target);
      feedback(action === 'delete' ? `${target} 已刪除。` : `${target} 已儲存到雲端。`, action === 'delete' ? target : undefined);
    } catch (problem) {
      showEditError(problem.message);
      if (problem.code === 'conflict') refresh(true);
    } finally {
      busy = false;
      $('edit-save').textContent = '儲存';
      $('edit-cancel').disabled = false;
      $('delete-apply').disabled = false;
      if (dialog.open) update();
    }
  }

  $('open-new').addEventListener('click', () => openEditor('new'));
  $('edit-cancel').addEventListener('click', () => dialog.close());
  $('edit-delete').addEventListener('click', () => { $('delete-confirm').hidden = false; $('delete-keep').focus(); });
  $('delete-keep').addEventListener('click', () => { $('delete-confirm').hidden = true; });
  $('delete-apply').addEventListener('click', () => persist('delete'));
  $('edit-series').addEventListener('change', () => { choices(); update(); });
  $('add-name').addEventListener('click', () => {
    const names = draft();
    if (names.length < 3) renderNames([...names, ''], names.length);
  });
  dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
  $('edit-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!$('edit-save').disabled) persist(mode === 'new' ? 'new' : 'update');
  });

  /* ───── Excel 匯出 ───── */
  $('download').addEventListener('click', async () => {
    const button = $('download');
    button.disabled = true;
    const original = button.innerHTML;
    button.textContent = '產生中…';
    try {
      await refresh(true);
      const records = data.records.filter(r => !r.archived);
      const { blob } = await PlateLayout.exportTotal(records);
      const stamp = new Date().toLocaleDateString('sv-SE');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `網版編號總表_${stamp}.xlsx`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (problem) {
      feedback(problem.message);
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  });

  /* ───── 帳號密碼管理（總管理員） ───── */
  const accountsDialog = $('accounts-dialog');

  function renderAccounts(list) {
    $('accounts-list').replaceChildren(...list.map(acc => {
      const form = document.createElement('form');
      form.className = 'account-row';
      const head = document.createElement('div');
      head.className = 'account-head';
      const title = document.createElement('strong');
      title.textContent = acc.role + (acc.label ? `（${acc.label}）` : '');
      const state = document.createElement('span');
      state.className = acc.set ? 'state on' : 'state';
      state.textContent = acc.set ? '已設定' : '未設定';
      head.append(title, state);
      form.append(head);
      const isManager = acc.account.startsWith('manager');
      let labelInput;
      if (isManager) {
        labelInput = document.createElement('input');
        labelInput.placeholder = '管理員稱呼（例如：小陳，可留空）';
        labelInput.value = acc.label;
        labelInput.maxLength = 20;
        form.append(labelInput);
      }
      const pw = document.createElement('input');
      pw.type = 'password';
      pw.autocomplete = 'new-password';
      pw.placeholder = acc.set ? '輸入新密碼（至少 8 字元）' : '設定密碼（至少 8 字元）';
      pw.required = true;
      pw.minLength = 8;
      const buttons = document.createElement('div');
      buttons.className = 'account-buttons';
      const save = document.createElement('button');
      save.type = 'submit';
      save.textContent = acc.set ? '更改密碼' : (isManager ? '新增此管理員' : '設定密碼');
      buttons.append(save);
      if (isManager && acc.set) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'danger';
        remove.textContent = '移除管理員';
        remove.addEventListener('click', async () => {
          if (!confirm(`確定移除「${acc.role}」？該管理員會立即被登出。`)) return;
          await accountCall('removeManager', { account: acc.account }, remove);
        });
        buttons.append(remove);
      }
      form.append(pw, buttons);
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (acc.account === 'owner' && !confirm('更改總管理員密碼後，所有已登入的總管理員裝置（包含這台）都需重新登入。確定？')) return;
        await accountCall('setPassword', { account: acc.account, password: pw.value, label: labelInput ? labelInput.value : '' }, save);
      });
      return form;
    }));
  }

  async function accountCall(action, payload, button) {
    button.disabled = true;
    $('accounts-error').hidden = true;
    try {
      const res = await api(action, payload);
      renderAccounts(res.accounts);
      $('accounts-error').textContent = '已更新。';
      $('accounts-error').hidden = false;
    } catch (problem) {
      $('accounts-error').textContent = problem.message;
      $('accounts-error').hidden = false;
      button.disabled = false;
    }
  }

  $('open-accounts').addEventListener('click', async () => {
    $('accounts-list').textContent = '讀取中…';
    $('accounts-error').hidden = true;
    $('accounts-backup').textContent = '';
    accountsDialog.showModal();
    try {
      const res = await api('accounts');
      renderAccounts(res.accounts);
      $('accounts-backup').textContent = res.lastBackup ? `最近一次雲端自動備份：${res.lastBackup.replace('_', ' ')}` : '雲端自動備份：每天晚上 10 點執行。';
    } catch (problem) {
      $('accounts-list').textContent = problem.message;
    }
  });
  $('accounts-close').addEventListener('click', () => accountsDialog.close());

  /* ───── 啟動 ───── */
  if (!token) {
    showLogin();
  } else {
    try {
      const cached = JSON.parse(store.get(CACHE_KEY) || 'null');
      if (cached) { applyRole(cached.role, cached.label); setData(cached); }
    } catch (e) { /* 忽略 */ }
    showApp();
    refresh();
  }
})();
