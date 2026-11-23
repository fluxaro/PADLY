const secureStorage = new Map();

module.exports = {
  getItemAsync: jest.fn(async (key) => secureStorage.get(key) ?? null),
  setItemAsync: jest.fn(async (key, value) => {
    secureStorage.set(key, String(value));
  }),
  deleteItemAsync: jest.fn(async (key) => {
    secureStorage.delete(key);
  }),
};
