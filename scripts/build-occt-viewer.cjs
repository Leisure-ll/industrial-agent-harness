// Rebuild the redistributable renderer entirely from the official OCCT source.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const root = path.resolve(__dirname, '..');
const source = path.resolve(process.argv[2] || '/tmp/harness-occt-7.9.2');
const build = path.resolve(process.argv[3] || 'dist/occt-rebuild');
const revision = 'c5f20409c52bf8f658314d205a0e5d6f0be0969c';
// The same script is distributed beside native/ and source/ in desktop licenses.
const target = process.argv[4]
  ? path.resolve(process.argv[4])
  : fs.existsSync(path.join(__dirname, 'native'))
    ? __dirname
    : path.join(root, 'packages/viewer-builtin/src/cad/occt');
const execute = (bin, args) => execFileSync(bin, args, { stdio: 'inherit' });
const toolchain = execFileSync('emcc', ['--version'], { encoding: 'utf8' }).split('\n')[0];
if (!/\b6\.0\.10\b/.test(toolchain)) throw Error('Use pinned Emscripten 6.0.10.');
let current = revision,
  modified = false;
if (fs.existsSync(path.join(source, '.git'))) {
  current = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  modified =
    current !== revision ||
    Boolean(
      execFileSync('git', ['-C', source, 'status', '--porcelain'], { encoding: 'utf8' }).trim(),
    );
  if (modified && process.env.HARNESS_OCCT_ALLOW_MODIFIED !== '1')
    throw Error(
      'Expected unmodified official OCCT V7_9_2; set HARNESS_OCCT_ALLOW_MODIFIED=1 to relink custom sources.',
    );
}
if (!fs.existsSync(path.join(source, 'src/Standard/Standard.hxx')))
  throw Error('Missing extracted OCCT source tree.');
fs.mkdirSync(build, { recursive: true });
const cache = execFileSync('em-config', ['CACHE'], { encoding: 'utf8' }).trim();
const include = path.join(cache, 'sysroot/include');
const install = path.join(build, 'install');
execute('emcmake', [
  'cmake',
  '-S',
  source,
  '-B',
  path.join(build, 'occt'),
  '-G',
  'Ninja',
  '-DCMAKE_BUILD_TYPE=Release',
  '-DCMAKE_POLICY_VERSION_MINIMUM=3.5',
  '-DBUILD_LIBRARY_TYPE=Static',
  '-DBUILD_MODULE_FoundationClasses=ON',
  '-DBUILD_MODULE_ModelingData=ON',
  '-DBUILD_MODULE_ModelingAlgorithms=ON',
  '-DBUILD_MODULE_Visualization=ON',
  '-DBUILD_MODULE_ApplicationFramework=OFF',
  '-DBUILD_MODULE_DataExchange=OFF',
  '-DBUILD_MODULE_DETools=OFF',
  '-DBUILD_MODULE_Draw=OFF',
  '-DUSE_FREETYPE=OFF',
  '-DUSE_TBB=OFF',
  '-DUSE_TCL=OFF',
  '-DUSE_TK=OFF',
  '-DUSE_OPENGL=OFF',
  '-DUSE_GLES2=ON',
  '-D3RDPARTY_EGL_INCLUDE_DIR=' + include,
  '-D3RDPARTY_GLES2_INCLUDE_DIR=' + include,
  '-DCMAKE_INSTALL_PREFIX=' + install,
]);
execute('cmake', [
  '--build',
  path.join(build, 'occt'),
  '--parallel',
  process.env.HARNESS_OCCT_JOBS || '4',
]);
execute('cmake', ['--install', path.join(build, 'occt')]);
execute('emcmake', [
  'cmake',
  '-S',
  path.join(target, 'native'),
  '-B',
  path.join(build, 'bridge'),
  '-G',
  'Ninja',
  '-DCMAKE_BUILD_TYPE=Release',
  '-DOpenCASCADE_DIR=' + path.join(install, 'lib/cmake/opencascade'),
]);
execute('cmake', ['--build', path.join(build, 'bridge')]);
for (const name of ['harness-occt.js', 'harness-occt.wasm'])
  fs.copyFileSync(path.join(build, 'bridge', name), path.join(target, name));
const manifestFile = path.join(target, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestFile));
if (modified || !fs.existsSync(path.join(source, '.git')))
  manifest.occtModifications = [
    'User-relinked or extracted source tree; original asset provenance requires independent source verification.',
  ];
manifest.revision = current;
for (const file of Object.keys(manifest.files))
  manifest.files[file] = createHash('sha256')
    .update(fs.readFileSync(path.join(target, file)))
    .digest('hex');
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(
  'Built OCCT AIS/V3d WebGL2 renderer and refreshed asset hashes. Rebuild the desktop and run CAD acceptance.',
);
