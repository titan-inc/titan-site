import { isActingOfficer } from '@titan/shared';
import { redirect } from 'next/navigation';
import { getSessionUser } from '../../../../lib/api';
import { EmImplementacao } from '../_components/em-implementacao';

export const metadata = { title: 'Configuração de loot — Titan Inc' };

/**
 * Aba de configuração. Só oficial.
 *
 * O redirect existe porque esconder a aba é cortesia: sem ele, quem digitasse a
 * URL entraria. Quem barra de verdade continua sendo o guard no Nest, em cada
 * endpoint que esta tela vier a chamar — Regra 5.
 *
 * Conteúdo é M5 em diante. Vale um aviso para quem for preenchê-la: as operações
 * que existem hoje (`catalog-load`, `loot-import-rc`) vivem sob `OpsTokenGuard`,
 * que a Regra 8 define como ator de automação/CLI, **não** pessoa com sessão de
 * Battle.net. Elas não podem ser chamadas daqui; precisariam de endpoints
 * paralelos com `OfficerGuard`.
 */
export default async function LootConfiguracaoPage() {
  const user = await getSessionUser();
  if (!user) redirect('/?erro=sessao');
  if (!isActingOfficer(user)) redirect('/interno/loot');

  return (
    <EmImplementacao>
      Aqui vão ficar as opções de resposta do conselho e as demais operações de bastidor.
    </EmImplementacao>
  );
}
