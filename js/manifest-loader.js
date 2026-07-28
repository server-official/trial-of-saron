const DataStore = {
  classes: [],
  classByName: {},
  manifest: { training: [], test: [] },

  async load() {
    const [classesRes, manifestRes] = await Promise.all([
      fetch('classes.json'),
      fetch('manifest.json'),
    ]);

    if (!classesRes.ok) throw new Error('classes.json not found');
    if (!manifestRes.ok) throw new Error('manifest.json not found — run scripts/generate_manifest.py or push to trigger the build workflow.');

    const classesJson = await classesRes.json();
    this.classes = classesJson.classes;
    this.classByName = {};
    for (const c of this.classes) this.classByName[c.name] = c;

    this.manifest = await manifestRes.json();

    return this;
  },

  classById(id) {
    return this.classes.find(c => c.id === id);
  },

  async fetchLabel(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Could not load label: ${path}`);
    const text = await res.text();
    return parseYoloLabel(text);
  },
};
