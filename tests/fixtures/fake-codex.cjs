'use strict';

const fs = require('node:fs');
const args = process.argv.slice(2);
const mode = process.env.DEEPBOOK_TEST_MODE || 'success';
if (args[0] === 'login') {
  if (mode === 'api-auth') {
    console.error('Logged in using an API key - sk-test-secret');
  } else if (mode === 'signed-out') {
    console.error('Not logged in');
    process.exitCode = 1;
  } else {
    console.error('Logged in using ChatGPT');
  }
} else {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    if (process.env.DEEPBOOK_TEST_TRACE) {
      fs.writeFileSync(process.env.DEEPBOOK_TEST_TRACE, JSON.stringify({
        args, input, cwd: process.cwd(), apiKeys: Object.keys(process.env).filter(k => /_API_KEY$/.test(k)),
      }));
    }
    const output = args[args.indexOf('--output-last-message') + 1];
    if (mode === 'timeout') { setInterval(() => {}, 1000); return; }
    if (mode === 'old-cli') { console.error('unexpected argument --ignore-user-config'); process.exitCode = 2; return; }
    if (mode === 'quota') {
      fs.writeFileSync(output, 'Incomplete draft');
      console.log(JSON.stringify({ type: 'turn.failed', error: { message: 'Usage limit reached' } }));
      process.exitCode = 1;
      return;
    }
    if (mode === 'partial') {
      fs.writeFileSync(output, 'Incomplete draft');
      console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Incomplete draft' } }));
      return;
    }
    let text = 'The teacup was missing.\n\n“Who took it?” I asked.';
    if (mode === 'pipeline') {
      if (input.includes('Create a complete series plan')) {
        text = JSON.stringify({ series_title: 'Teacup Test', series_bible: { protagonist: { name: 'Baaba' }, setting: { name: 'Tema' } }, books: [{ number: 1, title: 'The Missing Teacup', premise: 'Find a missing teacup.' }] });
      } else if (input.includes('Create a detailed chapter roadmap')) {
        text = JSON.stringify({ case_lock: { victim: { name: 'Kofi' }, killer: { name: 'Ama' } }, chapters: [{ number: 1, title: 'Missing', key_events: ['Find the clue'] }, { number: 2, title: 'Found', key_events: ['Solve the mystery'] }] });
      } else if (input.includes('Extract a CONTINUITY LOG')) {
        text = '- Key facts established:\n- Baaba found the teacup.\n- Character locations at chapter end:\n- Baaba is in Tema.';
      } else if (input.includes('Generate front & back matter')) {
        text = JSON.stringify({ dedication: 'For readers.', synopsis: 'A teacup mystery.', blurb: 'Who took the teacup?', authors_note: 'Thank you.' });
      }
    }
    if (mode !== 'missing-output') fs.writeFileSync(output, mode === 'empty' ? '  ' : text);
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'Working on it…' } }));
    if (mode === 'recovered') console.log(JSON.stringify({ type: 'error', message: 'Retrying connection' }));
    console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 25 } }));
  });
}
