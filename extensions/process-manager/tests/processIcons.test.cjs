const assert = require('node:assert/strict');
const { test, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');

// Exercise the actual TypeScript modules without adding a test runner dependency.
require.extensions['.ts'] = (module, filename) => {
  const { outputText } = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  });
  module._compile(outputText, filename);
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'process-manager-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const user = path.join(root, 'user');
const system = path.join(root, 'system');
process.env.XDG_DATA_HOME = user;
process.env.XDG_DATA_DIRS = `${path.join(root, 'missing')}:${system}`;

function write(relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

const malformed = fs.readFileSync(path.join(__dirname, 'fixtures/malformed.desktop'), 'utf8');
write('user/applications/broken.desktop', malformed);
write('user/applications/browser.desktop', '[Desktop Entry]\nName=Browser\nExec=/usr/bin/browser %U\nIcon=test-browser\n');
write('system/applications/browser.desktop', '[Desktop Entry]\nExec=browser\nIcon=wrong-priority\n');
write('system/applications/flatpak.desktop', '[Desktop Entry]\nExec=flatpak run --command=flat-app org.example.FlatApp %U\nIcon=test-flatpak\n');
write('user/applications/no-icon.desktop', '[Desktop Entry]\nExec=no-icon\n');
write('user/applications/no-exec.desktop', '[Desktop Entry]\nIcon=unused\n');
write('user/applications/no-section.desktop', '# empty launcher\n');
// A launcher can disappear or become unreadable between readdir and readFile.
fs.symlinkSync(path.join(root, 'absent'), path.join(user, 'applications/dangling.desktop'));
write('user/icons/hicolor/index.theme', '[Icon Theme]\nName=Test\nDirectories=128x128/apps\n[128x128/apps]\nSize=128\nType=Fixed\nContext=Applications\n');
const browserIcon = write('user/icons/hicolor/128x128/apps/test-browser.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
const flatpakIcon = write('user/icons/hicolor/128x128/apps/test-flatpak.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');

// Vicinae supplies this module at runtime; keep filesystem/parser/icon lookup real.
const apiPath = require.resolve('@vicinae/api');
require.cache[apiPath] = { id: apiPath, filename: apiPath, loaded: true, exports: { Icon: { Gear: 'gear' } } };
const { readDesktopEntries } = require('../src/utils/desktopEntries.ts');
const { getProcessIcon } = require('../src/utils/processIcons.ts');

test('fixture reproduces the exact upstream Name property error', () => {
  assert.throws(() => require('xdg-parse')(malformed), {
    name: 'TypeError', message: "Cannot read properties of undefined (reading 'Name')",
  });
});

test('desktop scan skips malformed and unreadable files and keeps XDG precedence', async () => {
  const entries = await readDesktopEntries();
  assert.equal(entries.length, 4);
  assert.equal(entries.find(entry => entry['Desktop Entry'].Name === 'Browser')['Desktop Entry'].Icon, 'test-browser');
  fs.unlinkSync(path.join(user, 'applications/dangling.desktop'));
});

test('icon loading survives the fixture and resolves normal and Flatpak icons', async () => {
  const names = ['browser', 'flat-app', 'FlatApp', 'no-icon', 'unknown', 'broken'];
  assert.deepEqual(await Promise.all(names.map(name => getProcessIcon({ name }))), [
    browserIcon, flatpakIcon, flatpakIcon, 'gear', 'gear', 'gear',
  ]);
  // Successful and fallback lookups stay cached after the desktop files are gone.
  fs.rmSync(path.join(user, 'applications'), { recursive: true });
  assert.equal(await getProcessIcon({ name: 'browser' }), browserIcon);
  assert.equal(await getProcessIcon({ name: 'broken' }), 'gear');
});
