'use strict';

let sqlAtual = '';
let glpiAtual = '';

document.addEventListener('DOMContentLoaded', carregarHistorico);

async function carregarHistorico() {
  const limite = document.getElementById('limite-sel').value;
  const hist = await fetch(`/api/historico?limite=${limite}`).then(r => r.json());

  const tbody = document.getElementById('tbody-hist');
  tbody.innerHTML = '';

  if (!hist.length) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:24px;">Nenhuma geração registrada.</td></tr>';
    return;
  }

  hist.forEach(h => {
    const tr = document.createElement('tr');
    tr.style.cursor = 'pointer';
    tr.innerHTML = `
      <td>${h.id}</td>
      <td>${esc(h.glpi || '—')}</td>
      <td>${esc(h.nome_campanha || '—')}</td>
      <td>${(h.total_registros || 0).toLocaleString('pt-BR')}</td>
      <td><span class="badge badge-muted">${esc(h.mapeamento_usado || 'auto')}</span></td>
      <td>${esc(h.criado_em || '')}</td>
      <td><button class="btn btn-secondary" style="padding:4px 10px;font-size:12px;" onclick="verDetalhe(${h.id})">Ver</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function verDetalhe(id) {
  const h = await fetch(`/api/historico/${id}`).then(r => r.json());

  document.getElementById('d-id').textContent       = h.id;
  document.getElementById('d-glpi').textContent     = h.glpi || '—';
  document.getElementById('d-campanha').textContent = h.nome_campanha || '—';
  document.getElementById('d-registros').textContent= (h.total_registros || 0).toLocaleString('pt-BR');
  document.getElementById('d-data').textContent     = h.criado_em || '';

  const sql = h.sql_gerado || '';
  sqlAtual  = sql;
  glpiAtual = h.glpi || 'sem_glpi';

  document.getElementById('d-sql').textContent = sql.slice(0, 5000) + (sql.length > 5000 ? '\n...' : '');
  document.getElementById('detalhe').style.display = 'block';
  document.getElementById('btn-dl').onclick = baixarSQL;
  document.getElementById('detalhe').scrollIntoView({ behavior: 'smooth' });
}

function baixarSQL() {
  if (!sqlAtual) return;
  const blob = new Blob([sqlAtual], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `lanc_cred_lim_global_glpi_${glpiAtual}.sql`;
  a.click();
}

function esc(s) { return String(s).replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
