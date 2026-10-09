const {
  createProjectRuntime,
  readProjectRecords,
} = require('@industrial-agent-harness/harness-core');

// A project has one persistent fact store, shared by its independent chats.
// Pack changes reset idle sessions before replacing these cached plugins.
class ProjectRuntimes {
  constructor(options = {}) {
    this.options = options;
    this.bundles = new Map();
    this.retiring = new Set();
    this.retirementErrors = [];
  }
  read(project) {
    return readProjectRecords({
      ...this.options,
      projectDir: project.path,
      domain: project.domain,
    });
  }
  get(project, registry) {
    const key = JSON.stringify([project.path, project.domain]);
    const previous = this.bundles.get(key);
    if (previous?.configurationCurrent()) return previous;
    if (previous) {
      const pending = previous.runtime.close();
      const retirement = Promise.resolve(pending)
        .catch(error => this.retirementErrors.push(error))
        .finally(() => this.retiring.delete(retirement));
      this.retiring.add(retirement);
      this.bundles.delete(key);
    }
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
    const errors = [],
      closing = [];
    for (const [key, bundle] of this.bundles) {
      try {
        closing.push(bundle.runtime.close());
        this.bundles.delete(key);
      } catch (error) {
        errors.push(error);
      }
    }
    return Promise.allSettled([...closing, ...this.retiring]).then(results => {
      errors.push(
        ...results.filter(result => result.status === 'rejected').map(result => result.reason),
        ...this.retirementErrors.splice(0),
      );
      if (errors.length) throw new AggregateError(errors, 'Some project runtimes could not close.');
    });
  }
  async reset(project) {
    const key = JSON.stringify([project.path, project.domain]);
    const bundle = this.bundles.get(key);
    if (bundle) await bundle.runtime.close();
    if (this.bundles.get(key) === bundle) this.bundles.delete(key);
  }
}

module.exports = { ProjectRuntimes };
