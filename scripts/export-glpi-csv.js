#!/usr/bin/env node
/**
 * Exporta todos os chamados GLPI para CSV, incluindo followups completos.
 *
 * Uso:
 *   node scripts/export-glpi-csv.js
 *
 * Variáveis de ambiente (lidas do .env na raiz ou do ambiente):
 *   GLPI_API_URL        URL base da API REST do GLPI
 *   GLPI_USER_TOKEN     Token de usuário GLPI
 *   GLPI_APP_TOKEN      (opcional) App-Token GLPI
 *   OBSERVER_GROUP      Grupo observador a filtrar  (padrão: Implantação)
 *   ENTITY_NAME         Nome da entidade a filtrar  (padrão: agente-CSC)
 *   OUTPUT_FILE         Arquivo de saída            (padrão: chamados_implantacao.csv)
 */

const fs   = require('fs')
const path = require('path')

// Carrega .env manualmente sem precisar do pacote dotenv
const envPath = path.join(__dirname, '..', '.env')
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const match = line.match(/^\s*([^#=]+?)\s*=\s*(.*?)\s*$/)
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '')
    }
  })
}

const BASE_URL    = (process.env.GLPI_API_URL    || '').replace(/\/$/, '')
const USER_TOKEN  =  process.env.GLPI_USER_TOKEN || ''
const APP_TOKEN   =  process.env.GLPI_APP_TOKEN  || ''
const OBS_GROUP   =  process.env.OBSERVER_GROUP  || 'Implantação'
// const ENTITY_NAME =  process.env.ENTITY_NAME     || 'Agente-CSC'
const OUTPUT      =  process.env.OUTPUT_FILE     || 'chamados_implantacao.csv'

if (!BASE_URL || !USER_TOKEN) {
  console.error('ERRO: defina GLPI_API_URL e GLPI_USER_TOKEN no .env ou no ambiente.')
  process.exit(1)
}

// ── helpers HTTP ─────────────────────────────────────────────────────────────

function makeHeaders(session) {
  const h = { 'Content-Type': 'application/json' }
  if (APP_TOKEN) h['App-Token'] = APP_TOKEN
  if (session)   h['Session-Token'] = session
  return h
}

async function glpiFetch(url, session) {
  const res = await fetch(url, { headers: makeHeaders(session) })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GLPI ${res.status}: ${body}`)
  }
  return res.json()
}

async function initSession() {
  const data = await glpiFetch(`${BASE_URL}/initSession/?user_token=${USER_TOKEN}`)
  console.log('[GLPI] sessão iniciada')
  return data.session_token
}

async function killSession(token) {
  await fetch(`${BASE_URL}/killSession`, { headers: makeHeaders(token) }).catch(() => {})
  console.log('[GLPI] sessão encerrada')
}

// ── busca paginada de tickets ─────────────────────────────────────────────────

async function fetchAllTickets(session) {
  const all = []
  let start = 0
  const PAGE = 50

  while (true) {
    const params = new URLSearchParams({
      range:            `${start}-${start + PAGE - 1}`,
      sort:             '15',
      order:            'DESC',
      expand_dropdowns: 'true',
    })

    // filtro por grupo técnico — sem forcedisplay, GLPI retorna colunas padrão
    params.set('criteria[0][field]',      '8')
    params.set('criteria[0][searchtype]', 'contains')
    params.set('criteria[0][value]',      OBS_GROUP)

    let data
    try {
      data = await glpiFetch(`${BASE_URL}/search/Ticket?${params}`, session)
    } catch (e) {
      console.warn('\n[GLPI] erro na página', start, '-', e.message)
      break
    }

    const batch = data.data ?? []
    all.push(...batch)
    process.stdout.write(`\r  [tickets] ${all.length} buscados...`)

    if (batch.length < PAGE) break
    start += PAGE
  }

  console.log()
  return all
}

// ── followups por ticket ──────────────────────────────────────────────────────

async function fetchFollowups(session, ticketId) {
  try {
    const url = `${BASE_URL}/Ticket/${ticketId}/ITILFollowup?expand_dropdowns=true&range=0-999`
    const data = await glpiFetch(url, session)
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function esc(value) {
  const str = String(value ?? '')
    .replace(/\r?\n|\r/g, ' | ')
    .replace(/"/g, '""')
  return `"${str}"`
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Exportando chamados`)
  console.log(`  Grupo observador : ${OBS_GROUP}`)
  // console.log(`  Entidade         : ${ENTITY_NAME}`)
  console.log(`  Arquivo de saída : ${OUTPUT}\n`)

  const session = await initSession()

  try {
    const tickets = await fetchAllTickets(session)
    console.log(`Total de chamados: ${tickets.length}`)

    // colunas dinâmicas — usa todas as chaves retornadas pelo GLPI
    const ticketKeys   = [...new Set(tickets.flatMap(t => Object.keys(t)))]
    const fuSuffix     = ['FU_ID', 'FU_Autor', 'FU_Data', 'FU_Privado', 'FU_Conteúdo']
    const rows = [[...ticketKeys, ...fuSuffix].map(esc).join(',')]

    for (let i = 0; i < tickets.length; i++) {
      const t        = tickets[i]
      const ticketId = Number(t['2'] ?? t.id ?? 0)
      process.stdout.write(`\r  [followups] ${i + 1}/${tickets.length} (id=${ticketId})...`)

      const base      = ticketKeys.map(k => esc(t[k] ?? ''))
      const followups = await fetchFollowups(session, ticketId)

      if (followups.length === 0) {
        rows.push([...base, esc(''), esc(''), esc(''), esc(''), esc('')].join(','))
      } else {
        for (const f of followups) {
          rows.push([
            ...base,
            esc(f.id ?? ''),
            esc(f.users_id ?? ''),
            esc(f.date ?? f.date_mod ?? ''),
            esc(f.is_private ? 'Sim' : 'Não'),
            esc(f.content ?? ''),
          ].join(','))
        }
      }
    }

    console.log()
    const output = path.resolve(process.cwd(), OUTPUT)
    fs.writeFileSync(output, '﻿' + rows.join('\n'), 'utf8') // BOM para abrir no Excel corretamente
    console.log(`\nArquivo gerado : ${output}`)
    console.log(`Chamados       : ${tickets.length}`)
    console.log(`Linhas CSV     : ${rows.length - 1}`)
  } finally {
    await killSession(session)
  }
}

main().catch(e => {
  console.error('\nERRO:', e.message)
  process.exit(1)
})
