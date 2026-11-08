// Prints a hash for the Companion password, read from the first line of stdin so it stays out of
// shell history and process lists. Example (bash or zsh):
//   read -rs P && printf '%s\n' "$P" | node server/src/hash-password.ts > companion_password_hash; unset P
import { text } from 'node:stream/consumers';
import { hashSecret } from './auth.ts';

const password = (await text(process.stdin)).split(/\r?\n/)[0];
if (password.length < 8) {
  process.stderr.write('Use at least 8 characters.\n');
  process.exit(1);
}
process.stdout.write((await hashSecret(password)) + '\n');
