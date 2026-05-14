import { getEndpoints, getHeaders, escapeHtml } from '../../js/util/util.js';
import { showAlert, showLoader, hideLoader } from '../../js/util/alerts.js';

const LIMITE = 10;
const MAX_CHARS = 60;

const BADGE_STATUS = {
  aberto:     { classe: 'mod-badge mod-badge-warning', label: 'Aberto' },
  em_analise: { classe: 'mod-badge mod-badge-info',    label: 'Em Análise' },
  resolvido:  { classe: 'mod-badge mod-badge-success', label: 'Resolvido' },
  fechado:    { classe: 'mod-badge mod-badge-neutral', label: 'Fechado' },
};

const BADGE_SEVERIDADE = {
  operacional: { classe: 'mod-badge mod-badge-warning', label: 'Falha Operacional' },
  critico:     { classe: 'mod-badge mod-badge-danger',  label: 'Falha Crítica' },
};

const TRANSICOES = {
  aberto:     [{ valor: 'em_analise', label: 'Marcar Em Análise' }, { valor: 'fechado', label: 'Fechar' }],
  em_analise: [{ valor: 'resolvido',  label: 'Marcar Resolvido'  }, { valor: 'fechado', label: 'Fechar' }],
  resolvido:  [{ valor: 'aberto',     label: 'Reabrir'           }, { valor: 'fechado', label: 'Fechar' }],
  fechado:    [{ valor: 'aberto',     label: 'Reabrir'           }],
};

let estado = { pagina: 1, total: 0, status: '' };
let chamadoAtivo = null;

function badge(status) {
  const c = BADGE_STATUS[status] || { classe: 'mod-badge mod-badge-neutral', label: escapeHtml(status || 'N/D') };
  return `<span class="${c.classe}">${c.label}</span>`;
}

function badgeSeveridade(severidade) {
  const c = BADGE_SEVERIDADE[severidade] || { classe: 'mod-badge mod-badge-neutral', label: escapeHtml(severidade || 'N/D') };
  return `<span class="${c.classe}">${c.label}</span>`;
}

function truncar(str, n) {
  const s = String(str || '');
  return s.length > n ? `${s.slice(0, n)}...` : s;
}

function formatarData(iso) {
  if (!iso) return '-';
  try { return new Date(iso).toLocaleString('pt-BR'); } catch { return '-'; }
}

function renderTabela(dados) {
  const tbody = document.querySelector('#tabela-tickets tbody');
  if (!tbody) return;

  if (!dados.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="td-empty">Nenhum chamado encontrado.</td></tr>`;
    return;
  }

  tbody.innerHTML = dados.map((item) => {
    const tipoBadge = item.tipo_entrada === 'usuario'
      ? `<span class="mod-badge mod-badge-info">Manual</span>`
      : `<span class="mod-badge mod-badge-neutral">Monitor</span>`;

    return `<tr class="chamado-linha" data-id="${item.incidente_id}">
      <td><span class="chamados-ticket-num">${escapeHtml(item.ticket_numero || '-')}</span></td>
      <td title="${escapeHtml(item.mensagem_erro || '')}">${escapeHtml(truncar(item.mensagem_erro, MAX_CHARS))}</td>
      <td>${tipoBadge}</td>
      <td>${badgeSeveridade(item.severidade)}</td>
      <td>${badge(item.status)}</td>
      <td>${escapeHtml(formatarData(item.data_inclusao))}</td>
      <td>
        <button class="mod-btn mod-btn-ghost mod-btn-sm btn-ver-chamado" data-id="${item.incidente_id}" title="Ver detalhes">
          <i class="fa-solid fa-eye"></i>
        </button>
      </td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.chamado-linha').forEach((tr) => {
    tr.addEventListener('click', () => abrirDetalhe(tr.dataset.id));
  });
}

function atualizarPaginacao() {
  const total = Math.max(1, Math.ceil(estado.total / LIMITE));
  const atual = estado.pagina;
  const elInfo = document.getElementById('chamados-pag-info');
  const btnAnt = document.getElementById('btn-chamados-anterior');
  const btnPrx = document.getElementById('btn-chamados-proximo');
  if (elInfo) elInfo.textContent = `Página ${atual} de ${total}`;
  if (btnAnt) btnAnt.disabled = atual <= 1;
  if (btnPrx) btnPrx.disabled = atual >= total;
}

async function carregarTickets() {
  const tbody = document.querySelector('#tabela-tickets tbody');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="7" class="td-empty">Carregando chamados...</td></tr>`;
  showLoader();

  try {
    const { API_SUPORTE_INCIDENTES } = getEndpoints();
    const params = new URLSearchParams({ limit: LIMITE, offset: (estado.pagina - 1) * LIMITE });
    if (estado.status) params.set('status', estado.status);

    const res = await fetch(`${API_SUPORTE_INCIDENTES}?${params}`, { headers: getHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const { dados, total } = await res.json();
    estado = { ...estado, total: Number(total) || 0 };
    renderTabela(Array.isArray(dados) ? dados : []);
    atualizarPaginacao();
  } catch {
    tbody.innerHTML = `<tr><td colspan="7" class="td-empty">Erro ao carregar chamados.</td></tr>`;
    showAlert('Não foi possível carregar os chamados.', 'error');
  } finally {
    hideLoader();
  }
}

function abrirPainel() {
  document.getElementById('chamado-painel')?.classList.add('aberto');
  document.getElementById('chamado-overlay')?.classList.add('visivel');
}

function fecharDetalhe() {
  document.getElementById('chamado-painel')?.classList.remove('aberto');
  document.getElementById('chamado-overlay')?.classList.remove('visivel');
  chamadoAtivo = null;
}

async function abrirDetalhe(id) {
  const conteudo = document.getElementById('chamado-painel-conteudo');
  if (!conteudo) return;
  conteudo.innerHTML = '<div class="chamado-loading"><i class="fa-solid fa-spinner fa-spin"></i> Carregando...</div>';
  abrirPainel();

  try {
    const { API_SUPORTE_INCIDENTES } = getEndpoints();
    const res = await fetch(`${API_SUPORTE_INCIDENTES}/${id}`, { headers: getHeaders() });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    chamadoAtivo = await res.json();
    renderDetalhe(chamadoAtivo);
  } catch {
    conteudo.innerHTML = '<p class="chamado-erro">Erro ao carregar detalhes do chamado.</p>';
    showAlert('Erro ao buscar detalhes do chamado.', 'error');
  }
}

function renderAnexos(chamado) {
  const anexos = Array.isArray(chamado.anexos) ? chamado.anexos : [];
  if (!anexos.length) return '';

  const cards = anexos.map((anexo) => `
    <a class="chamado-anexo-card" href="${escapeHtml(anexo.data_url || '#')}" target="_blank" rel="noopener noreferrer">
      <img src="${escapeHtml(anexo.data_url || '')}" alt="${escapeHtml(anexo.nome_arquivo || 'Anexo')}" class="chamado-anexo-thumb" />
      <span class="chamado-anexo-nome">${escapeHtml(anexo.nome_arquivo || 'Anexo')}</span>
    </a>
  `).join('');

  return `
    <div class="chamado-thread">
      <h4 class="chamado-thread-titulo"><i class="fa-solid fa-paperclip"></i> Anexos</h4>
      <div class="chamado-anexos-grid">${cards}</div>
    </div>
  `;
}

function renderMetadata(chamado) {
  const metadados = chamado.metadados && typeof chamado.metadados === 'object'
    ? Object.entries(chamado.metadados)
    : [];

  if (!metadados.length) return '';

  return `
    <div class="chamado-meta-grid">
      ${metadados
        .filter(([, valor]) => valor !== null && valor !== undefined && valor !== '')
        .slice(0, 6)
        .map(([chave, valor]) => `
          <div class="chamado-meta-item">
            <span class="chamado-campo-label">${escapeHtml(chave.replace(/_/g, ' '))}</span>
            <span class="chamado-valor-meta">${escapeHtml(typeof valor === 'object' ? JSON.stringify(valor) : String(valor))}</span>
          </div>
        `).join('')}
    </div>
  `;
}

function renderDetalhe(chamado) {
  const conteudo = document.getElementById('chamado-painel-conteudo');
  if (!conteudo) return;

  const transicoes = TRANSICOES[chamado.status] || [];
  const botoesStatus = transicoes.map((transicao) =>
    `<button class="mod-btn mod-btn-ghost mod-btn-sm btn-mudar-status" data-status="${transicao.valor}">${escapeHtml(transicao.label)}</button>`
  ).join('');

  const respostas = (Array.isArray(chamado.enriquecimentos) ? chamado.enriquecimentos : [])
    .map((item) => {
      const isUsuario = item.tipo_entrada === 'usuario';
      return `<div class="chamado-resposta ${isUsuario ? 'resposta-usuario' : 'resposta-suporte'}">
        <div class="resposta-header">
          <span class="resposta-autor">
            <i class="fa-solid fa-${isUsuario ? 'user' : 'headset'}"></i>
            ${escapeHtml(item.usuario_inclusao || 'Usuário')}
          </span>
          <span class="resposta-data">${escapeHtml(formatarData(item.data_inclusao))}</span>
        </div>
        <p class="resposta-texto">${escapeHtml(item.descricao_usuario || item.mensagem_erro || '-')}</p>
      </div>`;
    }).join('') || '<p class="chamado-sem-respostas">Nenhuma resposta ainda.</p>';

  conteudo.innerHTML = `
    <div class="chamado-detalhe-header">
      <div class="chamado-detalhe-top">
        <span class="chamados-ticket-num">${escapeHtml(chamado.ticket_numero || '-')}</span>
        ${badgeSeveridade(chamado.severidade)}
        ${badge(chamado.status)}
      </div>
      <p class="chamado-detalhe-data">Aberto em ${escapeHtml(formatarData(chamado.data_inclusao))}</p>
    </div>

    <div class="chamado-detalhe-campos">
      <div class="chamado-campo">
        <span class="chamado-campo-label">Assunto</span>
        <p class="chamado-campo-valor">${escapeHtml(chamado.mensagem_erro || '-')}</p>
      </div>
      ${chamado.descricao_usuario ? `
      <div class="chamado-campo">
        <span class="chamado-campo-label">Descrição</span>
        <p class="chamado-campo-valor">${escapeHtml(chamado.descricao_usuario)}</p>
      </div>` : ''}
      ${chamado.url_pagina ? `
      <div class="chamado-campo">
        <span class="chamado-campo-label">Página</span>
        <p class="chamado-campo-valor chamado-url">${escapeHtml(chamado.url_pagina)}</p>
      </div>` : ''}
      <div class="chamado-campo-grid">
        <div class="chamado-campo">
          <span class="chamado-campo-label">Sistema</span>
          <p class="chamado-campo-valor">${escapeHtml(chamado.sistema_origem || 'eGest')}</p>
        </div>
        <div class="chamado-campo">
          <span class="chamado-campo-label">Ambiente</span>
          <p class="chamado-campo-valor">${escapeHtml(chamado.ambiente_origem || '-')}</p>
        </div>
        <div class="chamado-campo">
          <span class="chamado-campo-label">Screenshot</span>
          <p class="chamado-campo-valor">${escapeHtml(chamado.screenshot_status || '-')}</p>
        </div>
      </div>
      ${renderMetadata(chamado)}
    </div>

    ${renderAnexos(chamado)}

    ${transicoes.length ? `
    <div class="chamado-status-actions">
      <span class="chamado-campo-label">Alterar status:</span>
      <div class="chamado-status-btns">${botoesStatus}</div>
    </div>` : ''}

    <div class="chamado-thread">
      <h4 class="chamado-thread-titulo"><i class="fa-solid fa-comments"></i> Histórico</h4>
      <div id="chamado-respostas">${respostas}</div>
    </div>

    <div class="chamado-reply-form">
      <h4 class="chamado-thread-titulo"><i class="fa-solid fa-reply"></i> Enviar resposta</h4>
      <textarea id="reply-texto" class="mod-input chamado-reply-textarea" placeholder="Digite sua mensagem..." rows="4"></textarea>
      <div class="chamado-reply-actions">
        <button class="mod-btn mod-btn-primary" id="btn-enviar-resposta">
          <i class="fa-solid fa-paper-plane"></i> Enviar
        </button>
      </div>
    </div>`;

  conteudo.querySelectorAll('.btn-mudar-status').forEach((btn) => {
    btn.addEventListener('click', () => mudarStatus(chamado.incidente_id, btn.dataset.status));
  });
  document.getElementById('btn-enviar-resposta')?.addEventListener('click', enviarResposta);
}

async function mudarStatus(id, novoStatus) {
  try {
    showLoader();
    const { API_SUPORTE_INCIDENTES } = getEndpoints();
    const res = await fetch(`${API_SUPORTE_INCIDENTES}/${id}/status`, {
      method: 'PATCH',
      headers: { ...getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: novoStatus }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    showAlert('Status atualizado com sucesso.', 'success');
    await abrirDetalhe(id);
    carregarTickets();
  } catch {
    showAlert('Erro ao alterar status do chamado.', 'error');
  } finally {
    hideLoader();
  }
}

async function enviarResposta() {
  if (!chamadoAtivo) return;
  const textarea = document.getElementById('reply-texto');
  const texto = textarea?.value?.trim();
  if (!texto) {
    showAlert('Digite uma mensagem antes de enviar.', 'warning');
    return;
  }

  try {
    showLoader();
    const { API_SUPORTE_INCIDENTES } = getEndpoints();
    const res = await fetch(`${API_SUPORTE_INCIDENTES}/${chamadoAtivo.incidente_id}/enriquecer`, {
      method: 'PUT',
      headers: { ...getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ descricao_usuario: texto }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (textarea) textarea.value = '';
    showAlert('Resposta enviada.', 'success');
    await abrirDetalhe(chamadoAtivo.incidente_id);
  } catch {
    showAlert('Erro ao enviar resposta.', 'error');
  } finally {
    hideLoader();
  }
}

function abrirModal() {
  document.getElementById('modal-novo-chamado')?.classList.add('visivel');
  document.getElementById('novo-assunto')?.focus();
}

function fecharModal() {
  document.getElementById('modal-novo-chamado')?.classList.remove('visivel');
  document.getElementById('form-novo-chamado')?.reset();
}

async function criarChamado(event) {
  event.preventDefault();
  const assunto = document.getElementById('novo-assunto')?.value?.trim();
  const descricao = document.getElementById('novo-descricao')?.value?.trim();
  if (!assunto) {
    showAlert('Informe o assunto do chamado.', 'warning');
    return;
  }

  try {
    showLoader();
    const { API_SUPORTE_INCIDENTES } = getEndpoints();
    const res = await fetch(`${API_SUPORTE_INCIDENTES}/manual`, {
      method: 'POST',
      headers: { ...getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ assunto, descricao, severidade: 'operacional' }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { ticket_numero } = await res.json();
    showAlert(`Chamado ${ticket_numero} aberto com sucesso!`, 'success');
    fecharModal();
    estado = { ...estado, pagina: 1 };
    carregarTickets();
  } catch {
    showAlert('Erro ao criar chamado. Tente novamente.', 'error');
  } finally {
    hideLoader();
  }
}

function vincularEventos() {
  document.getElementById('filtro-status-chamados')?.addEventListener('change', (event) => {
    estado = { ...estado, status: event.target.value, pagina: 1 };
    carregarTickets();
  });
  document.getElementById('btn-chamados-anterior')?.addEventListener('click', () => {
    if (estado.pagina <= 1) return;
    estado = { ...estado, pagina: estado.pagina - 1 };
    carregarTickets();
  });
  document.getElementById('btn-chamados-proximo')?.addEventListener('click', () => {
    if (estado.pagina >= Math.ceil(estado.total / LIMITE)) return;
    estado = { ...estado, pagina: estado.pagina + 1 };
    carregarTickets();
  });
  document.getElementById('btn-novo-chamado')?.addEventListener('click', abrirModal);
  document.getElementById('btn-fechar-modal')?.addEventListener('click', fecharModal);
  document.getElementById('btn-cancelar-modal')?.addEventListener('click', fecharModal);
  document.getElementById('modal-novo-chamado')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) fecharModal();
  });
  document.getElementById('form-novo-chamado')?.addEventListener('submit', criarChamado);
  document.getElementById('btn-fechar-painel')?.addEventListener('click', fecharDetalhe);
  document.getElementById('chamado-overlay')?.addEventListener('click', fecharDetalhe);
}

vincularEventos();
carregarTickets();
