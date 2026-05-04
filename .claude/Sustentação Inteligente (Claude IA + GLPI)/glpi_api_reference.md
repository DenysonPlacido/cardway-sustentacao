# Referência Técnica GLPI - Cardway

## Ambiente
- **URL Base:** https://suporte.cardway.net.br
- **API REST:** https://suporte.cardway.net.br/apirest.php
- **Localização:** pt_BR (UTF-8)

## Plugins Disponíveis (Acessíveis via API)
- **FormCreator:** Chamados via formulário (marketplace/formcreator)
- **Gantt:** Gestão de cronograma (marketplace/gantt)
- **Escalade:** Fluxos de escalonamento (marketplace/escalade)

## Erros Conhecidos para a IA Monitorar
- **Gantt Helper TypeError:** Ocorre em `gantt-helper.js` quando propriedades de data estão indefinidas. 
- **Ação da IA:** Se a IA detectar que um chamado de projeto está sem datas, ela deve sugerir o preenchimento automático para evitar quebra no frontend.