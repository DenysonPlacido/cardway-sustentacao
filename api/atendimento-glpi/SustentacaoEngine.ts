// api/atendimento-glpi/SustentacaoEngine.ts

import { GlpiService } from './GlpiService';
import { AiService } from './AiService';
import * as dotenv from 'dotenv';

dotenv.config();

export class SustentacaoEngine {
  private glpi: GlpiService;
  private ai: AiService;

  constructor() {
    this.glpi = new GlpiService();
    this.ai = new AiService(process.env.GEMINI_API_KEY || '');
  }

  async run(entityId: number) {
    console.log('--- Iniciando Ciclo de Monitoramento ---');
    
    try {
      // 1. Autentica no GLPI
      await this.glpi.initSession(process.env.GLPI_USER_TOKEN || '');

      // 2. Busca chamados novos
      const tickets = await this.glpi.getPendingTickets(entityId);
      console.log(`Encontrados ${tickets.length} chamados novos.`);

      for (const ticket of tickets) {
        console.log(`Analisando Ticket #${ticket.id}: ${ticket.name}`);

        // 3. IA faz a análise cognitiva
        const analise = await this.ai.analyzeTicket(ticket);

        // 4. Posta o resultado como um acompanhamento no GLPI
        // Isso permite que o analista veja o resumo antes de aprovar no portal
        const resumoFormatado = `
🎯 **Tipo:** ${analise.tipo}
🧠 **Análise:** ${analise.analise}
🛠️ **Ação Sugerida:** ${analise.acao_sugerida}
⚠️ **Risco:** ${analise.risco}
✅ **Confiança:** ${(analise.confianca * 100).toFixed(0)}%
        `;

        await this.glpi.addAnalysisFollowup(ticket.id, resumoFormatado);
        
        console.log(`Ticket #${ticket.id} processado com sucesso.`);
      }

    } catch (error) {
      console.error('Falha no ciclo de sustentação:', error);
    }
  }
}