export function buildFolderDialogOptions(options = {}) {
  const defaultPath = typeof options?.defaultPath === 'string' ? options.defaultPath.trim() : '';
  return {
    properties: ['openDirectory'],
    title: '选择视频文件夹',
    ...(defaultPath ? { defaultPath } : {})
  };
}
