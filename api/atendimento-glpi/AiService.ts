import Anthropic from '@anthropic-ai/sdk';
import { GlpiTicket } from './GlpiService';

// api\atendimento-glpi\AiService.ts  Interface para a resposta que a IA deve retornar
interface AiAnalysisResponse {
  analise: string;
  tipo: 'PADRONIZADO' | 'COMPLEXO';
  confianca: number;
  acao_sugerida: string;
  risco: 'BAIXO' | 'MEDIO' | 'ALTO';
}

export class AiService {
  private anthropic: Anthropic;

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({
      apiKey: apiKey, // Sua API Key da Anthropic
    });
  }

  async analyzeTicket(ticket: GlpiTicket): Promise<AiAnalysisResponse> {
    const prompt = `
      Analise o seguinte chamado técnico do GLPI:
      Título: ${ticket.name}
      Descrição: ${ticket.content}

      Responda EXCLUSIVAMENTE em formato JSON seguindo este modelo:
      {
        "analise": "resumo conciso",
        "tipo": "PADRONIZADO ou COMPLEXO",
        "confianca": 0.9,
        "acao_sugerida": "descrição da ação",
        "risco": "BAIXO, MEDIO ou ALTO"
      }
    `;

    try {
      const msg = await this.anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 1024,
        system: "Você é um engenheiro de sustentação de software sênior. Sua tarefa é identificar se um problema pode ser resolvido via script automatizado ou se requer análise manual.",
        messages: [{ role: "user", content: prompt }],
      });

      const rawText = msg.content[0].type === 'text' ? msg.content[0].text : '';
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, rawText];
      return JSON.parse(jsonMatch[1].trim()) as AiAnalysisResponse;
      
    } catch (error) {
      console.error('Erro na análise da IA:', error);
      throw error;
    }
  }
}