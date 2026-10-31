import { registerRootComponent } from 'expo';
import { Alert } from 'react-native';
import { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

// react-native-web's Alert does nothing, so error messages would vanish.
// Show them with the browser's own dialog instead.
Alert.alert = (title, message) => {
  window.alert([title, message].filter(Boolean).join('\n\n'));
};

// Skia needs its WebAssembly file loaded before App.js touches it.
// The file sits next to index.html, which on GitHub Pages is /double-exposure/.
const pageDir = window.location.href.split(/[?#]/)[0].replace(/[^/]*$/, '');

LoadSkiaWeb({ locateFile: (file) => pageDir + file }).then(() => {
  const App = require('./App').default;
  registerRootComponent(App);
});
