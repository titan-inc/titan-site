import {
  BadGatewayException,
  InternalServerErrorException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DiscordDeliveryError, type DiscordService } from '../discord/discord.service';
import { ApplicationsService } from './applications.service';

const candidatura = {
  characterRealm: 'Thrall — Azralon',
  roleSpec: 'Tank / Protection Warrior',
  contact: 'Discord: thrall.azeroth',
};

describe('ApplicationsService', () => {
  const discord = { send: jest.fn() };
  let service: ApplicationsService;

  beforeEach(() => {
    jest.clearAllMocks();
    discord.send.mockResolvedValue(undefined);
    service = new ApplicationsService(discord as unknown as DiscordService);
  });

  it('envia exatamente uma vez e só então confirma a entrega', async () => {
    await expect(service.apply(candidatura)).resolves.toEqual({ delivered: true });
    expect(discord.send).toHaveBeenCalledTimes(1);
    // O destino é o do recrutamento, nunca o canal aberto de M+.
    expect(discord.send).toHaveBeenCalledWith(
      'apply',
      expect.objectContaining({ allowed_mentions: { parse: [] } }),
    );
  });

  it('descarta honeypot silenciosamente sem chamar o Discord', async () => {
    await expect(service.apply({ ...candidatura, website: 'spam' })).resolves.toEqual({
      delivered: true,
    });
    expect(discord.send).not.toHaveBeenCalled();
  });

  it.each([
    ['unconfigured', ServiceUnavailableException],
    ['configuration', ServiceUnavailableException],
    ['rate-limit', ServiceUnavailableException],
    ['upstream', BadGatewayException],
    ['payload', InternalServerErrorException],
  ] as const)('mapeia falha %s', async (kind, ExceptionType) => {
    discord.send.mockRejectedValue(new DiscordDeliveryError(kind));
    await expect(service.apply(candidatura)).rejects.toBeInstanceOf(ExceptionType);
  });
});
