import express from 'express';
import autenticar from '../../middleware/authMiddleware.js';
import { getPoolSustentacao } from '../../db.js';

const router = express.Router();
router.use((req, res, next) => {
    if (req.path === '/integracao' || req.path === '/agest') {
        next();
        return;
    }

    autenticar(req, res, next);
});

const EMPRESA_ADM = 1;
const STATUS_PERMITIDOS = ['aberto', 'em_analise', 'resolvido', 'fechado'];
const SEVERIDADES_PERMITIDAS = ['operacional', 'critico'];
const CONTENT_TYPES_ANEXO = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_ANEXO_BYTES = 5 * 1024 * 1024;

let schemaCache = null;
let schemaCacheAt = 0;
const SCHEMA_CACHE_TTL_MS = 60 * 1000;

function gerarTicketNumero(seq) {
    const ano = new Date().getFullYear();
    return `INC-${ano}-${String(seq).padStart(5, '0')}`;
}

function isAdm(empresaId) {
    return Number(empresaId) === EMPRESA_ADM;
}

function normalizarTexto(value) {
    const texto = String(value ?? '').trim();
    return texto || null;
}

function normalizarBooleano(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;

    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['true', '1', 'sim', 's', 'on'].includes(normalized)) return true;
        if (['false', '0', 'nao', 'n', 'off', ''].includes(normalized)) return false;
    }

    return fallback;
}

function normalizarSeveridade(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return SEVERIDADES_PERMITIDAS.includes(normalized) ? normalized : 'critico';
}

function normalizarArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizarMetadados(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }

    return value;
}

function getContentTypeImagem(headerValue) {
    return String(headerValue || '').split(';')[0].trim().toLowerCase();
}

function inferirExtensao(contentType) {
    switch (contentType) {
        case 'image/png':
            return 'png';
        case 'image/webp':
            return 'webp';
        case 'image/jpeg':
        default:
            return 'jpg';
    }
}

function montarDataUrl(contentType, base64) {
    return `data:${contentType};base64,${base64}`;
}

function legacyProjection(alias = '') {
    const prefix = alias ? `${alias}.` : '';
    return [
        `${prefix}incidente_id`,
        `${prefix}ticket_numero`,
        `${prefix}empresa_id`,
        `${prefix}usuario_id`,
        `${prefix}tipo_entrada`,
        `${prefix}mensagem_erro`,
        `${prefix}descricao_usuario`,
        `${prefix}url_pagina`,
        `${prefix}user_agent`,
        `${prefix}console_logs`,
        `${prefix}network_requests`,
        `${prefix}status`,
        `${prefix}usuario_inclusao`,
        `${prefix}data_inclusao`,
        `'eGest' AS sistema_origem`,
        `NULL::varchar AS ambiente_origem`,
        `'critico' AS severidade`,
        `NULL::varchar AS codigo_alerta`,
        `true AS exibir_formulario_usuario`,
        `'{}'::jsonb AS metadados`,
        `NULL::varchar AS referencia_externa`,
        `CASE WHEN ${prefix}screenshot_blob IS NULL OR btrim(${prefix}screenshot_blob) = '' THEN 'nao_solicitado' ELSE 'capturado' END AS screenshot_status`,
        `NULL::text AS screenshot_erro`,
        `NULL::int AS screenshot_blob_id`
    ].join(',\n                    ');
}

function modernProjection(alias = '') {
    const prefix = alias ? `${alias}.` : '';
    return [
        `${prefix}incidente_id`,
        `${prefix}ticket_numero`,
        `${prefix}empresa_id`,
        `${prefix}usuario_id`,
        `${prefix}tipo_entrada`,
        `${prefix}mensagem_erro`,
        `${prefix}descricao_usuario`,
        `${prefix}url_pagina`,
        `${prefix}user_agent`,
        `${prefix}console_logs`,
        `${prefix}network_requests`,
        `${prefix}status`,
        `${prefix}usuario_inclusao`,
        `${prefix}data_inclusao`,
        `${prefix}sistema_origem`,
        `${prefix}ambiente_origem`,
        `${prefix}severidade`,
        `${prefix}codigo_alerta`,
        `${prefix}exibir_formulario_usuario`,
        `${prefix}metadados`,
        `${prefix}referencia_externa`,
        `${prefix}screenshot_status`,
        `${prefix}screenshot_erro`,
        `${prefix}screenshot_blob_id`
    ].join(',\n                    ');
}

async function carregarSchema(pool, force = false) {
    const now = Date.now();
    if (!force && schemaCache && now - schemaCacheAt < SCHEMA_CACHE_TTL_MS) {
        return schemaCache;
    }

    const colunasResult = await pool.query(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'incidentes_suporte'`
    );

    const tabelasResult = await pool.query(
        `SELECT table_name
         FROM information_schema.tables
         WHERE table_schema = 'public'
           AND table_name IN ('incidentes_suporte_anexos', 'blobs')`
    );

    const colunas = new Set(colunasResult.rows.map((row) => row.column_name));
    const tabelas = new Set(tabelasResult.rows.map((row) => row.table_name));

    schemaCache = {
        hasModernColumns:
            colunas.has('sistema_origem') &&
            colunas.has('severidade') &&
            colunas.has('metadados') &&
            colunas.has('screenshot_status'),
        hasAttachmentTable: tabelas.has('incidentes_suporte_anexos'),
        hasBlobTable: tabelas.has('blobs'),
        hasScreenshotBlobId: colunas.has('screenshot_blob_id'),
        hasScreenshotErro: colunas.has('screenshot_erro'),
        hasScreenshotStatus: colunas.has('screenshot_status'),
        projection: colunas.has('sistema_origem') ? modernProjection() : legacyProjection(),
        projectionWithAlias: (alias) => (colunas.has('sistema_origem') ? modernProjection(alias) : legacyProjection(alias))
    };
    schemaCacheAt = now;
    return schemaCache;
}

async function gerarTicket(pool) {
    const seqResult = await pool.query(`SELECT nextval('public.seq_incidentes_suporte') AS seq`);
    return gerarTicketNumero(seqResult.rows[0].seq);
}

async function registrarAnexo(pool, incidenteId, buffer, schema, {
    contentType = 'image/jpeg',
    nomeArquivo = null,
    tipoAnexo = 'screenshot',
    descricao = null,
    usuarioInclusao = 'egest.monitor'
} = {}) {
    if (!schema.hasBlobTable) {
        return {
            blobId: null,
            incidenteAnexoId: null,
            nomeArquivo: nomeArquivo || `${tipoAnexo}-${incidenteId}.${inferirExtensao(contentType)}`,
            contentType
        };
    }

    const tipoMime = CONTENT_TYPES_ANEXO.has(contentType) ? contentType : 'image/jpeg';
    const extensao = inferirExtensao(tipoMime);
    const nomePadrao = nomeArquivo || `${tipoAnexo}-${incidenteId}-${Date.now()}.${extensao}`;

    const blobResult = await pool.query(
        `INSERT INTO public.blobs (
            nome, descricao, dado, tipo_extensao,
            usuario_inclusao, data_inclusao, ativo, versao_registro
        ) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, true, 1)
        RETURNING blob_id`,
        [nomePadrao, descricao || `${tipoAnexo} do incidente ${incidenteId}`, buffer, extensao, usuarioInclusao]
    );

    const blobId = blobResult.rows[0].blob_id;

    if (!schema.hasAttachmentTable) {
        return {
            blobId,
            incidenteAnexoId: null,
            nomeArquivo: nomePadrao,
            contentType: tipoMime
        };
    }

    const anexoResult = await pool.query(
        `INSERT INTO public.incidentes_suporte_anexos (
            incidente_id, blob_id, nome_arquivo, content_type, tipo_anexo,
            tamanho_bytes, usuario_inclusao, data_inclusao
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
        RETURNING incidente_anexo_id`,
        [incidenteId, blobId, nomePadrao, tipoMime, tipoAnexo, buffer.length, usuarioInclusao]
    );

    return {
        blobId,
        incidenteAnexoId: anexoResult.rows[0].incidente_anexo_id,
        nomeArquivo: nomePadrao,
        contentType: tipoMime
    };
}

async function atualizarScreenshotIncidente(pool, incidenteId, schema, {
    dataUrl,
    blobId = null,
    status = 'capturado',
    erro = null,
    usuarioAlteracao = 'egest.monitor'
}) {
    const setParts = ['screenshot_blob = $1'];
    const params = [dataUrl];

    if (schema.hasScreenshotBlobId) {
        params.push(blobId);
        setParts.push(`screenshot_blob_id = $${params.length}`);
    }

    if (schema.hasScreenshotStatus) {
        params.push(status);
        setParts.push(`screenshot_status = $${params.length}`);
    }

    if (schema.hasScreenshotErro) {
        params.push(erro);
        setParts.push(`screenshot_erro = $${params.length}`);
    }

    params.push(usuarioAlteracao);
    setParts.push(`usuario_alteracao = $${params.length}`);
    setParts.push(`data_alteracao = CURRENT_TIMESTAMP`);
    params.push(incidenteId);

    await pool.query(
        `UPDATE public.incidentes_suporte
         SET ${setParts.join(', ')}
         WHERE incidente_id = $${params.length}`,
        params
    );
}

async function carregarAnexos(pool, incidenteId, schema, principal = null) {
    if (schema.hasAttachmentTable && schema.hasBlobTable) {
        const result = await pool.query(
            `SELECT
                a.incidente_anexo_id,
                a.incidente_id,
                a.blob_id,
                a.nome_arquivo,
                a.content_type,
                a.tipo_anexo,
                a.tamanho_bytes,
                a.data_inclusao,
                encode(b.dado, 'base64') AS dado_base64,
                b.tipo_extensao
             FROM public.incidentes_suporte_anexos a
             INNER JOIN public.blobs b
                ON b.blob_id = a.blob_id
               AND COALESCE(b.ativo, true) = true
             WHERE a.incidente_id = $1
             ORDER BY a.data_inclusao ASC`,
            [incidenteId]
        );

        return result.rows.map((row) => {
            const contentType = row.content_type || `image/${row.tipo_extensao || 'jpeg'}`;
            return {
                incidente_anexo_id: row.incidente_anexo_id,
                incidente_id: row.incidente_id,
                blob_id: row.blob_id,
                nome_arquivo: row.nome_arquivo,
                content_type: contentType,
                tipo_anexo: row.tipo_anexo,
                tamanho_bytes: row.tamanho_bytes,
                data_inclusao: row.data_inclusao,
                data_url: montarDataUrl(contentType, row.dado_base64)
            };
        });
    }

    if (principal?.screenshot_blob) {
        return [{
            incidente_anexo_id: null,
            incidente_id: principal.incidente_id,
            blob_id: null,
            nome_arquivo: `screenshot-${principal.incidente_id}.jpg`,
            content_type: 'image/jpeg',
            tipo_anexo: 'screenshot',
            tamanho_bytes: null,
            data_inclusao: principal.data_inclusao,
            data_url: principal.screenshot_blob
        }];
    }

    return [];
}

async function carregarIncidente(pool, id, empresaId, schema) {
    const empresaFiltro = isAdm(empresaId)
        ? `WHERE (i.incidente_id = $1 OR i.incidente_pai_id = $1)`
        : `WHERE (i.incidente_id = $1 OR i.incidente_pai_id = $1) AND i.empresa_id = $2`;
    const params = isAdm(empresaId) ? [id] : [id, empresaId];

    const result = await pool.query(
        `SELECT ${schema.projectionWithAlias('i')}, i.screenshot_blob
         FROM public.incidentes_suporte i ${empresaFiltro}
         ORDER BY i.data_inclusao ASC`,
        params
    );

    if (!result.rows.length) return null;

    const [principal, ...enriquecimentos] = result.rows;
    const anexos = await carregarAnexos(pool, principal.incidente_id, schema, principal);

    return { ...principal, anexos, enriquecimentos };
}

async function criarIncidenteMonitor(pool, payload, contexto = {}) {
    const schema = await carregarSchema(pool);
    const {
        mensagem_erro,
        url_pagina,
        user_agent,
        console_logs,
        network_requests,
        sistema_origem,
        ambiente_origem,
        severidade,
        codigo_alerta,
        exibir_formulario_usuario,
        metadados,
        referencia_externa,
        descricao_usuario,
        screenshot_base64,
        screenshot_content_type,
        screenshot_nome_arquivo
    } = payload;

    const empresaId = contexto.empresaId ?? null;
    const usuarioId = contexto.usuarioId ?? null;
    const usuarioInclusao = contexto.usuarioInclusao || 'egest.monitor';
    const ticketNumero = await gerarTicket(pool);
    const screenshotSolicitado = Boolean(normalizarTexto(screenshot_base64));

    let result;

    if (schema.hasModernColumns) {
        result = await pool.query(
            `INSERT INTO public.incidentes_suporte (
                ticket_numero, empresa_id, usuario_id, tipo_entrada,
                mensagem_erro, descricao_usuario, url_pagina, user_agent,
                console_logs, network_requests, usuario_inclusao, data_inclusao,
                sistema_origem, ambiente_origem, severidade, codigo_alerta,
                exibir_formulario_usuario, metadados, referencia_externa, screenshot_status
            ) VALUES (
                $1, $2, $3, 'monitor',
                $4, $5, $6, $7,
                $8::jsonb, $9::jsonb, $10, CURRENT_TIMESTAMP,
                $11, $12, $13, $14,
                $15, $16::jsonb, $17, $18
            )
            RETURNING incidente_id, ticket_numero, exibir_formulario_usuario, severidade`,
            [
                ticketNumero,
                empresaId,
                usuarioId,
                normalizarTexto(mensagem_erro),
                normalizarTexto(descricao_usuario),
                normalizarTexto(url_pagina),
                normalizarTexto(user_agent),
                JSON.stringify(normalizarArray(console_logs)),
                JSON.stringify(normalizarArray(network_requests)),
                usuarioInclusao,
                normalizarTexto(sistema_origem) || 'eGest',
                normalizarTexto(ambiente_origem),
                normalizarSeveridade(severidade),
                normalizarTexto(codigo_alerta),
                normalizarBooleano(exibir_formulario_usuario, true),
                JSON.stringify(normalizarMetadados(metadados)),
                normalizarTexto(referencia_externa),
                screenshotSolicitado ? 'pendente' : 'nao_solicitado'
            ]
        );
    } else {
        result = await pool.query(
            `INSERT INTO public.incidentes_suporte (
                ticket_numero, empresa_id, usuario_id, tipo_entrada,
                mensagem_erro, descricao_usuario, url_pagina, user_agent,
                console_logs, network_requests, usuario_inclusao, data_inclusao
            ) VALUES (
                $1, $2, $3, 'monitor',
                $4, $5, $6, $7,
                $8::jsonb, $9::jsonb, $10, CURRENT_TIMESTAMP
            )
            RETURNING incidente_id, ticket_numero`,
            [
                ticketNumero,
                empresaId,
                usuarioId,
                normalizarTexto(mensagem_erro),
                normalizarTexto(descricao_usuario),
                normalizarTexto(url_pagina),
                normalizarTexto(user_agent),
                JSON.stringify(normalizarArray(console_logs)),
                JSON.stringify(normalizarArray(network_requests)),
                usuarioInclusao
            ]
        );
    }

    const incidente = {
        exibir_formulario_usuario: schema.hasModernColumns
            ? result.rows[0].exibir_formulario_usuario
            : normalizarBooleano(exibir_formulario_usuario, true),
        severidade: schema.hasModernColumns
            ? result.rows[0].severidade
            : normalizarSeveridade(severidade),
        ...result.rows[0]
    };

    if (screenshotSolicitado) {
        try {
            const contentType = CONTENT_TYPES_ANEXO.has(screenshot_content_type)
                ? screenshot_content_type
                : 'image/jpeg';
            const rawBase64 = String(screenshot_base64).replace(/^data:[^;]+;base64,/, '');
            const buffer = Buffer.from(rawBase64, 'base64');

            if (!buffer.length || buffer.length > MAX_ANEXO_BYTES) {
                throw new Error('Screenshot invalida ou maior que 5MB.');
            }

            const anexo = await registrarAnexo(pool, incidente.incidente_id, buffer, schema, {
                contentType,
                nomeArquivo: screenshot_nome_arquivo || null,
                tipoAnexo: 'screenshot',
                usuarioInclusao
            });

            await atualizarScreenshotIncidente(pool, incidente.incidente_id, schema, {
                dataUrl: montarDataUrl(anexo.contentType, rawBase64),
                blobId: anexo.blobId,
                status: 'capturado',
                erro: null,
                usuarioAlteracao: usuarioInclusao
            });
        } catch (error) {
            if (schema.hasModernColumns) {
                await atualizarScreenshotIncidente(pool, incidente.incidente_id, schema, {
                    dataUrl: null,
                    blobId: null,
                    status: 'falha',
                    erro: error.message,
                    usuarioAlteracao: usuarioInclusao
                });
            }
        }
    }

    return incidente;
}

router.get('/', async (req, res) => {
    const empresaId = req.user?.empresa_id ?? null;
    const { status, tipo_entrada, limit = 50, offset = 0 } = req.query;
    const adm = isAdm(empresaId);

    try {
        const pool = getPoolSustentacao();
        const schema = await carregarSchema(pool);
        const params = [];
        let where = `WHERE incidente_pai_id IS NULL`;

        if (!adm) {
            params.push(empresaId);
            where += ` AND empresa_id = $${params.length} AND tipo_entrada = 'monitor'`;
        } else if (tipo_entrada) {
            params.push(tipo_entrada);
            where += ` AND tipo_entrada = $${params.length}`;
        }

        if (status) {
            params.push(status);
            where += ` AND status = $${params.length}`;
        }

        const countResult = await pool.query(
            `SELECT COUNT(*)::int AS total FROM public.incidentes_suporte ${where}`,
            params
        );

        params.push(limit, offset);
        const result = await pool.query(
            `SELECT ${schema.projection}
             FROM public.incidentes_suporte
             ${where}
             ORDER BY data_inclusao DESC
             LIMIT $${params.length - 1} OFFSET $${params.length}`,
            params
        );

        return res.json({ dados: result.rows, total: countResult.rows[0].total });
    } catch (err) {
        console.error('[suporte][incidentes][GET /]', err.message);
        return res.status(500).json({ erro: 'Erro ao listar incidentes' });
    }
});

router.get('/agest', async (req, res) => {
    const chave = req.headers['x-agest-key'];
    if (!chave || chave !== process.env.AGEST_KEY) {
        return res.status(401).json({ erro: 'Não autorizado.' });
    }

    const { status = 'aberto', limit = 30 } = req.query;

    try {
        const pool = getPoolSustentacao();
        const schema = await carregarSchema(pool);
        const projection = schema.hasModernColumns
            ? `${schema.projection}, screenshot_erro`
            : `${schema.projection}, NULL::text AS screenshot_erro`;

        const result = await pool.query(
            `SELECT ${projection}
             FROM public.incidentes_suporte
             WHERE incidente_pai_id IS NULL
               AND status = $1
             ORDER BY data_inclusao DESC
             LIMIT $2`,
            [status, limit]
        );

        return res.json({ dados: result.rows, total: result.rowCount });
    } catch (err) {
        console.error('[suporte][incidentes][GET /agest]', err.message);
        return res.status(500).json({ erro: 'Erro ao buscar chamados.' });
    }
});

router.get('/:id', async (req, res) => {
    const { id } = req.params;
    const empresaId = req.user?.empresa_id ?? null;

    try {
        const pool = getPoolSustentacao();
        const schema = await carregarSchema(pool);
        const incidente = await carregarIncidente(pool, id, empresaId, schema);

        if (!incidente) {
            return res.status(404).json({ erro: 'Incidente não encontrado' });
        }

        return res.json(incidente);
    } catch (err) {
        console.error('[suporte][incidentes][GET /:id]', err.message);
        return res.status(500).json({ erro: 'Erro ao buscar incidente' });
    }
});

router.post('/manual', async (req, res) => {
    const { assunto, descricao, severidade, sistema_origem, ambiente_origem, metadados } = req.body;
    const empresaId = req.user?.empresa_id ?? null;
    const usuarioId = req.user?.id ?? null;
    const usuarioNome = req.user?.nome || req.user?.login || String(usuarioId) || 'usuario';

    if (!assunto?.trim()) return res.status(400).json({ erro: 'Informe o assunto do chamado.' });

    try {
        const pool = getPoolSustentacao();
        const schema = await carregarSchema(pool);
        const ticketNumero = await gerarTicket(pool);

        const result = schema.hasModernColumns
            ? await pool.query(
                `INSERT INTO public.incidentes_suporte (
                    ticket_numero, empresa_id, usuario_id, tipo_entrada,
                    mensagem_erro, descricao_usuario,
                    usuario_inclusao, data_inclusao,
                    sistema_origem, ambiente_origem, severidade, metadados, exibir_formulario_usuario
                ) VALUES ($1, $2, $3, 'usuario', $4, $5, $6, CURRENT_TIMESTAMP, $7, $8, $9, $10::jsonb, true)
                RETURNING incidente_id, ticket_numero`,
                [
                    ticketNumero,
                    empresaId,
                    usuarioId,
                    assunto.trim(),
                    descricao?.trim() || null,
                    usuarioNome,
                    normalizarTexto(sistema_origem) || 'eGest',
                    normalizarTexto(ambiente_origem),
                    normalizarSeveridade(severidade),
                    JSON.stringify(normalizarMetadados(metadados))
                ]
            )
            : await pool.query(
                `INSERT INTO public.incidentes_suporte (
                    ticket_numero, empresa_id, usuario_id, tipo_entrada,
                    mensagem_erro, descricao_usuario,
                    usuario_inclusao, data_inclusao
                ) VALUES ($1, $2, $3, 'usuario', $4, $5, $6, CURRENT_TIMESTAMP)
                RETURNING incidente_id, ticket_numero`,
                [ticketNumero, empresaId, usuarioId, assunto.trim(), descricao?.trim() || null, usuarioNome]
            );

        return res.status(201).json({ ok: true, ...result.rows[0] });
    } catch (err) {
        console.error('[suporte][incidentes][POST /manual]', err.message);
        return res.status(500).json({ erro: 'Erro ao criar chamado.' });
    }
});

router.post('/integracao', async (req, res) => {
    const chave = req.headers['x-incidentes-key'];
    const chaveEsperada = process.env.SUPORTE_MONITOR_API_KEY;

    if (!chaveEsperada || !chave || chave !== chaveEsperada) {
        return res.status(401).json({ erro: 'Não autorizado.' });
    }

    try {
        const pool = getPoolSustentacao();
        const incidente = await criarIncidenteMonitor(pool, req.body, {
            empresaId: req.body?.empresa_id ?? null,
            usuarioId: req.body?.usuario_id ?? null,
            usuarioInclusao: normalizarTexto(req.body?.usuario_inclusao) || normalizarTexto(req.body?.sistema_origem) || 'integracao.monitor'
        });

        return res.status(201).json({
            status: 'OK',
            incidente_id: incidente.incidente_id,
            ticket_numero: incidente.ticket_numero,
            severidade: incidente.severidade,
            exibir_formulario_usuario: incidente.exibir_formulario_usuario
        });
    } catch (err) {
        console.error('[suporte][incidentes][POST /integracao]', err.message);
        return res.status(500).json({ erro: 'Erro ao registrar incidente externo.' });
    }
});

router.patch('/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    const empresaId = req.user?.empresa_id ?? null;
    const usuarioNome = req.user?.nome || req.user?.login || 'usuario';

    if (!STATUS_PERMITIDOS.includes(status)) return res.status(400).json({ erro: 'Status inválido.' });

    try {
        const pool = getPoolSustentacao();
        let query;
        let params;

        if (isAdm(empresaId)) {
            query = `UPDATE public.incidentes_suporte
                     SET status = $1, usuario_alteracao = $2, data_alteracao = CURRENT_TIMESTAMP
                     WHERE incidente_id = $3 AND incidente_pai_id IS NULL
                     RETURNING incidente_id, ticket_numero, status`;
            params = [status, usuarioNome, id];
        } else {
            query = `UPDATE public.incidentes_suporte
                     SET status = $1, usuario_alteracao = $2, data_alteracao = CURRENT_TIMESTAMP
                     WHERE incidente_id = $3 AND empresa_id = $4 AND incidente_pai_id IS NULL
                     RETURNING incidente_id, ticket_numero, status`;
            params = [status, usuarioNome, id, empresaId];
        }

        const result = await pool.query(query, params);
        if (result.rowCount === 0) return res.status(404).json({ erro: 'Incidente não encontrado.' });
        return res.json({ ok: true, ...result.rows[0] });
    } catch (err) {
        console.error('[suporte][incidentes][PATCH /:id/status]', err.message);
        return res.status(500).json({ erro: 'Erro ao atualizar status.' });
    }
});

router.post('/', async (req, res) => {
    const empresaId = req.user?.empresa_id ?? null;
    const usuarioId = req.user?.id ?? null;

    try {
        const pool = getPoolSustentacao();
        const incidente = await criarIncidenteMonitor(pool, req.body, {
            empresaId,
            usuarioId,
            usuarioInclusao: 'egest.monitor'
        });

        return res.status(201).json({
            status: 'OK',
            incidente_id: incidente.incidente_id,
            ticket_numero: incidente.ticket_numero,
            severidade: incidente.severidade,
            exibir_formulario_usuario: incidente.exibir_formulario_usuario
        });
    } catch (err) {
        console.error('[suporte][incidentes][POST]', err.message);
        return res.status(500).json({ erro: 'Erro ao registrar incidente' });
    }
});

router.post('/:id/anexos', async (req, res) => {
    const { id } = req.params;
    const empresaId = req.user?.empresa_id ?? null;
    const usuarioNome = req.user?.nome || req.user?.login || 'usuario';
    const {
        dado_base64,
        content_type,
        nome_arquivo,
        tipo_anexo = 'arquivo'
    } = req.body;

    if (!normalizarTexto(dado_base64)) {
        return res.status(400).json({ erro: 'Conteúdo do anexo não informado.' });
    }

    try {
        const pool = getPoolSustentacao();
        const schema = await carregarSchema(pool);
        const empresaFiltro = isAdm(empresaId)
            ? `WHERE incidente_id = $1`
            : `WHERE incidente_id = $1 AND empresa_id = $2`;
        const params = isAdm(empresaId) ? [id] : [id, empresaId];

        const check = await pool.query(
            `SELECT incidente_id FROM public.incidentes_suporte ${empresaFiltro}`,
            params
        );
        if (check.rowCount === 0) {
            return res.status(404).json({ erro: 'Incidente não encontrado.' });
        }

        const mimeType = CONTENT_TYPES_ANEXO.has(content_type) ? content_type : 'image/jpeg';
        const rawBase64 = String(dado_base64).replace(/^data:[^;]+;base64,/, '');
        const buffer = Buffer.from(rawBase64, 'base64');

        if (!buffer.length || buffer.length > MAX_ANEXO_BYTES) {
            return res.status(400).json({ erro: 'Anexo inválido ou maior que 5MB.' });
        }

        const anexo = await registrarAnexo(pool, id, buffer, schema, {
            contentType: mimeType,
            nomeArquivo: normalizarTexto(nome_arquivo),
            tipoAnexo: normalizarTexto(tipo_anexo) || 'arquivo',
            usuarioInclusao: usuarioNome
        });

        if ((tipo_anexo || '').toLowerCase() === 'screenshot') {
            await atualizarScreenshotIncidente(pool, id, schema, {
                dataUrl: montarDataUrl(anexo.contentType, rawBase64),
                blobId: anexo.blobId,
                status: 'capturado',
                erro: null,
                usuarioAlteracao: usuarioNome
            });
        }

        return res.status(201).json({ status: 'OK', ...anexo });
    } catch (err) {
        console.error('[suporte][incidentes][POST anexos]', err.message);
        return res.status(500).json({ erro: 'Erro ao salvar anexo.' });
    }
});

router.put(
    '/:id/screenshot',
    express.raw({
        type: (req) => CONTENT_TYPES_ANEXO.has(getContentTypeImagem(req.headers['content-type'])),
        limit: `${MAX_ANEXO_BYTES}b`
    }),
    async (req, res) => {
        const { id } = req.params;
        const empresaId = req.user?.empresa_id ?? null;
        const usuarioNome = req.user?.nome || req.user?.login || 'usuario';

        if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
            return res.status(400).json({ erro: 'Imagem ausente ou inválida.' });
        }

        try {
            const pool = getPoolSustentacao();
            const schema = await carregarSchema(pool);
            const empresaFiltro = isAdm(empresaId)
                ? `WHERE incidente_id = $1`
                : `WHERE incidente_id = $1 AND empresa_id = $2`;
            const params = isAdm(empresaId) ? [id] : [id, empresaId];

            const check = await pool.query(
                `SELECT incidente_id FROM public.incidentes_suporte ${empresaFiltro}`,
                params
            );
            if (check.rowCount === 0) {
                return res.status(404).json({ erro: 'Incidente não encontrado.' });
            }

            const contentType = getContentTypeImagem(req.headers['content-type']) || 'image/jpeg';
            const anexo = await registrarAnexo(pool, id, req.body, schema, {
                contentType,
                tipoAnexo: 'screenshot',
                usuarioInclusao: usuarioNome
            });

            await atualizarScreenshotIncidente(pool, id, schema, {
                dataUrl: montarDataUrl(anexo.contentType, req.body.toString('base64')),
                blobId: anexo.blobId,
                status: 'capturado',
                erro: null,
                usuarioAlteracao: usuarioNome
            });

            return res.json({ status: 'OK', ...anexo });
        } catch (err) {
            console.error('[suporte][incidentes][PUT screenshot]', err.message);

            try {
                const pool = getPoolSustentacao();
                const schema = await carregarSchema(pool);
                if (schema.hasModernColumns) {
                    await atualizarScreenshotIncidente(pool, id, schema, {
                        dataUrl: null,
                        blobId: null,
                        status: 'falha',
                        erro: err.message,
                        usuarioAlteracao: usuarioNome
                    });
                }
            } catch {
            }

            return res.status(500).json({ erro: 'Erro ao salvar screenshot.' });
        }
    }
);

router.put('/:id/enriquecer', async (req, res) => {
    const { id } = req.params;
    const { descricao_usuario } = req.body;

    const empresaId = req.user?.empresa_id ?? null;
    const usuarioId = req.user?.id ?? null;
    const usuarioNome = req.user?.nome || req.user?.login || String(usuarioId) || 'usuario';

    try {
        const pool = getPoolSustentacao();
        const schema = await carregarSchema(pool);
        const empresaFiltro = isAdm(empresaId)
            ? `WHERE incidente_id = $1 AND tipo_entrada = 'monitor'`
            : `WHERE incidente_id = $1 AND empresa_id = $2 AND tipo_entrada = 'monitor'`;
        const parentParams = isAdm(empresaId) ? [id] : [id, empresaId];

        const parentResult = await pool.query(
            `SELECT incidente_id, ticket_numero, usuario_id
             FROM public.incidentes_suporte ${empresaFiltro}`,
            parentParams
        );

        if (parentResult.rows.length === 0) {
            return res.status(404).json({ erro: 'Incidente não encontrado' });
        }

        const { ticket_numero, usuario_id: targetUserId } = parentResult.rows[0];

        if (schema.hasModernColumns) {
            await pool.query(
                `INSERT INTO public.incidentes_suporte (
                    ticket_numero, empresa_id, usuario_id, tipo_entrada, incidente_pai_id,
                    descricao_usuario, usuario_inclusao, data_inclusao,
                    sistema_origem, severidade, exibir_formulario_usuario, metadados
                ) VALUES ($1, $2, $3, 'usuario', $4, $5, $6, CURRENT_TIMESTAMP, 'eGest', 'operacional', true, '{}'::jsonb)`,
                [ticket_numero, empresaId, usuarioId, id, descricao_usuario || null, usuarioNome]
            );
        } else {
            await pool.query(
                `INSERT INTO public.incidentes_suporte (
                    ticket_numero, empresa_id, usuario_id, tipo_entrada, incidente_pai_id,
                    descricao_usuario, usuario_inclusao, data_inclusao
                ) VALUES ($1, $2, $3, 'usuario', $4, $5, $6, CURRENT_TIMESTAMP)`,
                [ticket_numero, empresaId, usuarioId, id, descricao_usuario || null, usuarioNome]
            );
        }

        if (targetUserId) {
            const tituloNotif = `Incidente ${ticket_numero} registrado`;
            const msgNotif = `Seu relatório foi recebido pelo suporte técnico. Acompanhe o status em Ajuda > Meus Chamados.`;
            await req.pool.query(
                `INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, situacao, data_inclusao)
                 VALUES ($1, $2, $3, 0, CURRENT_TIMESTAMP)`,
                [targetUserId, tituloNotif, msgNotif]
            );
        }

        return res.json({ status: 'OK', ticket_numero });
    } catch (err) {
        console.error('[suporte][incidentes][PUT enriquecer]', err.message);
        return res.status(500).json({ erro: 'Erro ao registrar enriquecimento do incidente' });
    }
});

export default router;
