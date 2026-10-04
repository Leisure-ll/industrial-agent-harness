const { createProjectRuntime } = require('@industrial-agent-harness/harness-core');

// A project has one persistent fact store, shared by its independent chats.
// Pack changes reset idle sessions before replacing these cached plugins.
class ProjectRuntimes {
  constructor(options = {}) {
    this.options = options;
    this.bundles = new Map();
  }
  get(project, registry) {
    const key = JSON.stringify([project.path, project.domain]);
    if (this.bundles.has(key)) return this.bundles.get(key);
    const bundle = createProjectRuntime({
      ...this.options,
      projectDir: project.path,
      domain: project.domain,
      registry,
    });
    if (bundle) this.bundles.set(key, bundle);
    return bundle;
  }
  close() {
    const errors = [];
    for (const [key, bundle] of this.bundles) {
      try {
        bundle.runtime.close();
        this.bundles.delete(key);
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Some project runtimes could not close.');
  }
}

module.exports = { ProjectRuntimes };
