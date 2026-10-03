/**
 * Stop iOS Safari zooming the page whenever a learner taps into a field.
 *
 * iOS zooms in on focus for any text under 16px, and does not zoom back out,
 * so every tap into the code or a block's number field left a phone learner
 * pinching the page back to size. Making the code 16px avoided it and was too
 * big to read a program on a phone (AB#455).
 *
 * maximum-scale=1 is the documented way to stop it. It is applied on iOS only
 * because only iOS needs it, and because Android honours it as "no pinch-zoom"
 * too, which would take zoom away from anyone who relies on it. iOS has
 * ignored maximum-scale for the user's own pinch since iOS 10, so there the
 * learner keeps pinch-zoom and loses only the unwanted automatic zoom.
 *
 * Returns an undo, for the page that asked for it to call when it leaves.
 */
export function preventIosInputZoom(): () => void {
  if (!isIos()) return () => {};
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta) return () => {};

  const original = meta.content;
  if (!/maximum-scale/.test(original)) meta.content = `${original}, maximum-scale=1`;
  return () => {
    meta.content = original;
  };
}

function isIos(): boolean {
  // iPadOS 13+ reports itself as a Mac; touch points give it away.
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
