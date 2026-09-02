export async function releaseBrowserContext(context, { keepOpen = false } = {}) {
  if (!context) return null;
  if (keepOpen) return context;
  await context.close().catch(() => {});
  return null;
}

export async function closeBrowserContextIfEmpty(context) {
  if (!context || typeof context.pages !== 'function') return false;
  const pages = await context.pages().catch(() => []);
  if (pages.length > 0) return false;
  await context.close().catch(() => {});
  return true;
}
