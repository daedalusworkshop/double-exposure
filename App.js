import React, {useRef, useState, useEffect} from 'react';
import {View, Text, Pressable, Image, StyleSheet, PanResponder, AppState, Alert, Linking, Animated, Platform, useWindowDimensions} from 'react-native';
import {CameraView, useCameraPermissions} from 'expo-camera';
import {Skia, BlendMode, ImageFormat} from '@shopify/react-native-skia';
import {captureRef, releaseCapture} from 'react-native-view-shot';
import * as Haptics from 'expo-haptics';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import {manipulateAsync, SaveFormat} from 'expo-image-manipulator';

const MODES=['Average','Lighten','Add','Darken'];
const PREVIEW_BLEND=['normal','lighten','normal','darken'];
// Browsers can't reliably drive the phone's optical zoom, so on the web pinch zooms
// the preview digitally (up to WEB_MAX_ZOOM) and the shot is cropped to match.
const WEB=Platform.OS==='web',WEB_MAX_ZOOM=3;
const webScale=z=>1+z/.25*(WEB_MAX_ZOOM-1);
function photoImportError(error, context) {
 const raw = String(error?.message || error || 'No error details were provided.');
 const code = String(error?.code || 'UNKNOWN');
 const signal = `${code} ${raw}`;
 const asset = context.asset;
 const heic = /heic|heif/i.test(`${asset?.mimeType || ''} ${asset?.fileName || ''}`);
 const label = asset ? `Photo ${context.index + 1}${asset.fileName ? ` (${asset.fileName})` : ''}` : 'The selected photo';
 let title, message, settings = false;
 if (/permission|access denied|not authorized|unauthori[sz]ed/i.test(signal)) {
  title = 'Photo access was denied';
  message = 'Check photo access for Expo Go in Settings, then select the photo again.';
  settings = true;
 } else if (/icloud|network|download|offline|timed?\s*out/i.test(signal)) {
  title = 'Could not retrieve the photo';
  message = `${label} could not be loaded. If it is stored in iCloud, open it in Photos and let it download, then try again with an internet connection.`;
 } else if (/memory|allocation|out of space|disk full|enospc/i.test(signal)) {
  title = 'Not enough resources to import';
  message = `${label} could not be processed. Try a smaller copy; if your phone storage is full, free some space first.`;
 } else if (context.stage === 'convert') {
  title = heic ? 'Could not convert HEIC photo' : 'Could not convert photo';
  message = `${label} could not be converted to JPEG. Try exporting a JPEG or PNG copy and selecting that. The original photo has not been changed.`;
 } else if (context.stage === 'decode') {
  title = 'Could not read converted photo';
  message = `${label} was converted, but Double could not decode the result for blending. Try a different JPEG or PNG copy.`;
 } else {
  title = 'Could not open selected photos';
  message = 'The photo picker could not return a usable image. Try selecting one photo at a time. The cause is not yet known.';
 }
 const details = [`Step: ${context.stage}`, asset ? `Selection: ${context.index + 1}` : '', asset?.mimeType ? `Format: ${asset.mimeType}` : '', `Code: ${code}`, raw.replace(/(?:file|https?|ph):\/\/\S+/gi, '[file reference]').slice(0, 600)].filter(Boolean).join('\n');
 return {title, message: message + '\n\nYour current shots are unchanged.', details, settings};
}
function crop(w,h){const ratio=3/4;const cw=Math.min(w,h*ratio),ch=cw/ratio;return Skia.XYWHRect((w-cw)/2,(h-ch)/2,cw,ch)}
async function blend(a,b,mode){
 const images=await Promise.all([a,b].map(async uri=>{const data=await Skia.Data.fromURI(uri);const img=Skia.Image.MakeImageFromEncoded(data);if(!img)throw Error('Could not decode photo');return img}));
 const w=Math.floor(Math.min(1800,...images.map(i=>Math.min(i.width(),i.height()*3/4)))/3)*3,h=w*4/3;
 const surface=Skia.Surface.MakeOffscreen(w,h);if(!surface)throw Error('Could not render photo');
 try{const canvas=surface.getCanvas(),paint=Skia.Paint(),dst=Skia.XYWHRect(0,0,w,h);
 canvas.drawImageRect(images[0],crop(images[0].width(),images[0].height()),dst,paint);
 if(mode===0)paint.setAlphaf(.5);else paint.setBlendMode([BlendMode.SrcOver,BlendMode.Lighten,BlendMode.Plus,BlendMode.Darken][mode]);
 canvas.drawImageRect(images[1],crop(images[1].width(),images[1].height()),dst,paint);surface.flush();
 const image=surface.makeImageSnapshot();const encoded=image.encodeToBase64(ImageFormat.JPEG,95);image.dispose();paint.dispose();
 return 'data:image/jpeg;base64,'+encoded;
 }finally{images.forEach(i=>i.dispose());surface.dispose()}
}
export default function Double(){
 const [permission,requestPermission]=useCameraPermissions();
 const [first,setFirst]=useState(null),[second,setSecond]=useState(null),[zoom,setZoom]=useState(0);
 const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[active,setActive]=useState(true),[loaded,setLoaded]=useState(false);
 const [mode,setMode]=useState(0),[output,setOutput]=useState(null),[rendering,setRendering]=useState(false),[renderError,setRenderError]=useState(false),[retry,setRetry]=useState(0),[cameraKey,setCameraKey]=useState(0);
 const revision=useRef(0),result=useRef(null),flash=useRef(new Animated.Value(0)).current;
 const dimensions=useWindowDimensions();const landscape=dimensions.width>dimensions.height;
 // Native is locked to portrait; a web page can't be, so landscape puts the controls beside the frame.
 const frameWidth=landscape?Math.max(120,Math.min(dimensions.width*.6,(dimensions.height-24)*.75)):Math.max(120,Math.min(dimensions.width,(dimensions.height-(WEB?196:240))*.75));
 useEffect(()=>{if(!first||!second){setOutput(null);setRendering(false);return}let cancelled=false;setRendering(true);setLoaded(false);setRenderError(false);setOutput(null);const rev=++revision.current;
 blend(first,second,mode).then(uri=>{if(!cancelled&&rev===revision.current)setOutput(uri)}).catch(()=>{if(!cancelled)setRenderError(true)}).finally(()=>{if(!cancelled)setRendering(false)});return()=>{cancelled=true};},[first,second,mode,retry]);
 const camera=useRef(null),lock=useRef(false),zoomRef=useRef(0),pinch=useRef(null);
 const [error,setError]=useState('');
 const [picking, setPicking] = useState(false);
 useEffect(()=>{const sub=AppState.addEventListener('change',s=>{setActive(s==='active');if(s!=='active')setReady(false)});return()=>sub.remove()},[]);
 const distance=t=>Math.hypot(t[0].pageX-t[1].pageX,t[0].pageY-t[1].pageY);
 const gesture=useRef(PanResponder.create({onStartShouldSetPanResponder:e=>e.nativeEvent.touches.length===2,onMoveShouldSetPanResponder:e=>e.nativeEvent.touches.length===2,onPanResponderGrant:e=>{const t=e.nativeEvent.touches;if(t.length===2)pinch.current={distance:distance(t),zoom:zoomRef.current}},onPanResponderMove:e=>{const t=e.nativeEvent.touches;if(t.length!==2)return;if(!pinch.current)pinch.current={distance:distance(t),zoom:zoomRef.current};const z=Math.max(0,Math.min(.25,pinch.current.zoom+(distance(t)-pinch.current.distance)/1500));zoomRef.current=z;setZoom(z)},onPanResponderRelease:()=>{pinch.current=null},onPanResponderTerminate:()=>{pinch.current=null}})).current;
 async function shoot(){if(lock.current||!ready||second)return;lock.current=true;setBusy(true);try{const shot=await camera.current.takePictureAsync({quality:.9});flash.setValue(.65);Animated.timing(flash,{toValue:0,duration:170,useNativeDriver:true}).start();Haptics.selectionAsync().catch(()=>{});let uri=shot.uri;if(WEB&&zoomRef.current>0&&shot.width&&shot.height){const s=webScale(zoomRef.current),cw=Math.round(shot.width/s),ch=Math.round(shot.height/s);uri=(await manipulateAsync(uri,[{crop:{originX:Math.round((shot.width-cw)/2),originY:Math.round((shot.height-ch)/2),width:cw,height:ch}}],{compress:.95,format:SaveFormat.JPEG})).uri}if(!first)setFirst(uri);else{setLoaded(false);setSecond(uri)}}catch(e){Alert.alert('Could not take photo','Please try again.')}finally{setTimeout(()=>{lock.current=false;setBusy(false)},400)}}
 async function pickPhotos() {
  if (lock.current) return;
  lock.current = true;
  setBusy(true);
  setPicking(true);
  const fillingSecond = Boolean(first && !second);
  const importContext = {stage: 'picker', asset: null, index: 0};
  try {
   const selection = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsMultipleSelection: true,
    selectionLimit: fillingSecond ? 1 : 2,
    orderedSelection: true,
    quality: 1,
   });
   if (selection.canceled) return;
   if (!selection.assets?.length) throw Error('The picker returned no images.');

   // Normalize HEIC and photo orientation before handing images to Skia.
   // Commit only after every selected image has converted successfully.
   const photos = [];
   for (const asset of selection.assets.slice(0, fillingSecond ? 1 : 2)) {
    importContext.asset = asset;
    importContext.index = photos.length;
    importContext.stage = 'convert';
    if (!asset.uri) throw Error('The selected photo has no readable file reference.');
    const image = await manipulateAsync(asset.uri, [], {
     compress: 1,
     format: SaveFormat.JPEG,
    });
    importContext.stage = 'decode';
    const data = await Skia.Data.fromURI(image.uri);
    const decoded = Skia.Image.MakeImageFromEncoded(data);
    if (!decoded) throw Error('The converted JPEG could not be decoded by the blend renderer.');
    decoded.dispose();
    photos.push(image.uri);
   }
   setLoaded(false);
   setOutput(null);
   setRenderError(false);
   if (fillingSecond) {
    setSecond(photos[0]);
   } else {
    setFirst(photos[0]);
    setSecond(photos[1] || null);
   }
  } catch (error) {
   const info = photoImportError(error, importContext);
   Alert.alert(info.title, info.message, [
    {text: 'OK', style: 'cancel'},
    {text: 'Details', onPress: () => Alert.alert(info.title, info.details)},
    ...(info.settings ? [{text: 'Settings', onPress: () => Linking.openSettings()}] : []),
   ]);
  } finally {
   // Remount after the system picker so the camera-ready event runs again.
   setReady(false);
   setCameraKey(key => key + 1);
   setPicking(false);
   lock.current = false;
   setBusy(false);
  }
 }
 function startNew() {
  if (lock.current) return;
  setFirst(null);
  setSecond(null);
  setReady(false);
  setOutput(null);
  setLoaded(false);
 }
 function cycleMode() {
  if (lock.current) return;
  if (second) {
   setLoaded(false);
   setRendering(true);
  }
  setMode(value => (value + 1) % MODES.length);
 }
 // Web: the blend is already a full-resolution JPEG data URI, so share or download it directly.
 async function saveWeb(){const blob=await (await fetch(output)).blob();const file=new File([blob],`double-${Date.now()}.jpg`,{type:'image/jpeg'});if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file]})}catch(e){if(e?.name!=='AbortError')throw e}return}const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=file.name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
 async function save(){if(lock.current||!loaded||!output||rendering)return;lock.current=true;setBusy(true);if(Platform.OS==='web'){try{await saveWeb()}catch(e){Alert.alert('Could not save','Your photos are still here. Try again.')}finally{lock.current=false;setBusy(false)}return}let exported;try{exported=await captureRef(result,{format:'jpg',quality:1,result:'tmpfile'});const uri=exported;if(await Sharing.isAvailableAsync())await Sharing.shareAsync(uri,{mimeType:'image/jpeg',UTI:'public.jpeg'});else Alert.alert('Sharing unavailable','Try this prototype on your iPhone.')}catch(e){if(e?.name!=='AbortError')Alert.alert('Could not share','Your photos are still here. Try again.')}finally{if(exported)releaseCapture(exported);lock.current=false;setBusy(false)}}
 function undo(){if(lock.current)return;if(second){setSecond(null);setReady(false)}else setFirst(null)}
 const button = (label, action, disabled = false, secondary = false, icon = null) => (
  <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={action} style={[styles.button, icon && styles.iconButton, disabled && {opacity: .35}]}>
   {icon && <View accessible={false} style={styles.smallIcon}>
    <View style={styles.iconHorizontal}/>
    {icon === 'plus' ? <View style={styles.iconVertical}/> : <View style={styles.iconArrowHead}/>}
   </View>}
   <Text style={[styles.text, secondary && styles.secondaryText]}>{label}</Text>
  </Pressable>
 );
 if(!permission)return <View style={styles.root}><Text style={styles.text}>Opening camera…</Text></View>;

 const header=(<View style={styles.header}>{first?button(second?'Retake':'Undo',undo,busy,true,'arrow'):<View style={{width:90}}/>}<Text accessibilityLabel={second?'Two photos taken':first?'One photo taken':'No photos taken'} style={styles.text}>{first?'●':'○'}  {second?'●':'○'}</Text>{second?button('New',startNew,busy,true,'plus'):<View style={{width:90}}/>}</View>);
 const frame=(
 <View style={[styles.frame,{width:frameWidth,alignSelf:"center"}]}>
 {!second&&active&&!picking&&permission.granted&&<View pointerEvents="none" style={[StyleSheet.absoluteFill,WEB&&{transform:[{scale:webScale(zoom)}]}]}><CameraView key={cameraKey} ref={camera} style={StyleSheet.absoluteFill} facing="back" zoom={WEB?0:zoom} onCameraReady={()=>{setReady(true);setError('')}} onMountError={e=>{setError(e.message);setReady(false)}}/></View>}
 {/* Native layer blending keeps the first photo composited with every live camera frame.
     Average and Add start at 50/50. Color dodge by middle gray doubles that
     average, clipping highlights like Skia Plus (within 8-bit rounding). */}
 {!second&&first&&<View pointerEvents="none" collapsable={false} style={[StyleSheet.absoluteFill,{mixBlendMode:PREVIEW_BLEND[mode],opacity:mode===0||mode===2?.5:1}]}><Image source={{uri:first}} style={StyleSheet.absoluteFill} resizeMode="cover" fadeDuration={0}/></View>}
 {!second&&first&&mode===2&&<View pointerEvents="none" collapsable={false} style={[StyleSheet.absoluteFill,{backgroundColor:'#808080',mixBlendMode:'color-dodge'}]}/> }
 {!second&&<View style={[StyleSheet.absoluteFill,WEB&&{touchAction:'none'}]} {...gesture.panHandlers}/>}
 {second&&output&&<View ref={result} collapsable={false} style={StyleSheet.absoluteFill}><Image source={{uri:output}} onLoad={()=>setLoaded(true)} onError={()=>setRenderError(true)} style={StyleSheet.absoluteFill} resizeMode="contain"/></View>}
 {second&&renderError&&<View style={styles.center}><Text style={styles.text}>Could not blend. Your photos are safe.</Text>{button('Retry',()=>setRetry(n=>n+1))}</View>}
 <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill,{backgroundColor:'#fff',opacity:flash}]}/>
 {!second&&!permission.granted&&<View style={styles.center}>{button(permission.canAskAgain?'Allow camera':'Open Settings',permission.canAskAgain?requestPermission:()=>Linking.openSettings(),busy)}</View>}
 {!second&&!!error&&<View style={styles.center}><Text style={styles.text}>Camera unavailable</Text>{button("Retry",()=>{setError("");setReady(false);setCameraKey(n=>n+1)})}</View>}
 </View>);
 const caption=(<Text style={styles.caption}>{picking?'OPENING PHOTOS…':second?(rendering?'BLENDING…':'YOUR DOUBLE'):busy?'CAPTURING…':!permission.granted?'CHOOSE PHOTOS OR ALLOW CAMERA':!ready?'STARTING CAMERA…':first?'SECOND PHOTO':'FIRST PHOTO'}</Text>);
 const bar=(
 <View style={styles.bar}>
  {!second ? button('Photos', pickPhotos, busy, true) : <View style={{width:90}}/>}
  {second ? (
   <Pressable accessibilityRole="button" accessibilityLabel="Save photo" disabled={busy || !loaded || rendering || !output} onPress={save} style={[styles.shutter, styles.saveButton, (busy || !loaded || rendering || !output) && {opacity: .35}]}>
    <View accessible={false} style={styles.downloadIcon}>
     <View style={styles.downloadStem}/>
     <View style={styles.downloadArrow}/>
     <View style={styles.downloadTray}/>
    </View>
   </Pressable>
  ) : (
   <Pressable accessibilityRole="button" accessibilityLabel={first ? 'Take second photo' : 'Take first photo'} disabled={busy || !ready} onPress={shoot} style={[styles.shutter, (busy || !ready) && {opacity: .35}]}>
    <View style={styles.shutterFill}/>
   </Pressable>
  )}
  {button(MODES[mode], cycleMode, busy, true)}
 </View>);
 if(landscape)return <View style={[styles.root,styles.rootLandscape]}>{frame}<View style={styles.side}>{header}{caption}{bar}</View></View>;
 return <View style={[styles.root,WEB&&{paddingTop:16}]}>{header}{frame}{caption}{bar}</View>;
}
const styles=StyleSheet.create({
 secondaryText: {color: '#aaa'},
 iconButton: {flexDirection: 'row', gap: 7},
 smallIcon: {width: 14, height: 14},
 iconHorizontal: {position: 'absolute', left: 1, top: 6.25, width: 12, height: 1.5, backgroundColor: '#aaa'},
 iconVertical: {position: 'absolute', left: 6.25, top: 1, width: 1.5, height: 12, backgroundColor: '#aaa'},
 iconArrowHead: {position: 'absolute', left: 2, top: 3, width: 8, height: 8, borderLeftWidth: 1.5, borderBottomWidth: 1.5, borderColor: '#aaa', transform: [{rotate: '45deg'}]},
root:{flex:1,backgroundColor:'#080808',paddingTop:60,paddingBottom:30},rootLandscape:{flexDirection:'row',alignItems:'center',paddingTop:12,paddingBottom:12,paddingHorizontal:12,gap:12},side:{flex:1,alignSelf:'stretch',justifyContent:'center'},center:{flex:1,alignItems:'center',justifyContent:'center',gap:18},header:{height:50,flexDirection:'row',justifyContent:'space-between',alignItems:'center',paddingHorizontal:12},frame:{width:'100%',aspectRatio:3/4,backgroundColor:'#111',overflow:'hidden',isolation:'isolate'},text:{color:'#f2f1ee',fontSize:12,letterSpacing:1,fontFamily:'Courier',textAlign:'center'},caption:{color:'#aaa',fontSize:10,letterSpacing:1,textAlign:'center',marginTop:20},bar:{flex:1,minHeight:95,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:20},button:{minHeight:48,minWidth:90,alignItems:'center',justifyContent:'center'},shutter:{width:74,height:74,borderWidth:1,borderColor:'#f2f1ee',borderRadius:37,padding:6},saveButton:{alignItems:'center',justifyContent:'center'},downloadIcon:{width:28,height:30},downloadStem:{position:'absolute',top:1,left:13,width:2,height:19,backgroundColor:'#f2f1ee'},downloadArrow:{position:'absolute',top:12,left:8,width:12,height:12,borderRightWidth:2,borderBottomWidth:2,borderColor:'#f2f1ee',transform:[{rotate:'45deg'}]},downloadTray:{position:'absolute',bottom:0,left:1,width:26,height:8,borderLeftWidth:2,borderRightWidth:2,borderBottomWidth:2,borderColor:'#f2f1ee'},shutterFill:{flex:1,backgroundColor:'#f2f1ee',borderRadius:32}});
