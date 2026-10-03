const fs = require('node:fs');
const path = require('node:path');
const { readBounded, utf8, MAX_TEXT, MAX_MEDIA } = require('./read.cjs');
const { godotScene, godotScript, godotProject, godotBinary, audio } = require('./godot.cjs');
const { library, rules, project: kicadProject } = require('./kicad.cjs');
const { manufacturing, isManufacturing } = require('./manufacturing.cjs');
const { obj, vrml, step, gltf } = require('./model.cjs');
const { createAssetPlugins } = require('../assets/service.cjs');

const extensions = new Set([
  '.tscn',
  '.tres',
  '.gd',
  '.res',
  '.wav',
  '.ogg',
  '.mp3',
  '.obj',
  '.gltf',
  '.glb',
  '.kicad_sym',
  '.kicad_mod',
  '.kicad_pro',
  '.kicad_dru',
  '.step',
  '.stp',
  '.wrl',
]);
const extensionOf = file => path.extname(file).toLowerCase();
const isEngineeringFile = file =>
  path.basename(file).toLowerCase() === 'project.godot' ||
  extensions.has(extensionOf(file)) ||
  isManufacturing(file);
const manufacturingStem = file =>
  path
    .parse(file)
    .name.replace(
      /[-_.](?:F_Cu|B_Cu|In\d+_Cu|F_Mask|B_Mask|F_SilkS|B_SilkS|F_Paste|B_Paste|Edge_Cuts|PTH|NPTH|drill)(?:[-_.].*)?$/i,
      '',
    );

function relatedManufacturing(file, root) {
  const directory = path.dirname(file),
    stem = manufacturingStem(file),
    selected = path.basename(file);
  const names = fs
    .readdirSync(directory)
    .filter(
      name =>
        name !== selected &&
        isManufacturing(name) &&
        (manufacturingStem(name) === stem || name.startsWith(stem + '-')),
    )
    .sort()
    .slice(0, 15);
  return [file, ...names.map(name => path.join(directory, name))].filter(candidate => {
    try {
      const resolved = fs.realpathSync(candidate);
      return resolved.startsWith(root + path.sep) && fs.statSync(resolved).isFile();
    } catch {
      return false;
    }
  });
}

function createEngineeringPlugins({ projectRoot }) {
  const animation = createAssetPlugins({ projectRoot }).find(item => item.id === 'animation');
  return [
    {
      id: 'engineering',
      matches: isEngineeringFile,
      open: async ({ artifact, file }) => {
        const root = fs.realpathSync(projectRoot());
        const extension = extensionOf(file);
        const binary = ['.res', '.wav', '.ogg', '.mp3', '.glb'].includes(extension);
        const size = binary || extension === '.kicad_sym' ? MAX_MEDIA : MAX_TEXT;
        const source = readBounded(file, root, artifact.sha256, size);
        let data;
        if (path.basename(file).toLowerCase() === 'project.godot')
          data = godotProject(utf8(source.bytes));
        else if (['.tscn', '.tres'].includes(extension)) {
          data = godotScene(utf8(source.bytes), root, file);
          if (animation.matches(file)) {
            try {
              data.animation = (await animation.open({ artifact, file })).data;
            } catch (error) {
              data.warnings.push(`Animation preview unavailable: ${String(error.message)}`);
            }
          }
        } else if (extension === '.gd') data = godotScript(utf8(source.bytes));
        else if (extension === '.res') data = godotBinary(source.bytes);
        else if (['.wav', '.ogg', '.mp3'].includes(extension))
          data = audio(source.bytes, extension);
        else if (extension === '.obj') data = obj(utf8(source.bytes));
        else if (extension === '.gltf' || extension === '.glb')
          data = gltf(source.bytes, extension);
        else if (extension === '.kicad_sym' || extension === '.kicad_mod')
          data = library(utf8(source.bytes), extension);
        else if (extension === '.kicad_pro') data = kicadProject(utf8(source.bytes));
        else if (extension === '.kicad_dru') data = rules(utf8(source.bytes));
        else if (extension === '.step' || extension === '.stp') data = step(utf8(source.bytes));
        else if (extension === '.wrl') data = vrml(utf8(source.bytes));
        else if (isManufacturing(file)) {
          const files = [],
            warnings = [];
          for (const [index, candidate] of relatedManufacturing(file, root).entries()) {
            try {
              const snapshot = index === 0 ? source : readBounded(candidate, root, null, MAX_TEXT);
              files.push({
                name: path.basename(candidate),
                text: utf8(snapshot.bytes),
                sha256: snapshot.sha256,
              });
            } catch (error) {
              if (index === 0) throw error;
              warnings.push(`${path.basename(candidate)}: ${error.message}`);
            }
          }
          data = manufacturing(files, warnings);
        } else throw Error('Unsupported engineering file.');
        return {
          kind: 'engineering',
          artifact,
          data: { ...data, name: artifact.name, sha256: artifact.sha256 },
        };
      },
    },
  ];
}

module.exports = { createEngineeringPlugins, isEngineeringFile, relatedManufacturing };
