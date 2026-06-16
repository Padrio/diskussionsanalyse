const makeArea = () => {
  let store: Record<string, unknown> = {};
  return {
    async get(keys?: string | string[] | null) {
      if (keys == null) return { ...store };
      const list = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]));
    },
    async set(items: Record<string, unknown>) {
      store = { ...store, ...items };
    },
    async remove(key: string) {
      delete store[key];
    },
    async clear() {
      store = {};
    },
  };
};

const browser = { storage: { local: makeArea(), session: makeArea() } };
export default browser;
