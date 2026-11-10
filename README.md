# Utility Mapper

A phone app (iPhone and Android) for recording where underground utilities are,
how deep they are, and when they were installed — drawn on a map with the
standard colour code:

| Colour | Utility |
| --- | --- |
| Blue | Water |
| Yellow | Gas |
| Red | Power |
| Green | Sewer |
| Orange | Communications |
| White (dashed) | Proposed new utility installation / construction |

## What it does

- **Map** with street and satellite views, your live GPS position, and a colour legend
  that doubles as a show/hide filter per utility.
- **Add a utility** by tapping along it on the map, or by standing over it and pressing
  *Point at my GPS*. One point records a valve/manhole/meter; two or more make a line.
- **Depth at every point**, shown as labels on the map when zoomed in (feet or metres).
- **Date of installation** for each utility (or *planned* installation date for white/proposed work),
  plus name, size, material, how it was located, and notes.
- **List** of everything mapped with length, depth range and install date; tap to zoom, edit or delete.
- **Export / import** as GeoJSON, which opens in QGIS, ArcGIS, Google Earth and most CAD/GIS tools.
- Data is stored on the device. Nothing is uploaded.

## Important limitation

A phone has no sensor that can detect buried pipes or cables. This app **records and maps**
locations and depths that you measure with a utility locator, ground-penetrating radar,
potholing, 811 mark-outs or as-built drawings. Phone GPS is usually only accurate to
3–10 m (10–30 ft). Always call 811 (or your local one-call service) and verify before digging.

## Run it

```bash
npm install
npm run dev      # open the printed URL; use your browser's phone view
npm test         # unit tests
npm run build    # production build in dist/
```

### Install on a phone without the app stores

Host the `dist/` folder on any https site, open it on the phone, then
**Share → Add to Home Screen** (iPhone) or **Menu → Install app** (Android).
It then opens full-screen like a native app and works offline for areas already viewed.

### Build native iOS and Android apps

The project is set up for [Capacitor](https://capacitorjs.com), which wraps the same app
in native shells.

```bash
npm run cap:add      # once: creates the android/ and ios/ projects
npm run android      # build + open in Android Studio
npm run ios          # build + open in Xcode (needs a Mac)
```

After `cap:add`, add the location permission text:

- **iOS** – `ios/App/App/Info.plist`: `NSLocationWhenInUseUsageDescription`
  = "Used to show your position and drop utility points where you stand."
- **Android** – `android/app/src/main/AndroidManifest.xml`:
  `<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />` and
  `<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />`

Before publishing, change `appId` in `capacitor.config.json` to your own identifier, and
check the tile providers' usage terms (OpenStreetMap and Esri World Imagery) for your expected traffic.
