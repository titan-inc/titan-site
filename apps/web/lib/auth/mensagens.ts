export const MENSAGENS_LOGIN: Record<string, string> = {
  // Quem chega em /interno sem sessão volta para a home com este motivo. Sem
  // ele a pessoa é jogada para a landing sem entender por quê.
  sessao: 'Entre com a Battle.net para abrir a área de membros. Sua sessão pode ter expirado.',
  cancelado: 'Você cancelou a autorização na Blizzard. Nada foi salvo.',
  state:
    'O retorno da Blizzard não pôde ser validado. Isso costuma acontecer quando o login demora demais ou é aberto em outra aba. Tente novamente.',
  falha:
    'Não foi possível concluir o login. Tente de novo; se persistir, avise um oficial — o erro fica registrado no servidor.',
  bloqueado:
    'Seu navegador bloqueou a janela de login. Libere popups para este site ou use o link abaixo.',
  timeout: 'O login demorou demais. Tente de novo.',
};
