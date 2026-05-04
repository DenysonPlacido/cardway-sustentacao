import { Pool } from 'pg'

export type GeradorDb = ReturnType<typeof createGeradorDb>

export function createGeradorDb(pool: Pool) {
  async function listarTipos(apenasAtivos = true) {
    const where = apenasAtivos ? 'WHERE ativo = TRUE' : ''
    const { rows } = await pool.query(
      `SELECT * FROM tipos_transacao ${where} ORDER BY nome`
    )
    return rows
  }

  async function criarTipo(dados: Record<string, unknown>) {
    const { rows } = await pool.query(
      `INSERT INTO tipos_transacao
        (nome, tipo_transacao_id, natureza, modalidade, impacto_limite, envia_fila, canal_venda, quantidade, descricao)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [dados.nome, dados.tipo_transacao_id, dados.natureza, dados.modalidade,
       dados.impacto_limite, dados.envia_fila, dados.canal_venda, dados.quantidade, dados.descricao]
    )
    return rows[0].id as number
  }

  async function atualizarTipo(id: number, dados: Record<string, unknown>) {
    await pool.query(
      `UPDATE tipos_transacao SET
        nome=$1, tipo_transacao_id=$2, natureza=$3, modalidade=$4,
        impacto_limite=$5, envia_fila=$6, canal_venda=$7, quantidade=$8,
        descricao=$9, ativo=$10, atualizado_em=NOW()
       WHERE id=$11`,
      [dados.nome, dados.tipo_transacao_id, dados.natureza, dados.modalidade,
       dados.impacto_limite, dados.envia_fila, dados.canal_venda, dados.quantidade,
       dados.descricao, dados.ativo, id]
    )
  }

  async function desativarTipo(id: number) {
    await pool.query(`UPDATE tipos_transacao SET ativo=FALSE WHERE id=$1`, [id])
  }

  async function listarMapeamentos(apenasAtivos = true) {
    const where = apenasAtivos ? 'WHERE ativo = TRUE' : ''
    const { rows } = await pool.query(
      `SELECT * FROM mapeamentos_colunas ${where} ORDER BY nome`
    )
    return rows
  }

  async function criarMapeamento(dados: Record<string, unknown>) {
    const { rows } = await pool.query(
      `INSERT INTO mapeamentos_colunas
        (nome, coluna_estabelecimento, coluna_valor, indice_estabelecimento, indice_valor, usar_indice, descricao)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id`,
      [dados.nome, dados.coluna_estabelecimento, dados.coluna_valor,
       dados.indice_estabelecimento, dados.indice_valor, dados.usar_indice, dados.descricao]
    )
    return rows[0].id as number
  }

  async function atualizarMapeamento(id: number, dados: Record<string, unknown>) {
    await pool.query(
      `UPDATE mapeamentos_colunas SET
        nome=$1, coluna_estabelecimento=$2, coluna_valor=$3,
        indice_estabelecimento=$4, indice_valor=$5, usar_indice=$6,
        descricao=$7, ativo=$8
       WHERE id=$9`,
      [dados.nome, dados.coluna_estabelecimento, dados.coluna_valor,
       dados.indice_estabelecimento, dados.indice_valor, dados.usar_indice,
       dados.descricao, dados.ativo, id]
    )
  }

  async function desativarMapeamento(id: number) {
    await pool.query(`UPDATE mapeamentos_colunas SET ativo=FALSE WHERE id=$1`, [id])
  }

  async function salvarHistorico(dados: Record<string, unknown>) {
    const { rows } = await pool.query(
      `INSERT INTO historico_lancamentos
        (glpi, nome_campanha, dados_complementares, tipo_transacao_id_val, natureza, modalidade,
         impacto_limite, envia_fila, canal_venda, quantidade, total_registros, valor_total, sql_gerado, mapeamento_usado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING id`,
      [dados.glpi, dados.nome_campanha, dados.dados_complementares, dados.tipo_transacao_id_val,
       dados.natureza, dados.modalidade, dados.impacto_limite, dados.envia_fila,
       dados.canal_venda, dados.quantidade, dados.total_registros, dados.valor_total,
       dados.sql_gerado, dados.mapeamento_usado]
    )
    return rows[0].id as number
  }

  async function listarHistorico(limite = 50) {
    const { rows } = await pool.query(
      `SELECT id, glpi, nome_campanha, total_registros, valor_total, mapeamento_usado, criado_em
       FROM historico_lancamentos ORDER BY id DESC LIMIT $1`,
      [limite]
    )
    return rows
  }

  async function buscarHistoricoSql(id: number) {
    const { rows } = await pool.query(
      `SELECT * FROM historico_lancamentos WHERE id=$1`, [id]
    )
    return rows[0] ?? null
  }

  async function listarSistema(apenasAtivos = true) {
    const where = apenasAtivos ? 'WHERE ativo = 1' : ''
    const { rows } = await pool.query(
      `SELECT * FROM tipos_transacao_sistema ${where} ORDER BY nome`
    )
    return rows
  }

  async function atualizarSistema(id: number, dados: Record<string, unknown>) {
    await pool.query(
      `UPDATE tipos_transacao_sistema SET
        nome=$1, natureza=$2, modalidade=$3, impacto_limite=$4, envia_fila=$5
       WHERE id=$6`,
      [dados.nome, dados.natureza, dados.modalidade, dados.impacto_limite, dados.envia_fila, id]
    )
  }

  async function statsGerais() {
    const { rows: [s] } = await pool.query(`
      SELECT
        COUNT(*)::int AS total_lancamentos,
        COALESCE(SUM(total_registros),0)::int AS total_registros,
        COALESCE(SUM(valor_total),0)::numeric AS valor_total_geral,
        COUNT(DISTINCT glpi)::int AS glpis_distintos
      FROM historico_lancamentos
    `)
    const { rows: [t] } = await pool.query(`SELECT COUNT(*)::int AS c FROM tipos_transacao WHERE ativo=TRUE`)
    const { rows: [m] } = await pool.query(`SELECT COUNT(*)::int AS c FROM mapeamentos_colunas WHERE ativo=TRUE`)
    const { rows: [sys] } = await pool.query(`SELECT COUNT(*)::int AS c FROM tipos_transacao_sistema`)
    return {
      ...s,
      tipos_cadastrados: t.c,
      mapeamentos_ativos: m.c,
      tipos_sistema: sys.c,
    }
  }

  return {
    listarTipos, criarTipo, atualizarTipo, desativarTipo,
    listarMapeamentos, criarMapeamento, atualizarMapeamento, desativarMapeamento,
    salvarHistorico, listarHistorico, buscarHistoricoSql,
    listarSistema, atualizarSistema,
    statsGerais,
  }
}
