import OpenAI from 'openai';

interface TicketInput {
  name: string;
  content: string;
}

export interface AiAnalysisResponse {
  analise: string;
  tipo: 'PADRONIZADO' | 'COMPLEXO';
  confianca: number;
  acao_sugerida: string;
  risco: 'BAIXO' | 'MEDIO' | 'ALTO';
}

const SYSTEM_PROMPT = `Voce e o AI Sustentacao Engine, um especialista em resolucao de incidentes integrado ao GLPI.
Seu objetivo e analisar chamados, classificar o tipo de problema e propor uma solucao tecnica precisa.

Regras de Operacao:
1. Analise de Contexto: Leia o titulo e a descricao do chamado. Busque por padroes conhecidos (Ex: Erros de banco, lentidao, bugs de UI).
2. Classificacao: Defina se o chamado e "Padronizado" (tem resolucao conhecida) ou "Complexo" (requer intervencao humana criativa).
3. Plano de Acao: Se for padronizado, selecione o script correspondente na base de conhecimento. Se nao, sugira o passo a passo tecnico.
4. Output Estruturado: Voce DEVE responder SEMPRE em formato JSON valido seguindo este schema:
{
  "analise": "Resumo executivo do que esta acontecendo",
  "tipo": "PADRONIZADO",
  "confianca": 0.9,
  "acao_sugerida": "Nome do script ou descricao da tarefa",
  "risco": "BAIXO"
}

O campo "tipo" deve ser exatamente "PADRONIZADO" ou "COMPLEXO".
O campo "risco" deve ser exatamente "BAIXO", "MEDIO" ou "ALTO".
O campo "confianca" deve ser um numero entre 0.0 e 1.0.
Responda SOMENTE com o JSON, sem texto adicional.`;

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';
const GEMINI_MODEL = 'gemini-2.0-flash';

interface AiErrorLike {
  status?: number;
  response?: {
    status?: number;
  };
  message?: string;
}

function getErrorStatus(error: unknown): number {
  const candidate = Number(
    (error as AiErrorLike)?.status ??
      (error as AiErrorLike)?.response?.status ??
      0
  );

  return Number.isFinite(candidate) ? candidate : 0;
}

function isRateLimitError(error: unknown): boolean {
  const status = getErrorStatus(error);
  const message = error instanceof Error ? error.message : String(error ?? '');
  return status === 429 || /rate limit|too many requests|limite/i.test(message);
}

function buildLocalFallbackAnalysis(ticket: TicketInput): AiAnalysisResponse {
  const text = `${ticket.name}\n${ticket.content}`.toLowerCase();
  const isCritical = /urgente|critico|critica|fora do ar|indisponivel|bloquei|parou|falha geral|500|producao|produção/.test(text);
  const isStandard =
    /senha|login|acesso|permissao|cadastro|perfil|relatorio|exporta|impressora|pdf|planilha|token|integracao|configuracao|configuracao|lento|lentidao/.test(text);

  const tipo: AiAnalysisResponse['tipo'] = isStandard ? 'PADRONIZADO' : 'COMPLEXO';
  const risco: AiAnalysisResponse['risco'] = isCritical ? 'ALTO' : isStandard ? 'MEDIO' : 'BAIXO';

  return {
    analise: isStandard
      ? 'Analise temporaria local: o chamado parece seguir um padrao recorrente de operacao ou configuracao.'
      : 'Analise temporaria local: o chamado parece exigir investigacao adicional e validacao manual.',
    tipo,
    confianca: isCritical ? 0.66 : isStandard ? 0.72 : 0.58,
    acao_sugerida: isStandard
      ? 'Validar o procedimento padrao, conferir configuracao e executar a correcao conhecida.'
      : 'Abrir investigacao manual, revisar logs e coletar evidencias antes da intervencao.',
    risco,
  };
}

function parseJsonResponse(rawText: string): AiAnalysisResponse {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('JSON nao encontrado na resposta do Gemini');
  return JSON.parse(jsonMatch[0]) as AiAnalysisResponse;
}

function getUserMessage(ticket: TicketInput): string {
  return `Analise o seguinte chamado tecnico do GLPI:\nTitulo: ${ticket.name}\nDescricao: ${ticket.content || '(sem descricao)'}`;
}

export class AiService {
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({
      apiKey,
      baseURL: GEMINI_BASE_URL,
    });
  }

  async streamAnalyzeTicket(
    ticket: TicketInput,
    onChunk: (text: string) => void
  ): Promise<AiAnalysisResponse> {
    try {
      const stream = await this.client.chat.completions.create({
        model: GEMINI_MODEL,
        stream: true,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: getUserMessage(ticket) },
        ],
      });

      let fullText = '';
      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta?.content ?? '';
        if (text) {
          fullText += text;
          onChunk(text);
        }
      }

      return parseJsonResponse(fullText);
    } catch (error) {
      if (isRateLimitError(error)) {
        return buildLocalFallbackAnalysis(ticket);
      }

      throw error;
    }
  }

  async analyzeTicket(ticket: TicketInput): Promise<AiAnalysisResponse> {
    try {
      const completion = await this.client.chat.completions.create({
        model: GEMINI_MODEL,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: getUserMessage(ticket) },
        ],
      });

      const rawText = completion.choices[0]?.message?.content ?? '{}';
      return parseJsonResponse(rawText);
    } catch (error) {
      if (isRateLimitError(error)) {
        console.warn('[assistente][ai] Gemini em rate limit; usando analise local temporaria');
        return buildLocalFallbackAnalysis(ticket);
      }

      throw error;
    }
  }
}
