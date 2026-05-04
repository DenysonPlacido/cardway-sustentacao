'use strict';

let rows = [{ aux1: '', aux2: '' }, { aux1: '', aux2: '' }, { aux1: '', aux2: '' }];
let sqlGerado = '';
let mapSelecionadoId = '';

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  carregarTipos();
  carregarMapeamentos();
  renderTabela();
  setupDropzone();
  setupTabs();

  document.getElementById('tipo-sel').addEventListener('change', aplicarTipo);
});

// ── Tipos ─────────────────────────────────────────────────────────────────────
async function carregarTipos() {
  const tipos = await fetch('/api/tipos').then(r => r.json());
  const sel = document.getElementById('tipo-sel');
  tipos.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.nome;
    opt.dataset.tipo = JSON.stringify(t);
    sel.appendChild(opt);
  });
}

function aplicarTipo() {
  const sel = document.getElementById('tipo-sel');
  const opt = sel.options[sel.selectedIndex];
  if (!opt.dataset.tipo) return;
  const t = JSON.parse(opt.dataset.tipo);
  document.getElementById('tipo-trn').value   = t.tipo_transacao_id;
  document.getElementById('natureza').value   = t.natureza;
  document.getElementById('modalidade').value = t.modalidade;
  document.getElementById('impacto').value    = t.impacto_limite;
  document.getElementById('envia-fila').value = t.envia_fila;
  document.getElementById('canal').value      = t.canal_venda;
  document.getElementById('quantidade').value = t.quantidade;
}

// ── Mapeamentos ───────────────────────────────────────────────────────────────
async function carregarMapeamentos() {
  const mapas = await fetch('/api/mapeamentos').then(r => r.json());
  const sel = document.getElementById('map-sel');
  mapas.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.nome;
    sel.appendChild(opt);
  });
  sel.addEventListener('change', () => { mapSelecionadoId = sel.value; });
}

// ── Dropzone ──────────────────────────────────────────────────────────────────
function setupDropzone() {
  const dz = document.getElementById('dropzone');
  const fi = document.getElementById('file-input');

  dz.addEventListener('click', () => fi.click());
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault();
    dz.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) processarArquivo(e.dataTransfer.files[0]);
  });
  fi.addEventListener('change', () => { if (fi.files[0]) processarArquivo(fi.files[0]); });
}

async function processarArquivo(file) {
  const fd = new FormData();
  fd.append('arquivo', file);
  if (mapSelecionadoId) fd.append('mapeamento_id', mapSelecionadoId);

  const res = await fetch('/api/parse', { method: 'POST', body: fd });
  const data = await res.json();

  if (data.erro) {
    mostrarInfo(document.getElementById('import-info'), data.erro, 'error');
    return;
  }

  rows = data.rows;
  renderTabela();
  validarEAtualizar();
  mostrarInfo(document.getElementById('import-info'),
    `✅ ${data.rows.length} registros importados — Estabelecimento: ${data.col_estab} | Valor: ${data.col_valor}`,
    'success');
}

// ── Tabela editável ───────────────────────────────────────────────────────────
function renderTabela() {
  const tbody = document.getElementById('dados-tbody');
  tbody.innerHTML = '';
  rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    tr.dataset.idx = i;
    tr.innerHTML = `
      <td><input type="text" value="${esc(row.aux1)}" oninput="rows[${i}].aux1=this.value;validarEAtualizar()" placeholder="estabelecimento"></td>
      <td><input type="text" value="${esc(row.aux2)}" oninput="rows[${i}].aux2=this.value;validarEAtualizar()" placeholder="valor"></td>
      <td><button class="btn-row-del" onclick="removerLinha(${i})" title="Remover">✕</button></td>
    `;
    tbody.appendChild(tr);
  });
}

function adicionarLinha() {
  rows.push({ aux1: '', aux2: '' });
  renderTabela();
}

function removerLinha(i) {
  rows.splice(i, 1);
  renderTabela();
  validarEAtualizar();
}

function esc(s) {
  return String(s || '').replace(/"/g, '&quot;');
}

// ── Validação ─────────────────────────────────────────────────────────────────
async function validarEAtualizar() {
  const validas = rows.filter(r => String(r.aux1).trim());
  if (!validas.length) { document.getElementById('stat-row').style.display = 'none'; return; }

  const res = await fetch('/api/validar', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows: validas }),
  });
  const v = await res.json();

  // colorir linhas
  const tbody = document.getElementById('dados-tbody');
  tbody.querySelectorAll('tr').forEach((tr, i) => {
    tr.classList.remove('row-err', 'row-warn');
    const r = rows[i];
    if (!String(r?.aux1 || '').trim()) return;
  });

  // atualizar stat bar
  const sr = document.getElementById('stat-row');
  sr.style.display = 'flex';
  sr.innerHTML = `
    <div class="stat-item"><div class="s-label">Total</div><div class="s-val">${v.total}</div></div>
    <div class="stat-item s-ok"><div class="s-label">Válidos</div><div class="s-val">${v.ok}</div></div>
    <div class="stat-item s-warn"><div class="s-label">Avisos</div><div class="s-val">${v.avisos}</div></div>
    <div class="stat-item s-err"><div class="s-label">Erros</div><div class="s-val">${v.erros}</div></div>
  `;
}

// ── Colar do Excel ────────────────────────────────────────────────────────────
function importarColagem() {
  const texto = document.getElementById('paste-area').value.trim();
  if (!texto) { alert('Cole algum dado antes de importar.'); return; }
  rows = texto.split('\n')
    .filter(l => l.trim())
    .map(l => {
      const partes = l.split(/[\t;]/);
      return { aux1: (partes[0] || '').trim(), aux2: (partes[1] || '').trim() };
    });
  renderTabela();
  validarEAtualizar();
  mostrarInfo(document.getElementById('import-info'), `✅ ${rows.length} registros importados da colagem.`, 'success');
}

// ── Config ────────────────────────────────────────────────────────────────────
function getConfig() {
  return {
    glpi:                   document.getElementById('glpi').value.trim(),
    campanha:               document.getElementById('campanha').value.trim(),
    dados_complementares:   document.getElementById('dados-comp').value.trim(),
    tipo_transacao_id:      Number(document.getElementById('tipo-trn').value),
    natureza:               Number(document.getElementById('natureza').value),
    modalidade:             Number(document.getElementById('modalidade').value),
    impacto_limite:         Number(document.getElementById('impacto').value),
    envia_fila:             Number(document.getElementById('envia-fila').value),
    canal_venda:            Number(document.getElementById('canal').value),
    quantidade:             Number(document.getElementById('quantidade').value),
    mapeamento_usado:       document.getElementById('map-sel').value || 'auto',
  };
}

// ── Gerar SQL ─────────────────────────────────────────────────────────────────
async function gerarSQL() {
  const config = getConfig();
  const alertBox = document.getElementById('alert-box');
  setAlert(alertBox, '', '');

  if (!config.glpi) { setAlert(alertBox, 'Informe o número do GLPI.', 'error'); return; }
  const validas = rows.filter(r => String(r.aux1).trim());
  if (!validas.length) { setAlert(alertBox, 'Nenhuma linha com dados para gerar.', 'error'); return; }

  const res = await fetch('/api/gerar/sql', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, rows: validas }),
  });
  const data = await res.json();

  if (data.erro) { setAlert(alertBox, data.erro, 'error'); return; }

  sqlGerado = data.sql;
  setAlert(alertBox, `✅ Script gerado com ${data.total} registro(s).`, 'success');

  const sqlResult = document.getElementById('sql-result');
  sqlResult.innerHTML = `
    <div class="code-block">${esc2(data.sql.slice(0, 4000))}${data.sql.length > 4000 ? '\n...' : ''}</div>
    <div class="form-actions" style="margin-top:10px;">
      <button class="btn btn-secondary" onclick="baixarSQL()">💾 Baixar .sql</button>
    </div>
  `;
}

function baixarSQL() {
  if (!sqlGerado) return;
  const glpi = document.getElementById('glpi').value.trim() || 'sem_glpi';
  const blob = new Blob([sqlGerado], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lanc_cred_lim_global_glpi_${glpi}.sql`;
  a.click();
}

// ── Gerar XLSX ────────────────────────────────────────────────────────────────
async function gerarXLSX() {
  const config = getConfig();
  const alertBox = document.getElementById('alert-box');
  setAlert(alertBox, '', '');

  const validas = rows.filter(r => String(r.aux1).trim());
  if (!validas.length) { setAlert(alertBox, 'Nenhuma linha com dados.', 'error'); return; }

  const res = await fetch('/api/gerar/xlsx', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, rows: validas }),
  });

  if (!res.ok) {
    const data = await res.json();
    setAlert(alertBox, data.erro, 'error');
    return;
  }

  const blob = await res.blob();
  const glpi = config.glpi || 'sem_glpi';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `table_aux_ciso_glpi_${glpi}.xlsx`;
  a.click();
  setAlert(alertBox, `✅ XLSX baixado com ${validas.length} registro(s).`, 'success');
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function mostrarInfo(el, msg, type) {
  el.innerHTML = `<div class="alert alert-${type === 'error' ? 'error' : 'success'}">${msg}</div>`;
}

function setAlert(el, msg, type) {
  if (!msg) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}

function esc2(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
