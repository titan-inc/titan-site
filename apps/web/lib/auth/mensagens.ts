export const MENSAGENS_LOGIN: Record<string, string> = {
  cancelado: 'Você cancelou a autorização na Blizzard. Nada foi salvo.',
  state:
    'O retorno da Blizzard não pôde ser validado. Isso costuma acontecer quando o login demora demais ou é aberto em outra aba. Tente novamente.',
  falha:
    'Não foi possível concluir o login. Tente de novo; se persistir, avise um oficial — o erro fica registrado no servidor.',
  bloqueado:
    'Seu navegador bloqueou a janela de login. Libere popups para este site ou use o link abaixo.',
  timeout: 'O login demorou demais. Tente de novo.',
};
