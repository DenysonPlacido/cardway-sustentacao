'use strict';

function normalizarValor(valorStr) {
  let v = String(valorStr).trim();
  v = v.replace(/\./g, '').replace(',', '.');
  return parseFloat(v) || 0;
}

function valorParaXlsx(valorStr) {
  let v = String(valorStr).trim();
  if (!v) return '';
  if (v.includes(',')) {
    v = v.replace(/\./g, '');
    const partes = v.split(',');
    const inteiro = partes[0];
    const decimal = (partes[1] + '00').slice(0, 2);
    return inteiro + decimal;
  }
  return v.replace(/\./g, '') + '00';
}

function gerarScript(config, rows) {
  const glpi        = config.glpi || '';
  const campanha    = config.campanha || '';
  const dadosComp   = (config.dados_complementares || '').replace(/'/g, "''");
  const tipoTrn     = config.tipo_transacao_id ?? 150;
  const natureza    = config.natureza ?? 0;
  const modalidade  = config.modalidade ?? 1;
  const impacto     = config.impacto_limite ?? 0;
  const enviaFila   = config.envia_fila ?? 1;
  const canalVenda  = config.canal_venda ?? 1;
  const quantidade  = config.quantidade ?? 1;
  const total       = rows.length;
  const dataGer     = new Date().toLocaleDateString('pt-BR');

  return `/*============================================================
  Lançamento de Crédito de Estabelecimento - Limite GLOBAL
  GLPI: ${glpi}
  Campanha: ${campanha}
  Gerado em: ${dataGer}
  Registros: ${total}
============================================================*/

PROMPT
SPOOL lanc_cred_lim_global_glpi_${glpi}.log
PROMPT ============================================================
PROMPT  INÍCIO DO PROCESSAMENTO
PROMPT ============================================================

SET VERIFY OFF
SET HEADING OFF
SET SERVEROUTPUT ON SIZE UNLIMITED

SELECT 'Hora de inicio: ' || TO_CHAR(SYSDATE, 'DD/MM/YYYY HH24:MI:SS') FROM DUAL;

DECLARE

    V_ID_TRANSACAO   NUMBER;
    V_TRANSACAO_ID   NUMBER;
    V_QTD_SUCESSO    NUMBER := 0;
    V_QTD_ERRO       NUMBER := 0;
    V_QTD_TOTAL      NUMBER := 0;

    C_DADOS_COMPLEMENTARES CONSTANT VARCHAR2(200) :=
        '${dadosComp}';
    C_TIPO_TRANSACAO_ID    CONSTANT NUMBER := ${tipoTrn};
    C_NATUREZA             CONSTANT NUMBER := ${natureza};
    C_MODALIDADE           CONSTANT NUMBER := ${modalidade};
    C_IMPACTO_LIMITE       CONSTANT NUMBER := ${impacto};
    C_ENVIA_FILA           CONSTANT NUMBER := ${enviaFila};
    C_CANAL_VENDA          CONSTANT NUMBER := ${canalVenda};
    C_QUANTIDADE           CONSTANT NUMBER := ${quantidade};

    ------------------------------------------------------------
    -- PROCEDURE: LANCA_TRANSACAO
    ------------------------------------------------------------
    PROCEDURE LANCA_TRANSACAO (
        P_TIPO_TRANSACAO_ID            IN  NUMBER,
        P_VALOR                        IN  NUMBER,
        P_EMPRESA_ID                   IN  NUMBER,
        P_ESTABELECIMENTO_EMPRESA_ID   IN  NUMBER,
        P_REDE_ID                      IN  NUMBER,
        P_DISTRIBUICAO_PROPRIA         IN  NUMBER,
        P_CONSULTOR_ID                 IN  NUMBER,
        P_SUPERVISOR_ID                IN  NUMBER,
        P_COORDENADOR_ID               IN  NUMBER,
        P_NATUREZA                     IN  NUMBER,
        P_MODALIDADE                   IN  NUMBER,
        P_IMPACTO_LIMITE               IN  NUMBER,
        P_ENVIA_FILA                   IN  NUMBER,
        P_CICLO_RECEBIMENTO_ID         IN  NUMBER,
        P_RECEBIVEL_ID                 IN  NUMBER,
        P_LIMITE_ID                    IN  NUMBER,
        P_TERMINAL_ID                  IN  NUMBER   DEFAULT NULL,
        P_QUANTIDADE                   IN  NUMBER   DEFAULT NULL,
        P_PARCELAS                     IN  NUMBER   DEFAULT NULL,
        P_CANAL_VENDA                  IN  NUMBER   DEFAULT 0,
        P_PRODUTO_ID                   IN  NUMBER   DEFAULT NULL,
        P_PRODUTO_VENDA_ID             IN  NUMBER   DEFAULT NULL,
        P_PRODUTO_CORRESP_BANCARIO_ID  IN  NUMBER   DEFAULT NULL,
        P_NEGOCIO_ID                   IN  NUMBER   DEFAULT NULL,
        P_FORNECEDOR_ID                IN  NUMBER   DEFAULT NULL,
        P_DATA_TRANSACAO               IN  DATE     DEFAULT SYSDATE,
        P_STAN_PARCEIRO                IN  NUMBER   DEFAULT NULL,
        P_TELEFONE                     IN  VARCHAR2 DEFAULT NULL,
        P_TIPO_PRODUTO_VENDIDO         IN  NUMBER   DEFAULT NULL,
        P_RESPONSAVEL_VENDA_ID         IN  NUMBER   DEFAULT NULL,
        P_FILIAL_EMPRESA_ID            IN  NUMBER   DEFAULT NULL,
        P_FUSO_HORARIO                 IN  NUMBER   DEFAULT NULL,
        P_VALOR_POSSIVEL_ID            IN  NUMBER   DEFAULT NULL,
        P_RESPONSAVEL_LIMITE_ID        IN  NUMBER   DEFAULT NULL,
        P_LIMITE_UNIFICADO             IN  NUMBER   DEFAULT NULL,
        P_TARIFACAO                    IN  NUMBER   DEFAULT 0,
        P_DATA_PAGAMENTO               IN  DATE     DEFAULT TRUNC(SYSDATE),
        P_DADOS_COMPLEMENTARES         IN  VARCHAR2 DEFAULT NULL,
        P_TRANSACAO_ID                 OUT NUMBER
    ) IS
        V_DATA_TRANSACAO DATE;
        V_USUARIO_ID     NUMBER := 1;
    BEGIN
        ADM_SGV.SGV_TRN_PK005.GERA_ID(V_ID_TRANSACAO);
        V_DATA_TRANSACAO := P_DATA_TRANSACAO;

        INSERT INTO ADM_SGV_TRN.TRANSACAO (
             ID                            -- 01
            ,CANAL_VENDA                   -- 02
            ,DATA_TRANSACAO                -- 03
            ,DATA_SERVIDOR                 -- 04
            ,HORARIO_VERAO                 -- 05
            ,DATA_CLIENTE                  -- 06
            ,MODALIDADE                    -- 07
            ,VALOR                         -- 08
            ,NATUREZA                      -- 09
            ,TARIFACAO                     -- 10
            ,DATA_INCLUSAO                 -- 11
            ,TIPO_TRANSACAO_ID             -- 12
            ,ESTABELECIMENTO_EMPRESA_ID    -- 13
            ,EMPRESA_ID                    -- 14
            ,INTEGRADOR_ID                 -- 15
            ,USUARIO_ID                    -- 16
            ,CICLO_RECEBIMENTO_ID          -- 17
            ,TRANSACAO_ORIGEM_ID           -- 18
            ,PRODUTO_VENDA_ID              -- 19
            ,FORNECEDOR_ID                 -- 20
            ,NEGOCIO_ID                    -- 21
            ,PRODUTO_ID                    -- 22
            ,LIMITE_ID                     -- 23
            ,RECEBIVEL_ID                  -- 24
            ,ESTOQUE_PIN_ID                -- 25
            ,CODIGO_AUTORIZACAO            -- 26
            ,FUSO_HORARIO                  -- 27
            ,DADOS_COMPLEMENTARES          -- 28
            ,SITUACAO_TRANSACAO            -- 29
            ,SITUACAO_ANTERIOR             -- 30
            ,DATA_SITUACAO                 -- 31
            ,BYTES_ENVIADOS                -- 32
            ,BYTES_RECEBIDOS               -- 33
            ,PARCELAS                      -- 34
            ,PAN                           -- 35
            ,NUMERO_CARTAO                 -- 36
            ,QUANTIDADE                    -- 37
            ,MOEDA                         -- 38
            ,EMPRESTIMO                    -- 39
            ,CODIGO_EMPRESTIMO             -- 40
            ,ICCID                         -- 41
            ,NUMERO_SERIE                  -- 42
            ,TERMINAL_ID                   -- 43
            ,CODIGO_AREA                   -- 44
            ,TELEFONE                      -- 45
            ,CODIGO_RESPOSTA_REMOTO        -- 46
            ,COMPROVANTE                   -- 47
            ,DATA_FIM                      -- 48
            ,DATA_INICIO                   -- 49
            ,DATA_UNIVERSAL                -- 50
            ,IRC                           -- 51
            ,ITC                           -- 52
            ,REV_IND                       -- 53
            ,STAN_LOCAL                    -- 54
            ,STAN_REQUISITANTE             -- 55
            ,STAN_PARCEIRO                 -- 56
            ,CODIGO_ORIGEM                 -- 57
            ,PIN                           -- 58
            ,CODIGO_RESPOSTA               -- 59
            ,ANDAMENTO                     -- 60
            ,VERSAO_REGISTRO               -- 61
            ,CODIGO_AUTORIZACAO_REMOTO     -- 62
            ,CPF_CNPJ                      -- 63
            ,MODO_ENTRADA                  -- 64
            ,DURACAO                       -- 65
            ,CODIGO_PROCESSAMENTO          -- 66
            ,STAN_EMPRESA                  -- 67
            ,DATA_EMPRESA                  -- 68
            ,FILIAL                        -- 69
            ,CANAL_SAIDA                   -- 70
            ,DATA_PAGAMENTO                -- 71
            ,VERSAO_BINARIO                -- 72
            ,CODIGO_RESPOSTA_ID            -- 73
            ,TIPO_PROTOCOLO                -- 74
            ,PROTOCOLO_COMUNICACAO         -- 75
            ,CHIP_ID                       -- 76
            ,FILIAL_ID                     -- 77
            ,OPERACAO_ID                   -- 78
            ,TIPO_PRODUTO_VENDIDO          -- 79
            ,GRUPO_VENDA_ID                -- 80
            ,LOTE_PIN_ID                   -- 81
            ,CONSULTOR_ID                  -- 82
            ,MODALIDADE_TIPO_TRANSACAO     -- 83
            ,SUPERVISOR_ID                 -- 84
            ,COORDENADOR_ID               -- 85
            ,IMPACTO_LIMITE                -- 86
            ,SIG_FORNEC                    -- 87
            ,DATA_PARCEIRO                 -- 88
            ,LIMITE_UNIFICADO              -- 89
            ,RESPONSAVEL_LIMITE_ID         -- 90
            ,DISTRIBUICAO_PROPRIA          -- 91
            ,REDE_ID                       -- 92
            ,CODIGO_RESPOSTA_REMOTO_ID     -- 93
            ,ENDERECO_ORIGEM               -- 94
            ,OPERACAO_ITEM_EMPRESA_ID      -- 95
            ,RESPONSAVEL_VENDA_ID          -- 96
            ,VALOR_POSSIVEL_ID             -- 97
            ,FILIAL_EMPRESA_ID             -- 98
            ,PRODUTO_CORRESP_BANCARIO_ID   -- 99
            ,USUARIO_VENDA_ID              -- 100
        ) VALUES (
             V_ID_TRANSACAO                -- 01 ID
            ,P_CANAL_VENDA                 -- 02 CANAL_VENDA
            ,V_DATA_TRANSACAO              -- 03 DATA_TRANSACAO
            ,V_DATA_TRANSACAO              -- 04 DATA_SERVIDOR
            ,0                             -- 05 HORARIO_VERAO
            ,V_DATA_TRANSACAO              -- 06 DATA_CLIENTE
            ,P_ENVIA_FILA                  -- 07 MODALIDADE
            ,P_VALOR                       -- 08 VALOR
            ,P_NATUREZA                    -- 09 NATUREZA
            ,P_TARIFACAO                   -- 10 TARIFACAO
            ,V_DATA_TRANSACAO              -- 11 DATA_INCLUSAO
            ,P_TIPO_TRANSACAO_ID           -- 12 TIPO_TRANSACAO_ID
            ,P_ESTABELECIMENTO_EMPRESA_ID  -- 13 ESTABELECIMENTO_EMPRESA_ID
            ,P_EMPRESA_ID                  -- 14 EMPRESA_ID
            ,1                             -- 15 INTEGRADOR_ID
            ,V_USUARIO_ID                  -- 16 USUARIO_ID
            ,P_CICLO_RECEBIMENTO_ID        -- 17 CICLO_RECEBIMENTO_ID
            ,NULL                          -- 18 TRANSACAO_ORIGEM_ID
            ,P_PRODUTO_VENDA_ID            -- 19 PRODUTO_VENDA_ID
            ,P_FORNECEDOR_ID               -- 20 FORNECEDOR_ID
            ,P_NEGOCIO_ID                  -- 21 NEGOCIO_ID
            ,P_PRODUTO_ID                  -- 22 PRODUTO_ID
            ,P_LIMITE_ID                   -- 23 LIMITE_ID
            ,P_RECEBIVEL_ID                -- 24 RECEBIVEL_ID
            ,NULL                          -- 25 ESTOQUE_PIN_ID
            ,NULL                          -- 26 CODIGO_AUTORIZACAO
            ,P_FUSO_HORARIO                -- 27 FUSO_HORARIO
            ,P_DADOS_COMPLEMENTARES        -- 28 DADOS_COMPLEMENTARES
            ,0                             -- 29 SITUACAO_TRANSACAO
            ,NULL                          -- 30 SITUACAO_ANTERIOR
            ,V_DATA_TRANSACAO              -- 31 DATA_SITUACAO
            ,NULL                          -- 32 BYTES_ENVIADOS
            ,NULL                          -- 33 BYTES_RECEBIDOS
            ,P_PARCELAS                    -- 34 PARCELAS
            ,NULL                          -- 35 PAN
            ,NULL                          -- 36 NUMERO_CARTAO
            ,P_QUANTIDADE                  -- 37 QUANTIDADE
            ,'R$'                          -- 38 MOEDA
            ,0                             -- 39 EMPRESTIMO
            ,NULL                          -- 40 CODIGO_EMPRESTIMO
            ,NULL                          -- 41 ICCID
            ,NULL                          -- 42 NUMERO_SERIE
            ,P_TERMINAL_ID                 -- 43 TERMINAL_ID
            ,NULL                          -- 44 CODIGO_AREA
            ,P_TELEFONE                    -- 45 TELEFONE
            ,NULL                          -- 46 CODIGO_RESPOSTA_REMOTO
            ,NULL                          -- 47 COMPROVANTE
            ,V_DATA_TRANSACAO              -- 48 DATA_FIM
            ,V_DATA_TRANSACAO              -- 49 DATA_INICIO
            ,NULL                          -- 50 DATA_UNIVERSAL
            ,NULL                          -- 51 IRC
            ,NULL                          -- 52 ITC
            ,NULL                          -- 53 REV_IND
            ,NULL                          -- 54 STAN_LOCAL
            ,NULL                          -- 55 STAN_REQUISITANTE
            ,P_STAN_PARCEIRO               -- 56 STAN_PARCEIRO
            ,NULL                          -- 57 CODIGO_ORIGEM
            ,NULL                          -- 58 PIN
            ,NULL                          -- 59 CODIGO_RESPOSTA
            ,NULL                          -- 60 ANDAMENTO
            ,NULL                          -- 61 VERSAO_REGISTRO
            ,NULL                          -- 62 CODIGO_AUTORIZACAO_REMOTO
            ,NULL                          -- 63 CPF_CNPJ
            ,NULL                          -- 64 MODO_ENTRADA
            ,NULL                          -- 65 DURACAO
            ,NULL                          -- 66 CODIGO_PROCESSAMENTO
            ,NULL                          -- 67 STAN_EMPRESA
            ,NULL                          -- 68 DATA_EMPRESA
            ,NULL                          -- 69 FILIAL
            ,NULL                          -- 70 CANAL_SAIDA
            ,P_DATA_PAGAMENTO              -- 71 DATA_PAGAMENTO
            ,NULL                          -- 72 VERSAO_BINARIO
            ,NULL                          -- 73 CODIGO_RESPOSTA_ID
            ,NULL                          -- 74 TIPO_PROTOCOLO
            ,NULL                          -- 75 PROTOCOLO_COMUNICACAO
            ,NULL                          -- 76 CHIP_ID
            ,NULL                          -- 77 FILIAL_ID
            ,NULL                          -- 78 OPERACAO_ID
            ,P_TIPO_PRODUTO_VENDIDO        -- 79 TIPO_PRODUTO_VENDIDO
            ,NULL                          -- 80 GRUPO_VENDA_ID
            ,NULL                          -- 81 LOTE_PIN_ID
            ,P_CONSULTOR_ID                -- 82 CONSULTOR_ID
            ,P_MODALIDADE                  -- 83 MODALIDADE_TIPO_TRANSACAO
            ,P_SUPERVISOR_ID               -- 84 SUPERVISOR_ID
            ,P_COORDENADOR_ID              -- 85 COORDENADOR_ID
            ,P_IMPACTO_LIMITE              -- 86 IMPACTO_LIMITE
            ,NULL                          -- 87 SIG_FORNEC
            ,NULL                          -- 88 DATA_PARCEIRO
            ,P_LIMITE_UNIFICADO            -- 89 LIMITE_UNIFICADO
            ,P_RESPONSAVEL_LIMITE_ID       -- 90 RESPONSAVEL_LIMITE_ID
            ,P_DISTRIBUICAO_PROPRIA        -- 91 DISTRIBUICAO_PROPRIA
            ,P_REDE_ID                     -- 92 REDE_ID
            ,NULL                          -- 93 CODIGO_RESPOSTA_REMOTO_ID
            ,NULL                          -- 94 ENDERECO_ORIGEM
            ,NULL                          -- 95 OPERACAO_ITEM_EMPRESA_ID
            ,P_RESPONSAVEL_VENDA_ID        -- 96 RESPONSAVEL_VENDA_ID
            ,P_VALOR_POSSIVEL_ID           -- 97 VALOR_POSSIVEL_ID
            ,P_FILIAL_EMPRESA_ID           -- 98 FILIAL_EMPRESA_ID
            ,P_PRODUTO_CORRESP_BANCARIO_ID -- 99 PRODUTO_CORRESP_BANCARIO_ID
            ,P_CONSULTOR_ID                -- 100 USUARIO_VENDA_ID
        );

        P_TRANSACAO_ID := V_ID_TRANSACAO;
    EXCEPTION
        WHEN OTHERS THEN RAISE;
    END LANCA_TRANSACAO;

BEGIN

    DBMS_OUTPUT.PUT_LINE('--------------------------------------------------');
    DBMS_OUTPUT.PUT_LINE(RPAD('SEQ',6)||RPAD('TRANSACAO_ID',14)||RPAD('ESTAB_ID',12)||'EMPRESA_ID');
    DBMS_OUTPUT.PUT_LINE('--------------------------------------------------');

    FOR X IN (
        SELECT
            ee.empresa_id, ee.filial_empresa_id,
            ee.id AS estabelecimento_empresa_id,
            ee.rede_id, ce.distribuicao_propria,
            ee.consultor_id, hc.supervisor_id, hc.coordenador_id,
            ci.ciclo_recebimento_id, ci.recebivel_id, ci.limite_id,
            ax.aux2 AS valor
        FROM
                 adm_sgv.estabelecimento_empresa   ee
            INNER JOIN adm_sgv.configuracao_empresa    ce ON ce.empresa_id = ee.empresa_id AND ce.ativo = 1
            LEFT  JOIN adm_sgv.hierarquia_consultor_v  hc ON hc.consultor_id = ee.consultor_id
            INNER JOIN (
                SELECT cr.id AS ciclo_recebimento_id, cr.recebivel_id,
                       cr.limite_id, cr.estabelecimento_empresa_id, l.negocio_id
                FROM adm_sgv.ciclo_recebimento cr
                INNER JOIN adm_sgv.limite l ON l.id = cr.limite_id AND l.ativo = 1 AND l.tipo = 1
                WHERE cr.ativo = 1 AND cr.tipo_ciclo_recebimento = 0
            ) ci ON ci.estabelecimento_empresa_id = ee.id
            INNER JOIN adm_sgv_tmp.table_aux_ciso ax ON ax.aux1 = ee.id
        WHERE ee.ativo = 1 AND ee.situacao != 0
    )
    LOOP
        V_QTD_TOTAL := V_QTD_TOTAL + 1;
        BEGIN
            LANCA_TRANSACAO(
                 P_TIPO_TRANSACAO_ID           => C_TIPO_TRANSACAO_ID
                ,P_VALOR                       => X.VALOR
                ,P_EMPRESA_ID                  => X.EMPRESA_ID
                ,P_ESTABELECIMENTO_EMPRESA_ID  => X.ESTABELECIMENTO_EMPRESA_ID
                ,P_REDE_ID                     => X.REDE_ID
                ,P_DISTRIBUICAO_PROPRIA        => X.DISTRIBUICAO_PROPRIA
                ,P_CONSULTOR_ID                => X.CONSULTOR_ID
                ,P_SUPERVISOR_ID               => X.SUPERVISOR_ID
                ,P_COORDENADOR_ID              => X.COORDENADOR_ID
                ,P_NATUREZA                    => C_NATUREZA
                ,P_MODALIDADE                  => C_MODALIDADE
                ,P_IMPACTO_LIMITE              => C_IMPACTO_LIMITE
                ,P_ENVIA_FILA                  => C_ENVIA_FILA
                ,P_CICLO_RECEBIMENTO_ID        => X.CICLO_RECEBIMENTO_ID
                ,P_RECEBIVEL_ID                => X.RECEBIVEL_ID
                ,P_LIMITE_ID                   => X.LIMITE_ID
                ,P_TERMINAL_ID                 => NULL
                ,P_QUANTIDADE                  => C_QUANTIDADE
                ,P_PARCELAS                    => NULL
                ,P_CANAL_VENDA                 => C_CANAL_VENDA
                ,P_PRODUTO_ID                  => NULL
                ,P_PRODUTO_VENDA_ID            => NULL
                ,P_PRODUTO_CORRESP_BANCARIO_ID => NULL
                ,P_NEGOCIO_ID                  => NULL
                ,P_FORNECEDOR_ID               => NULL
                ,P_FILIAL_EMPRESA_ID           => X.FILIAL_EMPRESA_ID
                ,P_DADOS_COMPLEMENTARES        => C_DADOS_COMPLEMENTARES
                ,P_TRANSACAO_ID                => V_TRANSACAO_ID
            );
            V_QTD_SUCESSO := V_QTD_SUCESSO + 1;
            DBMS_OUTPUT.PUT_LINE(
                RPAD(TO_CHAR(V_QTD_TOTAL),6)||RPAD(TO_CHAR(V_TRANSACAO_ID),14)||
                RPAD(TO_CHAR(X.ESTABELECIMENTO_EMPRESA_ID),12)||TO_CHAR(X.EMPRESA_ID)
            );
            IF MOD(V_QTD_SUCESSO,500)=0 THEN
                COMMIT;
                DBMS_OUTPUT.PUT_LINE('>>> ['||TO_CHAR(SYSDATE,'HH24:MI:SS')||'] '||V_QTD_SUCESSO||' transações confirmadas (lote parcial)...');
            END IF;
        EXCEPTION
            WHEN OTHERS THEN
                V_QTD_ERRO := V_QTD_ERRO + 1;
                DBMS_OUTPUT.PUT_LINE(RPAD(TO_CHAR(V_QTD_TOTAL),6)||RPAD('(erro)',14)||
                    RPAD(TO_CHAR(X.ESTABELECIMENTO_EMPRESA_ID),12)||TO_CHAR(X.EMPRESA_ID)||' | ERRO: '||SQLERRM);
        END;
    END LOOP;

    COMMIT;
    DBMS_OUTPUT.PUT_LINE('--------------------------------------------------');
    DBMS_OUTPUT.PUT_LINE('');
    DBMS_OUTPUT.PUT_LINE('============================================');
    DBMS_OUTPUT.PUT_LINE('RESULTADO FINAL');
    DBMS_OUTPUT.PUT_LINE('--------------------------------------------');
    DBMS_OUTPUT.PUT_LINE('Total processado : ' || V_QTD_TOTAL);
    DBMS_OUTPUT.PUT_LINE('Sucesso          : ' || V_QTD_SUCESSO);
    DBMS_OUTPUT.PUT_LINE('Erros            : ' || V_QTD_ERRO);
    DBMS_OUTPUT.PUT_LINE('============================================');

EXCEPTION
    WHEN OTHERS THEN
        ROLLBACK;
        DBMS_OUTPUT.PUT_LINE('ERRO CRITICO - ROLLBACK executado: ' || SQLERRM);
        RAISE;
END;
/

SELECT 'Hora de termino: ' || TO_CHAR(SYSDATE, 'DD/MM/YYYY HH24:MI:SS') FROM DUAL;

PROMPT
PROMPT ============================================================
PROMPT  FIM DO PROCESSAMENTO
PROMPT ============================================================
PROMPT

SPOOL OFF
`;
}

module.exports = { normalizarValor, valorParaXlsx, gerarScript };
