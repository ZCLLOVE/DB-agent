/**
 * DB-Agent 前端逻辑
 * 所有交互逻辑：连接管理、表浏览器、SQL编辑器、AI对话
 */

// ==================== 全局状态 ====================
const state = {
    currentConnId: null,
    connections: [],
    tabs: [],        // { id, type: 'sql'|'ai', title, editor?, chatHistory? }
    activeTabId: null,
    tableData: {},   // 缓存表结构数据
    tabCounter: 0,
};

// ==================== 工具函数 ====================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

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

function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', () => {
    loadConnections();
    loadAiConfig();
    bindEvents();
});

function bindEvents() {
    // 连接管理
    $('#btn-conn-manage').onclick = () => openModal('modal-conn');
    $('#btn-save-conn').onclick = saveConnection;
    $('#btn-test-conn').onclick = testConnection;
    $('#conn-db-type').onchange = onDbTypeChange;
    $('#conn-select').onchange = onConnectionSelect;
    $('#btn-refresh-tree').onclick = () => {
        if (state.currentConnId) loadTableTree();
    };

    // Tab 操作
    $('#btn-new-sql').onclick = () => createSqlTab();
    $('#btn-open-ai').onclick = () => createAiTab();

    // 设置
    $('#btn-settings').onclick = () => openModal('modal-settings');
    $('#btn-save-settings').onclick = saveAiConfig;

    // SQL 确认弹窗
    $('#btn-confirm-cancel').onclick = () => closeModal('modal-confirm');
    $('#btn-confirm-ok').onclick = confirmExecuteSql;

    // 侧边栏收起
    $('#btn-sidebar-toggle').onclick = () => {
        const sb = $('#sidebar');
        sb.classList.toggle('collapsed');
        const btn = $('#btn-sidebar-toggle');
        btn.textContent = sb.classList.contains('collapsed') ? '>' : '<';
    };

    // 关闭弹窗
    $$('.modal-close').forEach(btn => {
        btn.onclick = () => btn.closest('.fixed').classList.add('hidden');
    });

    // 点击遮罩关闭
    $$('.fixed.inset-0').forEach(modal => {
        modal.onclick = (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        };
    });

    // 数据库类型切换时更新默认端口
}

function openModal(id) {
    $(`#${id}`).classList.remove('hidden');
}
function closeModal(id) {
    $(`#${id}`).classList.add('hidden');
}

// ==================== 连接管理 ====================
async function loadConnections() {
    try {
        state.connections = await api('GET', '/api/connections');
        renderConnSelect();
        renderConnList();
    } catch (e) {
        console.error('加载连接列表失败:', e);
    }
}

function renderConnSelect() {
    const sel = $('#conn-select');
    const current = sel.value;
    sel.innerHTML = '<option value="">选择数据库连接...</option>';
    state.connections.forEach(c => {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = `${c.name} (${c.db_type})`;
        sel.appendChild(opt);
    });
    if (current) sel.value = current;
}

function renderConnList() {
    const list = $('#conn-list');
    list.innerHTML = '';
    if (state.connections.length === 0) {
        list.innerHTML = '<div class="text-xs text-muted text-center py-2">暂无保存的连接</div>';
        return;
    }
    state.connections.forEach(c => {
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between bg-bg rounded px-3 py-2 border border-border';
        div.innerHTML = `
            <div>
                <div class="text-sm font-medium">${escapeHtml(c.name)}</div>
                <div class="text-xs text-muted">${c.db_type}://${c.host || ''}${c.port ? ':'+c.port : ''}/${c.database}</div>
            </div>
            <div class="flex gap-1">
                <button class="text-xs text-muted hover:text-gray-300 px-1" onclick="editConnection(${c.id})">编辑</button>
                <button class="text-xs text-red-400 hover:text-red-300 px-1" onclick="deleteConnection(${c.id})">删除</button>
            </div>
        `;
        list.appendChild(div);
    });
}

async function saveConnection() {
    const id = $('#conn-edit-id').value;
    const data = {
        name: $('#conn-name').value,
        db_type: $('#conn-db-type').value,
        host: $('#conn-host').value,
        port: parseInt($('#conn-port').value),
        username: $('#conn-username').value,
        password: $('#conn-password').value,
        database: $('#conn-database').value,
    };
    if (!data.name || !data.database) {
        alert('请填写连接名称和数据库名');
        return;
    }
    try {
        if (id) {
            await api('PUT', `/api/connections/${id}`, data);
        } else {
            await api('POST', '/api/connections', data);
        }
        await loadConnections();
        resetConnForm();
    } catch (e) {
        alert('保存失败: ' + e.message);
    }
}

async function testConnection() {
    const id = $('#conn-edit-id').value;
    const resultEl = $('#conn-test-result');
    resultEl.classList.remove('hidden');

    // 如果已有保存的连接，直接测试
    if (id) {
        try {
            const res = await api('POST', `/api/connections/${id}/test`);
            resultEl.textContent = res.message;
            resultEl.className = `mt-2 text-xs ${res.success ? 'text-green-400' : 'text-red-400'}`;
        } catch (e) {
            resultEl.textContent = '测试失败: ' + e.message;
            resultEl.className = 'mt-2 text-xs text-red-400';
        }
        return;
    }

    // 先保存再测试
    resultEl.textContent = '请先保存连接后再测试';
    resultEl.className = 'mt-2 text-xs text-yellow-400';
}

function editConnection(id) {
    const conn = state.connections.find(c => c.id === id);
    if (!conn) return;
    $('#conn-edit-id').value = conn.id;
    $('#conn-name').value = conn.name;
    $('#conn-db-type').value = conn.db_type;
    $('#conn-host').value = conn.host || '';
    $('#conn-port').value = conn.port || 3306;
    $('#conn-username').value = conn.username || '';
    $('#conn-password').value = conn.password || '';
    $('#conn-database').value = conn.database;
    $('#conn-form-title').textContent = '编辑连接';
}

async function deleteConnection(id) {
    if (!confirm('确定删除该连接？')) return;
    try {
        await api('DELETE', `/api/connections/${id}`);
        await loadConnections();
    } catch (e) {
        alert('删除失败: ' + e.message);
    }
}

function resetConnForm() {
    $('#conn-edit-id').value = '';
    $('#conn-name').value = '';
    $('#conn-db-type').value = 'mysql';
    $('#conn-host').value = 'localhost';
    $('#conn-port').value = '3306';
    $('#conn-username').value = '';
    $('#conn-password').value = '';
    $('#conn-database').value = '';
    $('#conn-form-title').textContent = '新建连接';
    $('#conn-test-result').classList.add('hidden');
}

function onDbTypeChange() {
    const type = $('#conn-db-type').value;
    const portMap = { mysql: 3306, postgresql: 5432, sqlite: 0 };
    $('#conn-port').value = portMap[type] || 3306;

    // SQLite 不需要 host/port/username/password
    const isSqlite = type === 'sqlite';
    $('#conn-host').closest('div').style.display = isSqlite ? 'none' : '';
    $('#conn-port').closest('div').style.display = isSqlite ? 'none' : '';
    $('#conn-username').closest('div').style.display = isSqlite ? 'none' : '';
    $('#conn-password').closest('div').style.display = isSqlite ? 'none' : '';
    if (isSqlite) {
        $('#conn-database').placeholder = 'SQLite 文件路径（如: ./test.db）';
    } else {
        $('#conn-database').placeholder = '';
    }
}

async function onConnectionSelect() {
    const connId = parseInt($('#conn-select').value);
    state.currentConnId = connId || null;
    if (connId) {
        await loadTableTree();
    } else {
        $('#table-tree').innerHTML = '<div class="text-muted text-center py-8 text-xs">请先选择数据库连接</div>';
    }
}

// ==================== 表浏览器 ====================
async function loadTableTree() {
    if (!state.currentConnId) return;
    const tree = $('#table-tree');
    tree.innerHTML = '<div class="text-muted text-center py-4 text-xs">加载中...</div>';

    try {
        const data = await api('GET', `/api/connections/${state.currentConnId}/tables`);
        const tables = data.tables || [];
        state.tableData[state.currentConnId] = tables;

        if (tables.length === 0) {
            tree.innerHTML = '<div class="text-muted text-center py-8 text-xs">未找到任何表</div>';
            return;
        }

        tree.innerHTML = '';
        tables.forEach(t => {
            const item = document.createElement('div');
            item.className = 'tree-item';
            item.dataset.table = t.name;
            item.dataset.type = t.type;
            item.innerHTML = `
                <span class="tree-toggle">▸</span>
                <span class="tree-icon">${t.type === 'view' ? '👁' : '📋'}</span>
                <span class="tree-label">${escapeHtml(t.name)}</span>
            `;
            item.onclick = (e) => {
                e.stopPropagation();
                toggleTreeNode(item, t.name);
            };
            // 右键菜单
            item.oncontextmenu = (e) => {
                e.preventDefault();
                showTableContextMenu(e, t.name);
            };
            // 双击查看数据
            item.ondblclick = (e) => {
                e.stopPropagation();
                showTableData(t.name);
            };
            tree.appendChild(item);
        });
    } catch (e) {
        tree.innerHTML = `<div class="text-red-400 text-center py-4 text-xs">${escapeHtml(e.message)}</div>`;
    }
}

async function toggleTreeNode(item, tableName) {
    const toggle = item.querySelector('.tree-toggle');
    const children = item.querySelector('.tree-children');

    // 收起
    if (children) {
        children.remove();
        toggle.textContent = '▸';
        item.classList.remove('active');
        return;
    }

    // 展开
    toggle.textContent = '▾';
    item.classList.add('active');

    try {
        const data = await api('GET', `/api/connections/${state.currentConnId}/tables/${encodeURIComponent(tableName)}/columns`);
        const columns = data.columns || [];
        const childDiv = document.createElement('div');
        childDiv.className = 'tree-children';

        columns.forEach(col => {
            const colItem = document.createElement('div');
            colItem.className = 'tree-item';
            let badges = '';
            if (col.primary_key) badges += '<span class="tree-column-badge badge-pk">PK</span>';
            colItem.innerHTML = `
                <span class="tree-toggle"></span>
                <span class="tree-icon" style="color:#5a8a7a">◇</span>
                <span class="tree-label">${escapeHtml(col.name)}</span>
                <span class="tree-column-type">${escapeHtml(col.type)}</span>
                ${badges}
            `;
            colItem.title = `${col.name}: ${col.type}${col.primary_key ? ' (PK)' : ''}${col.comment ? ' -- ' + col.comment : ''}`;
            childDiv.appendChild(colItem);
        });

        item.appendChild(childDiv);
    } catch (e) {
        toggle.textContent = '▸';
        item.classList.remove('active');
    }
}

function showTableContextMenu(e, tableName) {
    // 移除已有的菜单
    document.querySelectorAll('.context-menu').forEach(m => m.remove());

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.innerHTML = `
        <div class="context-menu-item" data-action="data">查看数据（前200条）</div>
        <div class="context-menu-item" data-action="ddl">查看建表语句</div>
        <div class="context-menu-item" data-action="select">生成 SELECT *</div>
        <div class="context-menu-item" data-action="count">查看行数</div>
    `;

    menu.onclick = async (ev) => {
        const action = ev.target.dataset.action;
        menu.remove();
        switch (action) {
            case 'data': showTableData(tableName); break;
            case 'ddl': showTableDdl(tableName); break;
            case 'select': insertSelectSql(tableName); break;
            case 'count': showTableRowCount(tableName); break;
        }
    };

    document.body.appendChild(menu);
    // 点击其他地方关闭
    setTimeout(() => {
        document.addEventListener('click', () => menu.remove(), { once: true });
    }, 10);
}

async function showTableData(tableName) {
    const tab = getActiveSqlTab();
    if (!tab) {
        createSqlTab();
    }
    // 确保有活动的SQL tab
    await new Promise(r => setTimeout(r, 50));
    const activeTab = getActiveSqlTab();
    if (!activeTab) return;

    try {
        const data = await api('GET', `/api/connections/${state.currentConnId}/tables/${encodeURIComponent(tableName)}/data`);
        renderResultTable(activeTab.id, data.columns, data.rows);
        // 更新结果信息
        const infoEl = document.querySelector(`#tab-panel-${activeTab.id} .sql-result-info`);
        if (infoEl) infoEl.innerHTML = `<span>表: ${escapeHtml(tableName)} | ${data.rows.length} 行</span>`;
    } catch (e) {
        alert('加载数据失败: ' + e.message);
    }
}

async function showTableDdl(tableName) {
    try {
        const data = await api('GET', `/api/connections/${state.currentConnId}/tables/${encodeURIComponent(tableName)}/ddl`);
        $('#ddl-content').textContent = data.ddl;
        openModal('modal-ddl');
    } catch (e) {
        alert('获取DDL失败: ' + e.message);
    }
}

function insertSelectSql(tableName) {
    const tab = getActiveSqlTab();
    if (!tab) {
        createSqlTab(`SELECT * FROM ${tableName} LIMIT 100;`);
    } else {
        if (tab.editor) {
            tab.editor.setValue(`SELECT * FROM ${tableName} LIMIT 100;`);
        }
    }
}

async function showTableRowCount(tableName) {
    try {
        const data = await api('GET', `/api/connections/${state.currentConnId}/tables/${encodeURIComponent(tableName)}/count`);
        alert(`${tableName}: ${data.count} 行`);
    } catch (e) {
        alert('获取行数失败: ' + e.message);
    }
}

// ==================== Tab 管理 ====================
function createSqlTab(initialSql = '') {
    const id = ++state.tabCounter;
    const tab = {
        id,
        type: 'sql',
        title: `SQL ${id}`,
        editor: null,
        sql: initialSql,
    };
    state.tabs.push(tab);
    renderTabs();
    activateTab(id);
    return tab;
}

function createAiTab() {
    // 检查是否已有 AI tab
    const existing = state.tabs.find(t => t.type === 'ai');
    if (existing) {
        activateTab(existing.id);
        return;
    }
    const id = ++state.tabCounter;
    const tab = {
        id,
        type: 'ai',
        title: 'AI 对话',
        chatHistory: [],
    };
    state.tabs.push(tab);
    renderTabs();
    activateTab(id);
}

function closeTab(tabId) {
    const idx = state.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    // 清理编辑器
    const tab = state.tabs[idx];
    if (tab.editor) {
        tab.editor.to && tab.editor.to(); // destroy if possible
    }

    state.tabs.splice(idx, 1);

    // 如果关闭的是活动 tab，激活相邻的
    if (state.activeTabId === tabId) {
        if (state.tabs.length > 0) {
            const newIdx = Math.min(idx, state.tabs.length - 1);
            activateTab(state.tabs[newIdx].id);
        } else {
            state.activeTabId = null;
            renderTabContent();
        }
    }
    renderTabs();
}

function activateTab(tabId) {
    state.activeTabId = tabId;
    renderTabs();
    renderTabContent();

    // 初始化 CodeMirror（需要 DOM 已渲染）
    setTimeout(() => {
        const tab = state.tabs.find(t => t.id === tabId);
        if (tab && tab.type === 'sql' && !tab.editor) {
            initSqlEditor(tab);
        }
    }, 20);
}

function renderTabs() {
    const bar = $('#tab-bar');
    bar.innerHTML = '';
    state.tabs.forEach(tab => {
        const el = document.createElement('div');
        el.className = `tab-item ${tab.id === state.activeTabId ? 'active' : ''}`;
        el.innerHTML = `
            <span>${escapeHtml(tab.title)}</span>
            <span class="tab-close" title="关闭">&times;</span>
        `;
        el.querySelector('.tab-close').onclick = (e) => {
            e.stopPropagation();
            closeTab(tab.id);
        };
        el.onclick = () => activateTab(tab.id);
        bar.appendChild(el);
    });
}

function renderTabContent() {
    const container = $('#tab-content');
    const emptyState = $('#empty-state');
    const tab = state.tabs.find(t => t.id === state.activeTabId);

    if (!tab) {
        container.innerHTML = '';
        container.appendChild(emptyState || createEmptyState());
        return;
    }

    // 隐藏空状态
    if (emptyState) emptyState.style.display = 'none';

    // 清除旧内容但保留空状态元素
    Array.from(container.children).forEach(child => {
        if (child.id !== 'empty-state') child.remove();
    });

    if (tab.type === 'sql') {
        const panel = createSqlPanel(tab);
        container.appendChild(panel);
    } else if (tab.type === 'ai') {
        const panel = createAiPanel(tab);
        container.appendChild(panel);
    }
}

function createEmptyState() {
    const div = document.createElement('div');
    div.id = 'empty-state';
    div.className = 'flex items-center justify-center h-full text-muted text-sm';
    div.textContent = '选择一个数据库连接，然后开始操作';
    return div;
}

function createSqlPanel(tab) {
    const panel = document.createElement('div');
    panel.className = 'sql-panel';
    panel.id = `tab-panel-${tab.id}`;
    panel.innerHTML = `
        <div class="sql-toolbar">
            <button class="primary" id="btn-run-sql-${tab.id}">执行 (Ctrl+Enter)</button>
            <button id="btn-export-csv-${tab.id}">导出 CSV</button>
            <button id="btn-history-${tab.id}">历史</button>
        </div>
        <div class="sql-editor-wrapper" id="sql-editor-${tab.id}"></div>
        <div class="sql-result-info" id="sql-result-info-${tab.id}">
            <span>就绪</span>
        </div>
        <div class="sql-result-wrapper" id="sql-result-${tab.id}">
            <div class="text-muted text-center py-8 text-xs">执行 SQL 查看结果</div>
        </div>
    `;

    // 绑定事件
    setTimeout(() => {
        const runBtn = panel.querySelector(`#btn-run-sql-${tab.id}`);
        if (runBtn) runBtn.onclick = () => executeSql(tab.id);

        const exportBtn = panel.querySelector(`#btn-export-csv-${tab.id}`);
        if (exportBtn) exportBtn.onclick = () => exportCsv(tab.id);

        const histBtn = panel.querySelector(`#btn-history-${tab.id}`);
        if (histBtn) histBtn.onclick = () => showHistory(tab.id);
    }, 10);

    return panel;
}

function initSqlEditor(tab) {
    const wrapper = document.getElementById(`sql-editor-${tab.id}`);
    if (!wrapper || tab.editor) return;

    const editor = CodeMirror(wrapper, {
        value: tab.sql || '',
        mode: 'text/x-sql',
        theme: 'material-darker',
        lineNumbers: true,
        matchBrackets: true,
        indentWithTabs: true,
        smartIndent: true,
        tabSize: 2,
        autofocus: true,
        extraKeys: {
            'Ctrl-Enter': () => executeSql(tab.id),
            'Cmd-Enter': () => executeSql(tab.id),
            'Ctrl-Space': 'autocomplete',
        },
        hintOptions: {
            completeSingle: false,
        },
    });

    editor.on('change', () => {
        tab.sql = editor.getValue();
    });

    tab.editor = editor;
    setTimeout(() => editor.refresh(), 50);
}

function createAiPanel(tab) {
    const panel = document.createElement('div');
    panel.className = 'chat-container';
    panel.id = `tab-panel-${tab.id}`;
    panel.innerHTML = `
        <div class="chat-messages" id="chat-messages-${tab.id}"></div>
        <div class="chat-input-area">
            <textarea id="chat-input-${tab.id}" placeholder="用自然语言描述你的需求...（Enter 发送，Shift+Enter 换行）" rows="1"></textarea>
            <button id="chat-send-${tab.id}">发送</button>
        </div>
    `;

    // 渲染已有消息
    const messagesEl = panel.querySelector(`#chat-messages-${tab.id}`);
    if (tab.chatHistory) {
        tab.chatHistory.forEach(msg => {
            appendChatBubble(messagesEl, msg.role, msg.content);
        });
    }

    setTimeout(() => {
        const input = panel.querySelector(`#chat-input-${tab.id}`);
        const sendBtn = panel.querySelector(`#chat-send-${tab.id}`);

        // 自动调整高度
        input.addEventListener('input', () => {
            input.style.height = 'auto';
            input.style.height = Math.min(input.scrollHeight, 120) + 'px';
        });

        // Enter 发送
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendAiMessage(tab.id);
            }
        });

        sendBtn.onclick = () => sendAiMessage(tab.id);
    }, 10);

    return panel;
}

// ==================== SQL 执行 ====================
let pendingConfirmTabId = null;
let pendingConfirmSql = null;

async function executeSql(tabId) {
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab || !tab.editor || !state.currentConnId) {
        alert('请先选择数据库连接');
        return;
    }

    // 获取选中的 SQL 或全部 SQL
    const sql = tab.editor.getSelection() || tab.editor.getValue().trim();
    if (!sql) return;

    try {
        const result = await api('POST', `/api/connections/${state.currentConnId}/sql`, {
            sql,
            confirmed: false,
        });

        if (result.type === 'confirm_required') {
            // 写操作需要确认
            pendingConfirmTabId = tabId;
            pendingConfirmSql = sql;
            $('#confirm-sql').textContent = sql;
            openModal('modal-confirm');
            return;
        }

        renderSqlResult(tabId, result);
    } catch (e) {
        renderSqlError(tabId, e.message);
    }
}

async function confirmExecuteSql() {
    closeModal('modal-confirm');
    if (!pendingConfirmSql || !pendingConfirmTabId) return;

    try {
        const result = await api('POST', `/api/connections/${state.currentConnId}/sql`, {
            sql: pendingConfirmSql,
            confirmed: true,
        });
        renderSqlResult(pendingConfirmTabId, result);
    } catch (e) {
        renderSqlError(pendingConfirmTabId, e.message);
    }
    pendingConfirmTabId = null;
    pendingConfirmSql = null;
}

function renderSqlResult(tabId, result) {
    if (result.type === 'query') {
        renderResultTable(tabId, result.columns, result.rows);
        updateResultInfo(tabId, `${result.rowcount} 行`);
    } else {
        const wrapper = document.getElementById(`sql-result-${tabId}`);
        wrapper.innerHTML = `<div class="p-3 text-sm text-green-400">${escapeHtml(result.message)}</div>`;
        updateResultInfo(tabId, result.message);
    }
}

function renderSqlError(tabId, message) {
    const wrapper = document.getElementById(`sql-result-${tabId}`);
    wrapper.innerHTML = `<div class="p-3 text-sm text-red-400">${escapeHtml(message)}</div>`;
    updateResultInfo(tabId, '执行错误');
}

function renderResultTable(tabId, columns, rows) {
    const wrapper = document.getElementById(`sql-result-${tabId}`);
    if (!wrapper) return;

    if (!columns || columns.length === 0) {
        wrapper.innerHTML = '<div class="text-muted text-center py-8 text-xs">无数据</div>';
        return;
    }

    let sortCol = -1, sortAsc = true;

    const table = document.createElement('table');
    table.className = 'data-table';

    // 表头
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    columns.forEach((col, i) => {
        const th = document.createElement('th');
        th.textContent = col;
        th.onclick = () => {
            if (sortCol === i) {
                sortAsc = !sortAsc;
            } else {
                sortCol = i;
                sortAsc = true;
            }
            rows.sort((a, b) => {
                const va = a[i] ?? '', vb = b[i] ?? '';
                const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
                return sortAsc ? cmp : -cmp;
            });
            renderRows();
            // 更新排序指示
            headerRow.querySelectorAll('th').forEach((h, j) => {
                h.textContent = columns[j] + (j === i ? (sortAsc ? ' ▲' : ' ▼') : '');
            });
        };
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);

    function renderRows() {
        tbody.innerHTML = '';
        rows.forEach(row => {
            const tr = document.createElement('tr');
            row.forEach(cell => {
                const td = document.createElement('td');
                if (cell === null || cell === undefined) {
                    td.textContent = 'NULL';
                    td.className = 'cell-null';
                } else {
                    td.textContent = String(cell);
                }
                td.title = String(cell ?? 'NULL');
                td.onclick = () => {
                    // 点击复制
                    navigator.clipboard.writeText(String(cell ?? '')).catch(() => {});
                    td.style.background = 'rgba(233, 69, 96, 0.15)';
                    setTimeout(() => td.style.background = '', 300);
                };
                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
    }
    renderRows();

    wrapper.innerHTML = '';
    wrapper.appendChild(table);
}

function updateResultInfo(tabId, text) {
    const el = document.getElementById(`sql-result-info-${tabId}`);
    if (el) el.innerHTML = `<span>${escapeHtml(text)}</span>`;
}

function getActiveSqlTab() {
    return state.tabs.find(t => t.id === state.activeTabId && t.type === 'sql');
}

// ==================== CSV 导出 ====================
function exportCsv(tabId) {
    const wrapper = document.getElementById(`sql-result-${tabId}`);
    const table = wrapper?.querySelector('.data-table');
    if (!table) {
        alert('没有可导出的数据');
        return;
    }

    const rows = [];
    table.querySelectorAll('tr').forEach(tr => {
        const cells = [];
        tr.querySelectorAll('th, td').forEach(cell => {
            cells.push('"' + cell.textContent.replace(/"/g, '""') + '"');
        });
        rows.push(cells.join(','));
    });

    const csv = '\ufeff' + rows.join('\n'); // BOM for Excel
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `query_result_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ==================== SQL 历史 ====================
async function showHistory(tabId) {
    if (!state.currentConnId) return;
    try {
        const records = await api('GET', `/api/connections/${state.currentConnId}/sql-history`);
        const wrapper = document.getElementById(`sql-result-${tabId}`);
        wrapper.innerHTML = '';

        if (records.length === 0) {
            wrapper.innerHTML = '<div class="text-muted text-center py-8 text-xs">暂无执行历史</div>';
            return;
        }

        records.forEach(r => {
            const div = document.createElement('div');
            div.className = 'flex items-start gap-2 px-3 py-2 border-b border-border hover:bg-bg-lighter cursor-pointer text-xs';
            div.innerHTML = `
                <span class="${r.status === 'success' ? 'status-success' : 'status-error'}">●</span>
                <div class="flex-1 min-w-0">
                    <div class="font-mono truncate">${escapeHtml(r.sql)}</div>
                    <div class="text-muted mt-0.5">${r.executed_at || ''} | ${r.rows_affected}行${r.error_message ? ' | ' + escapeHtml(r.error_message) : ''}</div>
                </div>
            `;
            div.onclick = () => {
                const tab = state.tabs.find(t => t.id === tabId);
                if (tab && tab.editor) {
                    tab.editor.setValue(r.sql);
                }
            };
            wrapper.appendChild(div);
        });

        updateResultInfo(tabId, `历史记录 (${records.length} 条)`);
    } catch (e) {
        alert('加载历史失败: ' + e.message);
    }
}

// ==================== AI 对话 ====================
async function sendAiMessage(tabId) {
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab || tab.type !== 'ai') return;

    const input = document.getElementById(`chat-input-${tabId}`);
    const message = input.value.trim();
    if (!message || !state.currentConnId) {
        if (!state.currentConnId) alert('请先选择数据库连接');
        return;
    }

    input.value = '';
    input.style.height = 'auto';

    const messagesEl = document.getElementById(`chat-messages-${tabId}`);

    // 显示用户消息
    appendChatBubble(messagesEl, 'user', message);
    tab.chatHistory.push({ role: 'user', content: message });

    // 创建 AI 回复气泡（流式填充）
    const aiBubble = document.createElement('div');
    aiBubble.className = 'chat-bubble assistant typing-indicator';
    messagesEl.appendChild(aiBubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;

    let fullContent = '';
    try {
        const res = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message,
                connection_id: state.currentConnId,
                chat_history: tab.chatHistory.slice(0, -1), // 不包含刚发的
            }),
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ detail: res.statusText }));
            throw new Error(err.detail || '请求失败');
        }

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
                const jsonStr = line.slice(6);
                if (!jsonStr.trim()) continue;

                try {
                    const data = JSON.parse(jsonStr);

                    if (data.type === 'token') {
                        fullContent += data.content;
                        aiBubble.innerHTML = formatMarkdown(fullContent);
                        messagesEl.scrollTop = messagesEl.scrollHeight;
                    } else if (data.type === 'tool_start') {
                        const toolDiv = document.createElement('div');
                        toolDiv.className = 'tool-call';
                        toolDiv.textContent = `🔧 调用工具: ${data.tool}`;
                        aiBubble.appendChild(toolDiv);
                        messagesEl.scrollTop = messagesEl.scrollHeight;
                    } else if (data.type === 'tool_end') {
                        // 工具调用完成
                    } else if (data.type === 'done') {
                        break;
                    }
                } catch (e) {
                    // 忽略解析错误
                }
            }
        }

        aiBubble.classList.remove('typing-indicator');
        if (!fullContent) {
            aiBubble.textContent = '（无回复）';
        } else {
            aiBubble.innerHTML = formatMarkdown(fullContent);
        }

        tab.chatHistory.push({ role: 'assistant', content: fullContent });
    } catch (e) {
        aiBubble.classList.remove('typing-indicator');
        aiBubble.textContent = '错误: ' + e.message;
        aiBubble.style.color = '#f87171';
    }

    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendChatBubble(container, role, content) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    bubble.innerHTML = role === 'user' ? escapeHtml(content) : formatMarkdown(content);
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
}

function formatMarkdown(text) {
    // 简单的 Markdown 格式化
    let html = escapeHtml(text);

    // 代码块 ```sql ... ```
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        return `<pre><code>${code.trim()}</code></pre>`;
    });

    // 行内代码
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

    // 粗体
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // 换行
    html = html.replace(/\n/g, '<br>');

    return html;
}

// ==================== AI 配置 ====================
async function loadAiConfig() {
    try {
        const config = await api('GET', '/api/ai/config');
        $('#ai-api-key').value = config.api_key || '';
        $('#ai-base-url').value = config.base_url || 'https://api.deepseek.com';
        $('#ai-model').value = config.model || 'deepseek-chat';
        $('#ai-temperature').value = config.temperature ?? 0;
    } catch (e) {
        console.error('加载AI配置失败:', e);
    }
}

async function saveAiConfig() {
    try {
        await api('POST', '/api/ai/config', {
            api_key: $('#ai-api-key').value,
            base_url: $('#ai-base-url').value,
            model: $('#ai-model').value,
            temperature: parseFloat($('#ai-temperature').value),
        });
        closeModal('modal-settings');
        alert('AI 配置已保存');
    } catch (e) {
        alert('保存失败: ' + e.message);
    }
}
