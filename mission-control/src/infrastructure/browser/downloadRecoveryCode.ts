export function downloadRecoveryCode(code: string) {
  const text = `Mars Rover Mission Control — Recovery Code\n\n${code}\n\nEnter this code on any device to restore your missions and progress.\nKeep it somewhere safe. If you lose it, you can generate a new one from your profile.\n`;
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'recovery-code.txt';
  a.click();
  URL.revokeObjectURL(url);
}
