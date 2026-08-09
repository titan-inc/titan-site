import type { Metadata } from 'next';
import { Archivo, Geist_Mono } from 'next/font/google';
import { getSessionUser } from '../lib/api';
import { carregarProgressao } from '../lib/progressao/fonte';
import { resumirProgressaoNav } from '../lib/progressao/resumo-nav';
import { SiteShell } from './_components/site-shell';
import './globals.css';

const archivo = Archivo({
  axes: ['wdth'],
  display: 'swap',
  variable: '--font-archivo',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  display: 'swap',
  preload: false,
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_WEB_URL ?? 'http://localhost:3000'),
  title: 'Titan Inc — Guilda de World of Warcraft',
  description: 'Guilda de World of Warcraft. Progresso de raid, Mythic+ e recrutamento aberto.',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [sessao, fonte] = await Promise.all([getSessionUser(), carregarProgressao()]);
  const progressao = resumirProgressaoNav(fonte.relatorio, fonte.desenvolvimento);
  return (
    <html lang="pt-BR" className={`${archivo.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <span
          hidden
          aria-hidden="true"
          dangerouslySetInnerHTML={{
            __html:
              '<!-- TITAN_FEL_CONTRACT: THESIS=a_landing_afere; OWN_WORLD=ardosia_ar_pedra_materia_fel_energia; STORY=progressao_verificavel_e_candidatura_como_registro; FIRST_VIEWPORT=manchete_mais_key_art_progressao_inscrita_na_navbar; FINISH=review_documentacao_e_veredito -->',
          }}
        />
        <SiteShell sessao={sessao} progressao={progressao}>
          {children}
        </SiteShell>
      </body>
    </html>
  );
}
