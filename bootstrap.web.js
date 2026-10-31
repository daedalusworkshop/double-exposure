import { registerRootComponent } from 'expo';
import { Alert } from 'react-native';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

// react-native-web's Alert does nothing, so error messages would vanish.
// Show them with the browser's own dialog instead.
Alert.alert = (title, message) => {
  window.alert([title, message].filter(Boolean).join('\n\n'));
};

// Pinching should zoom the camera, not the page. Android honours the viewport
// meta; iOS Safari ignores it, so also cancel Safari's own pinch (gesture*)
// events and multi-finger touch moves. Double-tap zoom is turned off in CSS.
document
  .querySelector('meta[name="viewport"]')
  ?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no');
const style = document.createElement('style');
style.textContent = 'html,body{touch-action:manipulation;overscroll-behavior:none;background:#080808}';
document.head.appendChild(style);
const block = (e) => e.preventDefault();
['gesturestart', 'gesturechange', 'gestureend'].forEach((t) => document.addEventListener(t, block, { passive: false }));
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

// expo-camera asks the browser for a camera without a size, and Safari then
// streams 640x480. Ask for a full-resolution 4:3 stream instead (the browser
// picks the closest size the camera supports).
const media = navigator.mediaDevices;
if (media?.getUserMedia) {
  const getUserMedia = media.getUserMedia.bind(media);
  media.getUserMedia = (constraints) => {
    const video = constraints?.video;
    if (video && typeof video === 'object' && video.width === undefined && video.height === undefined) {
      constraints = { ...constraints, video: { ...video, width: { ideal: 4032 }, height: { ideal: 3024 } } };
    }
    return getUserMedia(constraints);
  };
}

// Skia needs its WebAssembly file loaded before App.js touches it.
// The file sits next to index.html, which on GitHub Pages is /double-exposure/.
const pageDir = window.location.href.split(/[?#]/)[0].replace(/[^/]*$/, '');

LoadSkiaWeb({ locateFile: (file) => pageDir + file }).then(() => {
  const App = require('./App').default;
  registerRootComponent(App);
});
