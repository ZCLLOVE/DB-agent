/**
 * API 调试工具 - 前端逻辑
 * 多 Tab 模式 + 三栏布局：侧边栏 | Tab(请求/响应) | AI 面板
 */

// ==================== 状态 ====================
const state = {
    collections: [],
    allRequests: [],
    environments: [],
    globalVars: {},
    // 多 Tab
    tabs: [],
    activeTabId: null,
    tabCounter: 0,
    // AI 对话（全局共享）
    chatHistory: [],
    // 集合折叠状态
    collapsedCollections: new Set(),
};

// ==================== 工具 ====================
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

async function api(method, url, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts);
    if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || JSON.stringify(err));
    }
    return res.json();
}

function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function formatJson(text) {
    try {
        const obj = JSON.parse(text);
        return syntaxHighlight(JSON.stringify(obj, null, 2));
    } catch { return escapeHtml(text); }
}

function syntaxHighlight(json) {
    return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, (match) => {
        let cls = 'json-number';
        if (/^"/.test(match)) cls = /:$/.test(match) ? 'json-key' : 'json-string';
        else if (/true|false/.test(match)) cls = 'json-boolean';
        else if (/null/.test(match)) cls = 'json-null';
        return `<span class="${cls}">${match}</span>`;
    });
}

function formatMarkdown(text) {
    if (!text) return '';
    if (typeof marked !== 'undefined') return marked.parse(text, { breaks: true });
    return escapeHtml(text).replace(/\n/g, '<br>');
}

// ==================== Tab 管理 ====================
function createTab(reqData) {
    const id = ++state.tabCounter;
    const tab = {
        id,
        title: reqData?.name || `请求 ${id}`,
        req: {
            method: reqData?.method || 'GET',
            url: reqData?.url || '',
            headers: reqData?.headers || {},
            params: reqData?.params || {},
            body_type: reqData?.body_type || ((reqData?.method || 'GET') === 'POST' ? 'json' : 'none'),
            body_raw: reqData?.body_raw || '',
            savedId: reqData?.id || null,
        },
        res: { _lastResult: null, _resBody: null, _resHeaders: null },
        activeInnerTab: (reqData?.method || 'GET') === 'POST' ? 'body' : 'params',
        activeResTab: 'body',
    };
    state.tabs.push(tab);
    return tab;
}

function getActiveTab() {
    return state.tabs.find(t => t.id === state.activeTabId);
}

function switchTab(tabId) {
    // 保存当前 Tab 状态
    saveCurrentTabState();
    state.activeTabId = tabId;
    renderTabs();
    applyTabToUI();
}

function closeTab(tabId, event) {
    if (event) event.stopPropagation();
    const idx = state.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;
    state.tabs.splice(idx, 1);
    if (state.tabs.length === 0) {
        // 至少保留一个 Tab
        const t = createTab();
        state.activeTabId = t.id;
    } else if (state.activeTabId === tabId) {
        const newIdx = Math.min(idx, state.tabs.length - 1);
        state.activeTabId = state.tabs[newIdx].id;
    }
    renderTabs();
    applyTabToUI();
}

function newTab() {
    const t = createTab();
    switchTab(t.id);
}

function renderTabs() {
    const list = $('#api-tabs');
    list.innerHTML = '';
    state.tabs.forEach(tab => {
        const m = (tab.req.method || 'get').toLowerCase();
        const div = document.createElement('div');
        div.className = `api-tab-item ${tab.id === state.activeTabId ? 'active' : ''}`;
        div.innerHTML = `
            <span class="tab-method method-${m}">${tab.req.method}</span>
            <span class="tab-title">${escapeHtml(tab.title)}</span>
            <button class="tab-close" title="关闭">&times;</button>
        `;
        div.onclick = () => switchTab(tab.id);
        div.oncontextmenu = (e) => showTabContextMenu(e, tab.id);
        div.querySelector('.tab-close').onclick = (e) => closeTab(tab.id, e);
        list.appendChild(div);
    });
}

// ==================== 页签右键菜单 ====================
function showTabContextMenu(e, tabId) {
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.innerHTML = `
        <div class="context-menu-item" data-action="close-others">关闭其他标签</div>
        <div class="context-menu-item" data-action="close-left">关闭左侧标签</div>
        <div class="context-menu-item" data-action="close-right">关闭右侧标签</div>
    `;
    menu.onclick = (ev) => {
        const item = ev.target.closest('.context-menu-item');
        if (!item) return;
        const action = item.dataset.action;
        menu.remove();
        switch (action) {
            case 'close-others': closeOtherTabs(tabId); break;
            case 'close-left': closeLeftTabs(tabId); break;
            case 'close-right': closeRightTabs(tabId); break;
        }
    };
    document.body.appendChild(menu);
    setTimeout(() => {
        const dismiss = () => { menu.remove(); document.removeEventListener('click', dismiss); };
        document.addEventListener('click', dismiss);
    }, 10);
}

function closeOtherTabs(keepId) {
    state.tabs = state.tabs.filter(t => t.id === keepId);
    state.activeTabId = keepId;
    renderTabs();
    applyTabToUI();
}

function closeLeftTabs(tabId) {
    const idx = state.tabs.findIndex(t => t.id === tabId);
    if (idx <= 0) return;
    const closed = state.tabs.splice(0, idx);
    if (!state.tabs.find(t => t.id === state.activeTabId)) {
        state.activeTabId = tabId;
    }
    renderTabs();
    applyTabToUI();
}

function closeRightTabs(tabId) {
    const idx = state.tabs.findIndex(t => t.id === tabId);
    if (idx === -1 || idx >= state.tabs.length - 1) return;
    const closed = state.tabs.splice(idx + 1);
    if (!state.tabs.find(t => t.id === state.activeTabId)) {
        state.activeTabId = tabId;
    }
    renderTabs();
    applyTabToUI();
}

// 从 DOM 读取当前状态存入 active tab
function saveCurrentTabState() {
    const tab = getActiveTab();
    if (!tab) return;
    collectStateInto(tab.req);
    tab.res._lastResult = tab.req._lastResult;
}

// 把 tab 数据写入 DOM
function applyTabToUI() {
    const tab = getActiveTab();
    if (!tab) return;
    // URL 栏
    $('#req-method').value = tab.req.method;
    $('#req-url').value = tab.req.url;
    // 内部 Tab
    switchInnerTab(tab.activeInnerTab);
    // 保存按钮状态
    updateSaveBtnState();
    // 响应区
    restoreResponse(tab);
}

function restoreResponse(tab) {
    const r = tab.res._lastResult;
    if (!r) {
        $('#res-header').innerHTML = '<span class="text-xs text-muted">发送请求查看响应</span>';
        $('#res-body').innerHTML = '<div class="text-muted text-center py-12 text-xs">在上方输入 URL 并点击发送</div>';
        $('#res-tabs').style.display = 'none';
        $('#res-actions').style.display = 'none';
        return;
    }
    renderResponseToDOM(r);
    state._resBody = tab.res._resBody;
    state._resHeaders = tab.res._resHeaders;
    // 恢复响应 Tab
    switchResTab(tab.activeResTab);
}

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
    loadInitialData();
    bindEvents();
    // 初始创建一个 Tab
    const t = createTab();
    state.activeTabId = t.id;
    renderTabs();
    applyTabToUI();
});

async function loadInitialData() {
    await Promise.all([
        loadCollections(),
        loadHistory(),
        loadEnvironments(),
        loadGlobalVariables(),
        loadProviders(),
    ]);
}

function bindEvents() {
    // Tab 操作
    $('#btn-new-tab').onclick = newTab;

    // 发送请求
    $('#req-send').onclick = sendRequest;
    $('#req-url').onkeydown = (e) => { if (e.key === 'Enter') sendRequest(); };

    // 保存按钮
    $('#btn-save-req').onclick = handleSaveClick;
    $('#btn-save-req-confirm').onclick = confirmSaveRequest;
    $('#btn-save-req-cancel').onclick = () => closeModal('modal-save-req');

    // 内部 Tab
    $$('.api-inner-tabs .api-inner-tab').forEach(t => {
        t.onclick = () => {
            const tab = getActiveTab();
            if (tab) tab.activeInnerTab = t.dataset.tab;
            switchInnerTab(t.dataset.tab);
        };
    });

    // 响应 Tab
    $('#res-tabs').querySelectorAll('.api-inner-tab').forEach(t => {
        t.onclick = () => {
            const tab = getActiveTab();
            if (tab) tab.activeResTab = t.dataset.restab;
            switchResTab(t.dataset.restab);
        };
    });

    // 操作按钮
    $('#btn-copy-curl').onclick = copyCurl;
    $('#btn-ask-ai').onclick = askAiAboutResponse;

    // 集合
    $('#btn-new-collection').onclick = () => {
        const name = prompt('集合名称:');
        if (!name) return;
        api('POST', '/api/http/collections', { name }).then(() => loadCollections());
    };

    // 刷新侧边栏
    $('#btn-refresh-sidebar').onclick = () => {
        loadCollections();
        loadHistory();
    };

    // 历史
    $('#btn-clear-history').onclick = async () => {
        if (!confirm('清空所有历史记录？')) return;
        await api('DELETE', '/api/http/history');
        loadHistory();
    };

    // 搜索
    $('#sidebar-search').oninput = (e) => filterSidebar(e.target.value);

    // 环境
    $('#api-env-select').ondblclick = openEnvModal;
    $('#api-env-select').onchange = async () => {
        const id = parseInt($('#api-env-select').value);
        if (!id) return;
        await api('POST', `/api/http/environments/${id}/activate`);
        loadEnvironments();
    };
    $('#btn-save-env').onclick = saveEnv;
    $('#btn-cancel-env').onclick = resetEnvForm;

    // 全局变量
    $('#btn-global-vars').onclick = openGlobalVarsModal;
    $('#btn-save-global-vars').onclick = saveGlobalVariables;
    $('#btn-cancel-global-vars').onclick = () => closeModal('modal-global-vars');

    // 设置
    $('#btn-settings').onclick = () => { resetProviderForm(); openModal('modal-settings'); };
    $('#btn-save-provider').onclick = saveProvider;
    $('#btn-cancel-provider').onclick = resetProviderForm;

    // AI 面板
    $('#ai-send').onclick = sendAiMessage;
    $('#ai-input').onkeydown = (e) => { if (e.key === 'Enter') sendAiMessage(); };
    $('#btn-ai-clear').onclick = () => { state.chatHistory = []; $('#ai-messages').innerHTML = ''; };

    // 分割线
    initResizers();

    // 关闭弹窗
    $$('.modal-close').forEach(b => b.onclick = () => b.closest('.fixed').classList.add('hidden'));
    $$('.fixed.inset-0').forEach(m => m.onclick = (e) => { if (e.target === m) m.classList.add('hidden'); });
}

function openModal(id) { $(`#${id}`).classList.remove('hidden'); }
function closeModal(id) { $(`#${id}`).classList.add('hidden'); }

// ==================== 集合管理 ====================
async function loadCollections() {
    try {
        const [colls, reqs] = await Promise.all([
            api('GET', '/api/http/collections'),
            api('GET', '/api/http/requests'),
        ]);
        state.collections = colls;
        state.allRequests = reqs;
        // 首次加载：全部收缩。之后只有用户点击才会改变收缩状态。
        if (state.collapsedCollections.size === 0) {
            state.collapsedCollections = new Set(colls.map(c => c.id));
        }
        renderCollectionTree();
    } catch (e) { console.error('加载集合失败:', e); }
}

function renderCollectionTree() {
    const tree = $('#api-collection-tree');
    const search = ($('#sidebar-search')?.value || '').trim().toLowerCase();
    tree.innerHTML = '';

    if (state.collections.length === 0) {
        tree.innerHTML = '<div class="text-muted text-center py-6 text-xs">暂无集合<br>点击上方 + 新建</div>';
        return;
    }

    // 构建树形结构
    const collMap = {};
    state.collections.forEach(c => collMap[c.id] = { ...c, children: [], requests: [] });
    state.allRequests.forEach(r => {
        if (collMap[r.collection_id]) collMap[r.collection_id].requests.push(r);
    });
    const roots = [];
    state.collections.forEach(c => {
        const node = collMap[c.id];
        if (c.parent_id && collMap[c.parent_id]) {
            collMap[c.parent_id].children.push(node);
        } else {
            roots.push(node);
        }
    });

    // 递归渲染
    function renderNode(node, depth, container) {
        const isCollapsed = state.collapsedCollections.has(node.id);
        const indent = depth * 16;

        const collDiv = document.createElement('div');
        collDiv.className = 'api-coll-item';
        collDiv.style.paddingLeft = (8 + indent) + 'px';
        collDiv.onclick = (e) => {
            if (e.target.closest('.coll-actions')) return;
            toggleCollCollapse(node.id);
        };
        collDiv.innerHTML = `
            <span class="coll-toggle">${isCollapsed ? '▸' : '▾'}</span>
            <span class="coll-icon">📁</span>
            <span class="coll-label">${escapeHtml(node.name)}</span>
            <span class="coll-actions">
                <button title="新建子集合" onclick="event.stopPropagation();newSubCollection(${node.id})">📁+</button>
                <button title="新建请求" onclick="event.stopPropagation();newRequestInColl(${node.id})">+</button>
                <button title="删除" onclick="event.stopPropagation();deleteColl(${node.id})">🗑</button>
            </span>
        `;
        container.appendChild(collDiv);

        const childrenDiv = document.createElement('div');
        childrenDiv.className = `coll-children ${isCollapsed ? 'collapsed' : ''}`;

        // 子集合（递归）
        node.children.forEach(child => renderNode(child, depth + 1, childrenDiv));

        // 请求
        node.requests.forEach(req => {
            if (search) {
                const match = (req.name || '').toLowerCase().includes(search)
                    || (req.url || '').toLowerCase().includes(search);
                if (!match) return;
            }
            const m = (req.method || 'get').toLowerCase();
            const item = document.createElement('div');
            item.className = `api-req-item`;
            item.style.paddingLeft = (22 + indent) + 'px';
            item.innerHTML = `
                <span class="req-method method-${m}">${req.method || 'GET'}</span>
                <span class="req-label">${escapeHtml(req.name)}</span>
                <span class="req-actions">
                    <button title="删除" onclick="event.stopPropagation();deleteReq(${req.id})">🗑</button>
                </span>
            `;
            item.onclick = () => openRequestInTab(req);
            childrenDiv.appendChild(item);
        });
        container.appendChild(childrenDiv);
    }

    roots.forEach(node => renderNode(node, 0, tree));
}

function filterSidebar(kw) { renderCollectionTree(); }

function toggleCollCollapse(collId) {
    if (state.collapsedCollections.has(collId)) {
        state.collapsedCollections.delete(collId);
    } else {
        state.collapsedCollections.add(collId);
    }
    renderCollectionTree();
}

async function newSubCollection(parentId) {
    const name = prompt('子集合名称:');
    if (!name) return;
    try {
        await api('POST', '/api/http/collections', { name, parent_id: parentId });
        loadCollections();
    } catch (e) { alert('创建失败: ' + e.message); }
}

function openRequestInTab(req) {
    // 如果已有 tab 打开了该请求，切换过去
    const existing = state.tabs.find(t => t.req.savedId === req.id);
    if (existing) {
        switchTab(existing.id);
        return;
    }
    // 否则新建 tab
    const t = createTab(req);
    switchTab(t.id);
}

async function newRequestInColl(collId) {
    const name = prompt('请求名称:');
    if (!name) return;
    try {
        const req = await api('POST', '/api/http/requests', {
            name, method: 'GET', url: '', collection_id: collId,
        });
        openRequestInTab(req);
        loadCollections();
    } catch (e) { alert('创建失败: ' + e.message); }
}

async function deleteColl(id) {
    if (!confirm('删除此集合及所有子集合和请求？')) return;
    // 收集所有后代集合 ID
    const collMap = {};
    state.collections.forEach(c => collMap[c.id] = c);
    const descIds = [id];
    function collectDesc(pid) {
        state.collections.filter(c => c.parent_id === pid).forEach(c => {
            descIds.push(c.id);
            collectDesc(c.id);
        });
    }
    collectDesc(id);
    // 关闭关联的 tab
    const affected = state.allRequests.filter(r => descIds.includes(r.collection_id)).map(r => r.id);
    const toClose = state.tabs.filter(t => affected.includes(t.req.savedId)).map(t => t.id);
    toClose.forEach(tid => closeTab(tid));
    await api('DELETE', `/api/http/collections/${id}`);
    loadCollections();
}

async function deleteReq(id) {
    if (!confirm('删除此请求？')) return;
    // 关闭关联的 tab
    const tab = state.tabs.find(t => t.req.savedId === id);
    if (tab) closeTab(tab.id);
    await api('DELETE', `/api/http/requests/${id}`);
    loadCollections();
}

// ==================== 保存请求逻辑 ====================
function updateSaveBtnState() {
    const tab = getActiveTab();
    const btn = $('#btn-save-req');
    if (!btn || !tab) return;
    if (tab.req.savedId) {
        btn.textContent = '保存';
        btn.classList.add('saved');
    } else {
        btn.textContent = '另存为';
        btn.classList.remove('saved');
    }
}

function handleSaveClick() {
    const tab = getActiveTab();
    if (!tab) return;
    collectStateInto(tab.req);
    if (tab.req.savedId) {
        doUpdateRequest(tab);
    } else {
        openSaveAsModal(tab);
    }
}

async function doUpdateRequest(tab) {
    try {
        await api('PUT', `/api/http/requests/${tab.req.savedId}`, {
            method: tab.req.method, url: tab.req.url,
            headers: tab.req.headers, params: tab.req.params,
            body_type: tab.req.body_type, body_raw: tab.req.body_raw,
        });
        const btn = $('#btn-save-req');
        btn.textContent = '已保存 ✓';
        setTimeout(() => updateSaveBtnState(), 1200);
        loadCollections();
    } catch (e) { alert('保存失败: ' + e.message); }
}

function openSaveAsModal(tab) {
    const sel = $('#save-req-collection');
    sel.innerHTML = '';
    if (state.collections.length === 0) {
        sel.innerHTML = '<option value="">请先创建集合</option>';
    } else {
        // 构建树形下拉
        const collMap = {};
        state.collections.forEach(c => collMap[c.id] = c);
        const childIds = new Set(state.collections.filter(c => c.parent_id).map(c => c.parent_id));
        const visited = new Set();

        function addOptions(parentId, depth) {
            state.collections.filter(c => c.parent_id === parentId).forEach(c => {
                if (visited.has(c.id)) return;
                visited.add(c.id);
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = '\u00A0\u00A0'.repeat(depth) + (depth > 0 ? '└ ' : '') + c.name;
                sel.appendChild(opt);
                addOptions(c.id, depth + 1);
            });
        }
        addOptions(null, 0);
        // 兜底：未被遍历到的（数据不一致）
        state.collections.forEach(c => {
            if (!visited.has(c.id)) {
                const opt = document.createElement('option');
                opt.value = c.id;
                opt.textContent = c.name;
                sel.appendChild(opt);
            }
        });
    }
    const urlPart = tab.req.url.replace(/^https?:\/\//, '').split('/')[0] || '未命名';
    $('#save-req-name').value = `${tab.req.method} ${urlPart}`;
    $('#save-req-title').textContent = '另存为';
    openModal('modal-save-req');
}

async function confirmSaveRequest() {
    const tab = getActiveTab();
    if (!tab) return;
    const name = $('#save-req-name').value.trim();
    const collId = parseInt($('#save-req-collection').value);
    if (!name) { alert('请填写请求名称'); return; }
    if (!collId) { alert('请先创建集合'); return; }
    try {
        const req = await api('POST', '/api/http/requests', {
            name, method: tab.req.method, url: tab.req.url,
            headers: tab.req.headers, params: tab.req.params,
            body_type: tab.req.body_type, body_raw: tab.req.body_raw,
            collection_id: collId,
        });
        tab.req.savedId = req.id;
        tab.title = name;
        renderTabs();
        updateSaveBtnState();
        closeModal('modal-save-req');
        await loadCollections();
    } catch (e) { alert('保存失败: ' + e.message); }
}

// ==================== 历史记录 ====================
async function loadHistory() {
    try {
        const records = await api('GET', '/api/http/history');
        renderHistory(records);
    } catch (e) { console.error('加载历史失败:', e); }
}

function renderHistory(records) {
    const list = $('#api-history-list');
    list.innerHTML = '';
    if (records.length === 0) {
        list.innerHTML = '<div class="text-muted text-center py-4 text-xs">暂无记录</div>';
        return;
    }
    records.forEach(h => {
        const div = document.createElement('div');
        div.className = 'api-history-item';
        const m = (h.method || 'get').toLowerCase();
        const statusColor = h.status_code >= 200 && h.status_code < 300 ? '#6ee7b7'
            : h.status_code >= 400 ? '#fca5a5' : '#9ca3af';
        div.innerHTML = `
            <span class="h-method method-${m}">${h.method}</span>
            <span class="h-url" title="${escapeHtml(h.url)}">${escapeHtml(h.url)}</span>
            <span class="h-status" style="color:${statusColor}">${h.status_code || '—'}</span>
            <span class="h-time">${h.elapsed_ms || 0}ms</span>
        `;
        div.onclick = () => {
            // 在新 tab 中打开历史请求
            const t = createTab({
                method: h.method || 'GET',
                url: h.url || '',
                headers: h.request_headers || {},
                params: h.request_params || {},
                body_type: h.body_type || 'none',
                body_raw: h.request_body || '',
            });
            t.title = `${h.method} ${h.url.split('?')[0].split('/').slice(-2).join('/')}`;
            switchTab(t.id);
        };
        list.appendChild(div);
    });
}

// ==================== 请求构建 ====================
function switchInnerTab(tabName) {
    const tab = getActiveTab();
    if (tab) tab.activeInnerTab = tabName;
    $$('.api-inner-tabs .api-inner-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.tab === tabName);
    });
    const content = $('#req-content');
    content.innerHTML = '';

    const req = tab ? tab.req : state.tabs[0]?.req;
    if (!req) return;

    if (tabName === 'params') renderKvEditor(content, req.params);
    else if (tabName === 'headers') renderKvEditor(content, req.headers);
    else if (tabName === 'body') { renderRequestBody(req); return; }
    else if (tabName === 'auth') renderAuthEditor(content, req);
}

function renderKvEditor(container, data) {
    const entries = Object.keys(data || {}).length > 0
        ? Object.entries(data).map(([k, v]) => ({ key: k, value: v }))
        : [{ key: '', value: '' }];

    entries.forEach(entry => {
        const row = document.createElement('div');
        row.className = 'api-kv-row';
        row.innerHTML = `
            <input class="kv-key" value="${escapeHtml(entry.key)}" placeholder="Key">
            <input class="kv-value" value="${escapeHtml(String(entry.value))}" placeholder="Value">
            <button class="api-kv-remove">&times;</button>
        `;
        row.querySelector('.api-kv-remove').onclick = () => row.remove();
        container.appendChild(row);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'api-kv-add';
    addBtn.textContent = '+ Add';
    addBtn.onclick = () => {
        const row = document.createElement('div');
        row.className = 'api-kv-row';
        row.innerHTML = `<input class="kv-key" placeholder="Key"><input class="kv-value" placeholder="Value"><button class="api-kv-remove">&times;</button>`;
        row.querySelector('.api-kv-remove').onclick = () => row.remove();
        container.insertBefore(row, addBtn);
    };
    container.appendChild(addBtn);
}

function renderRequestBody(req) {
    const content = $('#req-content');
    content.innerHTML = '';

    const typeRow = document.createElement('div');
    typeRow.className = 'api-body-type-row';
    ['none', 'json', 'form', 'raw', 'xml'].forEach(t => {
        const label = document.createElement('label');
        label.innerHTML = `<input type="radio" name="body-type" value="${t}" ${req.body_type === t ? 'checked' : ''}> ${t === 'none' ? 'none' : t.toUpperCase()}`;
        typeRow.appendChild(label);
    });
    content.appendChild(typeRow);

    const toolbar = document.createElement('div');
    toolbar.className = 'api-body-toolbar';
    toolbar.style.display = 'none';
    toolbar.innerHTML = `<button id="btn-format-json">格式化 JSON</button><button id="btn-compress-json">压缩 JSON</button>`;
    content.appendChild(toolbar);

    const textarea = document.createElement('textarea');
    textarea.className = 'api-body-textarea';
    textarea.id = 'req-body-raw';
    textarea.value = req.body_raw || '';
    textarea.placeholder = req.body_type === 'json' ? '{\n  "key": "value"\n}' : '请求体内容...';
    content.appendChild(textarea);

    function updateVis() {
        const selected = content.querySelector('input[name="body-type"]:checked')?.value || 'none';
        const isJson = selected === 'json';
        textarea.style.display = selected === 'none' ? 'none' : '';
        toolbar.style.display = isJson ? 'flex' : 'none';
        textarea.placeholder = isJson ? '{\n  "key": "value"\n}'
            : selected === 'xml' ? '<?xml version="1.0"?>\n<root>\n</root>' : '请求体内容...';
    }
    typeRow.querySelectorAll('input').forEach(r => r.onchange = updateVis);
    updateVis();

    toolbar.querySelector('#btn-format-json').onclick = () => {
        try { const v = textarea.value.trim(); if (v) textarea.value = JSON.stringify(JSON.parse(v), null, 2); } catch {}
    };
    toolbar.querySelector('#btn-compress-json').onclick = () => {
        try { const v = textarea.value.trim(); if (v) textarea.value = JSON.stringify(JSON.parse(v)); } catch {}
    };
    textarea.addEventListener('paste', () => {
        setTimeout(() => {
            if (content.querySelector('input[name="body-type"]:checked')?.value !== 'json') return;
            try { textarea.value = JSON.stringify(JSON.parse(textarea.value), null, 2); } catch {}
        }, 50);
    });
    textarea.addEventListener('blur', () => {
        if (content.querySelector('input[name="body-type"]:checked')?.value !== 'json') return;
        try { const v = textarea.value.trim(); if (v) textarea.value = JSON.stringify(JSON.parse(v), null, 2); } catch {}
    });
}

function renderAuthEditor(container, req) {
    container.innerHTML = `<div class="api-auth-section"><label>Authorization Header</label><input id="auth-header" placeholder="Bearer token 或 Basic base64..." value="${escapeHtml((req.headers || {})['Authorization'] || '')}"></div>`;
}

function collectStateInto(req) {
    req.method = $('#req-method').value;
    req.url = $('#req-url').value;
    const content = $('#req-content');
    const tab = getActiveTab();
    const innerTab = tab ? tab.activeInnerTab : 'params';

    if (innerTab === 'params' || innerTab === 'headers') {
        const obj = {};
        content.querySelectorAll('.api-kv-row').forEach(row => {
            const key = row.querySelector('.kv-key')?.value?.trim();
            const val = row.querySelector('.kv-value')?.value;
            if (key) obj[key] = val || '';
        });
        if (innerTab === 'params') req.params = obj;
        else req.headers = obj;
    }
    const bodyTypeRadio = content.querySelector('input[name="body-type"]:checked');
    if (bodyTypeRadio) req.body_type = bodyTypeRadio.value;
    const bodyRaw = $('#req-body-raw');
    if (bodyRaw) req.body_raw = bodyRaw.value;
    const authInput = $('#auth-header');
    if (authInput) {
        const val = authInput.value.trim();
        if (val) req.headers['Authorization'] = val;
        else delete req.headers['Authorization'];
    }
}

// ==================== 发送请求 ====================
async function sendRequest() {
    const tab = getActiveTab();
    if (!tab) return;
    collectStateInto(tab.req);
    if (!tab.req.url) { alert('请输入请求 URL'); return; }

    const sendBtn = $('#req-send');
    sendBtn.disabled = true;
    sendBtn.textContent = '发送中...';
    $('#res-body').innerHTML = '<div class="text-muted text-center py-12 text-xs">请求中...</div>';

    try {
        const result = await api('POST', '/api/http/send', {
            method: tab.req.method, url: tab.req.url,
            headers: tab.req.headers, params: tab.req.params,
            body_type: tab.req.body_type, body_raw: tab.req.body_raw,
        });
        tab.req._lastResult = result;
        tab.res._lastResult = result;
        tab.res._resBody = result.body || '';
        tab.res._resHeaders = result.headers || {};
        renderResponseToDOM(result);
        loadHistory();
    } catch (e) {
        $('#res-header').innerHTML = `<span class="status-badge status-err">错误</span><span class="text-xs text-muted">${escapeHtml(e.message)}</span>`;
        $('#res-body').innerHTML = `<div class="text-red-400 p-4 text-sm">${escapeHtml(e.message)}</div>`;
    } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = '发送';
    }
}

function renderResponseToDOM(result) {
    if (!result.success) {
        $('#res-header').innerHTML = `<span class="status-badge status-err">失败</span><span class="text-xs text-muted">${escapeHtml(result.error || '未知错误')}</span>`;
        $('#res-body').innerHTML = `<div class="text-red-400 p-4 text-sm">${escapeHtml(result.error)}</div>`;
        return;
    }
    const status = result.status_code;
    let cls = 'status-2xx';
    if (status >= 300 && status < 400) cls = 'status-3xx';
    else if (status >= 400 && status < 500) cls = 'status-4xx';
    else if (status >= 500) cls = 'status-5xx';
    const size = result.size_bytes;
    const sizeStr = size > 1024 ? (size / 1024).toFixed(1) + 'KB' : size + 'B';
    $('#res-header').innerHTML = `<span class="status-badge ${cls}">${status}</span><span class="text-xs text-muted">耗时: ${result.elapsed_ms}ms</span><span class="text-xs text-muted">大小: ${sizeStr}</span>`;
    const body = result.body || '';
    const bodyHtml = body.trim().startsWith('{') || body.trim().startsWith('[')
        ? `<pre>${formatJson(body)}</pre>` : `<pre>${escapeHtml(body)}</pre>`;
    $('#res-body').innerHTML = bodyHtml;
    state._resBody = body;
    state._resHeaders = result.headers || {};
    $('#res-tabs').style.display = 'flex';
    $('#res-actions').style.display = 'flex';
}

function switchResTab(tabName) {
    const tab = getActiveTab();
    if (tab) tab.activeResTab = tabName;
    $('#res-tabs').querySelectorAll('.api-inner-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.restab === tabName);
    });
    if (tabName === 'body') {
        const body = state._resBody || '';
        const html = body.trim().startsWith('{') || body.trim().startsWith('[')
            ? `<pre>${formatJson(body)}</pre>` : `<pre>${escapeHtml(body)}</pre>`;
        $('#res-body').innerHTML = html;
    } else if (tabName === 'headers') {
        const headers = state._resHeaders || {};
        let html = '<table><thead><tr><th>Key</th><th>Value</th></tr></thead><tbody>';
        Object.entries(headers).forEach(([k, v]) => { html += `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(v)}</td></tr>`; });
        html += '</tbody></table>';
        $('#res-body').innerHTML = html;
    }
}

// ==================== 操作按钮 ====================
async function copyCurl() {
    const tab = getActiveTab();
    if (!tab) return;
    collectStateInto(tab.req);
    try {
        const result = await api('POST', '/api/http/generate-curl', {
            method: tab.req.method, url: tab.req.url,
            headers: tab.req.headers, params: tab.req.params,
            body_type: tab.req.body_type, body_raw: tab.req.body_raw,
        });
        await navigator.clipboard.writeText(result.curl);
        const btn = $('#btn-copy-curl');
        btn.textContent = '已复制 ✓';
        setTimeout(() => { btn.textContent = '复制 cURL'; }, 1200);
    } catch (e) { alert('生成失败: ' + e.message); }
}

function askAiAboutResponse() {
    const tab = getActiveTab();
    if (!tab) return;
    const r = tab.res._lastResult;
    let msg = `分析这个接口请求和响应：\n${tab.req.method} ${tab.req.url}\n`;
    if (tab.req.body_raw) msg += `请求体: ${tab.req.body_raw}\n`;
    if (r) msg += `状态码: ${r.status_code}\n响应体: ${(r.body || '').substring(0, 2000)}`;
    $('#ai-input').value = msg;
    sendAiMessage();
}

// ==================== 环境管理 ====================
async function loadEnvironments() {
    try {
        const envs = await api('GET', '/api/http/environments');
        state.environments = envs;
        renderEnvSelect(envs);
    } catch (e) { console.error('加载环境失败:', e); }
}

function renderEnvSelect(envs) {
    const sel = $('#api-env-select');
    sel.innerHTML = '<option value="">无环境</option>';
    envs.forEach(env => {
        const opt = document.createElement('option');
        opt.value = env.id;
        opt.textContent = env.name + (env.is_active ? ' ✓' : '');
        opt.selected = env.is_active;
        sel.appendChild(opt);
    });
}

function openEnvModal() {
    api('GET', '/api/http/environments').then(envs => {
        const list = $('#env-list');
        list.innerHTML = '';
        if (envs.length === 0) list.innerHTML = '<div class="text-muted text-xs text-center py-2">暂无环境</div>';
        envs.forEach(env => {
            const div = document.createElement('div');
            div.className = 'flex items-center justify-between bg-bg rounded px-3 py-2 border border-border';
            div.innerHTML = `<div><div class="text-sm font-medium ${env.is_active ? 'text-primary' : ''}">${escapeHtml(env.name)} ${env.is_active ? '<span class="text-[10px] bg-primary/20 text-primary px-1.5 rounded">激活</span>' : ''}</div><div class="text-xs text-muted mt-0.5 truncate max-w-[300px]">${escapeHtml(env.base_url || '未配置 Base URL')}</div></div><div class="flex gap-1">${!env.is_active ? `<button onclick="activateEnv(${env.id})" class="text-xs px-2 py-1 rounded border border-border hover:border-accent-light text-muted">使用</button>` : ''}<button onclick="editEnv(${env.id})" class="text-xs px-2 py-1 rounded border border-border hover:border-muted text-muted">编辑</button><button onclick="deleteEnv(${env.id})" class="text-xs px-2 py-1 rounded border border-border hover:border-red-500 hover:text-red-400 text-muted">删除</button></div>`;
            list.appendChild(div);
        });
        resetEnvForm();
        openModal('modal-env');
    });
}

async function saveEnv() {
    const editId = $('#env-edit-id').value;
    const name = $('#env-name').value.trim();
    const base_url = $('#env-base-url').value.trim();
    if (!name) { alert('请填写环境名称'); return; }
    try {
        if (editId) await api('PUT', `/api/http/environments/${editId}`, { name, base_url });
        else await api('POST', '/api/http/environments', { name, base_url });
        resetEnvForm(); await loadEnvironments(); openEnvModal();
    } catch (e) { alert('保存失败: ' + e.message); }
}

async function editEnv(id) {
    const envs = await api('GET', '/api/http/environments');
    const env = envs.find(e => e.id === id);
    if (!env) return;
    $('#env-edit-id').value = env.id;
    $('#env-name').value = env.name;
    $('#env-base-url').value = env.base_url || '';
    $('#env-form-title').textContent = '编辑环境'; $('#btn-cancel-env').classList.remove('hidden');
}

async function activateEnv(id) { await api('POST', `/api/http/environments/${id}/activate`); await loadEnvironments(); openEnvModal(); }
async function deleteEnv(id) { if (!confirm('删除此环境？')) return; await api('DELETE', `/api/http/environments/${id}`); await loadEnvironments(); openEnvModal(); }
function resetEnvForm() {
    $('#env-edit-id').value = ''; $('#env-name').value = ''; $('#env-base-url').value = '';
    $('#env-form-title').textContent = '新建环境'; $('#btn-cancel-env').classList.add('hidden');
}

// ==================== 全局变量管理 ====================
async function loadGlobalVariables() {
    try {
        const vars = await api('GET', '/api/http/global-variables');
        state.globalVars = vars;
    } catch (e) { console.error('加载全局变量失败:', e); }
}

function openGlobalVarsModal() {
    renderGlobalVarsEditor($('#global-vars-container'), state.globalVars);
    openModal('modal-global-vars');
}

function renderGlobalVarsEditor(container, data) {
    container.innerHTML = '';
    const entries = Object.keys(data || {}).length > 0
        ? Object.entries(data).map(([k, v]) => ({ key: k, value: v }))
        : [];
    entries.forEach(entry => {
        const row = document.createElement('div');
        row.className = 'api-kv-row';
        row.innerHTML = `
            <input class="kv-key" value="${escapeHtml(entry.key)}" placeholder="Key">
            <input class="kv-value" value="${escapeHtml(String(entry.value))}" placeholder="Value">
            <button class="api-kv-remove">&times;</button>
        `;
        _bindValueTrim(row.querySelector('.kv-value'));
        row.querySelector('.api-kv-remove').onclick = () => row.remove();
        container.appendChild(row);
    });
    const addBtn = document.createElement('button');
    addBtn.className = 'api-kv-add';
    addBtn.textContent = '+ Add';
    addBtn.onclick = () => {
        const row = document.createElement('div');
        row.className = 'api-kv-row';
        row.innerHTML = `<input class="kv-key" placeholder="Key"><input class="kv-value" placeholder="Value"><button class="api-kv-remove">&times;</button>`;
        _bindValueTrim(row.querySelector('.kv-value'));
        row.querySelector('.api-kv-remove').onclick = () => row.remove();
        container.insertBefore(row, addBtn);
    };
    container.appendChild(addBtn);
}

function _bindValueTrim(input) {
    if (!input) return;
    input.addEventListener('paste', () => setTimeout(() => { input.value = input.value.trim(); }, 0));
    input.addEventListener('blur', () => { input.value = input.value.trim(); });
}

async function saveGlobalVariables() {
    const variables = {};
    const container = $('#global-vars-container');
    container.querySelectorAll('.api-kv-row').forEach(row => {
        const key = row.querySelector('.kv-key')?.value?.trim();
        const val = row.querySelector('.kv-value')?.value?.trim() ?? '';
        if (key) variables[key] = val;
    });
    try {
        await api('PUT', '/api/http/global-variables', { variables });
        state.globalVars = variables;
        closeModal('modal-global-vars');
    } catch (e) { alert('保存失败: ' + e.message); }
}

// ==================== AI 提供商管理 ====================
async function loadProviders() {
    try {
        const providers = await api('GET', '/api/ai/providers');
        renderProviderList(providers); renderProviderSelector(providers);
    } catch (e) { console.error('加载AI提供商失败:', e); }
}

function renderProviderSelector(providers) {
    const sel = $('#ai-provider-select');
    sel.innerHTML = '';
    if (providers.length === 0) { sel.innerHTML = '<option value="">未配置 AI</option>'; return; }
    providers.forEach(p => { const opt = document.createElement('option'); opt.value = p.id; opt.textContent = `${p.name} / ${p.model}`; opt.selected = p.is_active; sel.appendChild(opt); });
    sel.onchange = async () => { const id = parseInt(sel.value); if (!id) return; await api('POST', `/api/ai/providers/${id}/activate`); loadProviders(); };
}

function renderProviderList(providers) {
    const container = $('#provider-list'); container.innerHTML = '';
    if (providers.length === 0) { container.innerHTML = '<div class="text-muted text-xs text-center py-4">暂无 AI 提供商</div>'; return; }
    providers.forEach(p => {
        const div = document.createElement('div');
        div.className = `flex items-center gap-2 p-2 rounded border ${p.is_active ? 'border-primary bg-primary/5' : 'border-border bg-bg'}`;
        div.innerHTML = `<div class="flex-1 min-w-0"><div class="flex items-center gap-2"><span class="text-sm font-medium ${p.is_active ? 'text-primary' : 'text-gray-300'}">${escapeHtml(p.name)}</span>${p.is_active ? '<span class="text-[10px] bg-primary/20 text-primary px-1.5 rounded">使用中</span>' : ''}</div><div class="text-xs text-muted mt-0.5 truncate">${escapeHtml(p.model)} · ${escapeHtml(p.api_key)}</div></div><div class="flex gap-1 shrink-0">${!p.is_active ? `<button onclick="activateProvider(${p.id})" class="text-xs px-2 py-1 rounded border border-border hover:border-accent-light text-muted">使用</button>` : ''}<button onclick="editProvider(${p.id})" class="text-xs px-2 py-1 rounded border border-border hover:border-muted text-muted">编辑</button><button onclick="deleteProvider(${p.id})" class="text-xs px-2 py-1 rounded border border-border hover:border-red-500 hover:text-red-400 text-muted">删除</button></div>`;
        container.appendChild(div);
    });
}

async function activateProvider(id) { await api('POST', `/api/ai/providers/${id}/activate`); loadProviders(); }
function editProvider(id) {
    api('GET', '/api/ai/providers').then(providers => {
        const p = providers.find(x => x.id === id); if (!p) return;
        $('#provider-edit-id').value = p.id; $('#provider-name').value = p.name; $('#provider-base-url').value = p.base_url;
        $('#provider-api-key').value = ''; $('#provider-api-key').placeholder = p.api_key || '不修改请留空';
        $('#provider-model').value = p.model; $('#provider-temperature').value = p.temperature;
        $('#provider-form-title').textContent = '编辑 AI 提供商'; $('#btn-cancel-provider').classList.remove('hidden');
    });
}
async function deleteProvider(id) { if (!confirm('确认删除？')) return; await api('DELETE', `/api/ai/providers/${id}`); resetProviderForm(); loadProviders(); }
function resetProviderForm() { $('#provider-edit-id').value = ''; $('#provider-name').value = ''; $('#provider-base-url').value = ''; $('#provider-api-key').value = ''; $('#provider-api-key').placeholder = 'sk-...'; $('#provider-model').value = ''; $('#provider-temperature').value = '0'; $('#provider-form-title').textContent = '添加 AI 提供商'; $('#btn-cancel-provider').classList.add('hidden'); }
async function saveProvider() {
    const editId = $('#provider-edit-id').value;
    const data = { name: $('#provider-name').value.trim(), base_url: $('#provider-base-url').value.trim(), model: $('#provider-model').value.trim(), temperature: parseFloat($('#provider-temperature').value) || 0 };
    const apiKey = $('#provider-api-key').value.trim(); if (apiKey) data.api_key = apiKey;
    if (!data.name || !data.base_url || !data.model) { alert('请填写名称、URL 和模型'); return; }
    try {
        if (editId) await api('PUT', `/api/ai/providers/${editId}`, data);
        else { if (!apiKey) { alert('新建需要 API Key'); return; } data.api_key = apiKey; await api('POST', '/api/ai/providers', data); }
        resetProviderForm(); loadProviders();
    } catch (e) { alert('保存失败: ' + e.message); }
}

// ==================== AI 对话 ====================
async function sendAiMessage() {
    const input = $('#ai-input');
    const message = input.value.trim();
    if (!message) return;
    input.value = '';
    const msgs = $('#ai-messages');
    appendAiBubble(msgs, 'user', message);
    state.chatHistory.push({ role: 'user', content: message });
    const aiBubble = document.createElement('div');
    aiBubble.className = 'ai-msg assistant typing-indicator';
    msgs.appendChild(aiBubble);
    msgs.scrollTop = msgs.scrollHeight;

    let fullContent = '';
    try {
        const res = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, connection_id: null, chat_history: state.chatHistory.slice(0, -1) }),
        });
        if (!res.ok) { const err = await res.json().catch(() => ({ detail: res.statusText })); throw new Error(err.detail || '请求失败'); }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                try {
                    const data = JSON.parse(line.slice(6));
                    if (data.type === 'token') {
                        fullContent += data.content;
                        aiBubble.innerHTML = formatMarkdown(fullContent);
                        msgs.scrollTop = msgs.scrollHeight;
                    } else if (data.type === 'tool_start') {
                        if (data.tool === 'http_request') {
                            try {
                                const inp = typeof data.input === 'string' ? JSON.parse(data.input) : data.input;
                                const m = (inp.method || 'GET').toLowerCase();
                                const card = document.createElement('div'); card.className = 'http-request-card';
                                card.innerHTML = `<div class="card-header"><span class="card-method method-${m}">${inp.method}</span><span class="card-url">${escapeHtml(inp.url || '')}</span><span class="text-xs text-muted">⏳</span></div>`;
                                aiBubble.appendChild(card);
                            } catch { const tc = document.createElement('div'); tc.className = 'tool-call'; tc.textContent = `🚀 调用接口: ${data.input}`; aiBubble.appendChild(tc); }
                        } else {
                            const tc = document.createElement('div'); tc.className = 'tool-call'; tc.textContent = `🔧 ${data.tool}`; aiBubble.appendChild(tc);
                        }
                        msgs.scrollTop = msgs.scrollHeight;
                    } else if (data.type === 'tool_end') {
                        if (data.tool === 'http_request') {
                            const cards = aiBubble.querySelectorAll('.http-request-card');
                            const last = cards[cards.length - 1];
                            if (last) {
                                const sm = (data.output || '').match(/状态码:\s*(\d+)/);
                                if (sm) { const s = parseInt(sm[1]); const color = s < 300 ? '#6ee7b7' : s < 500 ? '#fcd34d' : '#fca5a5'; const emoji = s < 300 ? '✅' : s < 500 ? '⚠️' : '❌'; const statusSpan = last.querySelector('.text-muted:last-child'); if (statusSpan) { statusSpan.textContent = `${emoji} ${s}`; statusSpan.style.color = color; } }
                            }
                        }
                        // AI 操作了集合 → 刷新侧边栏
                        if (['save_api_request', 'update_api_request', 'delete_api_request', 'delete_api_collection', 'list_api_collections', 'get_api_request'].includes(data.tool)) {
                            loadCollections();
                        }
                        // AI 发了 HTTP 请求 → 刷新历史
                        if (data.tool === 'http_request') {
                            loadHistory();
                        }
                        // AI 操作了环境变量 → 刷新环境列表
                        if (['create_api_environment', 'update_api_environment', 'delete_api_environment'].includes(data.tool)) {
                            loadEnvironments();
                        }
                    } else if (data.type === 'done') { break; }
                } catch {}
            }
        }
        aiBubble.classList.remove('typing-indicator');
        if (!fullContent) aiBubble.textContent = '（无回复）';
        else aiBubble.innerHTML = formatMarkdown(fullContent);
        state.chatHistory.push({ role: 'assistant', content: fullContent });
    } catch (e) {
        aiBubble.classList.remove('typing-indicator');
        aiBubble.textContent = '错误: ' + e.message;
        aiBubble.style.color = '#f87171';
    }
    msgs.scrollTop = msgs.scrollHeight;
}

function appendAiBubble(container, role, content) {
    const div = document.createElement('div');
    div.className = `ai-msg ${role}`;
    div.innerHTML = role === 'user' ? escapeHtml(content) : formatMarkdown(content);
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

// ==================== 分割线拖拽 ====================
function initResizers() {
    initResizer('sidebar-resizer', 'api-sidebar', 'width', 180, 400);
    initResizer('ai-panel-resizer', 'ai-panel', 'width', 240, 600, true);
    initVerticalResizer();
}

function initResizer(resizerId, targetId, prop, min, max, reverse) {
    const resizer = $(`#${resizerId}`);
    const target = $(`#${targetId}`);
    if (!resizer || !target) return;
    let startX, startW;
    resizer.addEventListener('mousedown', (e) => {
        startX = e.clientX; startW = target.offsetWidth;
        document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'; e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (startX === undefined) return;
        const delta = reverse ? (startX - e.clientX) : (e.clientX - startX);
        target.style.width = Math.min(max, Math.max(min, startW + delta)) + 'px';
    });
    document.addEventListener('mouseup', () => { startX = undefined; document.body.style.cursor = ''; document.body.style.userSelect = ''; });
}

function initVerticalResizer() {
    const resizer = $('#req-res-resizer');
    const reqPanel = $('#request-panel');
    const container = $('#tab-content-area');
    if (!resizer || !reqPanel || !container) return;
    let startY, startRatio;
    resizer.addEventListener('mousedown', (e) => {
        startY = e.clientY;
        startRatio = reqPanel.offsetHeight / container.offsetHeight;
        document.body.style.cursor = 'row-resize'; document.body.style.userSelect = 'none'; e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
        if (startY === undefined) return;
        const delta = e.clientY - startY;
        const containerH = container.offsetHeight;
        const newH = startRatio * containerH + delta;
        const ratio = Math.max(0.15, Math.min(0.75, newH / containerH));
        reqPanel.style.height = (ratio * 100) + '%';
        reqPanel.style.flex = 'none';
    });
    document.addEventListener('mouseup', () => { startY = undefined; document.body.style.cursor = ''; document.body.style.userSelect = ''; });
}
