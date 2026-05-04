# Spec: Automação de Sustentação Inteligente (Claude IA + GLPI)

## 1. Visão Geral
Sistema de automação para triagem e resolução de chamados de sustentação. O sistema utiliza o Claude Code para analisar chamados no GLPI, propor soluções baseadas em conhecimento prévio e executar ajustes técnicos após aprovação de um analista sênior.

## 2. Pilares da Solução
- **Identificação Automática:** Monitoramento via API REST da Cardway (Entidades e Filas específicas).
- **Análise Cognitiva:** Uso de IA para entender o problema (Logs, Descrição, Histórico).
- **Aprovação Assistida:** Interface visual no Portal de Suporte para visualização do resumo da análise e do plano de ação.
- **Execução Delegada:** Automação de scripts/ajustes pela IA enquanto o atendente foca em outras tarefas.

## 3. Requisitos Técnicos
- **Linguagem:** TypeScript / Node.js
- **API GLPI:** https://suporte.cardway.net.br/apirest.php
- **Integração IA:** Claude Code CLI / Anthropic SDK
- **Interface:** Módulo adicional no Portal de Suporte Existente

## 4. Fluxo de Dados (Workflow)
1. **Polling/Webhook:** O serviço Node.js busca tickets com status "Novo" em filas específicas.
2. **Contextualização:** O sistema extrai o histórico do ticket e envia para o Claude Code com um "System Prompt" de especialista.
3. **Plano de Resolução:** A IA retorna:
    - Resumo do Problema.
    - Causa Raiz Provável.
    - Script/Ação proposta.
4. **Intervenção Humana:** O atendente vê o plano no portal e clica em "Aprovar".
5. **Ação:** O Node.js executa a tarefa (Ex: Update em banco, restart de serviço, deploy de hotfix).
6. **Encerramento:** Post automático no GLPI com o log da ação e fechamento do ticket.