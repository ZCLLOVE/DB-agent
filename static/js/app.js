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
    currentSessionId: null,
    sessionSidebarOpen: true,  // 侧边栏默认展开
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
    // 创建固定的 AI 标签页（始终第一个，不可关闭）
    createAiTab();
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

    // 设置
    $('#btn-settings').onclick = () => {
        resetProviderForm();
        openModal('modal-settings');
    };
    $('#btn-save-provider').onclick = saveProvider;
    $('#btn-cancel-provider').onclick = resetProviderForm;

    // SQL 确认弹窗
    $('#btn-confirm-cancel').onclick = () => closeModal('modal-confirm');
    $('#btn-confirm-ok').onclick = confirmExecuteSql;

    // 侧边栏拖拽调整宽度
    initSidebarResize();

    // 表名筛选
    $('#table-filter').addEventListener('input', (e) => {
        filterTableTree(e.target.value.trim().toLowerCase());
    });

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
    if (current) {
        sel.value = current;
    } else if (state.connections.length > 0) {
        sel.value = state.connections[0].id;
        state.currentConnId = state.connections[0].id;
        loadTableTree();
    }
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
                <button class="text-xs text-blue-400 hover:text-blue-300 px-1" onclick="cloneConnection(${c.id})">复制到新库</button>
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

function cloneConnection(id) {
    const conn = state.connections.find(c => c.id === id);
    if (!conn) return;
    $('#conn-edit-id').value = '';
    $('#conn-name').value = conn.name + ' (副本)';
    $('#conn-db-type').value = conn.db_type;
    $('#conn-host').value = conn.host || '';
    $('#conn-port').value = conn.port || 3306;
    $('#conn-username').value = conn.username || '';
    $('#conn-password').value = conn.password || '';
    $('#conn-database').value = '';
    $('#conn-form-title').textContent = '复制为新连接';
    $('#conn-database').focus();
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

        renderTableTreeItems(tables);
    } catch (e) {
        tree.innerHTML = `<div class="text-red-400 text-center py-4 text-xs">${escapeHtml(e.message)}</div>`;
    }
}

function renderTableTreeItems(tables) {
    const tree = $('#table-tree');
    const filter = ($('#table-filter').value || '').trim().toLowerCase();
    tree.innerHTML = '';

    tables.forEach(t => {
        // 筛选逻辑：匹配表名或备注
        if (filter) {
            const nameMatch = t.name.toLowerCase().includes(filter);
            const commentMatch = (t.comment || '').toLowerCase().includes(filter);
            if (!nameMatch && !commentMatch) return;
        }

        const item = document.createElement('div');
        item.className = 'tree-item';
        item.dataset.table = t.name;
        item.dataset.type = t.type;
        item.dataset.comment = t.comment || '';

        // 悬停提示：表名 + 备注
        const tooltip = t.comment ? `${t.name} — ${t.comment}` : t.name;
        item.title = tooltip;

        item.innerHTML = `
            <span class="tree-icon">${t.type === 'view' ? '👁' : '📋'}</span>
            <span class="tree-label">${escapeHtml(t.name)}</span>
            ${t.comment ? `<span class="tree-comment-text">${escapeHtml(t.comment)}</span>` : ''}
            <button class="tree-query-btn" title="查看前200条数据">▶</button>
        `;

        // 左键单击表名 → 插入标签到 AI 对话输入框
        item.onclick = (e) => {
            if (e.target.closest('.tree-query-btn')) return; // 排除查询按钮
            e.stopPropagation();
            insertTableTagIntoAi(t.name);
        };

        // 查询按钮 → 查看表数据
        item.querySelector('.tree-query-btn').onclick = (e) => {
            e.stopPropagation();
            showTableData(t.name);
        };

        // 右键菜单（含展开字段、DDL、SELECT 等）
        item.oncontextmenu = (e) => {
            e.preventDefault();
            showTableContextMenu(e, t.name);
        };
        tree.appendChild(item);
    });

    if (tree.children.length === 0) {
        tree.innerHTML = '<div class="text-muted text-center py-4 text-xs">无匹配结果</div>';
    }
}

function filterTableTree(keyword) {
    const tables = state.tableData[state.currentConnId];
    if (!tables) return;
    renderTableTreeItems(tables);
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
        <div class="context-menu-item" data-action="columns">展开字段</div>
        <div class="context-menu-item" data-action="data">查看数据（前200条）</div>
        <div class="context-menu-item" data-action="ddl">查看建表语句</div>
        <div class="context-menu-item" data-action="select">生成 SELECT *</div>
        <div class="context-menu-item" data-action="count">查看行数</div>
        <div class="context-menu-item" data-action="constraints">查看约束和索引</div>
    `;

    menu.onclick = async (ev) => {
        const action = ev.target.dataset.action;
        menu.remove();
        switch (action) {
            case 'columns': showTableColumnsPopup(tableName); break;
            case 'data': showTableData(tableName); break;
            case 'ddl': showTableDdl(tableName); break;
            case 'select': insertSelectSql(tableName); break;
            case 'count': showTableRowCount(tableName); break;
            case 'constraints': showTableConstraints(tableName); break;
        }
    };

    document.body.appendChild(menu);
    setTimeout(() => {
        document.addEventListener('click', () => menu.remove(), { once: true });
    }, 10);
}

// 右键"展开字段"：在侧边栏树节点内联展开
async function showTableColumnsPopup(tableName) {
    // 找到对应的树节点
    const treeItem = document.querySelector(`#table-tree .tree-item[data-table="${CSS.escape(tableName)}"]`);
    if (!treeItem) return;

    // 如果已展开，收起
    const existing = treeItem.querySelector('.tree-children');
    if (existing) {
        existing.remove();
        treeItem.classList.remove('active');
        return;
    }

    treeItem.classList.add('active');

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
                <span class="tree-icon" style="color:#5a8a7a">◇</span>
                <span class="tree-label">${escapeHtml(col.name)}</span>
                <span class="tree-column-type">${escapeHtml(col.type)}</span>
                ${badges}
            `;
            colItem.title = `${col.name}: ${col.type}${col.primary_key ? ' (PK)' : ''}${col.comment ? ' -- ' + col.comment : ''}`;
            childDiv.appendChild(colItem);
        });

        treeItem.appendChild(childDiv);
    } catch (e) {
        treeItem.classList.remove('active');
    }
}

function renderTableResultInfo(tabId, data) {
    const infoEl = document.querySelector(`#tab-panel-${tabId} .sql-result-info`);
    if (!infoEl) return;
    const tableName = data.tableName || '';
    const hasPk = data.primary_keys && data.primary_keys.length > 0;
    const hasUk = !hasPk && data.unique_keys && data.unique_keys.length > 0;
    const canDelete = hasPk || hasUk;
    const pkInfo = hasPk ? '' : (hasUk ? '<span class="text-blue-400 ml-2">(通过唯一键定位)</span>' : '<span class="text-yellow-500 ml-2">(无主键/唯一键，不可编辑/删除)</span>');
    const tableLabel = tableName ? `表: ${escapeHtml(tableName)} | ` : '';
    infoEl.innerHTML = `
        <span style="display:inline-flex;align-items:center;flex-wrap:wrap;gap:4px">
            <label class="flex items-center gap-1 cursor-pointer">
                <input type="checkbox" class="accent-red-500" id="data-select-all-${tabId}"> <span class="text-xs">全选</span>
            </label>
            ${tableLabel}${data.rows.length} 行${pkInfo}
        </span>
        <span class="flex items-center gap-2">
            <button class="bg-red-700 hover:bg-red-600 text-white text-xs px-3 py-0.5 rounded${canDelete ? '' : ' opacity-40 cursor-not-allowed'}" id="data-delete-${tabId}" ${canDelete ? '' : 'disabled'}>删除</button>
            <button class="bg-primary hover:bg-red-500 text-white text-xs px-3 py-0.5 rounded" id="data-ask-ai-${tabId}">问 AI</button>
            <button class="text-xs px-3 py-0.5 rounded border border-border hover:border-accent-light hover:text-accent-light" id="data-view-${tabId}">视图</button>
        </span>
    `;
    const resultWrapper = document.getElementById(`sql-result-${tabId}`);
    infoEl.querySelector(`#data-select-all-${tabId}`).onchange = (e) => {
        resultWrapper.querySelectorAll('.data-row-cb').forEach(cb => cb.checked = e.target.checked);
    };
    // 删除按钮
    const deleteBtn = infoEl.querySelector(`#data-delete-${tabId}`);
    if (deleteBtn && canDelete) {
        deleteBtn.onclick = () => deleteSelectedRows(tabId, data);
    }
    infoEl.querySelector(`#data-ask-ai-${tabId}`).onclick = () => {
        const checked = resultWrapper.querySelectorAll('.data-row-cb:checked');
        if (checked.length === 0) { alert('请先勾选数据行'); return; }
        const selectedData = Array.from(checked).map(cb => {
            const idx = parseInt(cb.dataset.rowIdx);
            const row = data.rows[idx];
            const obj = {};
            data.columns.forEach((col, i) => { obj[col] = row[i]; });
            return JSON.stringify(obj);
        });
        sendHistoryToAi(selectedData, { table: tableName, type: 'data' });
    };
    const viewBtn = infoEl.querySelector(`#data-view-${tabId}`);
    if (viewBtn) viewBtn.onclick = () => showColumnVisibilityPopup(tabId);
}

/** 删除勾选的行（通过主键或唯一键定位） */
function deleteSelectedRows(tabId, data) {
    const resultWrapper = document.getElementById(`sql-result-${tabId}`);
    const checked = resultWrapper.querySelectorAll('.data-row-cb:checked');
    if (checked.length === 0) { alert('请先勾选要删除的行'); return; }

    const tableName = data.tableName;
    if (!tableName) { alert('无法识别表名，不能删除'); return; }

    const columns = data.columns;
    const pkColumns = data.primary_keys || [];
    const uniqueKeys = data.unique_keys || [];

    // 引用值
    function sqlVal(v) {
        if (v === null || v === undefined || v === 'NULL') return 'NULL';
        if (typeof v === 'number') return String(v);
        return "'" + String(v).replace(/'/g, "''") + "'";
    }

    // 获取定位列（优先主键，否则唯一键）
    let keyColumns = pkColumns.length > 0 ? pkColumns : null;
    if (!keyColumns && uniqueKeys.length > 0) {
        // 选第一个在 columns 中都存在的唯一键
        keyColumns = uniqueKeys.find(uk => uk.every(c => columns.includes(c)));
    }
    if (!keyColumns) { alert('无可用的主键或唯一键来定位行'); return; }

    const keyIndices = keyColumns.map(c => columns.indexOf(c));

    // 生成 DELETE SQL
    const dialect = (state.connections.find(c => c.id === state.currentConnId)?.db_type || '').toLowerCase();
    const quoted = t => dialect === 'mysql' ? `\`${t}\`` : `"${t}"`;

    const conditions = Array.from(checked).map(cb => {
        const rowIdx = parseInt(cb.dataset.rowIdx);
        const row = data.rows[rowIdx];
        return keyColumns.map((col, i) => `${quoted(col)} = ${sqlVal(row[keyIndices[i]])}`).join(' AND ');
    });

    const sql = `DELETE FROM ${quoted(tableName)} WHERE ${conditions.map(c => `(${c})`).join(' OR ')};`;

    // 走确认弹窗
    pendingConfirmTabId = tabId;
    pendingConfirmSql = sql;
    $('#confirm-sql').textContent = sql;
    pendingConfirmOnSuccess = () => {
        // 删除成功后重新加载数据
        if (tableName) showTableData(tableName);
    };
    openModal('modal-confirm');
}

async function showTableData(tableName) {
    const sql = `SELECT * FROM ${tableName} LIMIT 200;`;
    const tab = getActiveSqlTab();
    if (!tab) {
        createSqlTab(sql);
    } else {
        if (tab.editor) {
            tab.editor.setValue(sql);
        }
    }
    await new Promise(r => setTimeout(r, 50));
    const activeTab = getActiveSqlTab();
    if (!activeTab) return;

    try {
        const data = await api('GET', `/api/connections/${state.currentConnId}/tables/${encodeURIComponent(tableName)}/data`);
        data.tableName = tableName;
        activeTab._tableData = { columns: data.columns, rows: data.rows, tableName: tableName };
        activeTab._tableAllColumns = [...data.columns];  // 保存完整表字段，供视图弹窗使用
        renderResultTable(activeTab.id, data);
        renderTableResultInfo(activeTab.id, data);
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

$('#btn-copy-ddl').onclick = () => {
    const text = $('#ddl-content').textContent;
    navigator.clipboard.writeText(text).then(() => {
        const btn = $('#btn-copy-ddl');
        btn.textContent = '已复制';
        setTimeout(() => btn.textContent = '复制', 1500);
    });
};

async function insertSelectSql(tableName) {
    const sql = `SELECT * FROM ${tableName};`;
    const tab = getActiveSqlTab();
    if (!tab) {
        createSqlTab(sql);
    } else {
        if (tab.editor) {
            tab.editor.setValue(sql);
        }
    }
    await new Promise(r => setTimeout(r, 50));
    const activeTab = getActiveSqlTab();
    if (activeTab) executeSql(activeTab.id);
}

async function showTableRowCount(tableName) {
    try {
        const data = await api('GET', `/api/connections/${state.currentConnId}/tables/${encodeURIComponent(tableName)}/count`);
        alert(`${tableName}: ${data.count} 行`);
    } catch (e) {
        alert('获取行数失败: ' + e.message);
    }
}

async function showTableConstraints(tableName) {
    try {
        const data = await api('GET', `/api/connections/${state.currentConnId}/tables/${encodeURIComponent(tableName)}/constraints`);
        const constraints = data.constraints || [];
        const indexes = data.indexes || [];
        let text = '';

        if (constraints.length > 0) {
            text += '-- 约束\n';
            constraints.forEach(c => {
                text += `${c.type}`;
                if (c.name) text += ` "${c.name}"`;
                text += ` (${c.columns.join(', ')})`;
                if (c.type === 'FOREIGN KEY') {
                    text += ` -> ${c.referred_table}(${c.referred_columns.join(', ')})`;
                }
                if (c.type === 'CHECK' && c.sqltext) {
                    text += ` ${c.sqltext}`;
                }
                text += '\n';
            });
        } else {
            text += '-- 无约束\n';
        }

        text += '\n';
        if (indexes.length > 0) {
            text += '-- 索引\n';
            indexes.forEach(idx => {
                text += `${idx.unique ? 'UNIQUE ' : ''}INDEX "${idx.name}" (${idx.columns.join(', ')})\n`;
            });
        } else {
            text += '-- 无索引\n';
        }

        $('#constraints-content').textContent = text.trim();
        openModal('modal-constraints');
    } catch (e) {
        alert('获取约束和索引失败: ' + e.message);
    }
}

$('#btn-copy-constraints').onclick = () => {
    const text = $('#constraints-content').textContent;
    navigator.clipboard.writeText(text).then(() => {
        const btn = $('#btn-copy-constraints');
        btn.textContent = '已复制';
        setTimeout(() => btn.textContent = '复制', 1500);
    });
};

/** 重新绑定结果信息栏里的全选+问AI按钮事件（tab切换恢复后调用） */
function rebindDataActionBar(tabId) {
    const tab = state.tabs.find(t => t.id === tabId);
    const info = document.getElementById(`sql-result-info-${tabId}`);
    const resultWrapper = document.getElementById(`sql-result-${tabId}`);
    if (!tab || !info || !resultWrapper) return;

    // 视图按钮（不依赖 selectAll/askAi，独立绑定）
    const viewBtn = info.querySelector(`#data-view-${tabId}`);
    if (viewBtn) viewBtn.onclick = () => showColumnVisibilityPopup(tabId);

    const selectAllCb = info.querySelector(`#data-select-all-${tabId}`);
    const askAiBtn = info.querySelector(`#data-ask-ai-${tabId}`);
    if (!selectAllCb || !askAiBtn) return;

    selectAllCb.onchange = (e) => {
        resultWrapper.querySelectorAll('.data-row-cb').forEach(cb => cb.checked = e.target.checked);
    };

    // 删除按钮重新绑定
    const deleteBtn = info.querySelector(`#data-delete-${tabId}`);
    if (deleteBtn && !deleteBtn.disabled) {
        const td = tab._tableData;
        if (td) deleteBtn.onclick = () => deleteSelectedRows(tabId, { ...td, primary_keys: td.primary_keys || [], unique_keys: td.unique_keys || [] });
    }

    askAiBtn.onclick = () => {
        const checked = resultWrapper.querySelectorAll('.data-row-cb:checked');
        if (checked.length === 0) { alert('请先勾选数据行'); return; }
        const td = tab._tableData;
        if (!td) { alert('数据已过期，请重新查询'); return; }
        const selectedData = Array.from(checked).map(cb => {
            const idx = parseInt(cb.dataset.rowIdx);
            const row = td.rows[idx];
            const obj = {};
            td.columns.forEach((col, i) => { obj[col] = row[i]; });
            return JSON.stringify(obj);
        });
        sendHistoryToAi(selectedData, { table: tab._tableData?.tableName || '', type: 'data' });
    };
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
        return existing;
    }
    const id = ++state.tabCounter;
    const tab = {
        id,
        type: 'ai',
        title: 'AI 对话',
        chatHistory: [],
        fixed: true,  // 标记为固定标签页，不可关闭
    };
    // AI 标签页始终在最前面
    state.tabs.unshift(tab);
    renderTabs();
    activateTab(id);
    return tab;
}

function closeTab(tabId) {
    const idx = state.tabs.findIndex(t => t.id === tabId);
    if (idx === -1) return;

    // 清理编辑器
    const tab = state.tabs[idx];
    // 不允许关闭固定标签页（AI 对话）
    if (tab.fixed) {
        return;
    }
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
    const tab = state.tabs.find(t => t.id === tabId);
    const prevActiveId = state.activeTabId;

    state.activeTabId = tabId;

    // 如果点击的是 AI 标签页，且之前也是 AI 标签页，则切换侧边栏
    if (tab && tab.type === 'ai' && prevActiveId === tabId) {
        toggleSessionSidebar();
        return;
    }

    renderTabs();
    renderTabContent();

    // 初始化 CodeMirror（需要 DOM 已渲染）
    setTimeout(() => {
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
        // 固定标签页不显示关闭按钮
        const closeBtn = tab.fixed ? '' : '<span class="tab-close" title="关闭">&times;</span>';
        el.innerHTML = `
            <span>${escapeHtml(tab.title)}</span>
            ${closeBtn}
        `;
        if (!tab.fixed) {
            el.querySelector('.tab-close').onclick = (e) => {
                e.stopPropagation();
                closeTab(tab.id);
            };
        }
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

    // 切换前保存所有 tab 状态
    state.tabs.forEach(t => {
        if (t.type === 'ai') {
            const input = document.getElementById(`chat-input-${t.id}`);
            if (input) t._savedInputHtml = input.innerHTML;
        }
        if (t.type === 'sql') {
            if (t.editor) {
                t.sql = t.editor.getValue();
                t.editor = null;
            }
            // 保存结果区 DOM 节点（保留事件绑定，不用 innerHTML）
            const result = document.getElementById(`sql-result-${t.id}`);
            if (result) {
                t._savedResultFragment = document.createDocumentFragment();
                while (result.firstChild) {
                    t._savedResultFragment.appendChild(result.firstChild);
                }
                // 保存列可见性上下文（wrapper 元素会被重建，属性会丢失）
                t._savedColVisCtx = result._colVisCtx;
            }
            const info = document.getElementById(`sql-result-info-${t.id}`);
            if (info) t._savedResultInfo = info.innerHTML;
        }
    });

    // 清除旧内容但保留空状态元素
    Array.from(container.children).forEach(child => {
        if (child.id !== 'empty-state') child.remove();
    });

    if (tab.type === 'sql') {
        const panel = createSqlPanel(tab);
        container.appendChild(panel);
        // 恢复结果区内容（用 DOM 节点而非 innerHTML，保留事件绑定）
        if (tab._savedResultFragment) {
            setTimeout(() => {
                const result = document.getElementById(`sql-result-${tab.id}`);
                if (result) {
                    result.innerHTML = '';
                    result.appendChild(tab._savedResultFragment);
                    // 恢复列可见性上下文（wrapper 是新重建的）
                    if (tab._savedColVisCtx) result._colVisCtx = tab._savedColVisCtx;
                }
                const info = document.getElementById(`sql-result-info-${tab.id}`);
                if (info && tab._savedResultInfo) info.innerHTML = tab._savedResultInfo;
                // 重新绑定 info 栏里的按钮事件
                rebindDataActionBar(tab.id);
            }, 30);
        }
    } else if (tab.type === 'ai') {
        const panel = createAiPanel(tab);
        container.appendChild(panel);
        // 恢复 AI 输入框内容
        if (tab._savedInputHtml) {
            setTimeout(() => {
                const input = document.getElementById(`chat-input-${tab.id}`);
                if (input) input.innerHTML = tab._savedInputHtml;
            }, 20);
        }
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
    panel.style.flexDirection = 'row';

    // 会话侧边栏
    const sidebar = document.createElement('div');
    sidebar.className = `session-sidebar ${state.sessionSidebarOpen ? '' : 'collapsed'}`;
    sidebar.id = `session-sidebar-${tab.id}`;
    sidebar.innerHTML = `
        <div class="session-sidebar-header">
            <button id="btn-new-session-${tab.id}">+ 新会话</button>
        </div>
        <div class="session-list" id="session-list-${tab.id}"></div>
    `;

    // 聊天主区域
    const chatMain = document.createElement('div');
    chatMain.className = 'chat-container';
    chatMain.style.flex = '1';
    chatMain.innerHTML = `
        <div class="chat-messages" id="chat-messages-${tab.id}"></div>
        <div class="chat-input-area">
            <div id="chat-input-${tab.id}" contenteditable="true"
                 class="chat-editable"
                 data-placeholder="用自然语言描述需求，点击左侧表名插入表标签...（Enter 发送，Shift+Enter 换行）"></div>
            <button id="chat-send-${tab.id}">发送</button>
        </div>
    `;

    panel.appendChild(sidebar);
    panel.appendChild(chatMain);

    // 渲染已有消息
    const messagesEl = chatMain.querySelector(`#chat-messages-${tab.id}`);
    if (tab.chatHistory) {
        tab.chatHistory.forEach(msg => {
            appendChatBubble(messagesEl, msg.role, msg.content);
        });
    }

    setTimeout(() => {
        const input = chatMain.querySelector(`#chat-input-${tab.id}`);
        const sendBtn = chatMain.querySelector(`#chat-send-${tab.id}`);

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendAiMessage(tab.id);
            }
        });

        input.addEventListener('dragover', (e) => {
            if (e.dataTransfer.types.includes('application/table-tag') ||
                e.dataTransfer.types.includes('application/sql-tag')) {
                e.preventDefault();
            }
        });
        input.addEventListener('drop', (e) => {
            const isTableTag = e.dataTransfer && e.dataTransfer.types.includes('application/table-tag');
            const isSqlTag = e.dataTransfer && e.dataTransfer.types.includes('application/sql-tag');
            if (isTableTag || isSqlTag) {
                e.preventDefault();
                e.stopPropagation();
                const draggedTag = input.querySelector('.table-tag.dragging, .sql-tag.dragging');
                if (!draggedTag) return;
                const range = document.caretRangeFromPoint(e.clientX, e.clientY);
                if (range && input.contains(range.commonAncestorContainer)) {
                    range.insertNode(draggedTag);
                    draggedTag.after(document.createTextNode('\u00A0'));
                }
            }
        });

        sendBtn.onclick = () => sendAiMessage(tab.id);
        sidebar.querySelector(`#btn-new-session-${tab.id}`).onclick = () => newSession(tab.id);
        loadSessionList(tab.id);
    }, 10);

    return panel;
}

// ==================== 列视图（显示/隐藏列） ====================
function showColumnVisibilityPopup(tabId) {
    document.querySelectorAll('.col-visibility-popup').forEach(m => m.remove());

    const wrapper = document.getElementById(`sql-result-${tabId}`);
    const ctx = wrapper?._colVisCtx;
    if (!ctx) return;

    const { colVisible, columns, commentMap, applyColVisibility } = ctx;
    const tab = state.tabs.find(t => t.id === tabId);

    // 始终使用完整表字段（不会越选越少）
    const allColumns = (tab && tab._tableAllColumns) ? tab._tableAllColumns : columns;
    // 当前结果中可见的列集合
    const visibleSet = new Set(columns.filter((_, i) => colVisible[i]));
    const tempVisible = allColumns.map(col => visibleSet.has(col));

    const popup = document.createElement('div');
    popup.className = 'col-visibility-popup fixed inset-0 bg-black/60 z-50 flex items-center justify-center';

    const box = document.createElement('div');
    box.className = 'bg-bg-light border border-border rounded-lg w-[360px] max-h-[70vh] flex flex-col';
    box.innerHTML = `
        <div class="flex items-center justify-between p-4 border-b border-border">
            <h3 class="text-sm font-medium">列视图</h3>
            <button class="modal-close text-muted hover:text-gray-300">&times;</button>
        </div>
        <div class="p-3 flex gap-2 border-b border-border">
            <button class="text-xs text-muted hover:text-gray-300 px-2 py-0.5 rounded border border-border" id="col-vis-select-all">全选</button>
            <button class="text-xs text-muted hover:text-gray-300 px-2 py-0.5 rounded border border-border" id="col-vis-deselect-all">全不选</button>
        </div>
        <div class="flex-1 overflow-auto p-3 space-y-1" id="col-vis-list"></div>
        <div class="flex gap-2 p-3 border-t border-border justify-end">
            <button class="bg-bg border border-border hover:border-muted text-sm px-4 py-1.5 rounded" id="col-vis-cancel">取消</button>
            <button class="bg-accent hover:bg-accent-light text-white text-sm px-4 py-1.5 rounded" id="col-vis-confirm">确认</button>
        </div>
    `;
    popup.appendChild(box);
    document.body.appendChild(popup);

    // 填充列复选框（始终展示完整表结构）
    const list = box.querySelector('#col-vis-list');
    allColumns.forEach((col, i) => {
        const comment = commentMap[col] || '';
        const label = document.createElement('label');
        label.className = 'flex items-center gap-2 text-sm cursor-pointer py-1';
        label.innerHTML = `
            <input type="checkbox" class="col-vis-cb accent-red-500" data-col-idx="${i}" ${tempVisible[i] ? 'checked' : ''}>
            <span>${escapeHtml(col)}</span>
            ${comment ? `<span class="text-xs text-muted">(${escapeHtml(comment)})</span>` : ''}
        `;
        label.querySelector('input').onchange = (e) => {
            tempVisible[i] = e.target.checked;
        };
        list.appendChild(label);
    });

    // 全选 / 全不选
    box.querySelector('#col-vis-select-all').onclick = () => {
        tempVisible.fill(true);
        list.querySelectorAll('.col-vis-cb').forEach(cb => cb.checked = true);
    };
    box.querySelector('#col-vis-deselect-all').onclick = () => {
        tempVisible.fill(false);
        list.querySelectorAll('.col-vis-cb').forEach(cb => cb.checked = false);
    };

    // 关闭
    const close = () => popup.remove();
    box.querySelector('.modal-close').onclick = close;
    box.querySelector('#col-vis-cancel').onclick = close;
    popup.onclick = (e) => { if (e.target === popup) close(); };

    // 确认：更新列可见性 + 替换 SQL 中 SELECT 和 FROM 之间的部分
    box.querySelector('#col-vis-confirm').onclick = () => {
        if (tempVisible.every(v => !v)) {
            alert('至少需要勾选一列');
            return;
        }
        // 映射回当前结果列的可见性
        const newVisibleSet = new Set(allColumns.filter((_, i) => tempVisible[i]));
        for (let i = 0; i < columns.length; i++) {
            colVisible[i] = newVisibleSet.has(columns[i]);
        }
        applyColVisibility();

        // 只替换 SQL 中 SELECT 和 FROM 之间的列部分，其余不动
        if (tab && tab.editor) {
            const selectedCols = allColumns.filter((_, i) => tempVisible[i]);
            const allSelected = selectedCols.length === allColumns.length;
            const colPart = allSelected ? '*' : selectedCols.join(',\n       ');
            const currentSql = tab.editor.getValue();
            const newSql = currentSql.replace(
                /SELECT\s+[\s\S]*?(\sFROM\s)/i,
                `SELECT ${colPart}$1`
            );
            tab.editor.setValue(newSql);
        }
        popup.remove();
    };
}

// ==================== SQL 执行 ====================
let pendingConfirmTabId = null;
let pendingConfirmSql = null;

// 列筛选上下文（全局，供弹窗按钮回调）
let _activeColFilter = {
    colFilters: {},     // 当前列筛选状态
    renderRows: null,   // 重新渲染行
    renderFilterTags: null,
    filterColIdx: -1,
    columns: [],
};

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

function renderSqlResult(tabId, result) {
    if (result.type === 'query') {
        const data = {
            columns: result.columns,
            rows: result.rows,
            column_meta: result.column_meta || [],
            primary_keys: result.primary_keys || [],
            unique_keys: result.unique_keys || [],
            tableName: result.tableName || null,
        };
        // 保存供问AI用
        const tab = state.tabs.find(t => t.id === tabId);
        if (tab) tab._tableData = { columns: data.columns, rows: data.rows, tableName: data.tableName, primary_keys: data.primary_keys || [], unique_keys: data.unique_keys || [] };
        renderResultTable(tabId, data);
        renderTableResultInfo(tabId, data);
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

function renderResultTable(tabId, data) {
    const wrapper = document.getElementById(`sql-result-${tabId}`);
    if (!wrapper) return;

    const columns = Array.isArray(data) ? data : (data.columns || []);
    const rows = Array.isArray(data) ? arguments[2] : (data.rows || []);
    const columnMeta = (!Array.isArray(data) && data.column_meta) ? data.column_meta : [];
    const pkColumns = (!Array.isArray(data) && data.primary_keys) ? data.primary_keys : [];
    const uniqueKeys = (!Array.isArray(data) && data.unique_keys) ? data.unique_keys : [];
    const tableName = (!Array.isArray(data) && data.tableName) ? data.tableName : null;

    if (!columns || columns.length === 0) {
        wrapper.innerHTML = '<div class="text-muted text-center py-8 text-xs">无数据</div>';
        return;
    }

    // 构建 列名 → 注释 映射
    const commentMap = {};
    columnMeta.forEach(c => { commentMap[c.name] = c.comment; });

    // 编辑状态：有主键则用主键，否则尝试唯一键
    const isEditable = tableName && (pkColumns.length > 0 || uniqueKeys.length > 0);
    const pkColIndices = pkColumns.length > 0
        ? pkColumns.map(pk => columns.indexOf(pk)).filter(i => i >= 0)
        : (() => {
            const uk = uniqueKeys.find(u => u.every(c => columns.includes(c)));
            return uk ? uk.map(c => columns.indexOf(c)) : [];
        })();

    // 引用值用于 SQL（处理字符串、NULL）
    function sqlVal(v) {
        if (v === null || v === undefined || v === 'NULL') return 'NULL';
        if (typeof v === 'number') return String(v);
        return "'" + String(v).replace(/'/g, "''") + "'";
    }

    let sortCol = -1, sortAsc = true;
    const colFilters = {}; // 列索引 -> { op, value } 活动筛选
    const colVisible = columns.map(() => true); // 列可见性
    const table = document.createElement('table');
    table.className = 'data-table';

    // 表头 — 带列注释 + 筛选图标
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    // 勾选列表头（对齐数据行的勾选框 td）
    const thCheck = document.createElement('th');
    thCheck.style.width = '30px';
    headerRow.appendChild(thCheck);
    columns.forEach((col, i) => {
        const th = document.createElement('th');
        const comment = commentMap[col];
        if (comment) {
            th.innerHTML = `${escapeHtml(col)}<span class="th-comment">(${escapeHtml(comment)})</span>`;
        } else {
            th.textContent = col;
        }
        // 左键排序
        th.onclick = () => {
            if (sortCol === i) sortAsc = !sortAsc;
            else { sortCol = i; sortAsc = true; }
            rows.sort((a, b) => {
                const va = a[i] ?? '', vb = b[i] ?? '';
                return String(va).localeCompare(String(vb), undefined, { numeric: true }) * (sortAsc ? 1 : -1);
            });
            renderRows();
        };
        // 右键筛选菜单
        th.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
            showColFilterMenu(e, i, col);
        };
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);

    // 筛选匹配函数
    function matchFilter(cellValue, filter) {
        const v = cellValue;
        const sv = String(v ?? '');
        const fv = filter.value;
        switch (filter.op) {
            case 'LIKE': {
                const pattern = fv.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const likePattern = pattern.replace(/%/g, '.*').replace(/_/g, '.');
                const regex = new RegExp(
                    (likePattern.includes('.*') || likePattern.includes('.')) ? `^${likePattern}$` : `.*${likePattern}.*`, 'i'
                );
                return regex.test(sv);
            }
            case '=': return sv === fv;
            case '!=': return sv !== fv;
            case '>': return sv > fv;
            case '<': return sv < fv;
            case '>=': return sv >= fv;
            case '<=': return sv <= fv;
            case 'IS NULL': return v === null || v === undefined;
            case 'IS NOT NULL': return v !== null && v !== undefined;
            case 'custom': {
                // filter.value 存的是自定义表达式如 "> 100 AND < 200"
                try {
                    const numV = Number(v);
                    if (!isNaN(numV)) {
                        return new Function('v', 'n', `return ${fv}`)(sv, numV);
                    }
                    return new Function('v', `return ${fv}`)(sv);
                } catch { return false; }
            }
            default: return true;
        }
    }

    function renderRows() {
        tbody.innerHTML = '';
        let visibleCount = 0;
        rows.forEach((row, rowIdx) => {
            // 检查列筛选
            if (Object.keys(colFilters).length > 0) {
                let matched = true;
                for (const [colIdx, filter] of Object.entries(colFilters)) {
                    if (!matchFilter(row[parseInt(colIdx)], filter)) {
                        matched = false;
                        break;
                    }
                }
                if (!matched) return;
            }
            visibleCount++;
            const tr = document.createElement('tr');
            // 勾选框
            const tdCb = document.createElement('td');
            tdCb.style.cssText = 'width:30px;text-align:center;padding:3px 2px';
            tdCb.innerHTML = `<input type="checkbox" class="data-row-cb accent-red-500" data-row-idx="${rowIdx}">`;
            tdCb.onclick = (e) => e.stopPropagation();
            tr.appendChild(tdCb);
            row.forEach((cell, colIdx) => {
                const td = document.createElement('td');
                if (cell === null || cell === undefined) {
                    td.textContent = 'NULL';
                    td.className = 'cell-null';
                } else {
                    td.textContent = String(cell);
                }
                td.title = String(cell ?? 'NULL');
                td.dataset.row = rowIdx;
                td.dataset.col = colIdx;

                // 双击编辑（仅可编辑表）— 弹窗方式
                if (isEditable) {
                    td.ondblclick = (e) => {
                        e.stopPropagation();
                        openCellEditModal(td, rowIdx, colIdx, cell, row);
                    };
                }

                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        // 同步列可见性
        applyColVisibility();
    }
    renderRows();

    // 应用列可见性到 thead + tbody
    function applyColVisibility() {
        const allThs = headerRow.children;
        columns.forEach((_, i) => {
            const domIdx = i + 1;
            const vis = colVisible[i] ? '' : 'none';
            if (allThs[domIdx]) allThs[domIdx].style.display = vis;
            tbody.querySelectorAll('tr').forEach(tr => {
                if (tr.children[domIdx]) tr.children[domIdx].style.display = vis;
            });
        });
    }

    // 渲染筛选标签到结果信息栏
    function renderFilterTags() {
        const infoEl = document.getElementById(`sql-result-info-${tabId}`);
        if (!infoEl) return;
        // 找到或创建筛选标签容器
        let tagsContainer = infoEl.querySelector('.col-filter-tags');
        if (!tagsContainer) {
            tagsContainer = document.createElement('span');
            tagsContainer.className = 'col-filter-tags';
            tagsContainer.style.cssText = 'display:inline-flex;gap:4px;flex-wrap:wrap;margin-left:8px;';
            const firstSpan = infoEl.querySelector('span');
            if (firstSpan) firstSpan.appendChild(tagsContainer);
        }
        tagsContainer.innerHTML = '';
        for (const [colIdx, filter] of Object.entries(colFilters)) {
            const colName = columns[parseInt(colIdx)];
            const label = filter.op === 'custom'
                ? `${colName} ${filter.value}`
                : filter.op === 'IS NULL' || filter.op === 'IS NOT NULL'
                    ? `${colName} ${filter.op}`
                    : `${colName} ${filter.op} '${filter.value}'`;
            const tag = document.createElement('span');
            tag.className = 'col-filter-tag';
            tag.innerHTML = `${escapeHtml(label)} <span class="col-filter-tag-x" data-col-idx="${colIdx}">&times;</span>`;
            tag.querySelector('.col-filter-tag-x').onclick = (e) => {
                e.stopPropagation();
                delete colFilters[colIdx];
                renderRows();
                renderFilterTags();
            };
            tagsContainer.appendChild(tag);
        }
    }

    // 更新全局筛选上下文，供外部回调使用
    _activeColFilter.colFilters = colFilters;
    _activeColFilter.renderRows = renderRows;
    _activeColFilter.renderFilterTags = renderFilterTags;
    _activeColFilter.columns = columns;

    // 右键列头筛选浮层菜单
    function showColFilterMenu(e, colIdx, colName) {
        _activeColFilter.filterColIdx = colIdx;
        document.querySelectorAll('.col-filter-menu').forEach(m => m.remove());

        const menu = document.createElement('div');
        menu.className = 'context-menu col-filter-menu';
        menu.style.minWidth = '180px';
        menu.innerHTML = `
            <div class="context-menu-item context-filter-header" style="color:#6b7280;font-size:11px;cursor:default;border-bottom:1px solid #2a2a4a;margin-bottom:2px;padding-bottom:6px">
                筛选: ${escapeHtml(colName)}
            </div>
            <div class="col-filter-row" style="padding:5px 10px">
                <select class="col-filter-op-select" style="width:100%;background:#12122a;border:1px solid #2a2a4a;color:#c0c0d0;font-size:11px;padding:2px 4px;border-radius:3px;outline:none">
                    <option value="LIKE">LIKE</option>
                    <option value="=">= 等于</option>
                    <option value="!=">!= 不等于</option>
                    <option value=">">> 大于</option>
                    <option value="<">< 小于</option>
                    <option value=">=">>= 大于等于</option>
                    <option value="<="><= 小于等于</option>
                    <option value="IS NULL">IS NULL</option>
                    <option value="IS NOT NULL">IS NOT NULL</option>
                    <option value="custom">自定义表达式</option>
                </select>
            </div>
            <div class="col-filter-row col-filter-value-row" style="padding:2px 10px">
                <input class="col-filter-value-input" type="text" placeholder="%关键词%" style="width:100%;background:#12122a;border:1px solid #2a2a4a;color:#c0c0d0;font-size:11px;padding:3px 6px;border-radius:3px;outline:none;font-family:Consolas,monospace">
            </div>
            <div style="display:flex;gap:4px;padding:4px 10px;justify-content:flex-end">
                <button class="col-filter-btn-clear" style="background:transparent;border:1px solid #2a2a4a;color:#e6a23c;font-size:11px;padding:2px 8px;border-radius:3px;cursor:pointer">清除</button>
                <button class="col-filter-btn-ok" style="background:#e94560;border:none;color:white;font-size:11px;padding:2px 10px;border-radius:3px;cursor:pointer">筛选</button>
            </div>
        `;

        const opSelect = menu.querySelector('.col-filter-op-select');
        const valueRow = menu.querySelector('.col-filter-value-row');
        const valueInput = menu.querySelector('.col-filter-value-input');

        // 恢复已有筛选
        const existing = colFilters[colIdx];
        if (existing) {
            opSelect.value = existing.op;
            if (existing.op !== 'IS NULL' && existing.op !== 'IS NOT NULL') {
                valueInput.value = existing.value;
            }
        }

        function toggleValue() {
            const op = opSelect.value;
            valueRow.style.display = (op === 'IS NULL' || op === 'IS NOT NULL') ? 'none' : '';
            if (op === 'custom') valueInput.placeholder = 'JS 表达式，如 n>100';
            else if (op === 'LIKE') valueInput.placeholder = '%关键词%';
            else valueInput.placeholder = '输入值';
        }
        opSelect.onchange = toggleValue;
        toggleValue();

        // 定位菜单（防止超出屏幕）
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';
        document.body.appendChild(menu);
        // 修正溢出
        requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            if (rect.right > window.innerWidth) menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
            if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';
        });

        // 筛选按钮
        menu.querySelector('.col-filter-btn-ok').onclick = () => {
            const op = opSelect.value;
            const value = valueInput.value;
            if (op !== 'IS NULL' && op !== 'IS NOT NULL' && op !== 'custom' && !value) {
                menu.remove();
                return;
            }
            colFilters[colIdx] = { op, value };
            renderRows();
            renderFilterTags();
            menu.remove();
        };

        // 清除按钮
        menu.querySelector('.col-filter-btn-clear').onclick = () => {
            delete colFilters[colIdx];
            renderRows();
            renderFilterTags();
            menu.remove();
        };

        // 输入框回车确认
        valueInput.onkeydown = (ev) => {
            if (ev.key === 'Enter') menu.querySelector('.col-filter-btn-ok').click();
        };

        // 点击其他地方关闭
        setTimeout(() => {
            document.addEventListener('mousedown', function close(ev) {
                if (!menu.contains(ev.target)) {
                    menu.remove();
                    document.removeEventListener('mousedown', close);
                }
            });
        }, 10);

        // 聚焦输入框
        setTimeout(() => valueInput.focus(), 50);
    }

    wrapper.innerHTML = '';
    wrapper.appendChild(table);
    // 存储列可见性上下文，供 showColumnVisibilityPopup 使用
    wrapper._colVisCtx = { colVisible, columns, headerRow, tbody, commentMap, applyColVisibility };

    // 更新保存按钮状态
    refreshSaveBtn();

    // 在信息栏添加"视图"按钮（控制列显示/隐藏）
    const infoBar = document.getElementById(`sql-result-info-${tabId}`);
    if (infoBar) {
        let actions = infoBar.querySelector('.result-info-actions');
        if (!actions) {
            actions = document.createElement('span');
            actions.className = 'result-info-actions flex items-center gap-2';
            infoBar.appendChild(actions);
            infoBar.style.display = 'flex';
            infoBar.style.alignItems = 'center';
            infoBar.style.justifyContent = 'space-between';
        }
        const viewBtn = document.createElement('button');
        viewBtn.id = `data-view-${tabId}`;
        viewBtn.className = 'text-xs px-3 py-0.5 rounded border border-border hover:border-accent-light hover:text-accent-light';
        viewBtn.textContent = '视图';
        viewBtn.onclick = () => showColumnVisibilityPopup(tabId);
        actions.appendChild(viewBtn);
    }

    // ---- 单元格编辑弹窗 ----
    function openCellEditModal(td, rowIdx, colIdx, originalValue, row) {
        const colName = columns[colIdx];
        const comment = commentMap[colName] || '';

        // 构建定位条件
        const whereParts = pkColIndices.map(pkIdx => {
            return `\`${columns[pkIdx]}\` = ${sqlVal(row[pkIdx])}`;
        });
        const whereStr = whereParts.join(' AND ');

        // 填充弹窗信息
        $('#cell-edit-table').textContent = tableName;
        $('#cell-edit-column').textContent = comment ? `${colName} (${comment})` : colName;
        $('#cell-edit-where').textContent = whereStr;
        $('#cell-edit-where').title = whereStr;
        $('#cell-edit-old').textContent = originalValue === null ? 'NULL' : String(originalValue);

        const newInput = $('#cell-edit-new');
        newInput.value = originalValue === null ? '' : String(originalValue);
        const nullCheckbox = $('#cell-edit-null');
        nullCheckbox.checked = (originalValue === null);

        newInput.oninput = () => {};
        nullCheckbox.onchange = () => {
            newInput.disabled = nullCheckbox.checked;
        };
        newInput.disabled = nullCheckbox.checked;

        openModal('modal-cell-edit');
        setTimeout(() => newInput.focus(), 100);

        // 确认按钮 — 执行 SQL
        $('#btn-cell-edit-ok').onclick = async () => {
            const isNull = nullCheckbox.checked;
            const newVal = isNull ? null : newInput.value.trim() || null;
            const sql = `UPDATE \`${tableName}\` SET \`${colName}\` = ${sqlVal(newVal)} WHERE ${whereStr};`;

            closeModal('modal-cell-edit');
            try {
                const result = await api('POST', `/api/connections/${state.currentConnId}/sql`, {
                    sql: sql, confirmed: true,
                });
                // 更新本地数据
                rows[rowIdx][colIdx] = newVal;
                renderRows();
            } catch (e) {
                alert('修改失败: ' + e.message);
            }
        };
        $('#btn-cell-edit-cancel').onclick = () => closeModal('modal-cell-edit');
    }

    function refreshSaveBtn() {
        // 无需批量保存按钮了（每次双击直接弹窗执行）
    }

    async function saveCellEdits() {
        // 保留接口兼容，实际逻辑已在弹窗中处理
    }
}

// 保存成功回调
let pendingConfirmOnSuccess = null;

// 修改原有确认执行，加入成功回调
async function confirmExecuteSql() {
    closeModal('modal-confirm');
    if (!pendingConfirmSql || !pendingConfirmTabId) return;

    try {
        const result = await api('POST', `/api/connections/${state.currentConnId}/sql`, {
            sql: pendingConfirmSql,
            confirmed: true,
        });
        renderSqlResult(pendingConfirmTabId, result);
        if (pendingConfirmOnSuccess) pendingConfirmOnSuccess();
    } catch (e) {
        renderSqlError(pendingConfirmTabId, e.message);
    }
    pendingConfirmTabId = null;
    pendingConfirmSql = null;
    pendingConfirmOnSuccess = null;
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

        // 顶部操作栏
        const toolbar = document.createElement('div');
        toolbar.className = 'flex items-center gap-2 px-3 py-1.5 border-b border-border bg-bg-light text-xs';
        toolbar.innerHTML = `
            <label class="flex items-center gap-1 text-muted cursor-pointer">
                <input type="checkbox" id="history-select-all-${tabId}" class="accent-red-500"> 全选
            </label>
            <button id="history-ask-ai-${tabId}" class="bg-primary hover:bg-red-500 text-white text-xs px-3 py-1 rounded ml-auto">问 AI</button>
        `;
        wrapper.appendChild(toolbar);

        const list = document.createElement('div');
        wrapper.appendChild(list);

        records.forEach(r => {
            const div = document.createElement('div');
            div.className = 'flex items-start gap-2 px-3 py-2 border-b border-border hover:bg-bg-lighter text-xs';
            div.innerHTML = `
                <input type="checkbox" class="history-cb accent-red-500 mt-0.5 shrink-0" data-sql="${escapeHtml(r.sql)}">
                <div class="flex-1 min-w-0 cursor-pointer">
                    <div class="font-mono truncate">${escapeHtml(r.sql)}</div>
                    <div class="text-muted mt-0.5">${r.executed_at || ''} | ${r.rows_affected}行${r.error_message ? ' | ' + escapeHtml(r.error_message) : ''}</div>
                </div>
            `;
            // 点击内容区域填充到编辑器
            div.querySelector('.flex-1').onclick = () => {
                const tab = state.tabs.find(t => t.id === tabId);
                if (tab && tab.editor) {
                    tab.editor.setValue(r.sql);
                }
            };
            list.appendChild(div);
        });

        // 全选
        wrapper.querySelector(`#history-select-all-${tabId}`).onchange = (e) => {
            list.querySelectorAll('.history-cb').forEach(cb => cb.checked = e.target.checked);
        };

        // 问 AI
        wrapper.querySelector(`#history-ask-ai-${tabId}`).onclick = () => {
            const checked = list.querySelectorAll('.history-cb:checked');
            if (checked.length === 0) {
                alert('请先勾选要提问的 SQL');
                return;
            }
            const sqls = Array.from(checked).map(cb => cb.dataset.sql);
            sendHistoryToAi(sqls);
        };

        updateResultInfo(tabId, `历史记录 (${records.length} 条)`);
    } catch (e) {
        alert('加载历史失败: ' + e.message);
    }
}

function sendHistoryToAi(sqls, meta = {}) {
    // 确保 AI tab 存在
    let aiTab = state.tabs.find(t => t.type === 'ai');
    const alreadyActive = aiTab && state.activeTabId === aiTab.id;
    if (!aiTab) {
        createAiTab();
        aiTab = state.tabs.find(t => t.type === 'ai');
    }
    if (!aiTab) return;

    if (!alreadyActive) {
        activateTab(aiTab.id);
    }

    const delay = alreadyActive ? 0 : 80;
    setTimeout(() => {
        const input = document.getElementById(`chat-input-${aiTab.id}`);
        if (!input) return;
        input.focus();

        // 创建 SQL 标签并插入
        sqls.forEach(sql => {
            const tag = createSqlTagElement(sql);
            // 附加元数据
            if (meta.table) tag.dataset.table = meta.table;
            if (meta.type) tag.dataset.tagType = meta.type;
            // 尝试在光标位置插入
            const sel = window.getSelection();
            let inserted = false;
            if (sel.rangeCount) {
                const range = sel.getRangeAt(0);
                if (input.contains(range.commonAncestorContainer)) {
                    range.insertNode(tag);
                    range.collapse(false);
                    inserted = true;
                }
            }
            if (!inserted) {
                input.appendChild(tag);
            }
            // 标签后加空格分隔
            const sp = document.createTextNode('\u00A0');
            tag.after(sp);
        });

        // 光标移到末尾
        const sel = window.getSelection();
        const newRange = document.createRange();
        newRange.selectNodeContents(input);
        newRange.collapse(false);
        sel.removeAllRanges();
        sel.addRange(newRange);
    }, delay);
}

function createSqlTagElement(sql) {
    const tag = document.createElement('span');
    tag.className = 'sql-tag';
    tag.contentEditable = 'false';
    tag.draggable = true;
    tag.dataset.sql = sql;
    tag.title = sql;

    const label = document.createElement('span');
    label.className = 'sql-label';
    label.textContent = sql.length > 50 ? sql.substring(0, 50) + '...' : sql;
    tag.appendChild(label);

    const removeBtn = document.createElement('span');
    removeBtn.className = 'tag-remove';
    removeBtn.textContent = '×';
    removeBtn.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };
    removeBtn.onclick = (e) => {
        e.stopPropagation();
        tag.remove();
    };
    tag.appendChild(removeBtn);

    // 拖拽
    tag.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', 'sql-tag');
        e.dataTransfer.setData('application/sql-tag', sql);
        tag.classList.add('dragging');
    });
    tag.addEventListener('dragend', () => {
        tag.classList.remove('dragging');
    });

    return tag;
}

// ==================== AI 对话 ====================

/** 从 contenteditable 输入框提取消息文本（标签转 `table_name`） */
function extractChatInput(div) {
    let text = '';
    div.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList && node.classList.contains('table-tag')) {
                text += `【表名: ${node.dataset.table}】`;
            } else if (node.classList && node.classList.contains('sql-tag')) {
                const tagType = node.dataset.tagType;
                const tagTable = node.dataset.table;
                const sql = node.dataset.sql;
                if (tagType === 'data') {
                    text += `{表: ${tagTable || '未知'}, 数据: ${sql}}`;
                } else {
                    text += `(SQL: ${sql})`;
                }
            } else if (node.tagName === 'BR') {
                text += '\n';
            } else {
                text += extractChatInput(node);
            }
        }
    });
    return text;
}

async function sendAiMessage(tabId) {
    const tab = state.tabs.find(t => t.id === tabId);
    if (!tab || tab.type !== 'ai') return;

    const input = document.getElementById(`chat-input-${tabId}`);
    const message = extractChatInput(input).trim();
    if (!message || !state.currentConnId) {
        if (!state.currentConnId) alert('请先选择数据库连接');
        return;
    }

    input.innerHTML = '';

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
                        let toolDiv;
                        if (data.tool === 'http_request') {
                            // 渲染为 HTTP 请求卡片
                            try {
                                const input = typeof data.input === 'string' ? JSON.parse(data.input) : data.input;
                                const method = input.method || 'GET';
                                const methodLower = method.toLowerCase();
                                toolDiv = document.createElement('div');
                                toolDiv.className = 'http-request-card';
                                toolDiv.innerHTML = `
                                    <div class="card-header">
                                        <span class="card-method method-${methodLower}">${method}</span>
                                        <span class="card-url">${escapeHtml(input.url || '')}</span>
                                        <span class="text-xs text-muted">⏳ 发送中...</span>
                                    </div>
                                    ${input.body ? `<div class="card-body">${escapeHtml(typeof input.body === 'string' ? input.body : JSON.stringify(input.body)).substring(0, 200)}</div>` : ''}
                                `;
                            } catch (e) {
                                toolDiv = document.createElement('div');
                                toolDiv.className = 'tool-call';
                                toolDiv.innerHTML = `🚀 <span style="color:#fcd34d">调用接口</span>: ${escapeHtml(String(data.input).substring(0, 200))}`;
                            }
                        } else if (data.tool === 'save_api_request') {
                            toolDiv = document.createElement('div');
                            toolDiv.className = 'tool-call';
                            toolDiv.innerHTML = `💾 <span style="color:#6ee7b7">保存接口</span>`;
                        } else {
                            toolDiv = document.createElement('div');
                            toolDiv.className = 'tool-call';
                            toolDiv.textContent = `🔧 调用工具: ${data.tool}`;
                        }
                        aiBubble.appendChild(toolDiv);
                        messagesEl.scrollTop = messagesEl.scrollHeight;
                    } else if (data.type === 'tool_end') {
                        if (data.tool === 'http_request') {
                            // 更新最后一个 HTTP 卡片状态
                            const cards = aiBubble.querySelectorAll('.http-request-card');
                            const lastCard = cards[cards.length - 1];
                            if (lastCard) {
                                const output = data.output || '';
                                // 尝试解析状态码
                                const statusMatch = output.match(/状态码:\s*(\d+)/);
                                const elapsedMatch = output.match(/耗时:\s*(\d+)ms/);
                                if (statusMatch) {
                                    const status = parseInt(statusMatch[1]);
                                    const statusColor = status < 300 ? '#6ee7b7' : status < 400 ? '#fcd34d' : '#fca5a5';
                                    const statusText = status < 300 ? '✅' : status < 500 ? '⚠️' : '❌';
                                    const headerDiv = lastCard.querySelector('.card-header');
                                    if (headerDiv) {
                                        const statusSpan = headerDiv.querySelector('.text-muted:last-child');
                                        if (statusSpan) {
                                            statusSpan.innerHTML = `${statusText} ${status} · ${elapsedMatch ? elapsedMatch[1] + 'ms' : ''}`;
                                            statusSpan.style.color = statusColor;
                                        }
                                    }
                                }
                            }
                        }
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

    // 自动保存会话
    autoSaveSession();
}

function appendChatBubble(container, role, content) {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    bubble.innerHTML = role === 'user' ? escapeHtml(content) : formatMarkdown(content);
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
}

function formatMarkdown(text) {
    if (!text) return '';
    if (typeof marked !== 'undefined') {
        return marked.parse(text, { breaks: true });
    }
    // 降级：简单处理
    return escapeHtml(text).replace(/\n/g, '<br>');
}

// ==================== AI 配置（多提供商） ====================
async function loadAiConfig() {
    await loadProviders();
}

async function loadProviders() {
    try {
        const providers = await api('GET', '/api/ai/providers');
        renderProviderList(providers);
        renderProviderSelector(providers);
    } catch (e) {
        console.error('加载AI提供商失败:', e);
    }
}

function renderProviderSelector(providers) {
    const select = $('#ai-provider-select');
    const activeId = providers.find(p => p.is_active)?.id;
    select.innerHTML = '';
    if (providers.length === 0) {
        select.innerHTML = '<option value="">未配置 AI</option>';
        return;
    }
    providers.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.name} / ${p.model}`;
        opt.selected = p.is_active;
        select.appendChild(opt);
    });
    // 切换提供商
    select.onchange = async () => {
        const id = parseInt(select.value);
        if (!id) return;
        try {
            await api('POST', `/api/ai/providers/${id}/activate`);
            await loadProviders();
        } catch (e) {
            alert('切换失败: ' + e.message);
        }
    };
}

function renderProviderList(providers) {
    const container = $('#provider-list');
    container.innerHTML = '';
    if (providers.length === 0) {
        container.innerHTML = '<div class="text-muted text-xs text-center py-4">暂无 AI 提供商，请添加</div>';
        return;
    }
    providers.forEach(p => {
        const div = document.createElement('div');
        div.className = `flex items-center gap-2 p-2 rounded border ${p.is_active ? 'border-primary bg-primary/5' : 'border-border bg-bg'}`;
        div.innerHTML = `
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                    <span class="text-sm font-medium ${p.is_active ? 'text-primary' : 'text-gray-300'}">${escapeHtml(p.name)}</span>
                    ${p.is_active ? '<span class="text-[10px] bg-primary/20 text-primary px-1.5 rounded">使用中</span>' : ''}
                </div>
                <div class="text-xs text-muted mt-0.5 truncate">${escapeHtml(p.model)} · ${escapeHtml(p.api_key)}</div>
            </div>
            <div class="flex gap-1 shrink-0">
                ${!p.is_active ? `<button onclick="activateProvider(${p.id})" class="text-xs px-2 py-1 rounded border border-border hover:border-accent-light hover:text-accent-light text-muted" title="切换到此模型">使用</button>` : ''}
                <button onclick="editProvider(${p.id})" class="text-xs px-2 py-1 rounded border border-border hover:border-muted text-muted" title="编辑">编辑</button>
                <button onclick="deleteProvider(${p.id})" class="text-xs px-2 py-1 rounded border border-border hover:border-red-500 hover:text-red-400 text-muted" title="删除">删除</button>
            </div>
        `;
        container.appendChild(div);
    });
}

async function activateProvider(id) {
    try {
        await api('POST', `/api/ai/providers/${id}/activate`);
        await loadProviders();
    } catch (e) {
        alert('切换失败: ' + e.message);
    }
}

function editProvider(id) {
    // 从列表中找到数据填充表单
    const container = $('#provider-list');
    const providers = []; // we'll reload
    api('GET', '/api/ai/providers').then(providers => {
        const p = providers.find(x => x.id === id);
        if (!p) return;
        $('#provider-edit-id').value = p.id;
        $('#provider-name').value = p.name;
        $('#provider-base-url').value = p.base_url;
        $('#provider-api-key').value = ''; // 不回显完整 key
        $('#provider-api-key').placeholder = p.api_key || '不修改请留空';
        $('#provider-model').value = p.model;
        $('#provider-temperature').value = p.temperature;
        $('#provider-form-title').textContent = '编辑 AI 提供商';
        $('#btn-cancel-provider').classList.remove('hidden');
    });
}

async function deleteProvider(id) {
    if (!confirm('确认删除此 AI 提供商？')) return;
    try {
        await api('DELETE', `/api/ai/providers/${id}`);
        resetProviderForm();
        await loadProviders();
    } catch (e) {
        alert('删除失败: ' + e.message);
    }
}

function resetProviderForm() {
    $('#provider-edit-id').value = '';
    $('#provider-name').value = '';
    $('#provider-base-url').value = '';
    $('#provider-api-key').value = '';
    $('#provider-api-key').placeholder = 'sk-...';
    $('#provider-model').value = '';
    $('#provider-temperature').value = '0';
    $('#provider-form-title').textContent = '添加 AI 提供商';
    $('#btn-cancel-provider').classList.add('hidden');
}

async function saveProvider() {
    const editId = $('#provider-edit-id').value;
    const data = {
        name: $('#provider-name').value.trim(),
        base_url: $('#provider-base-url').value.trim(),
        model: $('#provider-model').value.trim(),
        temperature: parseFloat($('#provider-temperature').value) || 0,
    };
    const apiKey = $('#provider-api-key').value.trim();
    if (apiKey) data.api_key = apiKey;

    if (!data.name || !data.base_url || !data.model) {
        alert('请填写提供商名称、API Base URL 和模型名称');
        return;
    }

    try {
        if (editId) {
            await api('PUT', `/api/ai/providers/${editId}`, data);
        } else {
            if (!apiKey) {
                alert('新建提供商时 API Key 不能为空');
                return;
            }
            data.api_key = apiKey;
            await api('POST', '/api/ai/providers', data);
        }
        resetProviderForm();
        await loadProviders();
    } catch (e) {
        alert('保存失败: ' + e.message);
    }
}

// ==================== AI 会话管理 ====================

function toggleSessionSidebar() {
    state.sessionSidebarOpen = !state.sessionSidebarOpen;
    const aiTab = state.tabs.find(t => t.type === 'ai');
    if (!aiTab) return;
    const sidebar = document.getElementById(`session-sidebar-${aiTab.id}`);
    if (sidebar) sidebar.classList.toggle('collapsed', !state.sessionSidebarOpen);
}

async function loadSessionList(tabId) {
    try {
        const sessions = await api('GET', '/api/ai/sessions');
        const list = document.getElementById(`session-list-${tabId}`);
        if (!list) return;
        list.innerHTML = '';
        if (sessions.length === 0) {
            list.innerHTML = '<div class="text-muted text-center py-4 text-xs">暂无会话记录</div>';
            return;
        }
        sessions.forEach(s => {
            const div = document.createElement('div');
            div.className = `session-item ${s.id === state.currentSessionId ? 'active' : ''}`;
            div.innerHTML = `
                <span class="session-title" title="${escapeHtml(s.title)}">${escapeHtml(s.title)}</span>
                <span class="session-del" title="删除">&times;</span>
            `;
            div.querySelector('.session-title').onclick = () => loadSession(s.id);
            div.querySelector('.session-del').onclick = (e) => {
                e.stopPropagation();
                deleteSession(s.id);
            };
            list.appendChild(div);
        });
    } catch (e) {
        console.error('加载会话列表失败:', e);
    }
}

async function newSession(tabId) {
    try {
        const s = await api('POST', '/api/ai/sessions');
        state.currentSessionId = s.id;
        const aiTab = state.tabs.find(t => t.type === 'ai');
        if (aiTab) {
            aiTab.chatHistory = [];
            const msgs = document.getElementById(`chat-messages-${aiTab.id}`);
            if (msgs) msgs.innerHTML = '';
        }
        await loadSessionList(tabId || aiTab?.id);
    } catch (e) {
        alert('创建会话失败: ' + e.message);
    }
}

async function loadSession(sessionId) {
    try {
        const s = await api('GET', `/api/ai/sessions/${sessionId}`);
        state.currentSessionId = sessionId;
        const aiTab = state.tabs.find(t => t.type === 'ai');
        if (!aiTab) return;
        aiTab.chatHistory = s.messages || [];
        const msgs = document.getElementById(`chat-messages-${aiTab.id}`);
        if (msgs) {
            msgs.innerHTML = '';
            aiTab.chatHistory.forEach(msg => appendChatBubble(msgs, msg.role, msg.content));
            msgs.scrollTop = msgs.scrollHeight;
        }
        await loadSessionList(aiTab.id);
    } catch (e) {
        alert('加载会话失败: ' + e.message);
    }
}

async function deleteSession(sessionId) {
    if (!confirm('确认删除此会话？')) return;
    try {
        await api('DELETE', `/api/ai/sessions/${sessionId}`);
        if (state.currentSessionId === sessionId) {
            state.currentSessionId = null;
            const aiTab = state.tabs.find(t => t.type === 'ai');
            if (aiTab) {
                aiTab.chatHistory = [];
                const msgs = document.getElementById(`chat-messages-${aiTab.id}`);
                if (msgs) msgs.innerHTML = '';
            }
        }
        const aiTab = state.tabs.find(t => t.type === 'ai');
        if (aiTab) await loadSessionList(aiTab.id);
    } catch (e) {
        alert('删除失败: ' + e.message);
    }
}

async function autoSaveSession() {
    const aiTab = state.tabs.find(t => t.type === 'ai');
    if (!aiTab || aiTab.chatHistory.length === 0) return;

    if (!state.currentSessionId) {
        try {
            const s = await api('POST', '/api/ai/sessions');
            state.currentSessionId = s.id;
            const firstMsg = aiTab.chatHistory.find(m => m.role === 'user');
            const title = firstMsg ? firstMsg.content.substring(0, 50) : '新会话';
            await api('PUT', `/api/ai/sessions/${s.id}/save`, { title, messages: aiTab.chatHistory });
            await loadSessionList(aiTab.id);
        } catch (e) {
            console.error('自动创建会话失败:', e);
        }
        return;
    }

    try {
        await api('PUT', `/api/ai/sessions/${state.currentSessionId}/save`, { messages: aiTab.chatHistory });
    } catch (e) {
        console.error('保存会话失败:', e);
    }
}

// ==================== 侧边栏拖拽调整宽度 ====================
function initSidebarResize() {
    const sidebar = $('#sidebar');
    const resizer = $('#sidebar-resizer');
    if (!sidebar || !resizer) return;

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    resizer.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = sidebar.offsetWidth;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;
        const diff = e.clientX - startX;
        const newWidth = Math.min(Math.max(startWidth + diff, 160), 480);
        sidebar.style.width = newWidth + 'px';
    });

    document.addEventListener('mouseup', () => {
        if (!isResizing) return;
        isResizing = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
}

// ==================== 表名标签插入 AI 输入框 ====================

/** 创建一个表名标签 pill 元素 */
function createTableTagElement(tableName) {
    const tag = document.createElement('span');
    tag.className = 'table-tag';
    tag.contentEditable = 'false';
    tag.draggable = 'true';
    tag.dataset.table = tableName;

    const label = document.createElement('span');
    label.textContent = tableName;
    tag.appendChild(label);

    const removeBtn = document.createElement('span');
    removeBtn.className = 'tag-remove';
    removeBtn.textContent = '×';
    removeBtn.onmousedown = (e) => {
        e.preventDefault();
        e.stopPropagation();
    };
    removeBtn.onclick = (e) => {
        e.stopPropagation();
        tag.remove();
    };
    tag.appendChild(removeBtn);

    // 拖拽开始
    tag.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', 'table-tag');
        e.dataTransfer.setData('application/table-tag', tableName);
        tag.classList.add('dragging');
    });
    tag.addEventListener('dragend', () => {
        tag.classList.remove('dragging');
    });

    return tag;
}

/** 左键单击表名：将表名以标签形式插入 AI 对话输入框 */
function insertTableTagIntoAi(tableName) {
    // 确保存在 AI tab
    let aiTab = state.tabs.find(t => t.type === 'ai');
    const needSwitch = !aiTab;
    if (!aiTab) {
        createAiTab();
        aiTab = state.tabs.find(t => t.type === 'ai');
    }
    if (!aiTab) return;

    // 如果 AI tab 已经是当前活动 tab，不重建面板（保留已输入内容）
    const alreadyActive = (state.activeTabId === aiTab.id);
    if (!alreadyActive) {
        activateTab(aiTab.id);
    }

    const delay = alreadyActive ? 0 : 60;
    setTimeout(() => {
        const input = document.getElementById(`chat-input-${aiTab.id}`);
        if (!input) return;
        input.focus();

        const tag = createTableTagElement(tableName);

        // 尝试在光标位置插入，否则追加到末尾
        const sel = window.getSelection();
        let inserted = false;
        if (sel.rangeCount) {
            const range = sel.getRangeAt(0);
            if (input.contains(range.commonAncestorContainer)) {
                range.insertNode(tag);
                // 光标移到标签后
                const afterRange = document.createRange();
                afterRange.setStartAfter(tag);
                afterRange.collapse(true);
                sel.removeAllRanges();
                sel.addRange(afterRange);
                inserted = true;
            }
        }
        if (!inserted) {
            input.appendChild(tag);
        }

        // 标签后加一个空格，方便继续输入
        const space = document.createTextNode('\u00A0');
        tag.after(space);
    }, 60);
}
