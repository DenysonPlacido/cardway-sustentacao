'use strict';

let mapData = [];

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  carregarMapeamentos();
});

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

async function carregarMapeamentos() {
  const todos = document.getElementById('chk-inativos').checked;
  mapData = await fetch('/api/mapeamentos' + (todos ? '?todos=1' : '')).then(r => r.json());

  const tbody = document.getElementById('tbody-map');
  tbody.innerHTML = '';
  mapData.forEach(m => {
    const tipo = m.usar_indice ? 'Por índice' : 'Por nome';
    const estab = m.usar_indice ? `idx ${m.indice_estabelecimento}` : (m.coluna_estabelecimento || '—');
    const valor = m.usar_indice ? `idx ${m.indice_valor}` : (m.coluna_valor || '—');
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${m.id}</td>
      <td>${esc(m.nome)}</td>
      <td><span class="badge badge-muted">${tipo}</span></td>
      <td>${esc(estab)}</td>
      <td>${esc(valor)}</td>
      <td><span class="badge ${m.ativo ? 'badge-ok' : 'badge-muted'}">${m.ativo ? 'Sim' : 'Não'}</span></td>
    `;
    tbody.appendChild(tr);
  });

  const sel = document.getElementById('e-sel');
  sel.innerHTML = '<option value="">— Selecione —</option>';
  mapData.forEach(m => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = `[${m.id}] ${m.nome}`;
    opt.dataset.m = JSON.stringify(m);
    sel.appendChild(opt);
  });
  document.getElementById('edit-form').style.display = 'none';
}

// ── Toggle modo novo ──────────────────────────────────────────────────────────
function toggleModoNovo() {
  const idx = document.getElementById('n-usar-idx').checked;
  document.getElementById('n-por-nome').style.display = idx ? 'none' : 'block';
  document.getElementById('n-por-idx').style.display  = idx ? 'block' : 'none';
  document.getElementById('n-modo-label').textContent = idx ? 'Mapear por índice' : 'Mapear por nome de coluna';
}

function toggleModoEdit() {
  const idx = document.getElementById('e-usar-idx').checked;
  document.getElementById('e-por-nome').style.display = idx ? 'none' : 'block';
  document.getElementById('e-por-idx').style.display  = idx ? 'block' : 'none';
  document.getElementById('e-modo-label').textContent = idx ? 'Mapear por índice' : 'Mapear por nome de coluna';
}

// ── CRUD ──────────────────────────────────────────────────────────────────────
async function criarMapeamento() {
  const nome = document.getElementById('n-nome').value.trim();
  const al = document.getElementById('alert-novo');
  if (!nome) { setAlert(al, 'Nome é obrigatório.', 'error'); return; }

  const usarIdx = document.getElementById('n-usar-idx').checked;
  const dados = {
    nome,
    usar_indice: usarIdx ? 1 : 0,
    coluna_estabelecimento: usarIdx ? null : document.getElementById('n-col-estab').value.trim() || null,
    coluna_valor:           usarIdx ? null : document.getElementById('n-col-valor').value.trim() || null,
    indice_estabelecimento: usarIdx ? Number(document.getElementById('n-idx-estab').value) : null,
    indice_valor:           usarIdx ? Number(document.getElementById('n-idx-valor').value) : null,
    descricao: document.getElementById('n-desc').value.trim() || null,
  };

  const res = await fetch('/api/mapeamentos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(dados),
  });
  const data = await res.json();
  if (data.erro) { setAlert(al, data.erro, 'error'); return; }
  setAlert(al, `✅ Mapeamento criado com ID ${data.id}.`, 'success');
  carregarMapeamentos();
}

function preencherEdit() {
  const sel = document.getElementById('e-sel');
  const opt = sel.options[sel.selectedIndex];
  if (!opt.dataset.m) { document.getElementById('edit-form').style.display = 'none'; return; }
  const m = JSON.parse(opt.dataset.m);
  document.getElementById('e-nome').value      = m.nome;
  document.getElementById('e-col-estab').value = m.coluna_estabelecimento || '';
  document.getElementById('e-col-valor').value = m.coluna_valor || '';
  document.getElementById('e-idx-estab').value = m.indice_estabelecimento ?? 0;
  document.getElementById('e-idx-valor').value = m.indice_valor ?? 1;
  document.getElementById('e-usar-idx').checked= !!m.usar_indice;
  document.getElementById('e-desc').value      = m.descricao || '';
  document.getElementById('e-ativo').checked   = !!m.ativo;
  toggleModoEdit();
  document.getElementById('edit-form').style.display = 'block';
}

async function salvarEdit() {
  const id = Number(document.getElementById('e-sel').value);
  const al = document.getElementById('alert-edit');
  if (!id) return;
  const nome = document.getElementById('e-nome').value.trim();
  if (!nome) { setAlert(al, 'Nome é obrigatório.', 'error'); return; }

  const usarIdx = document.getElementById('e-usar-idx').checked;
  await fetch(`/api/mapeamentos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome,
      usar_indice: usarIdx ? 1 : 0,
      coluna_estabelecimento: usarIdx ? null : document.getElementById('e-col-estab').value.trim() || null,
      coluna_valor:           usarIdx ? null : document.getElementById('e-col-valor').value.trim() || null,
      indice_estabelecimento: usarIdx ? Number(document.getElementById('e-idx-estab').value) : null,
      indice_valor:           usarIdx ? Number(document.getElementById('e-idx-valor').value) : null,
      descricao: document.getElementById('e-desc').value.trim() || null,
      ativo: document.getElementById('e-ativo').checked ? 1 : 0,
    }),
  });
  setAlert(al, '✅ Atualizado com sucesso.', 'success');
  carregarMapeamentos();
}

async function desativarMap() {
  const id = Number(document.getElementById('e-sel').value);
  if (!id || !confirm('Desativar este mapeamento?')) return;
  await fetch(`/api/mapeamentos/${id}`, { method: 'DELETE' });
  setAlert(document.getElementById('alert-edit'), 'Mapeamento desativado.', 'success');
  carregarMapeamentos();
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function esc(s) { return String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function setAlert(el, msg, type) {
  el.innerHTML = msg ? `<div class="alert alert-${type}">${msg}</div>` : '';
}
