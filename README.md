# 🤖 CS2 Mix Bot — Discord & Google Sheets Integration

Bot automatizado para gerenciamento de partidas de Mix de Counter-Strike 2 no Discord, integrado em tempo real com Google Sheets para acompanhamento de estatísticas e sistema de Elo dinâmico.

## 🚀 Funcionalidades
- **🎮 Fila Automática (`/fila`)**: Gerenciamento de vagas e auto-start ao completar 10 jogadores.
- **🗺️ Veto de Mapas (`/pick`)**: Sistema dinâmico de Ban & Pick para MD1 e MD3.
- **🎖️ Sistema de Elo / MMR (`/elo`, `/resultado`)**: Atualização automática de pontos por partida e performance individual (ADR/K-D).
- **📊 Estatísticas Avançadas (`/hall-da-fama`, `/x1`)**: Recordes históricos da comunidade e confronto direto entre jogadores.
- **⚙️ Automação de Voz (`/mover-times`, `/reunir`)**: Movimentação automática entre canais de voz do Discord.

## 🛠️ Tecnologias Utilizadas
- Node.js
- Discord.js v14
- Google Spreadsheet API (`google-spreadsheet`)
- dotenv