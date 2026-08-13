import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { AppState, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import WebView from "react-native-webview";

export type HtmlMapHostHandle = {
  injectJavaScript: (script: string) => void;
};

type Props = {
  html: string;
  baseUrl?: string;
  style?: StyleProp<ViewStyle>;
  onLoad?: () => void;
};

const INVALIDATE =
  "try{if(typeof map!=='undefined')map.invalidateSize({animate:false});}catch(e){} true;";

export const HtmlMapHost = forwardRef<HtmlMapHostHandle, Props>(function HtmlMapHost(
  { html, baseUrl = "https://openstreetmap.org", style, onLoad },
  ref,
) {
  const webViewRef = useRef<WebView>(null);
  // Freeze the first document — a new `html` string on every parent render
  // reloads the WebView and leaves a gray tile-less map.
  const sourceRef = useRef({ html, baseUrl });

  useImperativeHandle(ref, () => ({
    injectJavaScript(script: string) {
      webViewRef.current?.injectJavaScript(script);
    },
  }));

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        webViewRef.current?.injectJavaScript(INVALIDATE);
      }
    });
    return () => sub.remove();
  }, []);

  function handleLoad() {
    webViewRef.current?.injectJavaScript(INVALIDATE);
    onLoad?.();
  }

  function recover() {
    webViewRef.current?.reload();
  }

  return (
    <View style={[styles.container, style]}>
      <WebView
        ref={webViewRef}
        originWhitelist={["*"]}
        source={sourceRef.current}
        style={styles.fill}
        onLoadEnd={handleLoad}
        onContentProcessDidTerminate={recover}
        onRenderProcessGone={recover}
        javaScriptEnabled
        domStorageEnabled
        cacheEnabled
        cacheMode="LOAD_DEFAULT"
        mixedContentMode="always"
        androidLayerType="hardware"
        setSupportMultipleWindows={false}
        overScrollMode="never"
        startInLoadingState={false}
        scalesPageToFit={false}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1, overflow: "hidden", backgroundColor: "#e8e0d8" },
  fill: { flex: 1, backgroundColor: "#e8e0d8" },
});
