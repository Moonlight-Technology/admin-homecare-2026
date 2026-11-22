import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

/** Argon2id with OWASP-recommended parameters (spec §10). */
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const PASSWORD_MIN_LENGTH = 10;

@Injectable()
export class PasswordService {
  /** Hash checked when the email is unknown, so a miss costs the same time as a wrong password. */
  private dummyHash: Promise<string> | null = null;

  hash(password: string) {
    return argon2.hash(password, OPTIONS);
  }

  async verify(hash: string | null | undefined, password: string): Promise<boolean> {
    const target = hash ?? (await (this.dummyHash ??= argon2.hash('nakes-timing-equaliser', OPTIONS)));
    try {
      const valid = await argon2.verify(target, password);
      return Boolean(hash) && valid;
    } catch {
      return false;
    }
  }
}
