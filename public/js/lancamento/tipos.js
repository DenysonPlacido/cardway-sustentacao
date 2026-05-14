'use strict';

let tiposData = [];
let oracleData = [];

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  carregarTipos();
  carregarOracle();
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

// ── Tipos cadastrados ─────────────────────────────────────────────────────────
async function carregarTipos() {
  const todos = document.getElementById('chk-inativos-lista').checked;
  tiposData = await fetch('/api/tipos' + (todos ? '?todos=1' : '')).then(r => r.json());

  const tbody = document.getElementById('tbody-tipos');
  tbody.innerHTML = '';
  tiposData.forEach(t => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${t.id}</td>
      <td>${esc(t.nome)}</td>
      <td>${t.tipo_transacao_id}</td>
      <td>${t.natureza}</td>
      <td>${t.modalidade}</td>
      <td>${t.impacto_limite}</td>
      <td>${t.envia_fila}</td>
      <td>${t.canal_venda}</td>
      <td>${t.quantidade}</td>
      <td><span class="badge ${t.ativo ? 'badge-ok' : 'badge-muted'}">${t.ativo ? 'Sim' : 'Não'}</span></td>
    `;
    tbody.appendChild(tr);
  });

  // atualizar select de edição
  const sel = document.getElementById('e-sel');
  sel.innerHTML = '<option value="">— Selecione —</option>';
  tiposData.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `[${t.id}] ${t.nome}`;
    opt.dataset.t = JSON.stringify(t);
    sel.appendChild(opt);
  });
  document.getElementById('edit-form').style.display = 'none';
}

function preencherEdit() {
  const sel = document.getElementById('e-sel');
  const opt = sel.options[sel.selectedIndex];
  if (!opt.dataset.t) { document.getElementById('edit-form').style.display = 'none'; return; }
  const t = JSON.parse(opt.dataset.t);
  document.getElementById('e-nome').value      = t.nome;
  document.getElementById('e-tipo-id').value   = t.tipo_transacao_id;
  document.getElementById('e-natureza').value  = t.natureza;
  document.getElementById('e-modalidade').value= t.modalidade;
  document.getElementById('e-impacto').value   = t.impacto_limite;
  document.getElementById('e-envia').value     = t.envia_fila;
  document.getElementById('e-canal').value     = t.canal_venda;
  document.getElementById('e-qtd').value       = t.quantidade;
  document.getElementById('e-desc').value      = t.descricao || '';
  document.getElementById('e-ativo').checked   = !!t.ativo;
  document.getElementById('edit-form').style.display = 'block';
}

async function criarTipo() {
  const nome = document.getElementById('n-nome').value.trim();
  const al = document.getElementById('alert-novo');
  if (!nome) { setAlert(al, 'Nome é obrigatório.', 'error'); return; }

  const res = await fetch('/api/tipos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome,
      tipo_transacao_id: Number(document.getElementById('n-tipo-id').value),
      natureza:   Number(document.getElementById('n-natureza').value),
      modalidade: Number(document.getElementById('n-modalidade').value),
      impacto_limite: Number(document.getElementById('n-impacto').value),
      envia_fila: Number(document.getElementById('n-envia').value),
      canal_venda: Number(document.getElementById('n-canal').value),
      quantidade: Number(document.getElementById('n-qtd').value),
      descricao: document.getElementById('n-desc').value.trim() || null,
    }),
  });
  const data = await res.json();
  if (data.erro) { setAlert(al, data.erro, 'error'); return; }
  setAlert(al, `✅ Tipo criado com ID ${data.id}.`, 'success');
  carregarTipos();
}

async function salvarEdit() {
  const sel = document.getElementById('e-sel');
  const id = Number(sel.value);
  const al = document.getElementById('alert-edit');
  if (!id) return;
  const nome = document.getElementById('e-nome').value.trim();
  if (!nome) { setAlert(al, 'Nome é obrigatório.', 'error'); return; }

  await fetch(`/api/tipos/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome,
      tipo_transacao_id: Number(document.getElementById('e-tipo-id').value),
      natureza:   Number(document.getElementById('e-natureza').value),
      modalidade: Number(document.getElementById('e-modalidade').value),
      impacto_limite: Number(document.getElementById('e-impacto').value),
      envia_fila: Number(document.getElementById('e-envia').value),
      canal_venda: Number(document.getElementById('e-canal').value),
      quantidade: Number(document.getElementById('e-qtd').value),
      descricao: document.getElementById('e-desc').value.trim() || null,
      ativo: document.getElementById('e-ativo').checked ? 1 : 0,
    }),
  });
  setAlert(al, '✅ Atualizado com sucesso.', 'success');
  carregarTipos();
}

async function desativarTipo() {
  const id = Number(document.getElementById('e-sel').value);
  if (!id || !confirm('Desativar este tipo?')) return;
  await fetch(`/api/tipos/${id}`, { method: 'DELETE' });
  setAlert(document.getElementById('alert-edit'), 'Tipo desativado.', 'success');
  carregarTipos();
}

// ── Oracle ────────────────────────────────────────────────────────────────────
async function carregarOracle() {
  const todos = document.getElementById('chk-oracle-inativos').checked;
  oracleData = await fetch('/api/oracle' + (todos ? '?todos=1' : '')).then(r => r.json());

  const tbody = document.getElementById('tbody-oracle');
  tbody.innerHTML = '';
  oracleData.forEach(t => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${t.id}</td>
      <td>${esc(t.nome || '')}</td>
      <td>${t.natureza ?? ''}</td>
      <td>${t.modalidade ?? ''}</td>
      <td>${t.impacto_limite ?? ''}</td>
      <td>${t.envia_fila ?? ''}</td>
      <td><span class="badge ${t.ativo ? 'badge-ok' : 'badge-muted'}">${t.ativo ? 'Sim' : 'Não'}</span></td>
    `;
    tbody.appendChild(tr);
  });

  const sel = document.getElementById('o-sel');
  sel.innerHTML = '<option value="">— Selecione —</option>';
  oracleData.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = `[${t.id}] ${t.nome || ''}`;
    opt.dataset.t = JSON.stringify(t);
    sel.appendChild(opt);
  });
  document.getElementById('oracle-form').style.display = 'none';
}

function preencherOracle() {
  const sel = document.getElementById('o-sel');
  const opt = sel.options[sel.selectedIndex];
  if (!opt.dataset.t) { document.getElementById('oracle-form').style.display = 'none'; return; }
  const t = JSON.parse(opt.dataset.t);
  document.getElementById('o-nome').value      = t.nome || '';
  document.getElementById('o-id').value        = t.id;
  document.getElementById('o-natureza').value  = t.natureza ?? 0;
  document.getElementById('o-modalidade').value= t.modalidade ?? 1;
  document.getElementById('o-impacto').value   = t.impacto_limite ?? 0;
  document.getElementById('o-envia').value     = t.envia_fila ?? 1;
  document.getElementById('oracle-form').style.display = 'block';
}

async function salvarOracle() {
  const id = Number(document.getElementById('o-id').value);
  const al = document.getElementById('alert-oracle');
  await fetch(`/api/oracle/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome: document.getElementById('o-nome').value.trim(),
      natureza:   Number(document.getElementById('o-natureza').value),
      modalidade: Number(document.getElementById('o-modalidade').value),
      impacto_limite: Number(document.getElementById('o-impacto').value),
      envia_fila: Number(document.getElementById('o-envia').value),
    }),
  });
  setAlert(al, '✅ Tipo Oracle atualizado.', 'success');
  carregarOracle();
}

async function converterOracle() {
  const id = Number(document.getElementById('o-id').value);
  const nome = document.getElementById('o-nome').value.trim();
  const al = document.getElementById('alert-oracle');
  if (!nome) { setAlert(al, 'Nome é obrigatório.', 'error'); return; }

  const res = await fetch(`/api/oracle/${id}/converter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nome,
      tipo_transacao_id: id,
      natureza:   Number(document.getElementById('o-natureza').value),
      modalidade: Number(document.getElementById('o-modalidade').value),
      impacto_limite: Number(document.getElementById('o-impacto').value),
      envia_fila: Number(document.getElementById('o-envia').value),
      canal_venda: 1,
      quantidade: 1,
      descricao: null,
    }),
  });
  const data = await res.json();
  setAlert(al, `✅ Tipo cadastrado com ID ${data.id}. Agora aparece no Gerador.`, 'success');
  carregarTipos();
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function esc(s) { return String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function setAlert(el, msg, type) {
  if (!msg) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="alert alert-${type}">${msg}</div>`;
}
