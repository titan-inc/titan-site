// PRIMEIRO import, de propósito: carrega o .env antes de qualquer módulo que
// leia variáveis de ambiente (o PrismaClient lê DATABASE_URL na construção).
import './load-env';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // Produção tem exatamente um reverse proxy entre o cliente e o Nest. Confiar
  // em um salto faz req.ip usar o IP do cliente para o throttler; sem isto o
  // bucket seria o IP único do proxy. Se a topologia ganhar outro salto, este
  // número precisa mudar junto com o deploy — não aceite X-Forwarded-For livre.
  app.set('trust proxy', 1);

  // As rotas de ops carregam arquivo — catálogo de raid, export do
  // RCLootCouncil — e não cabem no teto público. Precisa vir ANTES do limite
  // geral: o Express roda middleware em ordem e o primeiro parser que consumir
  // o corpo vence.
  //
  // Teto maior, não ausência de teto. Aqui não existe ator anônimo (a porta é
  // loopback no compose de produção, e o OpsTokenGuard exige token), mas existe
  // engano de operador — `curl -d @arquivo` com o caminho errado. É o modo de
  // falha da TIT-109: comando legítimo, de dentro da máquina, que consumiu
  // memória demais numa instância de 1GB e derrubou a app inteira. Com teto
  // isso vira 413.
  //
  // 2mb dá ~6x sobre a maior carga legítima de hoje (o export do RC, 304 KB;
  // o maior catálogo tem 91 KB). Não há setGlobalPrefix — o caminho no Nest é
  // este mesmo, o `/api` é o Caddy que tira.
  app.use('/internal/ops', json({ limit: '2mb' }));

  // Limita o corpo antes do Zod para que JSONs gigantes não consumam memória.
  // Vale para tudo que não é ops, incluindo o /applications público — que é
  // anônimo e dispara mensagem no Discord da liderança.
  app.use(json({ limit: '16kb' }));

  // Necessário para ler o cookie de sessão. Sem isso req.cookies é undefined e
  // todo request parece deslogado.
  app.use(cookieParser());

  // 3001, e não o 3000 padrão do Nest: o Next já ocupa a 3000 e o
  // `pnpm dev` sobe os dois juntos.
  const port = process.env.API_PORT ?? 3001;

  // `credentials: true` é necessário para o cookie de sessão do Battle.net
  // atravessar do front para a API em dev (origens diferentes). Ver TIT-18.
  app.enableCors({
    origin: process.env.WEB_URL ?? 'http://localhost:3000',
    credentials: true,
  });

  await app.listen(port);
  console.log(`API ouvindo em http://localhost:${port}`);
}
void bootstrap();
