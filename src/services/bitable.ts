import { bitable, type IAttachmentField, type IOpenAttachment } from '@lark-base-open/js-sdk';

export interface AttachmentFile {
  name: string;
  url: string;
  token: string;
  type: string;
}

/**
 * 初始化飞书多维表格SDK
 */
export async function initBitable() {
  // SDK会自动初始化，这里可以做一些预加载
  return bitable;
}

/**
 * 监听字段选择变化
 * @param callback 当选中附件字段时的回调
 */
export function onFieldSelectionChange(
  callback: (files: AttachmentFile[]) => void
) {
  // 当前选择的单元格信息
  let currentSelection: { tableId: string; recordId: string; fieldId: string } | null = null;
  // 上次获取的文件签名（用于检测变化）
  let lastFilesSignature = '';
  // 轮询定时器
  let pollTimer: ReturnType<typeof setInterval> | null = null;

  // 获取附件文件的函数
  async function fetchAttachments(tableId: string, recordId: string, fieldId: string): Promise<AttachmentFile[]> {
    try {
      const table = await bitable.base.getTableById(tableId);
      const field = await table.getFieldById(fieldId);
      const fieldType = await field.getType();

      // 检查是否是附件字段 (FieldType.Attachment = 17)
      if (fieldType !== 17) {
        return [];
      }

      const attachmentField = field as IAttachmentField;
      const attachments = await attachmentField.getValue(recordId);

      if (!attachments || attachments.length === 0) {
        return [];
      }

      // 过滤出jsx/tsx文件
      const jsxTsxFiles = attachments.filter((att: IOpenAttachment) => {
        const name = att.name.toLowerCase();
        return name.endsWith('.jsx') || name.endsWith('.tsx');
      });

      if (jsxTsxFiles.length === 0) {
        return [];
      }

      // 获取附件URL
      const urls = await attachmentField.getAttachmentUrls(recordId);
      const urlMap = new Map<string, string>();
      urls.forEach((url, index) => {
        if (attachments[index]) {
          urlMap.set(attachments[index].token, url);
        }
      });

      return jsxTsxFiles.map((att: IOpenAttachment) => ({
        name: att.name,
        url: urlMap.get(att.token) || '',
        token: att.token,
        type: att.type,
      }));
    } catch (error) {
      console.error('[Bitable] Error reading attachment field:', error);
      return [];
    }
  }

  // 生成文件列表签名（用于检测变化）
  function getFilesSignature(files: AttachmentFile[]): string {
    return files.map(f => `${f.token}:${f.name}`).sort().join('|');
  }

  // 检查并更新文件列表
  async function checkAndUpdateFiles() {
    if (!currentSelection) return;

    const { tableId, recordId, fieldId } = currentSelection;
    const files = await fetchAttachments(tableId, recordId, fieldId);
    const signature = getFilesSignature(files);

    // 只有文件列表发生变化时才触发回调
    if (signature !== lastFilesSignature) {
      console.log('[Bitable] Files changed:', files.map(f => f.name));
      lastFilesSignature = signature;
      callback(files);
    }
  }

  // 开始轮询
  function startPolling() {
    stopPolling();
    // 每 2 秒检查一次文件变化
    pollTimer = setInterval(checkAndUpdateFiles, 2000);
  }

  // 停止轮询
  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // 监听选择变化
  bitable.base.onSelectionChange(async (event) => {
    const { fieldId, recordId, tableId } = event.data;

    console.log('[Bitable] Selection changed:', { fieldId, recordId, tableId });

    if (!fieldId || !recordId || !tableId) {
      console.log('[Bitable] Missing selection data, clearing');
      currentSelection = null;
      lastFilesSignature = '';
      stopPolling();
      callback([]);
      return;
    }

    // 更新当前选择
    currentSelection = { tableId, recordId, fieldId };

    // 立即获取文件
    const files = await fetchAttachments(tableId, recordId, fieldId);
    const signature = getFilesSignature(files);

    console.log('[Bitable] Files:', files.map(f => f.name));

    lastFilesSignature = signature;
    callback(files);

    // 开始轮询以检测文件变化
    startPolling();
  });

  // 返回清理函数
  return () => {
    stopPolling();
  };
}

/**
 * 下载附件内容
 */
export async function downloadAttachmentContent(url: string): Promise<string> {
  const response = await fetch(url);
  const text = await response.text();
  return text;
}
