## O que muda

<!-- Uma ou duas frases. O "por quê" importa mais que o "o quê". -->

## Issue

<!-- TIT-XX — o Linear liga automaticamente se a branch veio do nome que ele gerou. -->

## Como testar

<!-- Passos concretos. "subir e clicar" não ajuda quem revisa. -->

## Checklist

- [ ] `pnpm format:check && pnpm lint && pnpm build && pnpm typecheck && pnpm test` passa local
- [ ] Nenhum segredo, `.env` ou dado de membro no diff
- [ ] Se mexeu em contrato de API: schema atualizado em `packages/shared`, não duplicado nos apps
- [ ] Se criou endpoint interno: tem guard no Nest (não só o proxy do Next)
