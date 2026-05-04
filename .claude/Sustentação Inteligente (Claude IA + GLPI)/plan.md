# Plan: Roadmap de Implementação da Automação

## Fase 1: Integração Base (Semana 1)
- [ ] Configuração do ambiente TypeScript e instanciacão do Axios para API GLPI.
- [ ] Implementar `GlpiClient`:
    - Métodos para `initSession`, `listTickets` e `addITILFollowup`.
- [ ] Validar acesso com o Token: `A5DJPMbDT7CMbpo5OZS1Pc6UdL20IZYMi0waheM2`.

## Fase 2: Inteligência e Aprendizado (Semana 2)
- [ ] Criar a "Base de Conhecimento" em arquivos `.md` que a IA usará como referência.
- [ ] Integrar Claude Code:
    - Criar prompts que retornem JSON estruturado para facilitar o parsing das ações.
- [ ] Desenvolver o motor de classificação (Padronizado vs. Complexo).

## Fase 3: Frontend e UI no Portal (Semana 3)
- [ ] Criar nova tela no Portal de Suporte.
- [ ] Implementar Dashboard de "Pendentes de IA":
    - Visualização do Passo-a-passo sugerido.
    - Logs em tempo real da execução da IA.
- [ ] Sistema de notificação (Toast) quando uma ação da IA for concluída.

## Fase 4: Automação de Tarefas (Semana 4)
- [ ] Implementar conectores de execução (Executores de SQL, Comandos de Terminal, API de Terceiros).
- [ ] Testes de segurança: Garantir que a IA só execute comandos permitidos.
- [ ] Rollout para a primeira fila de produção.