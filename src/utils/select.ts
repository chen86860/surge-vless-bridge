import { clearScreenDown, emitKeypressEvents, moveCursor } from 'node:readline';

import { cyan, dim, isInteractive } from './prompt';

export type Choice = { label: string; note?: string; value: string };

// Raw mode is what turns arrow keys into events, and it is only available on a real TTY. Everything
// else — a pipe, an agent, a dumb terminal — falls back to the numbered prompt.
export const canSelect = () => isInteractive() && typeof process.stdin.setRawMode === 'function';

const HINT = 'Use ↑/↓ to move, Enter to select, Esc to skip';

export const selectFromList = async ({
  title,
  choices,
}: {
  title: string;
  choices: Choice[];
}): Promise<string | undefined> => {
  const stdin = process.stdin;
  const stdout = process.stdout;
  let active = 0;

  const render = (initial: boolean) => {
    if (!initial) {
      // Rewind over the block written last time; the title stays put above it.
      moveCursor(stdout, 0, -choices.length);
      clearScreenDown(stdout);
    }

    choices.forEach((choice, index) => {
      const selected = index === active;
      const pointer = selected ? cyan('❯') : ' ';
      const label = selected ? cyan(choice.label) : choice.label;
      stdout.write(`${pointer} ${label}${choice.note ? `  ${dim(choice.note)}` : ''}\n`);
    });
  };

  console.log(title);
  console.log(dim(`  ${HINT}`));
  stdout.write('\u001b[?25l'); // hide the cursor: it would otherwise trail the redraws
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();

  try {
    return await new Promise<string | undefined>((resolve) => {
      const finish = (value: string | undefined) => {
        stdin.off('keypress', onKeypress);
        resolve(value);
      };

      const onKeypress = (sequence: string, key: { name?: string; ctrl?: boolean }) => {
        // Raw mode suppresses SIGINT, so Ctrl+C has to be honoured by hand or the prompt is a trap.
        if (key?.ctrl && key.name === 'c') {
          stdin.setRawMode(false);
          stdout.write('\u001b[?25h\n');
          process.exit(130);
        }

        if (key?.name === 'up' || key?.name === 'k') {
          active = (active - 1 + choices.length) % choices.length;
          render(false);
          return;
        }

        if (key?.name === 'down' || key?.name === 'j') {
          active = (active + 1) % choices.length;
          render(false);
          return;
        }

        // A number key jumps straight to that entry, which keeps the old muscle memory working.
        const digit = Number(sequence);
        if (Number.isInteger(digit) && digit >= 1 && digit <= choices.length) {
          active = digit - 1;
          render(false);
          return;
        }

        if (key?.name === 'return' || key?.name === 'enter') {
          finish((choices[active] as Choice).value);
          return;
        }

        if (key?.name === 'escape' || key?.name === 'q') {
          finish(undefined);
        }
      };

      render(true);
      stdin.on('keypress', onKeypress);
    });
  } finally {
    stdin.setRawMode(false);
    stdin.pause();
    stdout.write('\u001b[?25h');
  }
};

