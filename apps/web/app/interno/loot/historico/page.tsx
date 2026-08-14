import { EmImplementacao } from '../_components/em-implementacao';

export const metadata = { title: 'Histórico de loot — Titan Inc' };

/**
 * Aba do histórico. Conteúdo é o explorador — TIT-58 (API) e TIT-59 (tela).
 *
 * Já existem 294 entregas importadas do RCLootCouncil esperando esta tela.
 */
export default function LootHistoricoPage() {
  return (
    <EmImplementacao>
      Aqui vai ficar tudo que o conselho já distribuiu, com filtro por personagem, período, boss,
      dificuldade e slot.
    </EmImplementacao>
  );
}
