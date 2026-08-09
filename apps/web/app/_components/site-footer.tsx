import { API_URL } from '../../lib/config';
import { Marca } from './ui/marca';
import { Rotulo } from './ui/rotulo';
import { Wordmark } from './ui/wordmark';

export function SiteFooter() {
  return (
    <footer className="border-border bg-bg relative overflow-hidden border-t px-6 pt-24 pb-12 md:px-8 xl:px-12">
      <h2 className="sr-only">Informações e conformidade</h2>
      <Marca className="text-fg pointer-events-none absolute right-[-60px] bottom-[-110px] size-80 opacity-[0.04]" />
      <div className="relative mx-auto grid max-w-[1120px] gap-12 md:grid-cols-3">
        <div>
          <Wordmark tamanho="footer" />
          <p className="text-fg-muted mt-6 max-w-[28ch] text-pretty">
            Guilda de raid e Mythic+ desde 2009, com progressão que cabe na vida real.
          </p>
        </div>
        <div>
          <Rotulo>Aferição</Rotulo>
          <ul className="text-fg-muted mt-5 space-y-3 text-sm">
            <li>
              <a
                href="https://raider.io"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-fg min-h-11"
              >
                Raider.IO — abre fora
              </a>
            </li>
            <li>
              <a
                href="https://www.warcraftlogs.com"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-fg min-h-11"
              >
                Warcraft Logs — abre fora
              </a>
            </li>
            <li>
              <span>Discord — endereço pendente</span>
            </li>
          </ul>
        </div>
        <div>
          <Rotulo>Membros</Rotulo>
          {/* Início do OAuth direto no Nest: navegação de página inteira, que
              funciona sem JavaScript. A página `/entrar` não existe mais — ela
              só somava um clique entre a pessoa e a Blizzard. */}
          <a
            href={`${API_URL}/auth/battlenet`}
            className="text-fg-muted hover:text-fg mt-5 inline-flex min-h-11 items-center text-sm"
          >
            Entrar com a Battle.net
          </a>
        </div>
      </div>
      <div className="border-border text-fg-subtle relative mx-auto mt-16 max-w-[1120px] border-t pt-6 text-xs leading-relaxed">
        <p>
          Dados de personagem via{' '}
          <a
            href="https://raider.io"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Raider.IO
          </a>
          .
        </p>
        <p className="mt-2">
          World of Warcraft é marca registrada da Blizzard Entertainment, Inc. Este é um site de
          fãs, sem afiliação ou patrocínio oficial.
        </p>
      </div>
    </footer>
  );
}
