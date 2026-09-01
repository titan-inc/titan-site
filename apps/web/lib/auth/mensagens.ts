/**
 * O texto de cada motivo que o Nest devolve em `/?erro=`.
 *
 * `bloqueado` e `timeout` saíram na TIT-148 junto com o popup: não havia mais
 * janela para o navegador bloquear nem espera para estourar. Motivo sem
 * caminho que o produza é convite a alguém reintroduzir o caminho.
 */
export const MENSAGENS_LOGIN: Record<string, string> = {
  // Quem chega em /interno sem sessão volta para a home com este motivo. Sem
  // ele a pessoa é jogada para a landing sem entender por quê.
  sessao: 'Entre com a Battle.net para abrir a área de membros. Sua sessão pode ter expirado.',
  cancelado: 'Você cancelou a autorização na Blizzard. Nada foi salvo.',
  state:
    'O retorno da Blizzard não pôde ser validado. Isso costuma acontecer quando o login fica parado por muitas horas antes de terminar. Tente novamente.',
  falha:
    'Não foi possível concluir o login. Tente de novo; se persistir, avise um oficial — o erro fica registrado no servidor.',
};
