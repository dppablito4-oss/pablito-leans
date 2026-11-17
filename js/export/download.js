/** Send every export through the browser's normal download manager. */
export function downloadBlob(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Give the browser time to start reading large files before releasing them.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}
