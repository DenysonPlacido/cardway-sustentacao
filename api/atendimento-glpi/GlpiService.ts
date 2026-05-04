import axios, { AxiosInstance } from 'axios';

export interface GlpiTicket {
  id: number;
  name: string;
  content: string;
  date_mod: string;
  entities_id: number;
  itilcategories_id: number;
}

export class GlpiService {
  private api: AxiosInstance;
  private sessionToken: string | null = null;
  private appToken: string = process.env.GLPI_APP_TOKEN ?? '';

  constructor() {
    this.api = axios.create({
      baseURL: 'https://suporte.cardway.net.br/apirest.php',
      headers: {
        'App-Token': this.appToken,
        'Content-Type': 'application/json'
      }
    });
  }

  /**
   * Método de Login validado via Postman
   */
  async initSession(userToken: string): Promise<string> {
    try {
      const response = await this.api.get('/initSession/', {
        params: { user_token: userToken }
      });

      this.sessionToken = response.data.session_token;
      
      if (this.sessionToken) {
        this.api.defaults.headers.common['Session-Token'] = this.sessionToken;
      }

      console.log('Sessão GLPI ativa:', this.sessionToken);
      return this.sessionToken!;
    } catch (error) {
      console.error('Falha na autenticação GLPI:', error);
      throw error;
    }
  }

  /**
   * Busca chamados novos
   */
  async getPendingTickets(entityId: number): Promise<GlpiTicket[]> {
    try {
      const response = await this.api.get('/Ticket', {
        params: {
          'searchText[status]': 1,
          'searchText[entities_id]': entityId,
          'range': '0-20'
        }
      });
      return response.data;
    } catch (error) {
      console.log('Nenhum ticket pendente encontrado.');
      return [];
    }
  }

  /**
   * ESTE É O MÉTODO QUE ESTAVA FALTANDO
   * Adiciona um acompanhamento (followup) no chamado
   */
  async addAnalysisFollowup(ticketId: number, content: string): Promise<void> {
    try {
      await this.api.post(`/Ticket/${ticketId}/ITILFollowup`, {
        input: {
          tickets_id: ticketId,
          content: content,
          is_private: 0 // 0 para público, 1 para privado
        }
      });
      console.log(`Acompanhamento adicionado ao ticket #${ticketId}`);
    } catch (error) {
      console.error(`Erro ao postar acompanhamento no ticket ${ticketId}:`, error);
      throw error;
    }
  }
}