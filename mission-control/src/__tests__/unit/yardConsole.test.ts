/**
 * @jest-environment jsdom
 */

/**
 * The address of the operator's yard console.
 *
 * It is per-browser rather than per-account because the console is on a
 * private network in the room, which the server cannot see, reach or know the
 * shape of.
 */

import {
  DEFAULT_CONSOLE_URL,
  normaliseConsoleUrl,
  readConsoleUrl,
  writeConsoleUrl,
} from '@/lib/yardConsole';

beforeEach(() => localStorage.clear());

describe('normalising what an operator types', () => {
  it('assumes http, because the yard has no certificate', () => {
    expect(normaliseConsoleUrl('mro.local:3001/run/')).toBe('http://mro.local:3001/run/');
    expect(normaliseConsoleUrl('192.168.137.1:3001')).toBe('http://192.168.137.1:3001/');
  });

  it('keeps an explicit scheme', () => {
    expect(normaliseConsoleUrl('https://yard.example/run/')).toBe('https://yard.example/run/');
  });

  it('refuses anything that is not a web address', () => {
    // This value ends up as the href of a button the operator clicks, so a
    // javascript: or data: URL here would run on their session.
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd']) {
      expect(normaliseConsoleUrl(bad)).toBeNull();
    }
  });

  it('refuses a dangerous scheme that carries a host', () => {
    // The three above all parse with an empty hostname, so a hostname check
    // alone appears to handle them. These do not: they parse with a real host
    // and still execute when used as an href, so the scheme has to be checked
    // on its own account.
    for (const bad of [
      'javascript://mro.local/%0aalert(1)',
      'javascript://mro.local:3001/%0afetch("//evil")',
    ]) {
      expect(normaliseConsoleUrl(bad)).toBeNull();
    }
  });

  it('treats blank as nothing rather than as an address', () => {
    for (const blank of ['', '   ', null, undefined]) {
      expect(normaliseConsoleUrl(blank)).toBeNull();
    }
  });
});

describe('remembering it', () => {
  it('defaults to the satellite before anyone sets anything', () => {
    expect(readConsoleUrl()).toBe(DEFAULT_CONSOLE_URL);
  });

  it('round-trips a stored address', () => {
    writeConsoleUrl('192.168.137.1:3001/run/');
    expect(readConsoleUrl()).toBe('http://192.168.137.1:3001/run/');
  });

  it('clearing it returns to the default', () => {
    writeConsoleUrl('192.168.137.1:3001/run/');
    expect(writeConsoleUrl('')).toBe(DEFAULT_CONSOLE_URL);
    expect(readConsoleUrl()).toBe(DEFAULT_CONSOLE_URL);
  });

  it('ignores a stored value that is no longer safe to open', () => {
    // Written by an older build, or edited by hand in devtools.
    localStorage.setItem('yard:consoleUrl', 'javascript:alert(1)');
    expect(readConsoleUrl()).toBe(DEFAULT_CONSOLE_URL);
  });

  it('survives storage being unavailable', () => {
    const boom = () => { throw new Error('denied'); };
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: { getItem: boom, setItem: boom, removeItem: boom },
    });

    expect(readConsoleUrl()).toBe(DEFAULT_CONSOLE_URL);
    expect(writeConsoleUrl('mro.local:3001')).toBe('http://mro.local:3001/');

    if (original) Object.defineProperty(window, 'localStorage', original);
  });
});
