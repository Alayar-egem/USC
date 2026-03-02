const devMode = import.meta.env.DEV;

export const logger = {
  debug(...args: unknown[]) {
    void args;
    if (!devMode) return;
  },
  info(...args: unknown[]) {
    if (devMode) {
      console.info(...args);
    }
  },
  error(...args: unknown[]) {
    console.error(...args);
  },
};
